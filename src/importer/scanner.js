/**
 * WorkBuddy source-directory scanner — ported from wb-market src/scanner.js
 * (design §7: "wb-market src/scanner.js 整体平移"). Reads the user's
 * WorkBuddy experts tree into complete expert cards — one card per flat
 * `agents/*.md`. Pure read: nothing is written, no scripts run, no
 * fingerprinting (the catalog cache owns that).
 *
 * Adaptations for this plugin (ticket 06):
 *   - template escaping and CRLF/BOM normalization are REUSED from the
 *     repo's src/sanitize.js (ticket 02) instead of the wb-market copy —
 *     the two escapers were byte-identical, so porting unified on the
 *     single implementation (design §1: one cleaning pipeline);
 *   - everything stays exactly as wb-market scanned otherwise.
 *
 * Contract:
 *   - `scanWorkbuddyRoot(rawRoot)` receives the RAW stored path (tilde
 *     intact) and expands it against the filesystem itself;
 *   - it never writes anything — cards live in memory only.
 *
 * Field mapping (plugin.json first + original fallbacks):
 *   id           ← frontmatter `name` (must pass ID_RE)
 *   name         ← frontmatter `displayName.en` ?? `name`
 *   zhName       ← single: plugin.json `profession.zh`
 *                → team card: frontmatter `profession.zh` ?? `displayName.zh`
 *                  (functional name first for both classes)
 *                → frontmatter `displayName.zh` ?? `profession.zh` fallbacks
 *                → first body H1's functional name when it is Chinese
 *                  (BODY-H1 EXTENSION below)
 *                → `name`
 *   description  ← frontmatter `description`
 *   zhDescription← plugin.json `displayDescription.zh` → README.md first
 *                non-title paragraph
 *   persona      ← agent body + every flat `rules/*.md` appended under a
 *                generated title; cleaned through sanitize.js
 *   skills       ← names of ALL subdirectories under `skills/` — copied
 *                verbatim, including data directories without SKILL.md
 *   avatarPath   ← single: plugin.json `avatar` (relative,
 *                existence-checked — dangling references fall through) →
 *                first PNG in `avatars/`
 *                team card: `avatars/<agentName>.png` exact → `team.png`
 *                → first PNG → undefined
 *   pluginDir    ← plugin directory name
 *   agentFile    ← the card's agent md file name inside agents/
 *   teamSize     ← number of agent files in the plugin directory
 *   category     ← plugin.json `categoryId` VERBATIM; undefined when absent
 *
 * Degradation rules: `git:`-prefixed directories are skipped whole and
 * silently; a plugin directory whose plugin.json is missing or corrupt is
 * skipped with a warning while the scan continues; an agent file that
 * cannot be parsed degrades to a warning for that card only; duplicate ids
 * across plugins are first-wins with a warning; a missing root yields an
 * empty table with NO scanner warning — the state layer reports
 * pathExists=false with its own warning.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { escapeUnregisteredTemplateGroups, normalizeNewlines } from '../sanitize.js'
import { errorMessage } from './util.js'

/** Default WorkBuddy experts directory, stored/echoed verbatim. */
export const DEFAULT_SOURCE_PATH = '~/.workbuddy/plugins/marketplaces/experts/plugins'

/**
 * The roster's own id rule. Exported so the avatar route accepts the SAME
 * charset (one source of truth — the route can never grow an id class the
 * scanner rejects).
 */
export const ID_RE = /^[a-z0-9][a-z0-9-]*$/

// Warnings render thrown values through the shared one-line helper.
const messageOf = errorMessage

/**
 * Expand a leading `~` or `~/` against the current home directory.
 * Anything else (absolute paths, `~foo`, relative paths) is returned as-is.
 * @param {string} value - raw stored path
 * @returns {string} the filesystem path to stat/read
 */
export function expandTildePath(value) {
  if (typeof value !== 'string') return value
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  return value
}

