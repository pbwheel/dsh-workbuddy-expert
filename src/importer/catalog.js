/**
 * Scan cache with the fingerprint scheme — ported verbatim in behavior
 * from wb-market src/catalog.js (design §7).
 *
 * The cache key is the RAW sourcePath plus a per-plugin file-manifest
 * fingerprint:
 *
 *   fingerprint = sha256 over a canonical string built from
 *     - the name list of the root's plugin directories (`git:` copies
 *       excluded — the scanner skips them whole, so they can never move
 *       the scan output and must not be able to move the cache either),
 *     - per plugin: the stat tuple of `.codebuddy-plugin/plugin.json`
 *       (the metadata source — editing it invalidates the cache) and
 *       the `(relativePath, mtimeMs, size)` tuples of every non-dot
 *       entry under `agents/ skills/ rules/ avatars/` down to depth 3 —
 *       entries INCLUDE directories themselves (a skills/ subdirectory
 *       with no files still changes the scan output, so a files-only
 *       manifest could miss).
 *
 * `GET /api/state` computes that stat-only fingerprint on every request
 * (never a content read) and rescans only when it moved. This is exactly
 * the required granularity: editing an existing agent file, or adding
 * one inside an existing plugin's `agents/`, leaves every top-level
 * directory mtime untouched — a top-level `(name, mtimeMs)` key would
 * miss both.
 *
 * Deliberate blind spots (stat tuples, not content hashes): a rewrite
 * that preserves size AND restores mtime is invisible until
 * `POST /api/refresh` force-drops the cache, and README.md is outside
 * the key. Refresh is the disclosed fallback — which is why invalidate()
 * must truly force a fresh scan even when one is already in flight (the
 * epoch gate below).
 *
 * The scanner itself stays a pure function with no fingerprinting — the
 * comparison lives here, in the service layer.
 */

import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { expandTildePath, scanWorkbuddyRoot } from './scanner.js'

/** Plugin subdirectories whose entries shape the scan output. */
const FINGERPRINTED_SUBDIRS = ['agents', 'skills', 'rules', 'avatars']

/** Entries are collected down to this depth inside each subdirectory above. */
const MAX_SUBDIR_DEPTH = 3

/** Bump when the canonical string below changes shape. */
const FINGERPRINT_FORMAT = 'v1'

/** The stat tuple of one manifest entry: `mtimeMs,size`. */
const tupleOf = (info) => `${String(info.mtimeMs)},${String(info.size)}`

/**
 * `relativePath:mtimeMs,size` lines of every non-dot file/directory under
 * `dir`, depth 1..3, name-sorted — the per-subdirectory manifest block.
 * A missing directory contributes nothing; other read errors surface to
 * the caller's per-plugin degradation.
 * @param {string} dir - one plugin's `agents/`-style subdirectory
 * @returns {Promise<string[]>}
 */
