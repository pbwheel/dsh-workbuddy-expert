/**
 * Tiny helpers local to the importer segment (design §7) — the shared
 * text-cleaning helpers live in src/sanitize.js (ticket 02) and are the
 * ONE cleaning implementation this repo keeps (the wb-market scanner
 * carried a byte-identical copy; porting unified on the repo module).
 */

/** Render any thrown value as a one-line message for JSON error payloads. */
export function errorMessage(error) {
  return String(error?.message ?? error)
}

/**
 * Runtime resolution of @deepseek-ai/schemastery for the settings schema.
 *
 * Ported from wb-market src/schemastery.js: this plugin may be `link:`
 * installed, and a linked package resolves bare specifiers from its own
 * real path, which cannot see `@deepseek-ai/*`. Layered tiers:
 *
 *   1. plain dynamic import (published installs, hoisted layouts);
 *   2. the harness-maintained flat fallback `$DSH_HOME/profiles/node_modules`;
 *   3. the running dsh installation itself (process.argv[1] anchor).
 *
 * Every tier failing is a hard, loud error: the settings namespace is a
 * hard dependency of the importer and must never silently degrade.
 */

import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SCHEMAMASTERY_SPECIFIER = '@deepseek-ai/schemastery'

/** Import the package through a resolved file path (CJS default interop). */
async function importFromPath(path) {
  return (await import(pathToFileURL(path).href)).default
}

/** Candidate anchor files for `createRequire`, in tier order. */
function anchorFiles() {
  const anchors = []
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') {
    anchors.push(join(process.env.DSH_HOME, 'profiles', 'package.json'))
  }
  anchors.push(join(homedir(), '.dsh', 'profiles', 'package.json'))
  if (typeof process.argv[1] === 'string' && process.argv[1] !== '') {
    anchors.push(process.argv[1])
  }
  return anchors
}

/**
 * Resolve the schemastery factory the settings schema is built with.
 * @returns {Promise<import('@deepseek-ai/schemastery')>} the `z` factory
 * @throws when no tier can provide the package (with tier diagnostics)
 */
export async function resolveSchemastery() {
  const attempts = []
  try {
    const z = (await import(SCHEMAMASTERY_SPECIFIER)).default
    if (z !== null && typeof z.object === 'function') return z
    attempts.push(`plain import resolved without a usable default (${typeof z})`)
  } catch (error) {
    attempts.push(`plain import: ${errorMessage(error)}`)
  }
  for (const anchor of anchorFiles()) {
    try {
      const require = createRequire(anchor)
      const resolved = require.resolve(SCHEMAMASTERY_SPECIFIER)
      const z = await importFromPath(resolved)
      if (z !== null && typeof z.object === 'function') return z
      attempts.push(`${anchor}: resolved without a usable default (${typeof z})`)
    } catch (error) {
      attempts.push(`${anchor}: ${errorMessage(error)}`)
    }
  }
  throw new Error(
    'dsh-workbuddy-expert: cannot resolve @deepseek-ai/schemastery, which the '
      + 'settings namespace schema requires; this plugin must run inside a dsh host. '
      + `Tried: ${attempts.join('; ')}`,
  )
}
