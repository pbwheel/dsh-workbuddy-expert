/**
 * Offline smoke checks for the install/update/uninstall export engine
 * (ticket 07) — no browser, no live profile: `node scripts/smoke-install.mjs`.
 *
 *   1. install = export: all four artifacts (expert.yml fields + NO
 *      trust_scripts, role.md = sanitized persona verbatim, skills/
 *      subtree wholesale incl. a SKILL.md-less data dir + an empty dir +
 *      an executable script, .expert-source.json fields) and owner-only
 *      permissions everywhere (dirs 0o700, files 0o600, owner-execute
 *      kept on the script);
 *   2. watcher-style verification: the repo registry rescans the export
 *      root and sees a VALID card (never broken, sanitized role text);
 *   3. update after fixture mutation (persona edit + skill add + skill
 *      delete) → updatable flag first, folder synced (role rewritten,
 *      add/delete landed), manifest refreshed; idempotent second update
 *      (changed:false) and no false warnings anywhere;
 *   4. degraded-path fingerprint: hand-editing the EXPORTED artifact
 *      (role.md + skill deletion inside the export folder) never sticks
 *      `updatable` — the fingerprint hashes scan-card + SOURCE stats;
 *   5. same-id folder without a manifest (hand-written expert) → install
 *      error, never overwritten; uninstall refuses it;
 *   6. corrupt manifest → broken listing with「清单缺失，请卸载重装」,
 *      install/update answer the same error, uninstall still recovers;
 *   7. source orphan → listed in state.orphans, folder never auto-deleted;
 *   8. routes: unknown id 404, install/update/uninstall round-trips,
 *      /api/state installed overlay (installed/updatable/broken/orphans
 *      + per-card flags), and single-flight 409 between concurrent
 *      engine calls.
 */

import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

const { createCatalog } = await import(join(root, 'src', 'importer', 'catalog.js'))
const { createExporter, BROKEN_MANIFEST_REASON, MANIFEST_NAME, EXPORT_ORDER } = await import(join(root, 'src', 'importer', 'export.js'))
const { scanWorkbuddyRoot } = await import(join(root, 'src', 'importer', 'scanner.js'))
const { SETTINGS_NS, mountImporterSettings, namespaceDescriptor } = await import(join(root, 'src', 'importer', 'settings.js'))
const { mountImporterRoutes } = await import(join(root, 'src', 'importer', 'routes.js'))
const { scanDiscoveryRoots } = await import(join(root, 'src', 'registry.js'))

// ── shared fakes (same contracts smoke-importer established) ────────────────

function makeFakeZ() {
  return {
    string: () => ({ type: 'string' }),
    object(dict) {
      const schema = (value) => {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('expected an object')
        const resolved = {}
        for (const [key, child] of Object.entries(dict)) {
          if (value[key] !== undefined) resolved[key] = value[key]
        }
        return resolved
      }
      schema.toJSON = () => ({ type: 'object', dict })
      return schema
    },
  }
}

function makeFakeSettings() {
  const registrations = new Map()
  return {
    register(ns, schema, options) {
      const reg = { ns, schema, base: options?.base, user: undefined, revision: 0, resolved: schema({ ...(options?.base ?? {}) }) }
      registrations.set(ns, reg)
      return {
        get: () => reg.resolved,
        watch: () => () => {},
        update: (patch) => this.update(ns, patch),
      }
    },
    describe: () => [...registrations.values()].map((reg) => ({ ns: reg.ns, value: reg.resolved, revision: reg.revision })),
    async update(ns, patch) {
      const reg = registrations.get(ns)
      reg.resolved = reg.schema({ ...(reg.base ?? {}), ...(reg.user ?? {}), ...patch })
      reg.user = { ...(reg.user ?? {}), ...patch }
      reg.revision += 1
    },
  }
}

function makeFakeServer() {
  const routes = new Map()
  return {
    routes,
    register(route) {
      routes.set(`${route.kind} ${route.path}`, route)
      return () => routes.delete(`${route.kind} ${route.path}`)
    },
  }
}

function makeResponse() {
  const res = { status: null, headers: null, chunks: [], ended: false }
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
  res.end = (chunk) => { if (chunk !== undefined && chunk !== null) res.chunks.push(chunk); res.ended = true }
  Object.defineProperty(res, 'body', { get: () => res.chunks.map((chunk) => (typeof chunk === 'string' ? chunk : '')).join('') })
  return res
}

