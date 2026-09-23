/**
 * Selector HTTP routes for the client switch control (ticket 05).
 *
 *   GET  /dsh-workbuddy-expert/api/experts[?sessionId=<id>]
 *                                     → { experts, warnings, currentExpertId? }
 *                                       (no-store) — the full card table
 *                                       INCLUDING broken rows (the selector
 *                                       shows them with their reason), cards
 *                                       already sorted by (order, id) by the
 *                                       registry; with ?sessionId the payload
 *                                       additionally carries the session's
 *                                       current expert id (switcher.stateOf —
 *                                       the in-memory projection, the
 *                                       zod-gated session projection stays
 *                                       deferred, see ticket DEVIATIONS);
 *   GET  /dsh-workbuddy-expert/api/expert-avatar?id=<id>
 *                                     → the INSTALLED expert's avatar.png
 *                                       (the installer's copied PNG) read
 *                                       on demand from the registry table;
 *                                       image/png + max-age=60; unknown or
 *                                       avatar-less ids answer one uniform
 *                                       404 (same no-probe rule as the
 *                                       importer's source-side avatar route);
 *   POST /dsh-workbuddy-expert/api/switch {sessionId, expertId}
 *                                     → the serialized soft-switch
 *                                       transaction; answers the transaction's
 *                                       own {kind, text} (kind:'error' stays
 *                                       HTTP 200 — the transport succeeded,
 *                                       the domain answer is the payload);
 *   POST /dsh-workbuddy-expert/api/after-create {sessionId, expertId}
 *                                     → switcher.composeForCreation on the
 *                                       just-created agent (the staged-draft
 *                                       contract: the client stages the pick
 *                                       while no session exists, then fires
 *                                       this ONCE when the session id appears
 *                                       — see client/client.js);
 *   POST /dsh-workbuddy-expert/api/clear {sessionId}
 *                                     → switcher.clear on the live agent:
 *                                       dispose the current expert
 *                                       composition, return to the default
 *                                       agent (the selector's 移除专家
 *                                       action's transport).
 *
 * Security baseline (ported from src/importer/routes.js): mutating routes
 * accept same-origin POSTs only (405/403 otherwise), JSON bodies are capped
 * at 4 KiB, and every JSON response carries no-store. The GET is a plain
 * read: no origin check, no lane.
 *
 * Agent resolution is an INJECTED seam (`resolveAgent(sessionId)`): the live
 * host's agent-by-sessionId lookup shape is not part of this plugin's
 * verified contract (design §11 covers commands/slots, not an agents
 * registry), so src/index.js builds a defensive resolver chain and the
 * routes degrade to a clean domain error when it cannot resolve — never a
 * fiber crash.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

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

/** The sessionId query parameter of a request, or null. */
function sessionIdParamOf(request) {
  try {
    const value = new URL(request.url ?? '/', 'http://internal.invalid').searchParams.get('sessionId')
    return typeof value === 'string' && value.trim() !== '' ? value : null
  } catch {
    return null
  }
}

/** Validate a `{sessionId}` body; returns the sessionId verbatim. */
function requireSession(body) {
  if (body === null || typeof body !== 'object') throw new Error('body must be a JSON object')
  if (typeof body.sessionId !== 'string' || body.sessionId.trim() === '') throw new Error('missing sessionId')
  return body.sessionId
}

