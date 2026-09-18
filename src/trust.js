/**
 * Script trust gating (design §1 rank table, §5.d; ticket 04).
 *
 * Reality check: expert skills run scripts because SKILL.md INSTRUCTS the
 * model to call the bash tool — there is no per-skill interception point in
 * the harness. This plugin therefore gates at the layers it owns:
 *
 *   1. the card: `trust_scripts` (expert.yml, default false) → computed
 *      `scriptsAllowed` (user-rank roots and trusted extra roots are always
 *      allowed; project rank requires the explicit declaration);
 *   2. the prompt: an untrusted project expert carries a guard paragraph
 *      telling the model NOT to run its scripts/ and how to unlock them;
 *      a trusting project expert carries a one-time (per composition)
 *      release notice;
 *   3. hard enforcement: mountScriptGuard() registers one guard through the
 *      VERIFIED dsh-tools contract `tools.guard(execution => reason |
 *      undefined)` (packages/core/tools/src/index.ts — a monotonic denial
 *      check evaluated after the tools/pre-execute waterfall; registered on
 *      the agent scoped context it applies only to that agent). The command
 *      string is read from the ToolExecution field `arguments` (the parsed
 *      tool-call JSON, e.g. `{ command }` for the bash tool). Any missing or
 *      throwing piece degrades to the prompt-paragraph-only path with ONE
 *      warning — never a fiber crash.
 */

import { join, sep } from 'node:path'

/** Guard paragraph for an untrusted project-rank expert (design §5.d). */
export const SCRIPT_GUARD_PARAGRAPH =
  '该专家来自项目仓库且未声明信任脚本（expert.yml trust_scripts）——请勿执行其 scripts/ 下的任何脚本；用户要求时提示需在 expert.yml 声明 trust_scripts: true。'

/** One-time (per composition) release notice for a trusting project expert. */
export const SCRIPT_TRUST_NOTICE_PARAGRAPH =
  '该专家声明执行项目仓库脚本，已按信任放行。'

/**
 * Whether this expert's scripts/ may run: user-rank roots (and trust: user
 * extra roots) are always allowed; project rank requires `trust_scripts: true`.
 * @param {object} expertCard - registry card
 * @returns {boolean}
 */
export function scriptsAllowedFor(expertCard) {
  if (expertCard === null || typeof expertCard !== 'object') return false
  if (expertCard.trust === 'user') return true
  return expertCard.trustScripts === true
}

/**
 * The trust paragraph for the role section: guard (untrusted project),
 * release notice (trusting project), or '' (user rank — nothing appended).
 * @param {object} expertCard - registry card
 * @returns {string}
 */
export function trustParagraph(expertCard) {
  if (scriptsAllowedFor(expertCard)) {
    return expertCard?.trust === 'project' ? SCRIPT_TRUST_NOTICE_PARAGRAPH : ''
  }
  return expertCard?.trust === 'project' ? SCRIPT_GUARD_PARAGRAPH : ''
}

/**
 * Does a shell command string reference this expert's scripts/ directory?
 * Matches the absolute path (`<dir>/scripts…`, both separators) and the
 * portable `<id>/skills/<skill>/scripts/…` segment SKILL.md bodies use.
 * Deliberately conservative: plain `scripts/` without the expert context
 * never matches, so other tools' scripts are untouched.
 * @param {string} command - the command string a tool is about to run
 * @param {object} expertCard - registry card (dir, id)
 * @returns {boolean}
 */
export function commandTargetsExpertScripts(command, expertCard) {
  if (typeof command !== 'string' || command === '') return false
  const dir = typeof expertCard?.dir === 'string' ? expertCard.dir : ''
  if (dir !== '') {
    const scriptsAbs = join(dir, 'scripts')
    const normalized = command.replaceAll('\\', '/')
    if (command.includes(scriptsAbs) || normalized.includes(scriptsAbs.replaceAll('\\', '/'))) return true
    if (normalized.includes(`${scriptsAbs.replaceAll(sep, '/')}/`)) return true
  }
  const id = typeof expertCard?.id === 'string' ? expertCard.id : ''
  if (id !== '' && new RegExp(`(^|[\\s'"=/])((\\./)?[^\\s'"=]*/)?${id}/skills/[^\s'"=]*/scripts/`).test(command.replaceAll('\\', '/'))) {
    return true
  }
  return false
}

