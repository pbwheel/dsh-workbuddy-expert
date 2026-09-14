/**
 * Read-only HTTP routes for the WorkBuddy importer — ported from
 * wb-market src/routes.js with the install/update/uninstall/agentPresets
 * machinery removed (ticket 07 owns export; this ticket is read-only).
 *
 *   GET  /dsh-workbuddy-expert/api/state  → { sourcePath, pathExists,
 *                                             revision, experts, warnings }
 *                                           (no-store); expert cards carry
 *                                           avatarUrl (only when the scan
 *                                           found a PNG) and never leak the
 *                                           internal absolute avatarPath;
 *                                           the fingerprint moves → an
 *                                           automatic rescan before the
 *                                           answer (catalog.stateOf);
 *   GET  /dsh-workbuddy-expert/api/avatar?id=<id>
 *                                     → the expert's PNG read on demand
 *                                       from the CURRENT scan table (never
 *                                       copied), image/png + max-age=60;
 *                                       the id must pass the scanner's
 *                                       ID_RE, hit the table, and its
 *                                       avatarPath must realpath inside
 *                                       the source root — unknown/invalid/
 *                                       escaping ids all answer one uniform
 *                                       404 (no probe signal), and read
 *                                       failures 404 the same way;
 *   POST /dsh-workbuddy-expert/api/config { sourcePath, expectedRevision }
 *                                     → save the RAW path string through
 *                                       the SERVICE-level settings update
 *                                       (revision conflict protection),
 *                                       answer with the new state;
 *                                       nonexistent paths are saveable and
 *                                       surface as pathExists=false +
 *                                       warning;
 *   POST /dsh-workbuddy-expert/api/refresh → drop the scan cache, answer
 *                                       with a freshly scanned state.
 *
 * Security baseline (ported from wb-market): mutating routes accept
 * same-origin POSTs only (405/403 otherwise), JSON bodies are capped at
 * 4 KiB, every JSON response carries no-store, and one mutating operation
 * runs at a time — a concurrent second change gets 409. The avatar route
 * is a GET read: no origin check, no lane — its only guard is the
 * id/containment chain above, and it is the ONE response allowed to cache
 * (max-age=60, the sole exception to no-store; a source PNG mtime change
 * moves the fingerprint, the rescan swaps the bytes, and the 60s window
 * absorbs itself).
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

import { ID_RE, expandTildePath } from './scanner.js'
import { SETTINGS_NS, namespaceDescriptor } from './settings.js'
import { errorMessage } from './util.js'

export const ROUTE_BASE = '/dsh-workbuddy-expert'

/** Write a JSON payload with no-store caching. */
function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/** True when the request's Origin matches its Host — required on POSTs. */
function sameOrigin(request) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Read and parse a JSON body, rejecting anything over 4 KiB. */
async function readJsonBody(request, maxBytes = 4096) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Whether the expanded form of a raw stored path exists on disk. */
async function pathExists(rawSourcePath) {
  try {
    await stat(expandTildePath(rawSourcePath))
    return true
  } catch {
    return false
  }
}

/**
 * True when a fully resolved candidate path sits strictly inside a fully
 * resolved root. Both inputs must already be realpath'd — the route
 * resolves both sides through the filesystem itself, so `..` segments AND
 * symlinks (a declared plugin.json avatar may be either) are undone
 * before the prefix test; a leading `../` or an absolute escape means
 * "outside".
 */
function isWithinRoot(rootReal, candidateReal) {
  const rel = relative(rootReal, candidateReal)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * One state-payload expert card: the scan card minus the internal
 * absolute `avatarPath`, plus `avatarUrl` — but ONLY for experts the scan
 * gave a PNG. PNG-less experts carry neither field. Ids are
 * ID_RE-constrained by the scanner, so the URL needs no percent-encoding.
 */
function stateCardOf(expert) {
  const { avatarPath, ...card } = expert
  return avatarPath === undefined
    ? card
    : { ...card, avatarUrl: `${ROUTE_BASE}/api/avatar?id=${expert.id}` }
}

/**
 * Compose one `/api/state` payload: raw stored path (tilde intact), its
 * existence flag, the settings revision for conflict protection, the
 * expert table (cards via `stateCardOf`), and warnings (scan + path
 * together; a nonexistent path adds its own warning while the scan still
 * answers an empty table).
 * @param {object} deps - { settingsService, catalog }
 * @returns {Promise<object>} the state payload
 */
async function buildState({ settingsService, catalog }) {
  const descriptor = namespaceDescriptor(settingsService)
  const rawSourcePath = descriptor.value.sourcePath
  const exists = await pathExists(rawSourcePath)
  const scan = await catalog.stateOf(rawSourcePath)
  const warnings = [...scan.warnings]
  if (!exists) warnings.push(`source path does not exist: ${rawSourcePath}`)
  return {
    sourcePath: rawSourcePath,
    pathExists: exists,
    revision: descriptor.revision,
    experts: scan.experts.map((expert) => stateCardOf(expert)),
    warnings,
  }
}

/** The RAW stored source path every scan-facing caller reads (tilde intact). */
function currentSourcePath(settingsService) {
  return namespaceDescriptor(settingsService).value.sourcePath
}

/** Validate the `sourcePath` field of a config body; returns it verbatim. */
function requireSourcePath(body) {
  if (body === null || typeof body !== 'object') throw new Error('body must be a JSON object')
  const sourcePath = body.sourcePath
  if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
    throw new Error('missing sourcePath')
  }
  return sourcePath
}