// ── mini frontmatter reader ─────────────────────────────────────────

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
 * Parse the WorkBuddy frontmatter YAML subset: top-level scalars (plain,
 * quoted, block `|`/`>` with optional chomp indicator) plus one level of
 * nested `key: value` children (displayName/profession en/zh). List values
 * and anything deeper are ignored — unknown shapes degrade to absent
 * fields instead of parse errors.
 */
function parseFrontmatterFields(lines) {
  const root = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      i += 1
      continue
    }
    if (/^\s/.test(line)) {
      i += 1
      continue
    }
    const top = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line)
    if (top === null) {
      i += 1
      continue
    }
    const key = top[1]
    const value = top[2].trim()
    if (value === '|' || value === '>' || value === '|-' || value === '>-' || value === '|+' || value === '>+') {
      const folded = value.startsWith('>')
      const block = []
      let j = i + 1
      while (j < lines.length) {
        const next = lines[j]
        if (next.trim() === '') {
          if (block.length === 0) break
          block.push('')
        } else if (/^[ \t]/.test(next)) {
          block.push(next.replace(/^[ \t]+/, ''))
        } else {
          break
        }
        j += 1
      }
      while (block.length > 0 && block[block.length - 1] === '') block.pop()
      root[key] = block.join(folded ? ' ' : '\n')
      i = j
    } else if (value === '') {
      // Nested mapping (or an empty/list value): keep simple `k: v` children.
      const child = {}
      let j = i + 1
      while (j < lines.length) {
        const next = lines[j]
        if (next.trim() === '') {
          j += 1
          continue
        }
        const childMatch = /^[ \t]+([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(next)
        if (childMatch === null) break
        const childValue = childMatch[2].trim()
        if (childValue !== '') child[childMatch[1]] = String(unquoteScalar(childValue))
        j += 1
      }
      root[key] = child
      i = j
    } else {
      root[key] = String(unquoteScalar(value))
      i += 1
    }
  }
  return root
}

/**
 * Split `---`-delimited frontmatter off an already newline-normalized text.
 * Files without frontmatter parse to empty fields + the full body.
 * @returns {{ fields: object, body: string }}
 */
function splitFrontmatter(text) {
  const lines = text.split('\n')
  if (lines[0] === undefined || lines[0].trim() !== '---') return { fields: {}, body: text }
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (close < 0) return { fields: {}, body: text }
  return {
    fields: parseFrontmatterFields(lines.slice(1, close)),
    body: lines.slice(close + 1).join('\n'),
  }
}

// ── field extraction helpers ────────────────────────────────────────

/** Trimmed `.zh` of a metadata object ('' when absent/not a string). */
function zhOf(value) {
  return typeof value?.zh === 'string' ? value.zh.trim() : ''
}

/** Trimmed `.en` of a metadata object ('' when absent/not a string). */
function enOf(value) {
  return typeof value?.en === 'string' ? value.en.trim() : ''
}

/** Trimmed string field ('' for anything else). */
function stringOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * First non-title paragraph of a README: frontmatter stripped, headings /
 * horizontal rules / HTML comments skipped; stops at the paragraph's first
 * blank line. Returned verbatim (may be English — disclosed).
 */
function firstNonTitleParagraph(text) {
  if (stringOf(text) === '') return ''
  const paragraph = []
  for (const line of splitFrontmatter(normalizeNewlines(text)).body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      if (paragraph.length > 0) break
      continue
    }
    if (trimmed.startsWith('#') || trimmed === '---' || trimmed.startsWith('<!--')) {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(trimmed)
  }
  return paragraph.join('\n')
}

/**
 * The BODY-H1 EXTENSION source: the first non-empty body line, accepted
 * only when it is a heading; the parenthetical part of `品牌（职能名）`
 * wins over the whole title, and only Chinese candidates up to 40 chars
 * qualify. It can never override an earlier source.
 */
function bodyHeadingFunctionalName(body) {
  for (const rawLine of body.split('\n').slice(0, 20)) {
    const line = rawLine.trim()
    if (line === '') continue
    const heading = /^#{1,6}[ \t]+(.+)$/.exec(line)
    if (heading === null) return ''
    const title = heading[1].trim()
    const parenthesized = /^(.+?)[（(](.+)[）)]$/.exec(title)
    const candidate = (parenthesized !== null ? parenthesized[2] : title).trim()
    if (candidate !== '' && candidate.length <= 40 && /\p{Script=Han}/u.test(candidate)) return candidate
    return ''
  }
  return ''
}

