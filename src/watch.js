/**
 * Zero-dependency root watcher (ticket 02): a chokidar-style add/remove
 * watch over the discovery roots, built on node:fs.watch with debouncing —
 * the plugin stays dependency-free like its sister plugin, while the
 * dsh-skill-filesystem watcher (chokidar) is bundled inside the harness and
 * not importable from a plain plugin without adding a dependency.
 *
 * Attachment ladder per root, most informative first:
 *   1. fs.watch(root, { recursive: true }) — catches edits too (macOS/Win,
 *      and Linux with recent node);
 *   2. fs.watch(root) — depth-1 rename events still catch expert folder
 *      add/remove, the ticket's requirement;
 *   3. fs.watch(parent) filtered to the root's basename — catches the root
 *      itself being created later;
 *   4. give up with one warning (list()'s TTL bounds staleness anyway).
 *
 * An errored watcher is closed, the invalidation is scheduled (so a deletion
 * is picked up), and re-attachment is retried once after a grace period.
 * Everything is reversible: the returned disposer closes every watcher and
 * pending timer.
 */

import { watch } from 'node:fs'
import { basename, dirname } from 'node:path'

/** Render thrown values as one line. */
function messageOf(error) {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '<unrenderable>'
  }
}

/**
 * Watch every root path and call `onInvalidate()` (debounced) after
 * add/remove/change activity under any of them.
 * @param {string[]} rootPaths - absolute discovery-root paths
 * @param {() => void} onInvalidate - debounced change hook
 * @param {{logger?: {warn?: (message: string) => void}, debounceMs?: number}} [options]
 * @returns {() => void} disposer closing all watchers and timers
 */
export function watchRoots(rootPaths, onInvalidate, options = {}) {
  const debounceMs = options.debounceMs ?? 150
  const logger = options.logger
  const watchers = new Set()
  const timers = new Set()
  const failed = new Set()
  let debounceTimer = null
  let closed = false

  const warn = (message) => logger?.warn?.(`dsh-workbuddy-expert: ${message}`)

  const scheduleInvalidate = () => {
    if (closed) return
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (!closed) onInvalidate()
    }, debounceMs)
    if (typeof debounceTimer.unref === 'function') debounceTimer.unref()
  }

  const later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (!closed) fn()
    }, ms)
    timers.add(timer)
    if (typeof timer.unref === 'function') timer.unref()
  }

  /** Adopt one fs.FSWatcher with error-driven teardown and retry. */
  const adopt = (watcher, rootPath, retry) => {
    watchers.add(watcher)
    watcher.on('error', (error) => {
      watchers.delete(watcher)
      try {
        watcher.close()
      } catch {
        /* already closed */
      }
      if (closed) return
      warn(`watcher for ${rootPath} failed: ${messageOf(error)} — rescanning and retrying`)
      scheduleInvalidate()
      later(retry, debounceMs * 8)
    })
    watcher.on('close', () => watchers.delete(watcher))
  }

  /** Try the attachment ladder for one root path. */
  const attach = (rootPath) => {
    if (closed) return
    // 1. recursive watch — events anywhere under the root.
    try {
      adopt(watch(rootPath, { recursive: true }, scheduleInvalidate), rootPath, () => attach(rootPath))
      return
    } catch {
      /* fall through */
    }
    // 2. plain watch — still sees depth-1 folder add/remove.
    try {
      adopt(watch(rootPath, scheduleInvalidate), rootPath, () => attach(rootPath))
      return
    } catch {
      /* fall through */
    }
    // 3. watch the parent filtered to the root's basename (root created later).
    try {
      const name = basename(rootPath)
      const parent = dirname(rootPath)
      const watcher = watch(parent, (event, filename) => {
        if (typeof filename === 'string' && filename !== name) return
        scheduleInvalidate()
        // The root may now exist — upgrade to watching the root itself.
        later(() => attach(rootPath), debounceMs * 2)
      })
      adopt(watcher, rootPath, () => attach(rootPath))
      return
    } catch (error) {
      // 4. give up once per root.
      if (!failed.has(rootPath)) {
        failed.add(rootPath)
        warn(`cannot watch ${rootPath} (${messageOf(error)}) — expert add/remove may lag up to the scan TTL`)
      }
    }
  }

  for (const rootPath of rootPaths) attach(rootPath)

  return () => {
    closed = true
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    for (const watcher of watchers) {
      try {
        watcher.close()
      } catch {
        /* already closed */
      }
    }
    watchers.clear()
  }
}