/**
 * Pull a plausible command string out of a ToolExecution. The verified field
 * is `arguments` (the parsed tool-call JSON; the bash tool carries its
 * command at `arguments.command`); the remaining probes stay for defensive
 * parity with unknown tool shapes.
 * @param {object} execution - a dsh-tools ToolExecution
 * @returns {string}
 */
function commandOf(execution) {
  if (execution === null || typeof execution !== 'object') return ''
  const args = execution.arguments
  const candidates = [
    args?.command,
    execution.command,
    args?.args?.command,
    args?.input?.command,
    args?.parameters?.command,
    typeof args === 'string' ? args : '',
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
  }
  return ''
}

/**
 * The denial reason the guard returns for a call referencing this expert's
 * scripts/ directory (dsh-tools renders it as the call's error result).
 * @param {object} expertCard - registry card
 * @returns {string}
 */
function scriptDenialReason(expertCard) {
  return `该专家（${expertCard.id}）来自项目仓库且未声明 trust_scripts: true，`
    + '其 scripts/ 下的脚本已被拒绝执行；请在 expert.yml 声明 trust_scripts: true 后重试。'
}

/**
 * Hard enforcement for an untrusted project expert: register one
 * `tools.guard(execution => reason | undefined)` on the AGENT's scoped
 * context (applies only to that agent; evaluated before every tool body).
 * The guard denies any call whose command string references the expert's
 * scripts/ directory and returns undefined otherwise. Every step stays
 * defensive: a missing tools service or guard, or a throwing registration,
 * degrades to the prompt-paragraph-only path with exactly one warning, and
 * the returned disposer is always safe.
 *
 * @param {object} agentCtx - the agent-scoped cordis context
 * @param {object} expertCard - registry card
 * @param {{warn?: (message: string) => void}} [logger]
 * @returns {() => void} disposer (no-op when nothing was mounted)
 */
export function mountScriptGuard(agentCtx, expertCard, logger = {}) {
  const warn = logger.warn ?? (() => {})
  const noop = () => {}
  try {
    if (scriptsAllowedFor(expertCard)) return noop
    const tools = typeof agentCtx?.get === 'function' ? agentCtx.get('tools') : undefined
    const guard = tools?.guard
    if (tools === undefined || typeof guard !== 'function') {
      warn(`dsh-workbuddy-expert: expert "${expertCard.id}" 的脚本硬拦截不可用（无 tools.guard 契约）——已降级为仅提示段落门控`)
      return noop
    }
    let unguard = null
    try {
      unguard = guard(function expertScriptGuard(execution) {
        const command = commandOf(execution)
        return command !== '' && commandTargetsExpertScripts(command, expertCard)
          ? scriptDenialReason(expertCard)
          : undefined
      })
    } catch (error) {
      warn(`dsh-workbuddy-expert: tools.guard 拒绝注册脚本拦截（${error instanceof Error ? error.message : String(error)}）——已降级为仅提示段落门控`)
      return noop
    }
    if (unguard === undefined || unguard === null) return noop
    let done = false
    return () => {
      if (done) return
      done = true
      try {
        typeof unguard === 'function' ? unguard() : unguard.dispose?.()
      } catch {
        // Best-effort unmount: nothing to do — the guard dies with the scope.
      }
    }
  } catch (error) {
    warn(`dsh-workbuddy-expert: mountScriptGuard 意外失败（${error instanceof Error ? error.message : String(error)}）——已降级为仅提示段落门控`)
    return noop
  }
}