async function collectEntryLines(dir) {
  const lines = []
  async function walk(current, prefix, depth) {
    let dirents
    try {
      dirents = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    for (const dirent of dirents) {
      // Dot entries and symlinks are invisible to the scanner (its listDir
      // filters exactly these), so they stay invisible to the fingerprint —
      // the key must move iff the scan output can move.
      if (dirent.name.startsWith('.')) continue
      if (!dirent.isFile() && !dirent.isDirectory()) continue
      const rel = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`
      const info = await stat(join(current, dirent.name))
      lines.push(`${rel}:${tupleOf(info)}`)
      if (dirent.isDirectory() && depth < MAX_SUBDIR_DEPTH) {
        await walk(join(current, dirent.name), rel, depth + 1)
      }
    }
  }
  await walk(dir, '', 1)
  return lines.sort()
}

/**
 * Stat-only fingerprint of one WorkBuddy source root (raw path in, tilde
 * expanded here). Deterministic across processes: same tree stats → same
 * hash. Never reads file contents; an unreachable root (missing,
 * unreadable) hashes to a stable marker so the empty scan it produces
 * stays cacheable.
 * @param {string} rawRoot - raw stored source path
 * @returns {Promise<string>} sha256 hex digest
 */
export async function computeSourceFingerprint(rawRoot) {
  const root = expandTildePath(rawRoot)

  let dirents
  try {
    dirents = await readdir(root, { withFileTypes: true })
  } catch {
    return createHash('sha256').update(`${FINGERPRINT_FORMAT}:unreachable-root`).digest('hex')
  }

  const pluginNames = dirents
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('git:'))
    .map((entry) => entry.name)
    .sort()

  const pieces = [FINGERPRINT_FORMAT, `plugins:${pluginNames.join(',')}`]
  for (const name of pluginNames) {
    pieces.push(`plugin:${name}`)
    let manifestLine = 'missing'
    try {
      manifestLine = tupleOf(await stat(join(root, name, '.codebuddy-plugin', 'plugin.json')))
    } catch (error) {
      // ENOENT → the scanner's "manifest missing" degradation; anything
      // else is an unreadable file whose recovery changes this line anyway.
      if (error.code !== 'ENOENT') manifestLine = 'unreadable'
    }
    pieces.push(`manifest:${manifestLine}`)
    for (const sub of FINGERPRINTED_SUBDIRS) {
      let lines
      try {
        lines = await collectEntryLines(join(root, name, sub))
      } catch {
        lines = ['<unreadable>']
      }
      for (const line of lines) pieces.push(`${sub}/${line}`)
    }
  }
  return createHash('sha256').update(pieces.join('\n')).digest('hex')
}

/**
 * Create a scan cache around a scan function. `stateOf` compares the
 * fingerprint before every answer: unchanged → the cached result (no
 * content re-read), moved → a fresh scan that replaces the cache. One
 * cache entry only — switching source paths always rescans.
 *
 * Concurrency: misses that share one (path, fingerprint) join a single
 * in-flight scan instead of stampeding the tree — but only within the
 * current invalidation epoch. `invalidate()` bumps the epoch, so a scan
 * born before it can neither be joined by later requests nor repopulate
 * the cache when it settles: the refresh route's "force a rescan" holds
 * even in the exotic size+mtime-preserving case where the fingerprint
 * itself cannot tell old from new.
 *
 * @param {(rawRoot: string) => Promise<{experts: object[], warnings: string[]}>} [scan]
 * @param {(rawRoot: string) => Promise<string>} [fingerprint]
 * @returns {{
 *   stateOf(rawSourcePath: string): Promise<{experts: object[], warnings: string[]}>,
 *   invalidate(): void,
 * }}
 */
export function createCatalog(scan = scanWorkbuddyRoot, fingerprint = computeSourceFingerprint) {
  let cached = null
  let inflight = null
  let epoch = 0

  /** Same path and fingerprint as this request? (the composite cache key) */
  const keyMatches = (entry, rawSourcePath, currentFingerprint) =>
    entry !== null && entry.sourcePath === rawSourcePath && entry.fingerprint === currentFingerprint

  return {
    /**
     * The scan result for one raw source path, auto-rescanned when the
     * fingerprint moved. The returned object is the cached reference —
     * callers must treat it as read-only.
     */
    async stateOf(rawSourcePath) {
      const currentFingerprint = await fingerprint(rawSourcePath)
      if (keyMatches(cached, rawSourcePath, currentFingerprint)) {
        return cached.result
      }
      if (inflight !== null && inflight.epoch === epoch
        && keyMatches(inflight, rawSourcePath, currentFingerprint)) {
        return inflight.promise
      }
      const born = epoch
      const entry = { epoch: born, sourcePath: rawSourcePath, fingerprint: currentFingerprint, promise: scan(rawSourcePath) }
      inflight = entry
      try {
        const result = await entry.promise
        if (born === epoch) {
          cached = { sourcePath: rawSourcePath, fingerprint: currentFingerprint, result }
        }
        return result
      } finally {
        if (inflight === entry) inflight = null
      }
    },

    /**
     * Drop the cache and cut the epoch: the next `stateOf` starts a scan
     * of its own (`POST /api/refresh`), never joining one already running,
     * and a scan still in flight from before cannot repopulate the cache.
     */
    invalidate() {
      cached = null
      epoch += 1
    },
  }
}
