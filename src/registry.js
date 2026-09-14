/**
 * Expert folder registry (design §1, ticket 02): scans the discovery roots
 * into expert cards, validates every expert.yml, applies rank-based
 * same-name override, and carries broken entries with their reason (never
 * silently hidden).
 *
 * Discovery roots (rank = precedence, lower wins):
 *   100  project  <projectRoot>/.agents/experts   (trust: project)
 *   200  user     <dshHome>/experts               (trust: user)
 *   200+ extra    mount-config `roots` entries    (MUST declare trust: user)
 *
 * A card is the complete unit of consumption for the listing command and the
 * later compose/switch tickets: id, displayName, description, order, rank,
 * root label + path + trust, sanitized role text, the skills inventory, and
 * — for invalid folders — a `broken` reason string instead of a silent drop.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { sanitizeText } from './sanitize.js'
import { parseAgentCordisYml, validateAgentCordisRows } from './cordis-lines.js'

/** Folder/id rule (design §1): kebab-case over [a-z0-9]. */
export const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Rank of the project-level discovery root `<projectRoot>/.agents/experts`. */
export const RANK_PROJECT = 100
/** Rank of the user-level discovery root `<dshHome>/experts`. */
export const RANK_USER = 200

/** Default selector sort order when expert.yml declares none. */
export const DEFAULT_ORDER = 100

/** Render thrown values as one line, never trusting string coercion. */
function messageOf(error) {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '<unrenderable>'
  }
}

// ── expert.yml mini parser ──────────────────────────────────────────────────

/** Strip one matching pair of YAML quotes; plain values pass through. */
function unquoteScalar(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

/**
 * Parse the expert.yml subset this registry consumes: top-level scalars
 * (plain or quoted) with CRLF tolerance. Nested mappings (tools/,
 * invocation/) and lists are deliberately ignored here — later tickets read
 * them; unknown shapes degrade to absent fields, never parse errors.
 * @returns {{ fields: Record<string, string>, malformed: string | undefined }}
 */
export function parseExpertYml(rawText) {
  const fields = {}
  const lines = sanitizeText(rawText).split('\n')
  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (/^\s/.test(line)) continue // nested mapping child — ignored
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line)
    if (match === null) {
      return { fields, malformed: `unparseable line: ${JSON.stringify(line)}` }
    }
    const value = match[2].trim()
    if (value === '') continue // nested mapping key or empty — ignored
    fields[match[1]] = String(unquoteScalar(value))
  }
  return { fields, malformed: undefined }
}

// ── tools.allow parsing (design §1, ticket 10) ──────────────────────────────

/**
 * Parse the `tools:` nested mapping for the `allow` list (design §1).
 * Accepted shapes (the expert.yml subset this registry consumes):
 *
 *   tools:            tools:                 tools:
 *     allow:            allow: [read, bash]     allow: []
 *       - read
 *       - bash
 *
 * A flow mapping `tools: { allow: [a] }` is also accepted. Anything else —
 * `tools` as a scalar, `allow` as a scalar, an empty or non-string list
 * item — is a broken reason, never silently ignored (design: invalid shapes
 * → broken row). A `tools:` block without `allow` declares no restriction.
 *
 * @param {string} rawText - sanitized expert.yml text
 * @returns {{ allow: string[] | undefined, broken: string | undefined }}
 *   allow undefined → not declared; [] → declared empty = 不限制.
 */