/**
 * Register every importer route on the host webServer. Returns a disposer
 * that drops them all, so the plugin unloads cleanly.
 * @param {object} hostCtx - injected context exposing `webServer` + `settings`
 * @param {{ invalidate(): void, stateOf(raw: string): Promise<object> }} deps - { catalog } the shared scan cache
 */
export function mountImporterRoutes(hostCtx, { catalog }) {
  const disposers = []
  const register = (route) => {
    const off = hostCtx.webServer.register(route)
    if (typeof off === 'function') disposers.push(off)
  }

  /** What buildState reads: settings + the shared scan cache. */
  const deps = { settingsService: hostCtx.settings, catalog }

  /** The RAW stored source path (tilde intact) every scan-facing caller reads. */
  const rawSourcePathOf = () => currentSourcePath(hostCtx.settings)

  /**
   * The CURRENT scan table's card for one expert id (undefined when absent)
   * — the shared lookup of the avatar route.
   */
  const currentCardOf = async (id) => {
    const scan = await deps.catalog.stateOf(rawSourcePathOf())
    return scan.experts.find((expert) => expert.id === id)
  }

  /** One mutating operation at a time (settings writes + refresh). */
  let mutating = false

  /** Shared guard chain for mutating routes: method, origin, single-flight. */
  function mutationGuard(request, response) {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method not allowed' })
      return false
    }
    if (!sameOrigin(request)) {
      sendJson(response, 403, { error: 'same-origin required' })
      return false
    }
    if (mutating) {
      sendJson(response, 409, { error: 'another change is in progress' })
      return false
    }
    mutating = true
    return true
  }

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/api/state`,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      try {
        sendJson(response, 200, await buildState(deps))
      } catch (error) {
        sendJson(response, 500, { error: errorMessage(error) })
      }
    },
  })

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/api/avatar`,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      // Every miss answers ONE uniform 404 — unknown id, charset reject,
      // PNG-less expert, out-of-root resolution, vanished file — so the
      // route cannot be probed for which ids exist.
      const notFound = () => sendJson(response, 404, { error: 'not found' })
      let id = null
      try {
        id = new URL(request.url ?? '/', 'http://internal.invalid').searchParams.get('id')
      } catch {
        id = null
      }
      if (typeof id !== 'string' || !ID_RE.test(id)) {
        notFound()
        return
      }
      try {
        // The card comes from the CURRENT scan table (through the catalog's
        // fingerprint cache, never a private rescan) — an id that is not in
        // the table has no avatar to serve.
        const card = await currentCardOf(id)
        if (card === undefined || typeof card.avatarPath !== 'string' || card.avatarPath === '') {
          notFound()
          return
        }
        // Containment on REAL paths: realpath undoes `..` and symlink hops
        // on both sides, so a declared avatar spelled or linked anywhere
        // outside the source root fails the check. A missing/unreadable
        // root or file resolves to null and 404s like any other miss.
        const rootReal = await realpath(expandTildePath(rawSourcePathOf())).catch(() => null)
        const avatarReal = await realpath(card.avatarPath).catch(() => null)
        if (rootReal === null || avatarReal === null || !isWithinRoot(rootReal, avatarReal)) {
          notFound()
          return
        }
        // Corpus PNGs are a few hundred KiB at most — a single Buffer read
        // is the stream here (read on demand, never copy). A read that
        // fails after containment (vanished mid-race, EACCES) 404s like
        // every other miss — the uniform body leaks no detail.
        const bytes = await readFile(avatarReal).catch(() => null)
        if (bytes === null) {
          notFound()
          return
        }
        response.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'max-age=60',
          'content-length': String(bytes.length),
        })
        response.end(bytes)
      } catch (error) {
        sendJson(response, 500, { error: errorMessage(error) })
      }
    },
  })

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/api/config`,
    handler: async (request, response) => {
      if (!mutationGuard(request, response)) return
      try {
        const body = await readJsonBody(request)
        const sourcePath = requireSourcePath(body)
        const expectedRevision = body.expectedRevision
        let state
        try {
          // Service-level update: the scope-level update(patch) takes no
          // expectedRevision, so conflict protection is only available here.
          await hostCtx.settings.update(SETTINGS_NS, { sourcePath }, expectedRevision)
          state = await buildState(deps)
        } catch (error) {
          if (error?.code === 'SETTINGS_CONFLICT') {
            sendJson(response, 409, {
              error: errorMessage(error),
              code: 'SETTINGS_CONFLICT',
              expectedRevision: error.expected,
              revision: error.actual,
            })
            return
          }
          throw error
        }
        sendJson(response, 200, state)
      } catch (error) {
        sendJson(response, 400, { error: errorMessage(error) })
      } finally {
        mutating = false
      }
    },
  })

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/api/refresh`,
    handler: async (request, response) => {
      if (!mutationGuard(request, response)) return
      try {
        catalog.invalidate()
        sendJson(response, 200, await buildState(deps))
      } catch (error) {
        sendJson(response, 500, { error: errorMessage(error) })
      } finally {
        mutating = false
      }
    },
  })

  return () => {
    for (const off of disposers) off()
  }
}
