/**
 * agent.cordis.yml composition-row passthrough (design §1 layout, §4 dispose
 * order, §9 security row, §10 P3; ticket 11).
 *
 * SUPPORTED ROW KINDS (documented deviation — the narrowest version that can
 * be verifiably activated per-session, established against the harness
 * source):
 *
 *   - id: demo-tools            # optional, [A-Za-z0-9][A-Za-z0-9._-]*
 *     name: ./plugins/demo.js   # REQUIRED: relative module path (./ or ../)
 *     config:                   # optional flat JSON-safe mapping of scalars,
 *       key: value              # scalar lists, and nested mappings
 *
 * The referenced module must export a Cordis plugin (a function, or an object
 * with an `apply` method). At compose time the module is imported with the
 * name resolved against the EXPERT FOLDER and started via `agentCtx.plugin(
 * plugin, config)` — a scoped fiber under the agent's own scope context
 * (verified: cordis mixes `ctx.plugin` onto every context, registry.ts#plugin;
 * dsh-scope creates agent scopes as plain child fibers, so everything started
 * through them is agent-local and unwinds with the session).
 *
 * REJECTED row kinds (broken reason, never silently ignored):
 *   - bare package specifiers ('@scope/pkg') — no per-session resolution path
 *     exists from an expert folder (the loader's bare-name resolution is a
 *     host-composition concern, root-include only);
 *   - `cordis:` builtins (group/include/isolate…) — they mutate the HOST
 *     loader tree (Include/Group write back through the tree), not this
 *     session's scope;
 *   - group rows, row-level `inject`/`provide`/`isolate`/`when`/`disabled`
 *     and every other key — loader-file semantics this scoped path cannot
 *     honor honestly;
 *   - YAML anchors/aliases/`!!` tags and flow mappings — injection surfaces
 *     the mini parser deliberately does not open.
 *
 * Security (design §9): the file is an injection surface equivalent to
 * scripts/ — a row activates arbitrary plugin code. The SAME trust gate as
 * ticket 04 applies via scriptsAllowedFor(): user-rank experts activate their
 * rows; project-rank experts require `trust_scripts: true`, otherwise the
 * rows are skipped and the role section carries a paragraph explaining why.
 */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { normalizeNewlines } from './sanitize.js'
import { scriptsAllowedFor } from './trust.js'

/** Guard paragraph when a project-rank expert's rows are skipped (no trust). */
export const CORDIS_LINES_GUARD_PARAGRAPH =
  '该专家来自项目仓库且未声明信任脚本（expert.yml trust_scripts）——其 agent.cordis.yml 声明的组装行未启用；需在 expert.yml 声明 trust_scripts: true 后方可生效。'

/**
 * Degrade paragraph when declared rows could not be activated (module import
 * or plugin startup failed, or the scoped plugin contract is unavailable).
 * @param {string[]} names - row ids/names that failed
 */
export function cordisLinesDegradeParagraph(names) {
  const listed = names.map((name) => JSON.stringify(name)).join(', ')
  return `该专家声明的 agent.cordis.yml 组装行激活失败（${listed}）——请检查插件文件与配置；其余专家内容不受影响。`
}

// ── YAML-subset mini parser (rows only; JSON-safe values) ───────────────────

/** One content line: { indent, text } — blank/comment lines dropped. */
function contentLines(text) {
  const lines = []
  for (const raw of normalizeNewlines(text).split('\n')) {
    const stripped = raw.replace(/\s+$/, '')
    if (stripped.trim() === '' || stripped.trimStart().startsWith('#')) continue
    lines.push({ indent: stripped.length - stripped.trimStart().length, text: stripped.trim() })
  }
  return lines
}

/** Parse one scalar: quoted, flow list, or typed plain value. */
function parseScalar(raw) {
  const value = raw.trim()
  if (value === 'null' || value === '~' || value === '') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.startsWith('[') && value.endsWith(']')) {
    const items = value.slice(1, -1).split(',').map((part) => part.trim()).filter((part) => part !== '')
    return items.map((item) => {
      if (item.startsWith('"') || item.startsWith("'")) return unquote(item)
      return parseScalar(item)
    })
  }
  if (value.startsWith('{')) return { error: 'flow mappings are not supported' }
  if (value.startsWith('[')) return { error: 'unterminated flow list' }
  if (value.startsWith('!!') || value.startsWith('&') || value.startsWith('*') || value.startsWith('!')) {
    return { error: `yaml tags/anchors are not supported (${value.slice(0, 12)})` }
  }
  if (!value.startsWith('"') && !value.startsWith("'") && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  return unquote(value)
}