function makeRequest({ method = 'GET', url = '/', headers = {}, chunks }) {
  const request = { method, url, headers }
  if (chunks !== undefined) {
    request[Symbol.asyncIterator] = async function* () { for (const chunk of chunks) yield chunk }
  }
  return request
}

const sameOriginHeaders = { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' }
const post = (path, body) => makeRequest({ method: 'POST', url: path, headers: sameOriginHeaders, chunks: [JSON.stringify(body)] })

/** Push one file's mtime deterministically ahead (same-ms writes must not mask a change). */
function bumpMtime(path) {
  const at = new Date(Date.now() + 5000)
  utimesSync(path, at, at)
}

// ── fixture: one source plugin with a persona, rules, and a skills tree ─────

const sourceRoot = mkdtempSync(join(tmpdir(), 'dsh-wbe-install-src-'))
const expertsRoot = mkdtempSync(join(tmpdir(), 'dsh-wbe-install-experts-'))

function srcWrite(relative, content, options) {
  const path = join(sourceRoot, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, options)
  return path
}

srcWrite('plug-a/agents/export-card.md', [
  '---',
  'name: export-card',
  'description: Use when testing the export engine.',
  'displayName:',
  '  en: "Export Card"',
  '  zh: "导出卡"',
  '---',
  '',
  '# 导出专家（导出引擎）',
  '',
  '正文：注册变量 {{model}} 保留，未注册组拆括号 {{ not-registered }}。',
].join('\n'))
srcWrite('plug-a/rules/quality.md', '---\ndescription: rule\n---\n\n规则正文一段。规则里的 {{ item.name }} 同样被清洗。')
srcWrite('plug-a/skills/main-skill/SKILL.md', 'SKILL: main\n')
const script = srcWrite('plug-a/skills/main-skill/scripts/run.sh', '#!/bin/sh\necho run\n')
chmodSync(script, 0o755)
srcWrite('plug-a/skills/references/data.md', 'reference data with no SKILL.md\n')
mkdirSync(join(sourceRoot, 'plug-a', 'skills', 'empty-skill'), { recursive: true })
srcWrite('plug-a/.codebuddy-plugin/plugin.json', JSON.stringify({
  name: 'plug-a',
  profession: { en: 'Export Expert', zh: '导出专家' },
  displayDescription: { zh: '导出引擎的中文描述。' },
}))
// A second plugin, later the orphan scenario needs a card that disappears.
srcWrite('plug-b/agents/vanish-card.md', '---\nname: vanish-card\ndescription: Later removed.\n---\n\n正文。\n')
srcWrite('plug-b/.codebuddy-plugin/plugin.json', JSON.stringify({ name: 'plug-b' }))

// ── engine mount (direct, plus the catalog/settings shared with routes) ──────

let importedClock = 0
const catalog = createCatalog()
const settings = makeFakeSettings()
mountImporterSettings(settings, makeFakeZ(), catalog)
await settings.update(SETTINGS_NS, { sourcePath: sourceRoot })
const rawSourcePathOf = () => namespaceDescriptor(settings).value.sourcePath

const exporter = createExporter({
  expertsRoot,
  catalog,
  getRawSourcePath: rawSourcePathOf,
  now: () => `2026-09-0${++importedClock}T00:00:00.000Z`,
})

const scanCard = async (id) => (await catalog.stateOf(rawSourcePathOf())).experts.find((expert) => expert.id === id)
const overlay = () => exporter.overlay()
const mode = (path) => statSync(path).mode & 0o777

// ── 1. install = export ──────────────────────────────────────────────────────

{
  const result = await exporter.install('export-card')
  assert.equal(result.changed, true)
  assert.equal(result.reinstalled, false, 'fresh install is not a reinstall')
  const dir = join(expertsRoot, 'export-card')
  assert.equal(result.dir, dir)
  assert.equal(mode(dir), 0o700, 'expert folder is owner-only')

  // expert.yml: exact fields, no trust_scripts (user rank is trusted by rank).
  const ymlText = readFileSync(join(dir, 'expert.yml'), 'utf8')
  assert.equal(mode(join(dir, 'expert.yml')), 0o600)
  assert.match(ymlText, /^id: "export-card"$/m)
  assert.match(ymlText, /^display_name: "导出专家"$/m, 'display_name ← card zhName')
  assert.match(ymlText, /^description: "导出引擎的中文描述。"$/m, 'description ← zhDescription || description')
  assert.match(ymlText, new RegExp(`^order: ${EXPORT_ORDER}$`, 'm'))
  assert.doesNotMatch(ymlText, /trust_scripts/, 'no trust_scripts declaration (rank-trusted)')

  // role.md: the scanner-sanitized persona, verbatim.
  const card = await scanCard('export-card')
  const role = readFileSync(join(dir, 'role.md'), 'utf8')
  assert.equal(mode(join(dir, 'role.md')), 0o600)
  assert.equal(role, `${card.persona}\n`)
  assert.ok(role.includes('{{model}}'), 'registered template groups survive verbatim')
  assert.ok(role.includes('{ { not-registered }}'), 'unregistered groups are split')
  assert.ok(role.includes('# 附加规则：rules/quality.md'), 'rules are part of the persona')
  assert.ok(!role.includes('\r'))

  // skills/: wholesale subtree — SKILL.md dir, data dir without SKILL.md,
  // empty dir, executable script with its owner-execute bit kept.
  assert.deepEqual(
    readFileSync(join(dir, 'skills', 'main-skill', 'SKILL.md'), 'utf8'),
    readFileSync(join(sourceRoot, 'plug-a', 'skills', 'main-skill', 'SKILL.md'), 'utf8'),
    'SKILL.md copies verbatim',
  )
  assert.equal(mode(join(dir, 'skills', 'main-skill')), 0o700, 'skill directories are owner-only')
  assert.equal(mode(join(dir, 'skills', 'main-skill', 'SKILL.md')), 0o600, 'plain files are 0o600')
  assert.equal(mode(join(dir, 'skills', 'main-skill', 'scripts', 'run.sh')), 0o700,
    'the source owner-execute bit is preserved on copy')
  assert.ok(existsSync(join(dir, 'skills', 'references', 'data.md')), 'a skill dir without SKILL.md is still copied')
  assert.ok(existsSync(join(dir, 'skills', 'empty-skill')), 'an empty skill directory is still copied')
  assert.equal(mode(join(dir, 'skills', 'references', 'data.md')), 0o600)

  // .expert-source.json: the fingerprint manifest.
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8'))
  assert.equal(mode(join(dir, MANIFEST_NAME)), 0o600)
  assert.equal(manifest.sourcePath, sourceRoot, 'manifest records the RAW source path')
  assert.equal(manifest.pluginDir, 'plug-a')
  assert.equal(manifest.agentFile, 'export-card.md')
  assert.equal(manifest.fingerprint, result.fingerprint)
  assert.match(manifest.importedAt, /^\d{4}-\d{2}-\d{2}T/, 'importedAt is an ISO timestamp')

  // Idempotent reinstall over a valid manifest re-exports in place.
  const again = await exporter.install('export-card')
  assert.equal(again.reinstalled, true, 'install over a valid manifest re-exports in place')
  assert.ok(existsSync(join(dir, 'expert.yml')))
}

// ── 2. watcher-style: the registry sees the new folder as a valid card ──────

{
  const { experts, warnings } = await scanDiscoveryRoots([
    { path: expertsRoot, rank: 200, label: 'user', trust: 'user' },
  ])
  const card = experts.find((expert) => expert.id === 'export-card')
  assert.ok(card !== undefined, 'the exported folder appears in a registry rescan immediately')
  assert.equal(card.broken, undefined, 'the exported folder is never listed broken')
  assert.equal(card.displayName, '导出专家')
  assert.equal(card.root, 'user')
  assert.deepEqual(card.skills.map((skill) => skill.name), ['empty-skill', 'main-skill', 'references'])
  assert.equal(card.trustScripts, false, 'trust_scripts is not declared')
  assert.ok(card.roleText.includes('{{model}}'))
  assert.deepEqual(warnings, [], 'the rescan over the export root carries no warnings')
}

// ── 3. update after source mutation ─────────────────────────────────────────

{
  // Mutate the source: persona edit + skill add + skill delete.
  srcWrite('plug-a/agents/export-card.md', [
    '---',
    'name: export-card',
    'description: Use when testing the export engine, v2.',
    'displayName:',
    '  en: "Export Card"',
    '  zh: "导出卡"',
    '---',
    '',
    '# 导出专家 v2',
    '',
    '新正文第二版：{{provider}} 保留。',
  ].join('\n'))
  bumpMtime(join(sourceRoot, 'plug-a', 'agents', 'export-card.md'))
  srcWrite('plug-a/skills/fresh-skill/SKILL.md', 'SKILL: fresh\n')
  rmSync(join(sourceRoot, 'plug-a', 'skills', 'references'), { recursive: true })

  // updatable first (state overlay sees the moved fingerprint)…
  let state = await overlay()
  let entry = state.installed.find((item) => item.id === 'export-card')
  assert.equal(entry.updatable, true, 'a persona+skills mutation marks the export updatable')

  // …then update = in-place re-export with add/delete sync.
  const before = await exporter.update('export-card')
  assert.equal(before.changed, true)
  const dir = join(expertsRoot, 'export-card')
  assert.ok(readFileSync(join(dir, 'role.md'), 'utf8').includes('导出专家 v2'), 'role.md is rewritten')
  assert.ok(existsSync(join(dir, 'skills', 'fresh-skill', 'SKILL.md')), 'the added skill lands')
  assert.ok(!existsSync(join(dir, 'skills', 'references')), 'the deleted skill is removed from the export')
  assert.ok(existsSync(join(dir, 'skills', 'main-skill', 'scripts', 'run.sh')), 'untouched skills survive the sync')

  // Idempotent: nothing moved → changed:false, and the overlay settles.
  const again = await exporter.update('export-card')
  assert.equal(again.changed, false, 'an unchanged source updates nothing')
  state = await overlay()
  entry = state.installed.find((item) => item.id === 'export-card')
  assert.equal(entry.updatable, false, 'after the update the fingerprint matches again — no false badge')

  // The registry rescan stays clean after the update (no broken/未挂载-style surprises).
  const rescan = await scanDiscoveryRoots([{ path: expertsRoot, rank: 200, label: 'user', trust: 'user' }])
  assert.equal(rescan.experts.find((expert) => expert.id === 'export-card').broken, undefined)
  assert.deepEqual(rescan.warnings, [])
}

// ── 4. degraded-path fingerprint: hash the scan card, not the artifact ──────

{
  // Hand-edit the EXPORTED folder while the source is untouched.
  writeFileSync(join(expertsRoot, 'export-card', 'role.md'), 'hand-edited role\n')
  rmSync(join(expertsRoot, 'export-card', 'skills', 'main-skill'), { recursive: true })
  const state = await overlay()
  const entry = state.installed.find((item) => item.id === 'export-card')
  assert.equal(entry.updatable, false,
    'a degraded on-disk export never sticks updatable — the fingerprint hashes scan-card + SOURCE stats')
  // Repair via reinstall: install over the still-valid manifest re-exports.
  await exporter.install('export-card')
  assert.ok(existsSync(join(expertsRoot, 'export-card', 'skills', 'main-skill', 'SKILL.md')),
    'a reinstall repairs the degraded export from source')
}

// ── 5. same-id folder without a manifest (hand-written expert) ──────────────

{
  const dir = join(expertsRoot, 'vanish-card')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'expert.yml'), 'id: vanish-card\ndisplay_name: 手写专家\ndescription: hand written\norder: 100\n')
  writeFileSync(join(dir, 'role.md'), '手写正文。\n')

  await assert.rejects(() => exporter.install('vanish-card'), (error) => {
    assert.equal(error.code, 'FOLDER_EXISTS')
    assert.ok(error.message.includes('never overwrites'))
    return true
  }, 'install onto a hand-written folder refuses with an explicit error')
  assert.equal(readFileSync(join(dir, 'role.md'), 'utf8'), '手写正文。\n', 'the hand-written folder is untouched')

  await assert.rejects(() => exporter.update('vanish-card'), (error) => error.code === 'FOLDER_EXISTS',
    'update onto a hand-written folder refuses the same way')
  await assert.rejects(() => exporter.uninstall('vanish-card'), (error) => error.code === 'NOT_EXPORTED',
    'uninstall refuses folders this importer did not export')
  assert.ok(existsSync(dir), 'the refused uninstall deletes nothing')

  rmSync(dir, { recursive: true })
}

