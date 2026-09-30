/**
 * Offline contract verification against the REAL host packages extracted
 * from the running DSH 0.2.0-rc.2 app (app.asar): schemastery@3.18.4,
 * cordis@4.0.4 (resolveConfig), cosmokit@1.8.5 (volatile refs).
 *
 * Run: node scripts/verify-host-contract.mjs [path-to-extracted-host-libs]
 * The default path points at the extraction created during the 0.2
 * migration (/tmp/dsh-refs/dsh/node_modules). Every check asserts the
 * exact chain the live loader exercises:
 *
 *   Config schema → resolveConfig → volatile ref → loader _commitVolatile
 *   (volatileEntries + updateVolatile) → the plugin's readSourcePath.
 */

import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const hostRoot = process.argv[2] ?? '/tmp/dsh-refs/dsh/node_modules'
const schemasteryPath = `${hostRoot}/@deepseek-ai/schemastery/lib/index.cjs`
const cosmokitSpecifier = `${hostRoot}/@deepseek-ai/cosmokit/lib/index.js`
const cordisSpecifier = `${hostRoot}/@deepseek-ai/cordis/lib/index.js`

const z = (await import(pathToFileURL(schemasteryPath).href)).default
const cosmokit = await import(pathToFileURL(cosmokitSpecifier).href)
const cordis = await import(pathToFileURL(cordisSpecifier).href)

// Same resolution tiers the plugin uses at load time.
const { readSourcePath } = await import(new URL('../src/importer/settings.js', import.meta.url).pathname)
const { DEFAULT_SOURCE_PATH } = await import(new URL('../src/importer/scanner.js', import.meta.url).pathname)

// ── 1. the Config schema builds on the real schemastery ─────────────────────

const Config = z.object({
  sourcePath: z.string().default(DEFAULT_SOURCE_PATH).volatile(),
  dshHome: z.string(),
  roots: z.array(z.object({ path: z.string(), trust: z.string() })),
})

assert.equal(Config['~standard'].vendor, 'schemastery', 'the schema is a schemastery ~standard schema')
assert.equal(typeof Config.toJSON, 'function', 'the schema exposes toJSON (dsh-settings schema() gate)')

// ── 2. resolveConfig: defaults, refs, plain fields, unknown-field merge ─────

const runtime = { Config, apply() {}, name: 'verify' }
const resolved = cordis.resolveConfig(runtime, {})

assert.equal(typeof resolved.sourcePath?.get, 'function', 'sourcePath resolves to a volatile ref')
assert.equal(resolved.sourcePath.get(), DEFAULT_SOURCE_PATH, 'the ref snapshots the schema default')
assert.equal(resolved.dshHome, undefined, 'an unset ordinary field stays unset')
assert.deepEqual(resolved.roots, [], 'an unset array resolves to the schema default (empty array)')

const configured = cordis.resolveConfig(runtime, {
  sourcePath: '~/.workbuddy/plugins/marketplaces/experts/plugins',
  dshHome: '/custom/dsh',
  roots: [{ path: '~/company-experts', trust: 'user' }],
})
assert.equal(configured.sourcePath.get(), '~/.workbuddy/plugins/marketplaces/experts/plugins', 'a configured path rides the ref')
assert.equal(configured.dshHome, '/custom/dsh', 'ordinary fields stay plain values')
assert.deepEqual(configured.roots, [{ path: '~/company-experts', trust: 'user' }], 'nested ordinary arrays resolve intact')

const withUnknown = cordis.resolveConfig(runtime, { sourcePath: '/x', futureField: { a: 1 } })
assert.deepEqual(withUnknown.futureField, { a: 1 }, 'unknown fields survive resolution (merge semantics) — roots/dshHome stay usable without schema entries')

// A wrong-typed sourcePath must fail validation loudly (the loader refuses
// the config instead of silently coercing).
assert.throws(() => cordis.resolveConfig(runtime, { sourcePath: 42 }), /expected/i,
  'a non-string sourcePath fails validation')

// ── 3. the loader's volatile commit path over the real cosmokit refs ────────

const refs = cosmokit.volatileEntries(configured)
assert.equal(refs.length, 1, 'exactly one volatile ref exists (sourcePath)')
assert.deepEqual(refs[0].path, ['sourcePath'], 'the ref sits at the fixed object path ["sourcePath"]')

const candidate = cordis.resolveConfig(runtime, { sourcePath: '/new/root/from/settings' })
cosmokit.updateVolatile(refs[0].ref, candidate.sourcePath)
assert.equal(configured.sourcePath.get(), '/new/root/from/settings', 'updateVolatile commits into the RUNNING reference')

assert.equal(readSourcePath(configured), '/new/root/from/settings', 'the plugin read helper follows the committed value')
assert.equal(readSourcePath(resolved), DEFAULT_SOURCE_PATH, 'and still reads the default ref shape')

// plain-object tolerance (no schema resolved / test doubles)
assert.equal(readSourcePath({ sourcePath: '/plain' }), '/plain', 'plain-string configs read unchanged')

// ── 4. deepEqual identity semantics the loader's change guard relies on ────

const snapA = configured.sourcePath.get()
cosmokit.updateVolatile(refs[0].ref, candidate.sourcePath) // commit the SAME snapshot again
assert.equal(configured.sourcePath.get(), snapA, 're-committing an equal snapshot is idempotent')

console.log('verify-host-contract: all checks passed (real schemastery/cordis/cosmokit)')
