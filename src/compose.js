/**
 * Session composition (design §5, ticket 03): compose(agent, expertCard)
 * registers the expert's role section and its skills inside the AGENT's
 * scoped context so every effect is agent-local and unwinds with the session
 * (plugin unload, session end) — and returns every disposer so the switch
 * transaction can also dispose the group explicitly, in reverse order.
 *
 * Host contracts used here (verified against the harness source, see docs
 * design §11):
 *   - ctx.systemPrompt.section({ name, order, text }) → disposer
 *     (dsh-system-prompt: scoped layers, duplicate names throw, order must be
 *     finite; the AGENTS.md/persona band is order 0–499 — persona prefix sits
 *     at 0 and PLAN_POLICY at 500, so this plugin documents the 150 slot).
 *   - ctx.skills.register(skillRegistration) → disposer
 *     (dsh-skill runtime path: requires { name, description, content?, … };
 *     `provider` labels the contribution — we use `expert:<id>`).
 *
 * tools.restrict is deliberately NOT registered here (ticket 10 / P3).
 */

import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { mountScriptGuard, trustParagraph } from './trust.js'

/** System prompt section name owned by this plugin (one per agent scope). */
export const ROLE_SECTION_NAME = 'expert-role'

/**
 * Documented free band: sister plugins use 100–199 for persona-adjacent
 * sections; the expert role rides at 150 — after the deployment persona
 * prefix (0), before PLAN_POLICY (500).
 */
export const ROLE_SECTION_ORDER = 150

/** Meta line appended under the sanitized role.md body. */
export function roleMetaLine(expertCard) {
  return `你当前承担以下专家角色：${expertCard.displayName ?? expertCard.id}（/expert <id> 可切换；全部会话历史保持不变）。`
}

/** Full role section text: sanitized role.md + one meta line. */
export function roleSectionText(expertCard) {
  const body = typeof expertCard.roleText === 'string' ? expertCard.roleText.trim() : ''
  return body === '' ? roleMetaLine(expertCard) : `${body}\n\n${roleMetaLine(expertCard)}`
}

/**
 * Role section text plus the script-trust paragraph (ticket 04): untrusted
 * project expert → guard paragraph; trusting project expert → one-time
 * (per composition) release notice; user rank → nothing appended.
 */
export function roleSectionTextWithTrust(expertCard) {
  const paragraph = trustParagraph(expertCard)
  const base = roleSectionText(expertCard)
  return paragraph === '' ? base : `${base}\n\n${paragraph}`
}

// ── skills registration (defensive seam — ticket 05/10 may adjust) ──────────

/** Strip a leading YAML frontmatter block, returning the body. */
function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  if (end < 0) return text
  const after = text.indexOf('\n', end + 1)
  return after < 0 ? '' : text.slice(after + 1)
}

/** Derive a short routing description from a SKILL.md body. */
export function skillDescription(text) {
  for (const line of stripFrontmatter(text).split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    return trimmed.replace(/^#+\s*/, '').slice(0, 160)
  }
  return 'expert skill'
}

/**
 * Register the expert's skills with the layered skills service, each labeled
 * `expert:<id>`. The exact SkillRegistration field set is not fully locally
 * verifiable (design §11 #2), so this function is the single defensive seam:
 * any failure degrades to a compact textual catalog the caller appends to the
 * role section, with ONE warning — never a hard failure.
 *
 * @param {object} agentCtx - the agent-scoped cordis context
 * @param {object} expertCard - registry card (skills[] with name/path/text)
 * @param {{warn: (message: string) => void}} logger
 * @returns {{ disposers: Array<() => void>, fallbackCatalog: string }}
 */
export function registerExpertSkills(agentCtx, expertCard, logger) {
  const warn = logger?.warn ?? (() => {})
  const skills = Array.isArray(expertCard.skills) ? expertCard.skills.filter((skill) => skill.hasSkillMd && typeof skill.text === 'string') : []
  const disposers = []
  const failed = []
  if (skills.length === 0) return { disposers, fallbackCatalog: '' }

  const skillsService = typeof agentCtx.get === 'function' ? agentCtx.get('skills') : undefined
  if (skillsService === undefined || typeof skillsService.register !== 'function') {
    warn(`dsh-workbuddy-expert: the skills service is unavailable — expert "${expertCard.id}" skills degrade to a textual catalog in the role section`)
    return { disposers, fallbackCatalog: renderSkillCatalog(expertCard, skills) }
  }

  for (const skill of skills) {
    try {
      disposers.push(skillsService.register({
        name: skill.name,
        description: skillDescription(skill.text),
        content: skill.text,
        path: skill.path,
        source: 'custom',
        provider: `expert:${expertCard.id}`,
      }))
    } catch (error) {
      failed.push(skill.name)
      warn(`dsh-workbuddy-expert: skill "${skill.name}" of expert "${expertCard.id}" failed to register (${messageOf(error)}) — degraded to the textual catalog`)
    }
  }
  if (failed.length > 0) {
    return { disposers, fallbackCatalog: renderSkillCatalog(expertCard, skills.filter((skill) => failed.includes(skill.name))) }
  }
  return { disposers, fallbackCatalog: '' }
}

/** Compact textual skill catalog for the degraded (no skills service) path. */
function renderSkillCatalog(expertCard, skills) {
  const lines = [`该专家的以下 skill 以文本形式提供（skills 服务不可用或注册失败）：`]
  for (const skill of skills) {
    lines.push(`## skill: ${skill.name}\n${skill.text.trim()}`)
  }
  return lines.join('\n')
}

/** Render thrown values as one line. */
function messageOf(error) {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '<unrenderable>'
  }
}