// ── 6. corrupt manifest → broken, same error on install/update ──────────────

{
  // Install the second card first, then corrupt its manifest.
  await exporter.install('vanish-card')
  writeFileSync(join(expertsRoot, 'vanish-card', MANIFEST_NAME), '{ not json')

  let state = await overlay()
  assert.deepEqual(
    state.broken.map((item) => item.id),
    ['vanish-card'],
    'a corrupt manifest is listed broken',
  )
  assert.equal(state.broken[0].reason, BROKEN_MANIFEST_REASON, 'the broken reason is「清单缺失，请卸载重装」')

  for (const operation of ['install', 'update']) {
    await assert.rejects(() => exporter[operation]('vanish-card'), (error) => {
      assert.equal(error.code, 'MANIFEST_BROKEN')
      assert.ok(error.message.includes(BROKEN_MANIFEST_REASON), `${operation} answers the same broken text`)
      return true
    })
  }
  assert.ok(existsSync(join(expertsRoot, 'vanish-card')), 'the failed operations leave the folder in place')

  // Uninstall is the recovery path and must still work on a corrupt manifest.
  await exporter.uninstall('vanish-card')
  assert.ok(!existsSync(join(expertsRoot, 'vanish-card')), 'uninstall deletes the broken export')
}

// ── 7. source orphan ─────────────────────────────────────────────────────────