export function parseToolsAllow(rawText) {
  const lines = sanitizeText(rawText).split('\n')

  // Locate the top-level `tools:` key.
  let toolsIndex = -1
  let toolsValue = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (/^\s/.test(line)) continue
    const match = /^tools:[ \t]*(.*)$/.exec(line)
    if (match === null) continue
    toolsIndex = i
    toolsValue = match[1].trim()
    break
  }
  if (toolsIndex < 0) return { allow: undefined, broken: undefined }

  // Inline forms: flow mapping, or an invalid scalar.
  if (toolsValue !== '') {
    if (toolsValue.startsWith('{')) {
      const flow = /\ballow:[ \t]*\[([^\]]*)\]/.exec(toolsValue)
      if (flow === null) return { allow: undefined, broken: undefined } // flow mapping without allow
      const parsed = parseFlowList(flow[1])
      if (parsed.broken !== undefined) return { allow: undefined, broken: `tools.allow ${parsed.broken}` }
      return { allow: parsed.items, broken: undefined }
    }
    return { allow: undefined, broken: `tools must be a mapping (indented allow: list), got ${JSON.stringify(toolsValue)}` }
  }

  // Block form: indented children until the next top-level key.
  const children = []
  for (let i = toolsIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    if (!/^\s/.test(line)) break
    children.push(line)
  }

  const first = children.find((line) => !line.trimStart().startsWith('#'))
  if (first === undefined) return { allow: undefined, broken: undefined } // empty block
  const baseIndent = first.length - first.trimStart().length

  let allowValue = null // null = no allow key found yet
  let allowLine = -1
  for (let i = 0; i < children.length; i++) {
    const line = children[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    const match = /^allow:[ \t]*(.*)$/.exec(trimmed)
    if (match !== null && indent === baseIndent) {
      allowValue = match[1].trim()
      allowLine = i
      break
    }
  }
  if (allowValue === null) return { allow: undefined, broken: undefined } // other tools.* keys only

  if (allowValue !== '') {
    if (!allowValue.startsWith('[')) {
      return { allow: undefined, broken: `tools.allow must be a list, got ${JSON.stringify(allowValue)}` }
    }
    const parsed = parseFlowList(allowValue.slice(1, -1))
    if (parsed.broken !== undefined) return { allow: undefined, broken: `tools.allow ${parsed.broken}` }
    return { allow: parsed.items, broken: undefined }
  }

  // Block list: subsequent `- item` lines (same indent band as the block).
  const items = []
  for (let i = allowLine + 1; i < children.length; i++) {
    const line = children[i]
    const trimmed = line.trim()
    if (trimmed === '') continue
    const itemMatch = /^-(?:[ \t]+(.*))?$/.exec(trimmed)
    if (itemMatch === null) break // first non-item line ends the list
    const raw = (itemMatch[1] ?? '').trim()
    if (raw === '') return { allow: undefined, broken: 'tools.allow has an empty list item' }
    items.push(String(unquoteScalar(raw)))
  }
  return { allow: items, broken: undefined } // zero items = declared empty
}

/** Parse a flow list body (`a, b, "c d"`) into items or a broken reason. */
function parseFlowList(body) {
  const items = []
  for (const part of body.split(',')) {
    const raw = part.trim()
    if (raw === '') continue
    items.push(String(unquoteScalar(raw)))
  }
  return { items, broken: undefined }
}

// ── discovery roots ─────────────────────────────────────────────────────────

/**
 * Assemble the ordered discovery-root list. Extra roots come from the mount
 * config and MUST declare `trust: user` explicitly (design §1); anything
 * else is skipped with a warning callback instead of trusted implicitly.
 * @param {object} options
 * @param {string} options.projectRoot - absolute project root
 * @param {string} options.dshHome - absolute harness home (~/.dsh)
 * @param {Array<{path: string, trust?: string}>} [options.extraRoots]
 * @param {(message: string) => void} [options.onWarning]
 * @returns {Array<{path: string, rank: number, label: string, trust: 'project' | 'user'}>}
 */
export function buildDiscoveryRoots({ projectRoot, dshHome, extraRoots, onWarning }) {
  const warn = onWarning ?? (() => {})
  const roots = [
    { path: join(projectRoot, '.agents', 'experts'), rank: RANK_PROJECT, label: 'project', trust: 'project' },
    { path: join(dshHome, 'experts'), rank: RANK_USER, label: 'user', trust: 'user' },
  ]
  const listed = Array.isArray(extraRoots) ? extraRoots : []
  listed.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string' || entry.path.trim() === '') {
      warn(`extra roots[${index}] skipped: expected { path, trust } with a string path`)
      return
    }
    if (entry.trust !== 'user') {
      warn(`extra roots[${index}] (${entry.path}) skipped: only trust: user is allowed`)
      return
    }
    roots.push({ path: entry.path, rank: RANK_USER + 1 + index, label: 'extra', trust: 'user' })
  })
  return roots
}

// ── folder scan ─────────────────────────────────────────────────────────────

/** True when path exists as a regular file. */
async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Sorted subdirectory names under dir ([] when missing). */
async function listSubdirectories(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort()
}

/** A broken card: carried with its reason, never silently hidden. */
function brokenCard(dir, folderName, rootInfo, reason) {
  return {
    id: folderName,
    displayName: folderName,
    description: '',
    order: DEFAULT_ORDER,
    rank: rootInfo.rank,
    root: rootInfo.label,
    rootPath: rootInfo.path,
    trust: rootInfo.trust,
    dir,
    broken: reason,
    skills: [],
    trustScripts: false,
    scriptsAllowed: false,
    toolsAllow: [],
  }
}

