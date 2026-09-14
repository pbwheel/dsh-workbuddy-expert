/**
 * Expert tools.allow whitelist mounting (design §4 step c, ticket 10).
 *
 * Host contract — VERIFIED against the harness dsh-tools source (design §11
 * row 1; previously signature-level only, now implementation-level):
 *
 *   tools.restrict({ allow: string[], deny?: string[] }) → () => void
 *
 *   - requires a SCOPED context (agent.ctx) — a context-global restriction
 *     throws ("would mask every agent");
 *   - unknown global tool names throw loudly with the known-name list (the
 *     host's job — this plugin passes declared names through verbatim);
 *   - `{ allow: [] }` is NOT a no-op: an empty set admits nothing, which is
 *     why the registry maps a declared-empty list to "no restriction"
 *     (design: 空 = 不限制) and this mount returns early without calling;
 *   - restrictions intersect with preset tool rows (#01 conclusion) and lift
 *     via the returned disposer.
 */

/** Prompt-only fallback paragraph (degraded path). */
export function toolsAllowlistParagraph(allow) {
  return `该专家声明了工具白名单 tools.allow（${allow.join('、')}）。请只使用以上列出的工具完成任务；白名单之外的工具不可用。`
}

/** Render thrown values as one line. */
function messageOf(error) {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '<unrenderable>'
  }
}

/**
 * Mount the expert's tools.allow restriction on the AGENT's scoped context.
 *
 * Degrade contract (one warning, never a hard failure): when the tools
 * service is absent, `restrict` is not callable, or the call throws (e.g.
 * the host rejects an unknown global tool name), no restriction is mounted
 * and a prompt-only allowlist paragraph is returned for the caller to append
 * to the role section.
 *
 * @param {object} agentCtx - the agent-scoped cordis context (agent.ctx)
 * @param {string[]} allow - declared tool names (verbatim; unknown names are
 *   the host's loud error, not ours). Empty/absent → no restriction at all.
 * @param {{warn?: (message: string) => void}} [logger]
 * @param {string} [expertId] - expert id for warnings
 * @returns {{ dispose: () => void, paragraph: string }}
 */
export function mountToolsAllowlist(agentCtx, allow, logger = {}, expertId = '?') {
  const warn = logger.warn ?? (() => {})
  const noop = () => {}
  if (!Array.isArray(allow) || allow.length === 0) {
    // Design: 空 = 不限制 — an empty declaration mounts nothing, calls
    // nothing, and never reaches the host (which would read `allow: []` as
    // "admit nothing").
    return { dispose: noop, paragraph: '' }
  }

  const toolsService = typeof agentCtx.get === 'function' ? agentCtx.get('tools') : undefined
  if (toolsService === undefined || typeof toolsService.restrict !== 'function') {
    warn(`dsh-workbuddy-expert: the tools.restrict contract is unavailable — expert "${expertId}" tools.allow (${allow.join(', ')}) degrades to a prompt-only allowlist; the session tools are NOT hard-restricted`)
    return { dispose: noop, paragraph: toolsAllowlistParagraph(allow) }
  }

  try {
    // Field shape confirmed in the harness source ({ allow, deny? }) — no
    // alternative-shape retry is needed; a throw here is a genuine contract
    // violation (scoped-context missing, unknown global tool name, reserved
    // transport name) and falls through to the degrade path below.
    const dispose = toolsService.restrict({ allow })
    if (typeof dispose !== 'function') throw new Error(`tools.restrict returned a ${typeof dispose}, not a disposer`)
    return { dispose, paragraph: '' }
  } catch (error) {
    warn(`dsh-workbuddy-expert: tools.restrict({ allow }) failed for expert "${expertId}" (${messageOf(error)}) — tools.allow degrades to a prompt-only allowlist; the session tools are NOT hard-restricted`)
    return { dispose: noop, paragraph: toolsAllowlistParagraph(allow) }
  }
}