/** Validate a `{sessionId, expertId}` body; returns both verbatim. */
function requireSessionAndExpert(body) {
  if (body === null || typeof body !== 'object') throw new Error('body must be a JSON object')
  for (const field of ['sessionId', 'expertId']) {
    const value = body[field]
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing ${field}`)
  }
  return { sessionId: body.sessionId, expertId: body.expertId }
}

/**
 * Register the three selector routes on the host webServer. Returns a
 * disposer that drops them all, so the plugin unloads cleanly.
 * @param {object} hostCtx - context exposing `webServer`
 * @param {{list: () => Promise<{experts: object[], warnings: string[]}>}} deps.registry
 * @param {{
 *   switch: (agent: object, expertId: string) => Promise<{kind: string, text: string}>,
 *   clear: (agent: object) => Promise<{kind: string, text: string}>,
 *   stateOf: (sessionId: string) => {id: string} | undefined,
 *   composeForCreation: (agent: object, expertId: string) => Promise<{kind: string, text: string}>,
 * }} deps.switcher
 * @param {(sessionId: string) => object | undefined | Promise<object | undefined>} [deps.resolveAgent]
 *   resolves a live Agent by session id (defensive seam — see the header)
 */
export function mountSelectorRoutes(hostCtx, { registry, switcher, resolveAgent }) {
  const disposers = []
  const register = (route) => {
    const off = hostCtx.webServer.register(route)
    if (typeof off === 'function') disposers.push(off)
  }

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/api/experts`,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      try {
        const result = await registry.list()
        const sessionId = sessionIdParamOf(request)
        const state = sessionId === null ? undefined : switcher.stateOf(sessionId)
        sendJson(response, 200, {
          experts: result.experts ?? [],
          warnings: result.warnings ?? [],
          ...(sessionId !== null ? { sessionId, currentExpertId: state?.id ?? null } : {}),
        })
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  // The installed expert's avatar.png: the registry card's dir is internal
  // scan output (never request input), and the card only carries avatarUrl
  // when the scan saw the file — the route just streams those bytes. Every
  // miss (unknown id, avatar-less expert, vanished file) answers ONE
  // uniform 404, mirroring the importer's source-side avatar route.
  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/api/expert-avatar`,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      const notFound = () => sendJson(response, 404, { error: 'not found' })
      try {
        const id = new URL(request.url ?? '/', 'http://internal.invalid').searchParams.get('id')
        const card = id === null ? undefined
          : (await registry.list()).experts.find((expert) => expert.id === id)
        if (card === undefined || card.avatarUrl === undefined) {
          notFound()
          return
        }
        const bytes = await readFile(join(card.dir, 'avatar.png'))
        response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=60' })
        response.end(bytes)
      } catch {
        notFound()
      }
    },
  })

  /** Shared body of the two mutating routes (only the switcher call differs). */
  const mutating = (name, run) => {
    register({
      kind: 'exact',
      path: `${ROUTE_BASE}/api/${name}`,
      handler: async (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'method not allowed' })
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'same-origin required' })
          return
        }
        try {
          const { sessionId, expertId } = requireSessionAndExpert(await readJsonBody(request))
          if (typeof resolveAgent !== 'function') {
            sendJson(response, 200, {
              kind: 'error',
              text: `experts: no agent resolver is wired on this host — /api/${name} cannot reach the session.`,
            })
            return
          }
          const agent = await resolveAgent(sessionId)
          if (agent === undefined || agent === null) {
            sendJson(response, 200, {
              kind: 'error',
              text: `experts: session ${sessionId} has no live agent on this host (cold sessions are not switchable; Remote cold-session query stays deferred, see DEVIATIONS).`,
            })
            return
          }
          sendJson(response, 200, await run(agent, expertId))
        } catch (error) {
          sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
  }

  mutating('switch', (agent, expertId) => switcher.switch(agent, expertId))
  mutating('after-create', (agent, expertId) => switcher.composeForCreation(agent, expertId))

  // POST /api/clear {sessionId}: the remove-expert transport — same guards
  // as the other mutating routes, but the body carries no expertId.
  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/api/clear`,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      if (!sameOrigin(request)) {
        sendJson(response, 403, { error: 'same-origin required' })
        return
      }
      try {
        const sessionId = requireSession(await readJsonBody(request))
        if (typeof resolveAgent !== 'function') {
          sendJson(response, 200, {
            kind: 'error',
            text: 'experts: no agent resolver is wired on this host — /api/clear cannot reach the session.',
          })
          return
        }
        const agent = await resolveAgent(sessionId)
        if (agent === undefined || agent === null) {
          sendJson(response, 200, {
            kind: 'error',
            text: `experts: session ${sessionId} has no live agent on this host (cold sessions are not switchable; Remote cold-session query stays deferred, see DEVIATIONS).`,
          })
          return
        }
        sendJson(response, 200, await switcher.clear(agent))
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  return () => {
    for (const off of disposers) off()
  }
}