/**
 * Scan one expert folder into a card (valid or broken).
 * @param {string} dir - absolute folder path
 * @param {string} folderName
 * @param {{rank: number, label: string, path: string, trust: string}} rootInfo
 * @returns {Promise<object>} expert card
 */
export async function scanExpertFolder(dir, folderName, rootInfo) {
  if (!ID_RE.test(folderName)) {
    return brokenCard(dir, folderName, rootInfo, `folder name ${JSON.stringify(folderName)} fails ${String(ID_RE)}`)
  }

  let manifestText
  try {
    manifestText = await readFile(join(dir, 'expert.yml'), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return brokenCard(dir, folderName, rootInfo, 'expert.yml missing')
    return brokenCard(dir, folderName, rootInfo, `expert.yml unreadable: ${messageOf(error)}`)
  }

  const { fields, malformed } = parseExpertYml(manifestText)
  if (malformed !== undefined) return brokenCard(dir, folderName, rootInfo, `expert.yml invalid: ${malformed}`)

  // tools.allow (design §1, ticket 10): invalid shapes are broken rows,
  // never silently ignored; 空 = 不限制 (empty list → no restriction).
  const toolsInfo = parseToolsAllow(manifestText)
  if (toolsInfo.broken !== undefined) {
    return brokenCard(dir, folderName, rootInfo, `expert.yml invalid: ${toolsInfo.broken}`)
  }

  const id = typeof fields.id === 'string' ? fields.id.trim() : ''
  if (id === '') return brokenCard(dir, folderName, rootInfo, 'expert.yml has no id')
  if (!ID_RE.test(id)) {
    return brokenCard(dir, folderName, rootInfo, `expert.yml id ${JSON.stringify(id)} fails ${String(ID_RE)}`)
  }
  if (id !== folderName) {
    return brokenCard(dir, folderName, rootInfo, `expert.yml id ${JSON.stringify(id)} does not match folder name ${JSON.stringify(folderName)}`)
  }

  const rolePath = join(dir, 'role.md')
  if (!(await isFile(rolePath))) return brokenCard(dir, folderName, rootInfo, 'role.md missing')

  let roleText
  try {
    roleText = sanitizeText(await readFile(rolePath, 'utf8'))
  } catch (error) {
    return brokenCard(dir, folderName, rootInfo, `role.md unreadable: ${messageOf(error)}`)
  }

  // agent.cordis.yml (design §1 optional file, ticket 11): presence is
  // detected here and the rows parse+validate ONCE per scan — a folder
  // without the file pays nothing. Corrupt files / unsupported row kinds are
  // broken reasons, never silently ignored; compose-time activation and the
  // trust gate live in cordis-lines.js.
  let cordisLines
  const linesPath = join(dir, 'agent.cordis.yml')
  if (await isFile(linesPath)) {
    let rawLines
    try {
      rawLines = await readFile(linesPath, 'utf8')
    } catch (error) {
      return brokenCard(dir, folderName, rootInfo, `agent.cordis.yml unreadable: ${messageOf(error)}`)
    }
    const parsed = parseAgentCordisYml(rawLines)
    if (parsed.broken !== undefined) {
      return brokenCard(dir, folderName, rootInfo, `agent.cordis.yml invalid: ${parsed.broken}`)
    }
    const validated = validateAgentCordisRows(parsed.rows)
    if (validated.broken !== undefined) {
      return brokenCard(dir, folderName, rootInfo, `agent.cordis.yml invalid: ${validated.broken}`)
    }
    cordisLines = { path: linesPath, rows: validated.rows }
  }

  // skills/ follows the dsh skill convention: one skill per subdirectory
  // with a SKILL.md. Subdirectories without SKILL.md stay listed (flagged)
  // rather than dropped — the listing never invents inventory.
  const skills = []
  for (const name of await listSubdirectories(join(dir, 'skills'))) {
    const skillDir = join(dir, 'skills', name)
    const hasSkillMd = await isFile(join(skillDir, 'SKILL.md'))
    let text
    if (hasSkillMd) {
      try {
        text = sanitizeText(await readFile(join(skillDir, 'SKILL.md'), 'utf8'))
      } catch (error) {
        skills.push({ name, path: skillDir, hasSkillMd, broken: `SKILL.md unreadable: ${messageOf(error)}` })
        continue
      }
    }
    skills.push(hasSkillMd
      ? { name, path: skillDir, hasSkillMd, text }
      : { name, path: skillDir, hasSkillMd })
  }

  const orderValue = Number(fields.order)
  return {
    id,
    displayName: typeof fields.display_name === 'string' && fields.display_name.trim() !== '' ? fields.display_name.trim() : id,
    description: typeof fields.description === 'string' ? fields.description.trim() : '',
    order: Number.isFinite(orderValue) && fields.order !== undefined ? orderValue : DEFAULT_ORDER,
    rank: rootInfo.rank,
    root: rootInfo.label,
    rootPath: rootInfo.path,
    trust: rootInfo.trust,
    dir,
    roleText,
    trustScripts: fields.trust_scripts === 'true',
    // Computed (ticket 04): user-rank roots always allow scripts/, project
    // rank only with an explicit trust_scripts declaration.
    scriptsAllowed: rootInfo.trust === 'user' || fields.trust_scripts === 'true',
    // Declared tool whitelist (ticket 10): [] = 不限制; compose mounts the
    // scoped tools.restrict only for a non-empty array.
    toolsAllow: toolsInfo.allow ?? [],
    // Declared composition rows (ticket 11): undefined when no file — zero
    // overhead for folders without agent.cordis.yml.
    cordisLines,
    skills,
  }
}

/**
 * Scan every discovery root into expert cards. Same-name override is
 * rank-based (lower rank wins — project overrides user); the losing entry is
 * reported in warnings. A missing root contributes nothing, silently; an
 * unreadable root warns and the scan continues.
 * @param {Array<{path: string, rank: number, label: string, trust: string}>} roots
 * @returns {Promise<{ experts: object[], warnings: string[] }>}
 */
export async function scanDiscoveryRoots(roots) {
  const experts = []
  const warnings = []
  const byId = new Map()
  const ordered = [...roots].sort((a, b) => a.rank - b.rank)
  for (const rootInfo of ordered) {
    let entries
    try {
      entries = await readdir(rootInfo.path, { withFileTypes: true })
    } catch (error) {
      if (error.code !== 'ENOENT') {
        warnings.push(`${rootInfo.label} root not readable: ${rootInfo.path} (${messageOf(error)})`)
      }
      continue
    }
    const folders = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort()
    for (const folderName of folders) {
      const card = await scanExpertFolder(join(rootInfo.path, folderName), folderName, rootInfo)
      const existing = byId.get(card.id)
      if (existing !== undefined) {
        warnings.push(`expert "${card.id}" from ${card.root} overridden by the ${existing.root} entry (rank ${String(existing.rank)} < ${String(card.rank)})`)
        continue
      }
      byId.set(card.id, card)
      experts.push(card)
    }
  }
  experts.sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { experts, warnings }
}

// ── cached registry ─────────────────────────────────────────────────────────

/**
 * Create the scan-caching registry behind `ctx.experts.list()`. The cache is
 * dropped by watcher invalidation (`invalidate()`), and a short TTL bounds
 * staleness on platforms where a watch event is missed.
 * @param {object} options
 * @param {Array<object>} options.roots - discovery roots (buildDiscoveryRoots)
 * @param {(roots: Array<object>) => Promise<{experts: object[], warnings: string[]}>} [options.scan]
 * @param {number} [options.ttlMs] - cache lifetime; default 1000ms
 */
export function createRegistry({ roots, scan = scanDiscoveryRoots, ttlMs = 1000 }) {
  let cache = null
  let dirty = true
  let inflight = null
  return {
    /** Drop the cached scan (watcher hook). */
    invalidate() {
      dirty = true
    },
    /**
     * The current expert table: cards (including broken rows) sorted by
     * (order, id), plus scan warnings.
     * @returns {Promise<{experts: object[], warnings: string[]}>}
     */
    async list() {
      if (cache !== null && !dirty && Date.now() - cache.at < ttlMs) return cache.result
      if (inflight !== null) return inflight
      inflight = (async () => {
        let result
        try {
          result = await scan(roots)
        } catch (error) {
          result = { experts: [], warnings: [`registry scan failed: ${messageOf(error)}`] }
        }
        cache = { result, at: Date.now() }
        dirty = false
        inflight = null
        return result
      })()
      return inflight
    },
  }
}
