/**
 * The per-session soft-switch transaction (design §4, ticket 03).
 *
 * switch(agent, nextId) — serialized per session (a promise chain keyed by
 * sessionId, so concurrent switches queue and apply in order at turn
 * boundaries):
 *
 *   1. turn-boundary wait: never interrupt a running turn — when the agent
 *      reports a non-idle status and exposes whenIdle(), the transaction
 *      chains after it (defensive: absence degrades to applying now);
 *   2. resolve the card from the registry — broken/missing ids answer with
 *      an error text listing the experts, never a silent no-op;
 *   3. dispose the current composition in reverse order;
 *   4. re-stamp the target folder's generation (mtime+size) BEFORE compose;
 *   5. append the `expert/selected` session event BEFORE the composition
 *      commit (aligning the agent-presets precedent — the recorded event is
 *      what later turns/replays reconstruct the composition from);
 *   6. compose the next expert inside the agent's scoped context;
 *   7. agent.inject() the switch notice so it lands in the next admitted
 *      request (defensive: a missing/throwing inject degrades to a warning).
 *
 * The `expert/selected` append uses the Session.append contract verified in
 * the harness source (dsh-agent-presets: `agent.session.append(type, data)`
 * with JSON data; the event-type table is merge-extensible and the runtime
 * validates only the payload's JSON-serializability). Any append failure
 * degrades to ONE warning + a TODO marker (design DEVIATIONS note).
 */

import { randomUUID } from 'node:crypto'

import { compose } from './compose.js'

/** Session event type recorded on every selection/switch (design §6). */
export const EXPERT_SELECTED_EVENT = 'expert/selected'

/** Session event type recorded when the expert role is removed (symmetric). */
export const EXPERT_CLEARED_EVENT = 'expert/cleared'

/** Render thrown values as one line. */
function messageOf(error) {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '<unrenderable>'
  }
}

/** Valid cards only, keyed by id. */
function validExpertsOf(result) {
  return (result.experts ?? []).filter((expert) => expert.broken === undefined)
}

/** The switch notice injected for the next admitted model request. */
export function switchNotice(previousId, nextCard) {
  const next = `${nextCard.displayName ?? nextCard.id}（${nextCard.id}）`
  return previousId === undefined || previousId === null
    ? `已采用专家角色 ${next}；后续按该角色的说明与 skill 工作。会话历史全部保留。`
    : `已从专家 ${previousId} 切换为 ${next}；后续按新角色与 skill 工作。会话历史全部保留。`
}

/**
 * Create the switch-transaction manager.
 * @param {object} options
 * @param {{list: () => Promise<{experts: object[], warnings: string[]}>}} options.registry
 * @param {object} [options.logger] - { warn(message) }
 * @returns {{
 *   switch: (agent: object, nextId: string) => Promise<{kind: 'success'|'error', text: string}>,
 *   clear: (agent: object) => Promise<{kind: 'success'|'error', text: string}>,
 *   stateOf: (sessionId: string) => {id: string, generation: Array} | undefined,
 *   composeForCreation: (agent: object, expertId: string) => Promise<{kind: 'success'|'error', text: string}>,
 * }}
 */
