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
 *   3. best-effort hard enforcement: mountScriptGuard() probes the agent
 *      scoped context for a tool-guard API (ctx.tools / ctx.get('tools')
 *      with a callable .guard). The harness bundle was grepped for the
 *      ToolGuard contract ('guard' — zero hits in lib/*.js), so no shape
 *      is verifiable today: the probe stays isolated here, wrapped in
 *      try/catch, and degrades to the prompt-paragraph-only path with ONE
 *      warning whenever the contract cannot be confirmed.
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

/** Pull a plausible command string out of an unknown tool-call shape. */
function commandOf(call) {
  if (call === null || typeof call !== 'object') return ''
  const candidates = [
    call.command,
    call.args?.command,
    call.input?.command,
    call.parameters?.command,
    typeof call.args === 'string' ? call.args : '',
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
  }
  return ''
}

/**
 * Best-effort hard enforcement for an untrusted project expert: if the agent
 * scoped context exposes a callable tool guard (ctx.tools.guard or
 * toolsService.guard), register one that denies bash/exec-like invocations
 * whose command references the expert's scripts/ directory. No ToolGuard
 * contract is verifiable in the harness source today, so EVERY step is
 * defensive: any missing/throwing piece degrades to the prompt-paragraph-only
 * path with exactly one warning, and the returned disposer is always safe.
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
    const tools = typeof agentCtx?.get === 'function' ? agentCtx.get('tools') : agentCtx?.tools
    const guard = tools?.guard
    if (tools === undefined || typeof guard !== 'function') {
      warn(`dsh-workbuddy-expert: expert "${expertCard.id}" 的脚本硬拦截不可用（无 tools.guard 契约）——已降级为仅提示段落门控`)
      return noop
    }
    let unguard = null
    try {
      unguard = guard({
        name: `expert-script-guard:${expertCard.id}`,
        async exec(call, next) {
          const toolName = String(call?.name ?? call?.tool ?? '')
          const command = commandOf(call)
          const shellLike = /bash|shell|exec|terminal|command/i.test(toolName) || command !== ''
          if (shellLike && commandTargetsExpertScripts(command, expertCard)) {
            throw new Error(
              `该专家（${expertCard.id}）来自项目仓库且未声明 trust_scripts: true，其 scripts/ 下的脚本已被拒绝执行；请在 expert.yml 声明 trust_scripts: true 后重试。`,
            )
          }
          return typeof next === 'function' ? next(call) : undefined
        },
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