/** Strip one matching pair of YAML quotes; plain values typed by caller. */
function unquote(value) {
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

/** Match `key:` / `key: value` with a row-legal key. */
const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/
/** Match a block-list item with an inline remainder. */
const ITEM_RE = /^-(?:[ \t]+(.*))?$/

/**
 * Parse the row-file subset: a top-level block list of mappings whose values
 * are JSON-safe scalars, scalar lists, and nested mappings.
 * @param {string} rawText
 * @returns {{ rows: Array<object>, broken: string | undefined }}
 */
export function parseAgentCordisYml(rawText) {
  const lines = contentLines(rawText)
  if (lines.length === 0) return { rows: [], broken: 'file has no content' }
  // A lone `[]` (a declared-empty row list) is the only top-level flow form
  // supported — anything else flow-shaped is rejected below.
  if (lines.length === 1 && lines[0].indent === 0 && lines[0].text === '[]') return { rows: [], broken: undefined }
  if (lines[0].indent !== 0 || ITEM_RE.exec(lines[0].text) === null) {
    return { rows: [], broken: 'the file must be a top-level list of rows ("- name: ./plugin.js")' }
  }
  const state = { index: 0 }
  const rows = []
  while (state.index < lines.length) {
    const line = lines[state.index]
    if (line.indent !== 0 || ITEM_RE.exec(line.text) === null) {
      return { rows: [], broken: `unexpected line at row boundary: ${JSON.stringify(line.text)}` }
    }
    const rest = ITEM_RE.exec(line.text)[1] ?? ''
    state.index += 1
    if (rest === '') {
      // "- " followed by an indented child block — must be a mapping row.
      const child = parseNode(lines, state, 1)
      if (child.error !== undefined) return { rows: [], broken: child.error }
      if (child.value === null || typeof child.value !== 'object' || Array.isArray(child.value)) {
        return { rows: [], broken: 'a row must be a mapping ("- name: ./plugin.js")' }
      }
      rows.push(child.value)
      continue
    }
    // Inline first key: "- key: value" — the row mapping continues on
    // following lines aligned with that first key (indent 2).
    const restLine = { indent: 2, text: rest }
    const mapping = parseMapping([restLine, ...lines.slice(state.index)], { index: 0 }, 2)
    if (mapping.error !== undefined) return { rows: [], broken: mapping.error }
    state.index += mapping.consumed - 1
    rows.push(mapping.value)
  }
  return { rows, broken: undefined }
}

/**
 * Parse one node (mapping, list, or scalar) starting at state.index with all
 * content at exactly `indent` (children deeper).
 */
function parseNode(lines, state, indent) {
  const line = lines[state.index]
  if (line === undefined) return { value: null, error: undefined }
  if (line.indent < indent) return { value: null, error: undefined }
  if (ITEM_RE.test(line.text)) return parseList(lines, state, line.indent)
  if (KEY_RE.test(line.text)) return parseMapping(lines, state, line.indent)
  const scalar = parseScalar(line.text)
  if (scalar !== null && typeof scalar === 'object' && scalar.error !== undefined) {
    return { value: null, error: scalar.error }
  }
  state.index += 1
  return { value: scalar, error: undefined }
}

/** Parse a block list of scalars or nested rows at one indent. */
function parseList(lines, state, indent) {
  const items = []
  while (state.index < lines.length) {
    const line = lines[state.index]
    if (line.indent < indent) break
    if (line.indent > indent) return { value: null, error: `unexpected indent: ${JSON.stringify(line.text)}` }
    const match = ITEM_RE.exec(line.text)
    if (match === null) break
    const rest = match[1] ?? ''
    state.index += 1
    if (rest === '') {
      const child = parseNode(lines, state, indent + 1)
      if (child.error !== undefined) return { value: null, error: child.error }
      items.push(child.value)
    } else if (KEY_RE.test(rest)) {
      // Inline mapping start inside a list item.
      const restLine = { indent: indent + 2, text: rest }
      const mapping = parseMapping([restLine, ...lines.slice(state.index)], { index: 0 }, indent + 2)
      if (mapping.error !== undefined) return { value: null, error: mapping.error }
      state.index += mapping.consumed - 1
      items.push(mapping.value)
    } else {
      const scalar = parseScalar(rest)
      if (scalar !== null && typeof scalar === 'object' && scalar.error !== undefined) {
        return { value: null, error: scalar.error }
      }
      items.push(scalar)
    }
  }
  return { value: items, error: undefined }
}

/**
 * Parse a block mapping at one indent. Returns { value, consumed, error }
 * where `consumed` counts how many of the ORIGINAL lines array were eaten
 * (1 for the synthetic inline-key line).
 */
function parseMapping(lines, state, indent) {
  const value = {}
  const startIndex = state.index
  while (state.index < lines.length) {
    const line = lines[state.index]
    if (line.indent < indent) break
    if (line.indent > indent) return { value: null, consumed: state.index - startIndex, error: `unexpected indent: ${JSON.stringify(line.text)}` }
    const match = KEY_RE.exec(line.text)
    if (match === null) return { value: null, consumed: state.index - startIndex, error: `unparseable line: ${JSON.stringify(line.text)}` }
    const key = match[1]
    const rest = (match[2] ?? '').trim()
    state.index += 1
    if (rest === '') {
      const child = parseNode(lines, state, indent + 1)
      if (child.error !== undefined) return { value: null, consumed: state.index - startIndex, error: child.error }
      value[key] = child.value
    } else {
      const scalar = parseScalar(rest)
      if (scalar !== null && typeof scalar === 'object' && scalar.error !== undefined) {
        return { value: null, consumed: state.index - startIndex, error: scalar.error }
      }
      value[key] = scalar
    }
  }
  return { value, consumed: state.index - startIndex, error: undefined }
}

// ── row-level validation ────────────────────────────────────────────────────

/** Legal optional row id: no whitespace, no tree separators. */
const ROW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
/** Keys a supported row may carry. */
const ROW_KEYS = new Set(['id', 'name', 'config'])

/**
 * Validate parsed rows against the supported subset (module header): unknown
 * keys, bare/builtin names, missing names, and non-mapping shapes are broken
 * reasons, never silently ignored.
 * @param {Array<unknown>} rows
 * @returns {{ rows: Array<{id?: string, name: string, config?: object}>, broken: string | undefined }}
 */
export function validateAgentCordisRows(rows) {
  if (!Array.isArray(rows)) return { rows: [], broken: 'rows must be a list' }
  const seen = new Set()
  const valid = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const label = () => (row !== null && typeof row === 'object' && typeof row.id === 'string' ? `row "${row.id}"` : `row #${i + 1}`)
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      return { rows: [], broken: `${label()} must be a mapping` }
    }
    for (const key of Object.keys(row)) {
      if (!ROW_KEYS.has(key)) {
        return { rows: [], broken: `${label()}: unsupported key ${JSON.stringify(key)}（支持的组织行字段: id, name, config）` }
      }
    }
    if (typeof row.name !== 'string' || row.name.trim() === '') {
      return { rows: [], broken: `${label()}: "name" is required` }
    }
    const name = row.name.trim()
    if (!(name.startsWith('./') || name.startsWith('../'))) {
      return { rows: [], broken: `${label()}: "name" must be a relative module path starting with ./ or ../ (got ${JSON.stringify(name)})——裸包名与 cordis: 内建行不支持` }
    }
    if (row.id !== undefined) {
      if (typeof row.id !== 'string' || !ROW_ID_RE.test(row.id)) {
        return { rows: [], broken: `${label()}: invalid id ${JSON.stringify(row.id)}` }
      }
      if (seen.has(row.id)) return { rows: [], broken: `duplicate row id ${JSON.stringify(row.id)}` }
      seen.add(row.id)
    }
    if (row.config !== undefined && row.config !== null) {
      if (typeof row.config !== 'object' || Array.isArray(row.config)) {
        return { rows: [], broken: `${label()}: "config" must be a mapping` }
      }
    }
    valid.push({
      id: typeof row.id === 'string' ? row.id : undefined,
      name,
      config: row.config ?? undefined,
    })
  }
  return { rows: valid, broken: undefined }
}