export function createSwitcher({ registry, logger = {} }) {
  const warn = logger.warn ?? (() => {})
  /** sessionId → tail of the serialized transaction chain. */
  const chains = new Map()
  /** sessionId → current composition state ({ id, composition }). */
  const states = new Map()

  /** Chain one transaction after every previous one for this session. */
  function enqueue(sessionId, run) {
    const tail = (chains.get(sessionId) ?? Promise.resolve()).then(run, run)
    chains.set(sessionId, tail.catch(() => {}))
    return tail
  }

  /** Append the expert/selected event before the composition commit. */
  function recordSelection(agent, nextId, previousId) {
    try {
      agent.session.append(EXPERT_SELECTED_EVENT, { expert: nextId, previous: previousId ?? null })
    } catch (error) {
      // TODO(ticket 05): register a real `expertState` session projection via
      // ctx.sessionProjections so stateOf() reads the durable fold, not this
      // in-memory map. Event append failed here — degrade to one warning.
      warn(`dsh-workbuddy-expert: appending ${EXPERT_SELECTED_EVENT} failed (${messageOf(error)}) — the switch still committed; the durable log misses this selection record`)
    }
  }

  /** Never interrupt streaming: chain after the running turn when possible. */
  async function waitForTurnBoundary(agent) {
    if (agent !== null && typeof agent === 'object' && agent.status !== undefined && agent.status !== 'idle'
      && typeof agent.whenIdle === 'function') {
      try {
        await agent.whenIdle()
      } catch (error) {
        warn(`dsh-workbuddy-expert: whenIdle() rejected during a queued switch (${messageOf(error)}) — applying at the next boundary anyway`)
      }
    }
  }

  /** The transaction body (already serialized for this session). */
  async function runSwitch(agent, nextId) {
    await waitForTurnBoundary(agent)

    const sessionId = agent?.id
    const result = await registry.list()
    const card = validExpertsOf(result).find((expert) => expert.id === nextId)
    if (card === undefined) {
      const broken = (result.experts ?? []).find((expert) => expert.id === nextId)
      const reason = broken !== undefined ? `（broken: ${broken.broken}）` : ''
      const available = validExpertsOf(result).map((expert) => expert.id)
      const text = [`/expert ${nextId}: 无此可用专家${reason}。可用专家：${available.length > 0 ? available.join(', ') : '（无）'}`,
        ...(result.warnings ?? []).map((w) => `⚠ ${w}`)].join('\n')
      return { kind: 'error', text }
    }

    const current = states.get(sessionId)
    if (current !== undefined && current.id === card.id) {
      return { kind: 'success', text: `当前已是专家 ${card.id}，无需切换。` }
    }

    // Dispose the current composition first (reverse order inside), so a
    // same-named re-registration never hits the layered first-wins warning.
    if (current !== undefined) {
      try {
        current.composition.dispose()
      } catch (error) {
        warn(`dsh-workbuddy-expert: disposing the previous composition threw (${messageOf(error)}) — continuing the switch`)
      }
      states.delete(sessionId)
    }

    // Event BEFORE the composition commit (agent-presets precedent).
    recordSelection(agent, card.id, current?.id)

    let composition
    try {
      composition = await compose(agent, card, { warn })
    } catch (error) {
      return { kind: 'error', text: `/expert ${card.id}: 组装失败（${messageOf(error)}）。当前会话未绑定任何专家；可用 /expert <id> 重试。` }
    }
    states.set(sessionId, { id: card.id, composition })

    // The notice lands in the next admitted request (verified: inject queues
    // model-facing context without waking the driver).
    try {
      agent.inject?.(injectMessage(switchNotice(current?.id ?? null, card)))
    } catch (error) {
      warn(`dsh-workbuddy-expert: agent.inject() failed after the switch to "${card.id}" (${messageOf(error)}) — the notice was not queued; the composition is still active`)
    }

    return { kind: 'success', text: `已切换为专家 ${card.id}（${card.displayName ?? card.id}）。角色与 skill 在下一个模型请求边界生效，会话历史保持不变。` }
  }

  /** The clear transaction body (already serialized for this session). */
  async function runClear(agent) {
    await waitForTurnBoundary(agent)

    const sessionId = agent?.id
    const current = states.get(sessionId)
    if (current === undefined) {
      return { kind: 'success', text: '当前会话未绑定专家，无需移除。' }
    }

    try {
      current.composition.dispose()
    } catch (error) {
      warn(`dsh-workbuddy-expert: disposing the composition during a clear threw (${messageOf(error)}) — continuing the clear`)
    }
    states.delete(sessionId)

    // The removal record — symmetric to expert/selected so the durable log
    // stays replayable (a later selection's `previous` reads null again).
    try {
      agent.session.append(EXPERT_CLEARED_EVENT, { previous: current.id })
    } catch (error) {
      warn(`dsh-workbuddy-expert: appending ${EXPERT_CLEARED_EVENT} failed (${messageOf(error)}) — the clear still committed; the durable log misses this removal record`)
    }

    try {
      agent.inject?.(injectMessage(`已移除专家 ${current.id}。会话恢复默认 agent 行为，会话历史全部保留。`))
    } catch (error) {
      warn(`dsh-workbuddy-expert: agent.inject() failed after clearing "${current.id}" (${messageOf(error)}) — the notice was not queued; the composition is still removed`)
    }

    return { kind: 'success', text: `已移除专家 ${current.id}，会话恢复默认 agent。移除在下一个模型请求边界生效，会话历史保持不变。` }
  }

  return {
    /** Serialized soft-switch transaction for one session. */
    switch(agent, nextId) {
      const sessionId = agent?.id
      if (sessionId === undefined) return Promise.resolve({ kind: 'error', text: '/expert: 缺少当前会话的 agent 上下文，无法切换。' })
      return enqueue(sessionId, () => runSwitch(agent, nextId))
    },

    /**
     * Serialized clear transaction for one session: dispose the current
     * expert composition and return the session to the default agent.
     * Mirrors runSwitch's ordering rules (turn boundary, event, notice) —
     * the `expert/cleared` event keeps the durable log symmetric so a
     * future replay sees the removal, not just selections.
     */
    clear(agent) {
      const sessionId = agent?.id
      if (sessionId === undefined) return Promise.resolve({ kind: 'error', text: '/expert off: 缺少当前会话的 agent 上下文，无法移除专家。' })
      return enqueue(sessionId, () => runClear(agent))
    },

    /** Current composition state for one session (in-memory projection). */
    stateOf(sessionId) {
      const state = states.get(sessionId)
      return state === undefined ? undefined : { id: state.id, generation: state.composition.generation }
    },

    /**
     * Session-creation compose (ticket 05's UI concern calls this after
     * creating an agent with a chosen expert): same transaction, first
     * selection wording.
     */
    composeForCreation(agent, expertId) {
      const sessionId = agent?.id
      if (sessionId === undefined) return Promise.resolve({ kind: 'error', text: 'experts: 缺少 agent 上下文，无法组装专家。' })
      return enqueue(sessionId, () => runSwitch(agent, expertId))
    },
  }
}

/** Build one injected UserMessage (dsh-llm createUserMessage shape). */
function injectMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-workbuddy-expert', form: 'notice', summary: 'expert switch' },
  }
}