// ── directory listing helpers (all deterministic: name-sorted) ──────

/**
 * One readdir shape shared by every listing the scanner needs: name-sorted
 * entry names kept by the predicate, [] for a missing directory, anything
 * else thrown to the caller's degrade path.
 */
async function listDir(dir, keep) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return entries.filter(keep).map((entry) => entry.name).sort()
}

/** Flat `*.md` file names in dir ([] when the directory is missing). */
async function listFlatMarkdown(dir) {
  return listDir(dir, (entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'))
}

/** Sorted `*.png` file names in dir ([] when missing). */
async function listPngs(dir) {
  return listDir(dir, (entry) => entry.isFile() && entry.name.endsWith('.png') && !entry.name.startsWith('.'))
}

/** Names of ALL subdirectories under dir ([] when missing) — verbatim. */
async function listSubdirectories(dir) {
  return listDir(dir, (entry) => entry.isDirectory() && !entry.name.startsWith('.'))
}

/** Read a file's text with newline normalization ('' when missing). */
async function readOptionalText(path) {
  try {
    return normalizeNewlines(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

/** True when path exists as a regular file. */
async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

// ── plugin + card assembly ──────────────────────────────────────────

/**
 * Build every card of one plugin directory. Throws for plugin-level
 * failures (plugin.json missing/corrupt while agents exist, unreadable
 * agents directory); per-agent-file failures land in warnings instead.
 * @returns {Promise<{ cards: object[], warnings: string[] }>}
 */
async function scanPluginDirectory(pluginDir) {
  const pluginName = basename(pluginDir)
  const agentFiles = await listFlatMarkdown(join(pluginDir, 'agents'))

  // The manifest read keeps its own ENOENT: a missing plugin.json is a
  // different verdict than a corrupt one, and a directory with neither
  // manifest nor agents is a foreign folder that stays silently invisible.
  let manifestText
  try {
    manifestText = await readFile(join(pluginDir, '.codebuddy-plugin', 'plugin.json'), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (agentFiles.length === 0) return { cards: [], warnings: [] }
      throw new Error('plugin.json missing')
    }
    throw new Error(`plugin.json unreadable: ${messageOf(error)}`)
  }
  let manifest
  try {
    manifest = JSON.parse(normalizeNewlines(manifestText))
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('plugin.json is not an object')
    }
  } catch (error) {
    throw new Error(`plugin.json corrupt: ${messageOf(error)}`)
  }

  const warnings = []
  const isTeam = manifest.expertType === 'team' || agentFiles.length > 1
  const pngs = await listPngs(join(pluginDir, 'avatars'))
  const firstPng = pngs[0]
  const teamPng = pngs.includes('team.png') ? 'team.png' : undefined
  const skills = await listSubdirectories(join(pluginDir, 'skills'))
  const ruleFiles = await listFlatMarkdown(join(pluginDir, 'rules'))
  const readmeParagraph = firstNonTitleParagraph(await readOptionalText(join(pluginDir, 'README.md')))
  const manifestProfessionZh = zhOf(manifest.profession)
  const manifestDescriptionZh = zhOf(manifest.displayDescription)
  const manifestCategory = stringOf(manifest.categoryId)

  const cards = []
  for (const file of agentFiles) {
    try {
      const raw = await readFile(join(pluginDir, 'agents', file), 'utf8')
      const { fields, body } = splitFrontmatter(normalizeNewlines(raw))

      const id = stringOf(fields.name)
      if (id === '') throw new Error('frontmatter has no name')
      if (!ID_RE.test(id)) throw new Error(`frontmatter name fails ${String(ID_RE)}: ${JSON.stringify(id)}`)
      const name = enOf(fields.displayName) || id

      // zhName chain — the FUNCTIONAL name first for both classes: solo
      // cards lead with plugin.json profession.zh, team cards with their
      // own frontmatter profession.zh, each keeping the other fields as
      // fallbacks, the body-H1 extension last, and the card's English
      // base name as the terminal fallback.
      const zhNameCandidates = isTeam
        ? [zhOf(fields.profession), zhOf(fields.displayName)]
        : [manifestProfessionZh, zhOf(fields.displayName), zhOf(fields.profession)]
      zhNameCandidates.push(bodyHeadingFunctionalName(body))
      const zhName = zhNameCandidates.find((candidate) => candidate !== '') ?? name

      // persona: agent body + every rule file under a generated title,
      // with template escaping applied to the assembled whole (the repo's
      // shared sanitize pipeline, ticket 02).
      const parts = [body.trim()]
      for (const rule of ruleFiles) {
        const ruleText = await readFile(join(pluginDir, 'rules', rule), 'utf8')
        parts.push(`# 附加规则：rules/${rule}\n\n${splitFrontmatter(normalizeNewlines(ruleText)).body.trim()}`)
      }
      const persona = escapeUnregisteredTemplateGroups(parts.join('\n\n'))

      // avatarPath: the existence-checked chains. The team's
      // `<agentName>.png` exact match tries the frontmatter name and the
      // md file stem — the two readings coincide across the real corpus.
      let avatarPath
      if (isTeam) {
        const stem = file.replace(/\.md$/, '')
        const exact = pngs.find((png) => png === `${id}.png` || png === `${stem}.png`) ?? teamPng ?? firstPng
        avatarPath = exact === undefined ? undefined : join(pluginDir, 'avatars', exact)
      } else {
        const declared = stringOf(manifest.avatar).replace(/^\.\//, '')
        avatarPath = declared !== '' && (await isFile(join(pluginDir, declared)))
          ? join(pluginDir, declared)
          : firstPng === undefined ? undefined : join(pluginDir, 'avatars', firstPng)
      }

      cards.push({
        id,
        name,
        zhName,
        description: stringOf(fields.description),
        zhDescription: manifestDescriptionZh || readmeParagraph,
        persona,
        skills: [...skills],
        avatarPath,
        pluginDir: pluginName,
        agentFile: file,
        teamSize: agentFiles.length,
        category: manifestCategory === '' ? undefined : manifestCategory,
      })
    } catch (error) {
      warnings.push(`${pluginName}/agents/${file}: expert skipped (${messageOf(error)})`)
    }
  }
  return { cards, warnings }
}

/**
 * Scan one WorkBuddy root into expert cards. Pure read: nothing is
 * written, no scripts run, no fingerprinting (the catalog cache owns
 * that).
 * @param {string} rawRoot - raw stored source path (tilde expanded here)
 * @returns {Promise<{ experts: object[], warnings: string[] }>}
 */
export async function scanWorkbuddyRoot(rawRoot) {
  const experts = []
  const warnings = []
  const root = expandTildePath(rawRoot)

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    // A missing root is the state layer's message (pathExists=false plus
    // its own warning) — the scanner stays silent here to avoid
    // duplicating it.
    if (error.code !== 'ENOENT') {
      warnings.push(`source directory not readable: ${root} (${messageOf(error)})`)
    }
    return { experts, warnings }
  }

  const seen = new Set()
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    // WorkBuddy's duplicate-install copies carry `git:`-prefixed names and
    // duplicate the original's agent ids — skipped whole, silently.
    if (name.startsWith('git:')) continue
    let plugin
    try {
      plugin = await scanPluginDirectory(join(root, name))
    } catch (error) {
      warnings.push(`${name}: plugin skipped (${messageOf(error)})`)
      continue
    }
    for (const card of plugin.cards) {
      if (seen.has(card.id)) {
        warnings.push(`duplicate expert id "${card.id}" from ${card.pluginDir} skipped (first wins)`)
        continue
      }
      seen.add(card.id)
      experts.push(card)
    }
    warnings.push(...plugin.warnings)
  }
  return { experts, warnings }
}