// ── generation stamping (design §5: mtime+size re-stamp before compose) ─────

/**
 * Stamp one expert folder: every regular file's (mtimeMs, size), keyed by
 * path relative to the folder. Compositions hold their startup stamp; the
 * registry re-reads only affect future switches/creations.
 * @param {string} dir - absolute expert folder path
 * @returns {Promise<Array<[string, number, number]>>} sorted [relPath, mtimeMs, size]
 */
export async function stampExpertDir(dir) {
  const entries = []
  async function walk(current) {
    let listed
    try {
      listed = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of listed) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        try {
          const info = await stat(path)
          entries.push([relative(dir, path), info.mtimeMs, info.size])
        } catch {
          // File vanished mid-stamp: the folder is being mutated; the missing
          // entry itself is the generation change.
        }
      }
    }
  }
  await walk(dir)
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return entries
}

// ── compose ─────────────────────────────────────────────────────────────────

/**
 * Compose one expert onto an agent: role section + skills, all inside the
 * agent's scoped context (agent.ctx), every disposer held and returned.
 *
 * @param {object} agent - live agent ({ id, ctx, session?, inject?, status? })
 * @param {object} expertCard - valid registry card (broken === undefined)
 * @param {{warn?: (message: string) => void}} [logger]
 * @returns {Promise<{ dispose: () => void, expertId: string, generation: Array }>}
 */
export async function compose(agent, expertCard, logger = {}) {
  const warn = logger.warn ?? (() => {})
  const agentCtx = agent?.ctx
  if (agentCtx === undefined || typeof agentCtx.get !== 'function') {
    throw new Error('compose: the agent has no usable scoped context (agent.ctx)')
  }

  const systemPrompt = agentCtx.get('systemPrompt')
  if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') {
    warn('dsh-workbuddy-expert: the systemPrompt service is unavailable — the expert role section was not registered')
  }

  // Skills first: the degraded catalog (when the skills service is absent or
  // per-skill registration fails) rides inside the role section text.
  const { disposers: skillDisposers, fallbackCatalog } = registerExpertSkills(agentCtx, expertCard, logger)

  // Script-trust gating (ticket 04): the trust paragraph rides the role
  // section; hard enforcement is a best-effort scoped tool guard that
  // degrades to this paragraph with one warning (see mountScriptGuard).
  const guardDisposer = mountScriptGuard(agentCtx, expertCard, logger)

  const text = fallbackCatalog === ''
    ? roleSectionTextWithTrust(expertCard)
    : `${roleSectionTextWithTrust(expertCard)}\n\n${fallbackCatalog}`

  const disposers = []
  if (systemPrompt !== undefined && typeof systemPrompt.section === 'function') {
    disposers.push(systemPrompt.section({ name: ROLE_SECTION_NAME, order: ROLE_SECTION_ORDER, text }))
  }

  // Composition owns its startup generation: the registry re-reads only
  // affect future switches/creations, never a running composition.
  const generation = await stampExpertDir(expertCard.dir)

  return {
    expertId: expertCard.id,
    generation,
    dispose() {
      // Reverse order (design §4): role section last-registered → first out,
      // then skills in reverse registration order.
      for (const dispose of [...disposers, ...skillDisposers, guardDisposer].reverse()) {
        try {
          dispose()
        } catch (error) {
          warn(`dsh-workbuddy-expert: a composition disposer threw during dispose (${messageOf(error)})`)
        }
      }
    },
  }
}
