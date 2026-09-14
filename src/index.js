/**
 * dsh-workbuddy-expert host entry (ticket 02): wires the discovery roots
 * (project `<cwd>/.agents/experts`, user `<dshHome>/experts`, optional
 * config extras with a required `trust: user`), the cached registry, the
 * zero-dependency root watcher, the `ctx.experts` service, and the `/expert`
 * listing command. Every side effect is registered through `ctx.effect` and
 * therefore reversible on plugin unload.
 *
 * No `Config` export on purpose (the sister plugin's lesson): cordis
 * resolveConfig() expects a schemastery schema, so a plain object here would
 * crash the loader. The plugin's options stay a plain object consumed
 * defensively inside apply().
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { registerExpertCommand } from './command.js'
import { buildDiscoveryRoots, createRegistry } from './registry.js'
import { watchRoots } from './watch.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-workbuddy-expert'

/** Expand `~`/`~/` prefixes against the OS home; anything else passes through. */
function expandHomePath(value) {
  if (typeof value !== 'string') return value
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/**
 * Resolve the harness home: explicit config > `$DSH_HOME` (when non-blank) >
 * `~/.dsh` — the same precedence the harness itself uses, inlined here so the
 * plugin stays zero-dependency.
 */
function resolveDshHome(configured, env = process.env) {
  const fromEnv = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '' ? env.DSH_HOME : undefined
  return resolve(expandHomePath(configured ?? fromEnv ?? join(homedir(), '.dsh')))
}

/**
 * Register the expert registry against the host context.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context
 * @param {{dshHome?: string, roots?: Array<{path: string, trust?: string}>}} [config]
 */
export function apply(ctx, config = {}) {
  const warn = (message) => ctx.logger?.warn?.(`dsh-workbuddy-expert: ${message}`)
  const dshHome = resolveDshHome(config.dshHome)
  const projectRoot = process.cwd()
  const roots = buildDiscoveryRoots({
    projectRoot,
    dshHome,
    extraRoots: config.roots,
    onWarning: warn,
  })

  const registry = createRegistry({ roots })

  // Watcher: root add/remove reflects without restart (invalidates the cache;
  // list()'s TTL bounds staleness if an event is ever missed).
  ctx.effect(
    () => watchRoots(roots.map((root) => root.path), () => registry.invalidate(), { logger: ctx.logger }),
    'dsh-workbuddy-expert:watch',
  )

  // Service: ctx.experts.list() — cards including broken rows with reasons.
  ctx.effect(() => {
    if (ctx.reflect === undefined || typeof ctx.reflect.provide !== 'function') {
      warn('ctx.reflect.provide is unavailable — the ctx.experts service was not published')
      return () => {}
    }
    return ctx.reflect.provide('experts', { list: () => registry.list() })
  }, 'dsh-workbuddy-expert:service')

  // Command: `/expert` (no argument) lists experts; isolated seam for the
  // later contract-verification ticket.
  ctx.effect(
    () => registerExpertCommand(ctx, registry, roots.map((root) => root.path)),
    'dsh-workbuddy-expert:command',
  )
}
