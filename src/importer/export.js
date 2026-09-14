/**
 * Install/update/uninstall engine (design §7, ticket 07): the market
 * "install" is an EXPORT of a scanned WorkBuddy card into the user-rank
 * experts root — `<expertsRoot>/<id>/` carrying expert.yml + role.md +
 * skills/ (whole subtree, verbatim) + `.expert-source.json`.
 *
 * Folder layout produced (identical to a hand-written expert, design §1):
 *
 *   <expertsRoot>/<id>/expert.yml          id/display_name/description/order
 *   <expertsRoot>/<id>/role.md             the card persona — the scanner
 *                                          already ran the shared sanitize
 *                                          pipeline, so this is verbatim
 *   <expertsRoot>/<id>/skills/...          the source plugin's skills/
 *                                          subtree copied wholesale (dirs
 *                                          without SKILL.md included — #15
 *                                          verbatim-copy philosophy)
 *   <expertsRoot>/<id>/.expert-source.json { sourcePath (raw), pluginDir,
 *                                          agentFile, fingerprint,
 *                                          importedAt }
 *
 * Fingerprint (wb-market decision #8 field coverage: everything that
 * lands in the folder must move it) = sha256 over the SCAN CARD's
 * name + description + persona plus a stat manifest (relpath, size,
 * mtime) of the SOURCE skills/ subtree. The README-heuristic
 * zhDescription does not land in the hash — a README edit alone must
 * never fabricate "updatable". Degraded-path rule (wb-market #21 ②): the
 * hash reads scan data + SOURCE stats, never the exported on-disk
 * artifact, so a hand-edited export can never stick "updatable".
 *
 * Everything created is owner-only: directories 0o700, files 0o600 with
 * the source's owner-execute bit preserved.
 *
 * Error contract (routes map these to statuses):
 *   CARD_NOT_FOUND   id absent from the current scan table
 *   CARD_INVALID     id fails the registry's folder-name charset (the
 *                    export could only produce a broken folder)
 *   FOLDER_EXISTS    target folder exists WITHOUT a valid manifest
 *                    (hand-written expert) — never overwritten
 *   MANIFEST_BROKEN  manifest exists but is unreadable/corrupt — the
 *                   「清单缺失，请卸载重装」verdict
 *   NOT_INSTALLED    update/uninstall on a missing folder
 *   NOT_EXPORTED     uninstall on a folder this importer did not export
 */

import { createHash } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ID_RE as REGISTRY_ID_RE } from '../registry.js'
import { expandTildePath } from './scanner.js'

/** The per-folder export manifest file name. */
export const MANIFEST_NAME = '.expert-source.json'

/** Broken-export reason string (design §7, echoed by state and errors). */
export const BROKEN_MANIFEST_REASON = '清单缺失，请卸载重装'

/** expert.yml `order` of every export — stable, hash-free (ticket 07). */
export const EXPORT_ORDER = 200

/** Bump when the fingerprint canonical string below changes shape. */
const FINGERPRINT_FORMAT = 'v1'

/** Owner-only directory mode for everything the export creates. */
const DIR_MODE = 0o700
/** Owner-only file mode; the source's owner-execute bit is OR-ed in. */
const FILE_MODE = 0o600
/** Owner-execute bit (kept from the source file on copy). */
const OWNER_EXECUTE = 0o100

/** A tagged engine error (the `code` drives the route's status). */
class ExportError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** JSON-quote one scalar for the expert.yml the registry parses back. */
const yml = (value) => JSON.stringify(String(value))

// ── fingerprint ──────────────────────────────────────────────────────────────

/**
 * `relpath:size:mtimeMs` lines of every non-dot file AND directory under
 * the SOURCE skills/ subtree (name-sorted, full depth — the export copies
 * the whole tree, so the manifest must cover the whole tree). Dot
 * entries and symlinks are skipped: the copy skips them too, so they
 * cannot land and must not move the fingerprint.
 * @param {string} skillsDir - one plugin's `skills/` directory
 * @returns {Promise<string[]>}
 */