// ── compose-time activation ─────────────────────────────────────────────────

/** Unwrap an ES-module import into a Cordis plugin value. */
function pluginOf(module) {
  if (module === null || typeof module !== 'object') return module
  const candidate = module.default !== undefined ? module.default : module
  return candidate
}

/** True when the value is a startable Cordis plugin shape. */
function isPluginShape(value) {
  return typeof value === 'function' || (value !== null && typeof value === 'object' && typeof value.apply === 'function')
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
 * Mount the expert's declared composition rows inside the AGENT scope
 * (ticket 11). Paths:
 *   - no agent.cordis.yml (or zero rows) → zero overhead: nothing probed;
 *   - project rank without trust → rows skipped, guard paragraph returned;
 *   - trusted → each row's module imported (resolved against the expert
 *     folder) and started via agentCtx.plugin(plugin, config); every fiber's
 *     disposer rides the composition group;
 *   - any failure (import, plugin shape, startup) → all partial mounts
 *     disposed, ONE warning per failed row, and a degrade paragraph.
 *
 * @param {object} agentCtx - the agent-scoped cordis context
 * @param {object} expertCard - registry card (cordisLines: { path, rows }?)
 * @param {{warn?: (message: string) => void}} [logger]
 * @returns {Promise<{ dispose: () => void, paragraph: string, mounted: number }>}
 */