{
  await exporter.install('vanish-card')
  // The card leaves the scan table: remove the whole plugin from the source.
  rmSync(join(sourceRoot, 'plug-b'), { recursive: true })
  const state = await overlay()
  assert.ok(state.installed.every((item) => item.id !== 'vanish-card'), 'the orphan leaves the installed list')
  const orphan = state.orphans.find((item) => item.id === 'vanish-card')
  assert.ok(orphan !== undefined, 'the orphan is listed')
  assert.equal(orphan.sourcePath, sourceRoot)
  assert.equal(orphan.pluginDir, 'plug-b')
  assert.ok(existsSync(join(expertsRoot, 'vanish-card')), 'orphans are never auto-deleted')

  // And its update is refused (card gone from the scan table).
  await assert.rejects(() => exporter.update('vanish-card'), (error) => error.code === 'CARD_NOT_FOUND')
  await exporter.uninstall('vanish-card')
}

// ── 8. routes: overlay in /api/state, error mapping, single-flight 409 ──────

{
  const server = makeFakeServer()
  const routeSettings = makeFakeSettings()
  const routeCatalog = createCatalog()
  mountImporterSettings(routeSettings, makeFakeZ(), routeCatalog)
  await routeSettings.update(SETTINGS_NS, { sourcePath: sourceRoot })
  const routeExporter = createExporter({
    expertsRoot,
    catalog: routeCatalog,
    getRawSourcePath: () => namespaceDescriptor(routeSettings).value.sourcePath,
  })
  const off = mountImporterRoutes(
    { webServer: server, settings: routeSettings },
    { catalog: routeCatalog, exporter: routeExporter },
  )
  assert.deepEqual([...server.routes.keys()].sort(), [
    'exact /dsh-workbuddy-expert/api/avatar',
    'exact /dsh-workbuddy-expert/api/config',
    'exact /dsh-workbuddy-expert/api/install',
    'exact /dsh-workbuddy-expert/api/refresh',
    'exact /dsh-workbuddy-expert/api/state',
    'exact /dsh-workbuddy-expert/api/uninstall',
    'exact /dsh-workbuddy-expert/api/update',
  ].sort(), 'the engine adds exactly the three POST routes')

  const stateRoute = server.routes.get('exact /dsh-workbuddy-expert/api/state')
  const installRoute = server.routes.get('exact /dsh-workbuddy-expert/api/install')
  const updateRoute = server.routes.get('exact /dsh-workbuddy-expert/api/update')
  const uninstallRoute = server.routes.get('exact /dsh-workbuddy-expert/api/uninstall')

  // /api/state carries the overlay + per-card flags.
  {
    const res = makeResponse()
    await stateRoute.handler(makeRequest({ url: '/dsh-workbuddy-expert/api/state' }), res)
    assert.equal(res.status, 200)
    const state = JSON.parse(res.body)
    const card = state.experts.find((expert) => expert.id === 'export-card')
    assert.equal(card.installed, true)
    assert.equal(card.updatable, false)
    assert.ok(Array.isArray(state.installed) && state.installed.some((item) => item.id === 'export-card'))
    assert.deepEqual(state.broken, [])
    assert.deepEqual(state.orphans, [])
  }

  // Error mapping: unknown id 404; guards: GET 405, cross-origin 403.
  {
    let res = makeResponse()
    await installRoute.handler(post('/dsh-workbuddy-expert/api/install', { id: 'never-scanned' }), res)
    assert.equal(res.status, 404)
    assert.equal(JSON.parse(res.body).code, 'CARD_NOT_FOUND')

    res = makeResponse()
    await installRoute.handler(makeRequest({ method: 'GET', url: '/dsh-workbuddy-expert/api/install' }), res)
    assert.equal(res.status, 405)

    res = makeResponse()
    await uninstallRoute.handler(makeRequest({
      method: 'POST', url: '/dsh-workbuddy-expert/api/uninstall',
      headers: { origin: 'http://evil.example', host: '127.0.0.1:3080' },
      chunks: ['{"id":"export-card"}'],
    }), res)
    assert.equal(res.status, 403)

    res = makeResponse()
    await updateRoute.handler(post('/dsh-workbuddy-expert/api/update', { id: 'export-card' }), res)
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(res.body).changed, false, 'an unchanged source updates nothing over HTTP too')
    assert.equal(JSON.parse(res.body).state.experts.find((expert) => expert.id === 'export-card').updatable, false,
      'the install/update answer carries the refreshed state')
  }

  // Full uninstall round-trip over the route.
  {
    const res = makeResponse()
    await uninstallRoute.handler(post('/dsh-workbuddy-expert/api/uninstall', { id: 'export-card' }), res)
    assert.equal(res.status, 200)
    assert.ok(!existsSync(join(expertsRoot, 'export-card')))
    const state = JSON.parse(res.body).state
    assert.ok(state.experts.find((expert) => expert.id === 'export-card').installed === false)
    assert.deepEqual(state.installed, [])
    // Reinstall over the route for the single-flight probe below.
    const back = makeResponse()
    await installRoute.handler(post('/dsh-workbuddy-expert/api/install', { id: 'export-card' }), back)
    assert.equal(back.status, 200)
  }

  // Single-flight: a second engine call while one is mid-scan gets 409.
  {
    let releaseScan
    const gate = new Promise((resolve) => { releaseScan = resolve })
    const gatedCatalog = createCatalog(async (rawPath) => {
      await gate
      return scanWorkbuddyRoot(rawPath)
    })
    const gatedSettings = makeFakeSettings()
    mountImporterSettings(gatedSettings, makeFakeZ(), gatedCatalog)
    await gatedSettings.update(SETTINGS_NS, { sourcePath: sourceRoot })
    const gatedExporter = createExporter({
      expertsRoot,
      catalog: gatedCatalog,
      getRawSourcePath: () => namespaceDescriptor(gatedSettings).value.sourcePath,
    })
    const gatedServer = makeFakeServer()
    mountImporterRoutes({ webServer: gatedServer, settings: gatedSettings }, { catalog: gatedCatalog, exporter: gatedExporter })
    const route = gatedServer.routes.get('exact /dsh-workbuddy-expert/api/install')

    const firstRes = makeResponse()
    const first = route.handler(post('/dsh-workbuddy-expert/api/install', { id: 'export-card' }), firstRes)
    await new Promise((resolve) => setImmediate(resolve)) // first call is inside its scan now
    const res = makeResponse()
    await route.handler(post('/dsh-workbuddy-expert/api/install', { id: 'export-card' }), res)
    assert.equal(res.status, 409, 'a concurrent install/update/uninstall is single-flighted with 409')
    releaseScan()
    await first
    assert.equal(firstRes.status, 200)
  }

  off()
  assert.equal(server.routes.size, 0, 'disposal removes every route the engine added')
}

rmSync(sourceRoot, { recursive: true, force: true })
rmSync(expertsRoot, { recursive: true, force: true })

console.log('smoke-install: all checks passed')