async function skillsStatLines(skillsDir) {
  const lines = []
  async function walk(current, prefix) {
    let dirents
    try {
      dirents = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    for (const dirent of dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (dirent.name.startsWith('.')) continue
      if (!dirent.isFile() && !dirent.isDirectory()) continue
      const rel = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`
      const info = await stat(join(current, dirent.name))
      lines.push(`${rel}:${String(info.size)}:${String(info.mtimeMs)}`)
      if (dirent.isDirectory()) await walk(join(current, dirent.name), rel)
    }
  }
  await walk(skillsDir, '')
  return lines
}

/**
 * The updatable-detection fingerprint of one card: sha256 over the SCAN
 * CARD's name + description + persona plus the source skills stat
 * manifest (wb-market decision #8 — everything that lands must move it;
 * the README-heuristic zhDescription does not land and stays out).
 * Deterministic across processes; reads only scan data + source stats,
 * never the exported artifact (degraded-path rule, wb-market #21 ②).
 * @param {object} card - scanner card
 * @param {string} rawSourcePath - RAW stored source path (tilde expanded here)
 * @returns {Promise<string>} sha256 hex digest
 */
export async function cardFingerprint(card, rawSourcePath) {
  const skillsDir = join(expandTildePath(rawSourcePath), card.pluginDir, 'skills')
  const pieces = [
    FINGERPRINT_FORMAT,
    `name:${card.name}`,
    `description:${card.description}`,
    `persona:\n${card.persona}`,
  ]
  const lines = await skillsStatLines(skillsDir).catch(() => ['<unreadable>'])
  for (const line of lines) pieces.push(`skills/${line}`)
  return createHash('sha256').update(pieces.join('\n')).digest('hex')
}

// ── manifest read/validate ───────────────────────────────────────────────────

/**
 * Read + shape-validate one folder's `.expert-source.json`.
 * @param {string} dir - the expert folder
 * @returns {Promise<{status: 'ok', value: object} | {status: 'corrupt'} | {status: 'absent'}>}
 */
async function readManifest(dir) {
  let text
  try {
    text = await readFile(join(dir, MANIFEST_NAME), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'absent' }
    return { status: 'corrupt' }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { status: 'corrupt' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'corrupt' }
  for (const field of ['sourcePath', 'pluginDir', 'agentFile', 'fingerprint']) {
    if (typeof parsed[field] !== 'string' || parsed[field] === '') return { status: 'corrupt' }
  }
  if (typeof parsed.importedAt !== 'string') return { status: 'corrupt' }
  return { status: 'ok', value: parsed }
}

/** True when the target folder exists (any kind — file or directory). */
async function targetExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// ── tree copy (owner-only) ───────────────────────────────────────────────────

/**
 * Copy one source directory tree into a fresh target, wholesale: every
 * non-dot file and directory, symlinks skipped. Directories 0o700; files
 * 0o600 with the source's owner-execute bit preserved.
 * @param {string} src - absolute source directory (missing → no-op)
 * @param {string} dst - absolute target directory (created only on copy)
 */
async function copyTree(src, dst) {
  let dirents
  try {
    dirents = await readdir(src, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  await mkdir(dst, { recursive: true })
  await chmod(dst, DIR_MODE)
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue
    const from = join(src, dirent.name)
    const to = join(dst, dirent.name)
    if (dirent.isDirectory()) {
      await copyTree(from, to)
    } else if (dirent.isFile()) {
      const bytes = await readFile(from)
      await writeFile(to, bytes, { mode: FILE_MODE })
      const info = await stat(from)
      await chmod(to, info.mode & OWNER_EXECUTE ? FILE_MODE | OWNER_EXECUTE : FILE_MODE)
    }
  }
}

/** Write one owner-only text file. */
async function writeSecure(path, text) {
  await writeFile(path, text, { mode: FILE_MODE })
  await chmod(path, FILE_MODE)
}

// ── the export itself ────────────────────────────────────────────────────────

/**
 * Export one card into its folder (install and changed-update share
 * this): expert.yml + role.md + a wholesale-replaced skills/ tree + a
 * fresh `.expert-source.json`.
 * @returns {Promise<{id: string, dir: string, fingerprint: string}>}
 */
async function exportCard(card, rawSourcePath, expertsRoot, now) {
  const dir = join(expertsRoot, card.id)
  const fingerprint = await cardFingerprint(card, rawSourcePath)

  await mkdir(dir, { recursive: true })
  await chmod(dir, DIR_MODE)

  const expertYml = [
    `id: ${yml(card.id)}`,
    `display_name: ${yml(card.zhName || card.name)}`,
    `description: ${yml(card.zhDescription || card.description)}`,
    `order: ${EXPORT_ORDER}`,
    '',
  ].join('\n')
  await writeSecure(join(dir, 'expert.yml'), expertYml)

  // role.md: the scanner already ran the shared sanitize pipeline over
  // the persona — written verbatim (design §1: export-time cleaning).
  await writeSecure(join(dir, 'role.md'), `${card.persona}\n`)

  // skills/: whole-tree sync — remove, then copy the source subtree
  // wholesale (adds, deletes and overwrites land together).
  await rm(join(dir, 'skills'), { recursive: true, force: true })
  await copyTree(join(expandTildePath(rawSourcePath), card.pluginDir, 'skills'), join(dir, 'skills'))

  await writeSecure(join(dir, MANIFEST_NAME), `${JSON.stringify({
    sourcePath: rawSourcePath,
    pluginDir: card.pluginDir,
    agentFile: card.agentFile,
    fingerprint,
    importedAt: now(),
  })}\n`)

  return { id: card.id, dir, fingerprint }
}

// ── engine ───────────────────────────────────────────────────────────────────

/**
 * Create the export engine behind the install/update/uninstall routes
 * and the `/api/state` overlay.
 *
 * @param {object} options
 * @param {string} options.expertsRoot - the export root (`<dshHome>/experts`)
 * @param {{ stateOf(raw: string): Promise<{experts: object[], warnings: string[]}> }} options.catalog
 *   - the shared scan cache (never a private rescan)
 * @param {() => string} options.getRawSourcePath - RAW stored source path
 * @param {() => string} [options.now] - importedAt clock (ISO string)
 */
export function createExporter({ expertsRoot, catalog, getRawSourcePath, now = () => new Date().toISOString() }) {
  /** The current scan table (through the shared catalog cache). */
  const scanState = () => catalog.stateOf(getRawSourcePath())

  /** The scan card for one id, or a CARD_NOT_FOUND error. */
  async function requireCard(id) {
    const scan = await scanState()
    const card = scan.experts.find((expert) => expert.id === id)
    if (card === undefined) {
      throw new ExportError('CARD_NOT_FOUND', `expert "${id}" is not in the current scan table`)
    }
    return card
  }

  /**
   * The manifest verdict of one installed folder, with the two refusal
   * errors pre-raised for install/update (never overwrite a folder we
   * cannot attribute; a corrupt manifest always answers the same text).
   */
  async function manifestForWrite(id) {
    const dir = join(expertsRoot, id)
    if (!(await targetExists(dir))) return { dir, status: 'absent' }
    const manifest = await readManifest(dir)
    if (manifest.status === 'absent') {
      throw new ExportError(
        'FOLDER_EXISTS',
        `expert folder already exists without a valid ${MANIFEST_NAME}: ${dir} (hand-written expert? this export never overwrites it)`,
      )
    }
    if (manifest.status === 'corrupt') {
      throw new ExportError('MANIFEST_BROKEN', `${BROKEN_MANIFEST_REASON} (${dir})`)
    }
    return { dir, status: 'ok', manifest: manifest.value }
  }

  return {
    /**
     * Install = export. A folder holding a VALID manifest re-exports in
     * place (idempotent); anything else that exists refuses.
     * @returns {Promise<{id: string, dir: string, fingerprint: string, changed: true}>}
     */
    async install(id) {
      const card = await requireCard(id)
      if (!REGISTRY_ID_RE.test(card.id)) {
        throw new ExportError('CARD_INVALID', `expert id "${card.id}" is not a valid expert folder name (${String(REGISTRY_ID_RE)})`)
      }
      const verdict = await manifestForWrite(card.id)
      const result = await exportCard(card, getRawSourcePath(), expertsRoot, now)
      return { ...result, changed: true, reinstalled: verdict.status === 'ok' }
    },

    /**
     * Update = in-place re-export when the source fingerprint moved;
     * unchanged sources answer changed:false without touching the disk
     * (idempotent — no false "updatable" ever rewrites anything).
     * @returns {Promise<{id: string, dir: string, fingerprint: string, changed: boolean}>}
     */
    async update(id) {
      const card = await requireCard(id)
      if (!REGISTRY_ID_RE.test(card.id)) {
        throw new ExportError('CARD_INVALID', `expert id "${card.id}" is not a valid expert folder name (${String(REGISTRY_ID_RE)})`)
      }
      const dir = join(expertsRoot, card.id)
      if (!(await targetExists(dir))) {
        throw new ExportError('NOT_INSTALLED', `expert "${card.id}" is not installed (no folder: ${dir})`)
      }
      const manifest = await readManifest(dir)
      if (manifest.status === 'absent') {
        throw new ExportError(
          'FOLDER_EXISTS',
          `expert folder exists without a valid ${MANIFEST_NAME}: ${dir} (hand-written expert? this export never overwrites it)`,
        )
      }
      if (manifest.status === 'corrupt') {
        throw new ExportError('MANIFEST_BROKEN', `${BROKEN_MANIFEST_REASON} (${dir})`)
      }
      const fingerprint = await cardFingerprint(card, getRawSourcePath())
      if (manifest.value.fingerprint === fingerprint) {
        return { id: card.id, dir, fingerprint, changed: false }
      }
      const result = await exportCard(card, getRawSourcePath(), expertsRoot, now)
      return { ...result, changed: true }
    },

    /**
     * Uninstall = delete the whole expert folder. Refused when the
     * folder was never exported by this importer (no manifest file at
     * all); a CORRUPT manifest still uninstalls — the「卸载重装」
     * recovery path must work.
     * @returns {Promise<{id: string, dir: string}>}
     */
    async uninstall(id) {
      const dir = join(expertsRoot, id)
      if (!(await targetExists(dir))) {
        throw new ExportError('NOT_INSTALLED', `expert "${id}" is not installed (no folder: ${dir})`)
      }
      const manifest = await readManifest(dir)
      if (manifest.status === 'absent') {
        throw new ExportError(
          'NOT_EXPORTED',
          `refusing to uninstall ${dir}: no ${MANIFEST_NAME} (not exported by this importer; delete it manually)`,
        )
      }
      await rm(dir, { recursive: true, force: true })
      return { id, dir }
    },

    /**
     * The `/api/state` installed overlay (mirrors wb-market's shape):
     *
     *   installed — exported folders whose id is in the current scan
     *               table, each carrying its manifest fields plus
     *               `updatable` (source fingerprint moved);
     *   broken    — folders whose manifest exists but is corrupt, with
     *               the「清单缺失，请卸载重装」reason;
     *   orphans   — exported folders whose id left the scan table
     *               (never auto-deleted, listed for the user to act on).
     *
     * Folders without a manifest file are hand-written experts — not
     * this importer's business, absent from every list.
     * @returns {Promise<{installed: object[], broken: object[], orphans: object[]}>}
     */
    async overlay() {
      const raw = getRawSourcePath()
      const scan = await scanState()
      const byId = new Map(scan.experts.map((expert) => [expert.id, expert]))
      const installed = []
      const broken = []
      const orphans = []
      let dirents
      try {
        dirents = await readdir(expertsRoot, { withFileTypes: true })
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        return { installed, broken, orphans }
      }
      for (const name of dirents.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort()) {
        const dir = join(expertsRoot, name)
        const manifest = await readManifest(dir)
        if (manifest.status === 'absent') continue
        if (manifest.status === 'corrupt') {
          broken.push({ id: name, dir, reason: BROKEN_MANIFEST_REASON })
          continue
        }
        const card = byId.get(name)
        if (card === undefined) {
          orphans.push({ id: name, dir, sourcePath: manifest.value.sourcePath, pluginDir: manifest.value.pluginDir, importedAt: manifest.value.importedAt })
          continue
        }
        const fingerprint = await cardFingerprint(card, raw)
        installed.push({
          id: name,
          dir,
          sourcePath: manifest.value.sourcePath,
          pluginDir: manifest.value.pluginDir,
          agentFile: manifest.value.agentFile,
          fingerprint: manifest.value.fingerprint,
          importedAt: manifest.value.importedAt,
          updatable: manifest.value.fingerprint !== fingerprint,
        })
      }
      return { installed, broken, orphans }
    },
  }
}