export async function mountCordisLines(agentCtx, expertCard, logger = {}) {
  const warn = logger.warn ?? (() => {})
  const noop = () => {}
  const rows = expertCard?.cordisLines?.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return { dispose: noop, paragraph: '', mounted: 0 }
  }
  if (!scriptsAllowedFor(expertCard)) {
    return { dispose: noop, paragraph: CORDIS_LINES_GUARD_PARAGRAPH, mounted: 0 }
  }
  if (typeof agentCtx?.plugin !== 'function') {
    warn(`dsh-workbuddy-expert: expert "${expertCard.id}" 的组装行无法激活（agent ctx 无 ctx.plugin 契约）——已降级为提示段落`)
    return { dispose: noop, paragraph: cordisLinesDegradeParagraph(rows.map((row) => row.id ?? row.name)), mounted: 0 }
  }

  const baseDir = expertCard.dir
  const disposers = []
  const failed = []
  const labelOf = (row) => row.id ?? row.name

  for (const row of rows) {
    const moduleUrl = pathToFileURL(resolve(baseDir, row.name)).href
    let plugin
    try {
      plugin = pluginOf(await import(moduleUrl))
    } catch (error) {
      failed.push(labelOf(row))
      warn(`dsh-workbuddy-expert: expert "${expertCard.id}" 组装行 ${labelOf(row)} 的模块导入失败（${messageOf(error)}）`)
      continue
    }
    if (!isPluginShape(plugin)) {
      failed.push(labelOf(row))
      warn(`dsh-workbuddy-expert: expert "${expertCard.id}" 组装行 ${labelOf(row)} 的模块不是 Cordis 插件（需 function 或 { apply }）`)
      continue
    }
    let fiber
    try {
      fiber = agentCtx.plugin(plugin, row.config)
    } catch (error) {
      failed.push(labelOf(row))
      warn(`dsh-workbuddy-expert: expert "${expertCard.id}" 组装行 ${labelOf(row)} 启动失败（${messageOf(error)}）`)
      continue
    }
    const disposer = fiberDisposer(fiber)
    disposers.push(disposer)
    if (fiber !== null && typeof fiber === 'object' && typeof fiber.then === 'function') {
      try {
        await fiber
      } catch (error) {
        failed.push(labelOf(row))
        warn(`dsh-workbuddy-expert: expert "${expertCard.id}" 组装行 ${labelOf(row)} 启动失败（${messageOf(error)}）`)
      }
    }
  }

  if (failed.length > 0) {
    for (const dispose of disposers.reverse()) dispose()
    return { dispose: noop, paragraph: cordisLinesDegradeParagraph([...new Set(failed)]), mounted: 0 }
  }
  let done = false
  return {
    dispose() {
      if (done) return
      done = true
      for (const dispose of disposers.reverse()) dispose()
    },
    paragraph: '',
    mounted: disposers.length,
  }
}

/** Adapt a ctx.plugin() fiber (or its dispose) into a safe disposer. */
function fiberDisposer(fiber) {
  let done = false
  return () => {
    if (done) return
    done = true
    try {
      const dispose = typeof fiber?.dispose === 'function' ? fiber.dispose.bind(fiber) : typeof fiber === 'function' ? fiber : null
      if (dispose !== null) dispose()
    } catch {
      // Best-effort: the fiber dies with the agent scope regardless.
    }
  }
}
