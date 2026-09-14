/**
 * Offline smoke checks for dsh-workbuddy-expert — no browser, no live
 * profile, zero dependencies: `node scripts/smoke.mjs`.
 *
 *   1. package contract: manifest shape (dsh.bundle.patch, no client yet,
 *      no runtime deps), every exports target exists, patch layer wired;
 *   2. sanitize: registered-variable whitelist (model/cwd/provider as data)
 *      survives verbatim; {{.CurrentDate}}, {{ y: -2 }}, nested-brace and
 *      triple-brace groups are split at the opening braces; BOM + CRLF are
 *      stripped; a lone `{{` without any `}}` stays literal;
 *   3. registry: discovery-root assembly (project 100 / user 200, extra
 *      roots require trust: user), expert.yml mini-parser (quotes, CRLF,
 *      malformed line), folder validation (valid expert, missing expert.yml,
 *      missing role.md, id/folder mismatch, invalid folder name), skills
 *      convention (with/without SKILL.md, sanitized SKILL.md text),
 *      rank-based same-name override (project beats user, loser warned),
 *      broken entries carried with reasons, ordering by (order, id);
 *   4. registry cache: TTL hit avoids rescan, invalidate() forces rescan;
 *   5. watcher (fs.watch + debounce, zero deps): an expert folder renamed
 *      into a watched root appears in list() without restart, removing it
 *      makes it disappear — with a TTL long enough that ONLY the watcher
 *      chain can surface the change; the disposer closes everything;
 *   6. /expert command over a fake commands service: no-argument invocation
 *      lists experts including broken rows with reasons, an argument answers
 *      with an explicit not-yet error, a missing commands service warns and
 *      stays inert;
 *   7. full apply() wiring over a fake cordis context (process.cwd patched
 *      into the fixture): service provided as `experts`, command registered,
 *      list() works end to end, every effect disposer runs.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

// ── 1. package contract ──────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
assert.equal(pkg.name, 'dsh-workbuddy-expert')
assert.equal(pkg.type, 'module', 'zero-build ESM, no runtime deps')
assert.equal(pkg.main, 'src/index.js')
assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'no runtime dependencies')
assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'bundle patch declared')
assert.equal(pkg.dsh?.client, undefined, 'no client half in this phase (P1 adds one)')
for (const [specifier, target] of Object.entries(pkg.exports)) {
  assert.ok(readFileSync(join(root, target), 'utf8') !== undefined, `exports target exists: ${specifier} -> ${target}`)
}
const patchText = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
assert.ok(patchText.includes('- insert:'), 'patch is a top-level insert array')
assert.ok(patchText.includes('id: dsh-workbuddy-expert'), 'patch row id present')
assert.ok(/name: ['"]?dsh-workbuddy-expert/.test(patchText), 'patch row name present')

// ── 2. sanitize ──────────────────────────────────────────────────────────────

const { REGISTERED_PROMPT_VARIABLES, escapeUnregisteredTemplateGroups, normalizeNewlines, sanitizeText } =
  await import(join(root, 'src', 'sanitize.js'))

assert.deepEqual([...REGISTERED_PROMPT_VARIABLES], ['model', 'cwd', 'provider'],
  'the whitelist is data covering exactly the registered prompt variables')

const templateGroupsOf = (text) => [...text.matchAll(/\{\{([^{}]*)\}\}/g)].map((match) => match[1])

{
  const escaped = escapeUnregisteredTemplateGroups(
    'keep {{model}} {{cwd}} {{provider}}; split {{ y: -2 }}, {{.CurrentDate}}, {{bogus}}, {{ {a:1} }}, {{{ ninja }}}',
  )
  assert.deepEqual([...new Set(templateGroupsOf(escaped))].sort(), ['cwd', 'model', 'provider'],
    'only registered variables remain as complete groups')
  assert.ok(escaped.includes('{ { y: -2 }}') && escaped.includes('{ {.CurrentDate}}'),
    'non-registered groups are split at the opening braces')
  assert.ok(!escaped.includes('{{ {'), 'nested-brace groups never survive whole')
  assert.equal(escapeUnregisteredTemplateGroups('a {{ lonely opener'), 'a {{ lonely opener',
    'lone `{{` without any `}}` stays literal')
}

assert.equal(normalizeNewlines('\uFEFFa\r\nb\rc'), 'a\nb\nc', 'BOM stripped, CRLF and lone CR normalized')
{
  const sanitized = sanitizeText('line one\r\nline two\r\nvars {{model}} ok, {{ y: -2 }} split\r\n')
  assert.ok(!sanitized.includes('\r'), 'sanitizeText strips every \\r')
  assert.ok(sanitized.includes('{{model}}') && sanitized.includes('{ { y: -2 }}'),
    'sanitizeText applies both CRLF strip and template escaping')
}

// ── 3. registry ──────────────────────────────────────────────────────────────

const registryModule = await import(join(root, 'src', 'registry.js'))
const { buildDiscoveryRoots, createRegistry, parseExpertYml, scanDiscoveryRoots, scanExpertFolder } = registryModule
const { RANK_PROJECT, RANK_USER } = registryModule

// Mini-parser: quoted scalars, CRLF, comments, malformed line.
{
  const parsed = parseExpertYml('id: "video-editor"\r\ndisplay_name: \'视频\'剪辑\'\r\n# comment\r\norder: 42\r\nnested:\r\n  child: 1\r\n')
  assert.equal(parsed.fields.id, 'video-editor', 'double-quoted scalar parses')
  assert.equal(parsed.fields.display_name, '视频\'剪辑', 'single-quoted scalar unescapes \'\'')
  assert.equal(parsed.fields.order, '42', 'plain scalar parses')
  assert.equal(parsed.malformed, undefined, 'comments and nested mappings are not malformed')
  assert.equal(parseExpertYml('id: ok\ngarbage line\n').malformed !== undefined, true,
    'a non-key line is reported as malformed')
}

// Root assembly: defaults + extra trust enforcement.
{
  const warnings = []
  const roots = buildDiscoveryRoots({
    projectRoot: '/proj',
    dshHome: '/home/.dsh',
    extraRoots: [
      { path: '~/company-experts', trust: 'user' },
      { path: '/untrusted', trust: 'project' },
      { path: 42 },
    ],
    onWarning: (message) => warnings.push(message),
  })
  assert.deepEqual(roots.map((r) => [r.label, r.rank, r.trust]), [
    ['project', RANK_PROJECT, 'project'],
    ['user', RANK_USER, 'user'],
    ['extra', RANK_USER + 1, 'user'],
  ], 'project(100) then user(200) then rank-ordered extras')
  assert.equal(roots[0].path, join('/proj', '.agents', 'experts'))
  assert.equal(roots[1].path, join('/home/.dsh', 'experts'))
  assert.equal(warnings.length, 2, 'untrusted and malformed extras each warn once')
  assert.ok(warnings.some((w) => w.includes('only trust: user')), 'the trust refusal names the rule')
}

// Fixture tree.
const fixture = mkdtempSync(join(tmpdir(), 'dsh-workbuddy-expert-'))
const projectRoot = join(fixture, 'project')
const userRoot = join(fixture, 'user-home', '.dsh', 'experts')
const stagingRoot = join(fixture, 'staging')

/** Write one fixture file, creating parent directories as needed. */
function fixtureWrite(base, relative, content) {
  const path = join(base, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

// Valid expert (user root): full manifest + skills with and without SKILL.md
// + a role.md exercising sanitization over CRLF.
fixtureWrite(userRoot, 'video-editor/expert.yml', [
  'id: video-editor',
  'display_name: 视频剪辑专家',
  'description: 负责短视频剪辑、字幕烧录与导出',
  'order: 50',
].join('\n'))
fixtureWrite(userRoot, 'video-editor/role.md', [
  '你是视频剪辑专家。变量 {{model}} 与 {{cwd}} 已注册，保留。(#1)',
  '未注册组必须拆括号：{{ y: -2 }} 与 {{.CurrentDate}}。(#2)',
].join('\r\n').concat('\r\n'))
fixtureWrite(userRoot, 'video-editor/skills/cut-video/SKILL.md', 'SKILL: cut video — 模板 {{ bogus }} 转义，{{provider}} 保留。\r\n')
mkdirSync(join(userRoot, 'video-editor', 'skills', 'data-only'), { recursive: true })
fixtureWrite(userRoot, 'video-editor/skills/data-only/notes.md', 'not a skill manifest\n')

// Same-name override: 'shared' exists in BOTH roots — project (100) wins.
{
  const projectExperts = join(projectRoot, '.agents', 'experts')
  fixtureWrite(projectExperts, 'shared/expert.yml', 'id: shared\ndisplay_name: 项目同名专家\n')
  fixtureWrite(projectExperts, 'shared/role.md', `project body {{model}}\n`)
  fixtureWrite(userRoot, 'shared/expert.yml', 'id: shared\ndisplay_name: 用户同名专家\n')
  fixtureWrite(userRoot, 'shared/role.md', 'user body\n')
}

// Broken experts (user root): each failure mode, each with a reason.
fixtureWrite(userRoot, 'no-role/expert.yml', 'id: no-role\ndisplay_name: 缺角色\n')
fixtureWrite(userRoot, 'id-mismatch/expert.yml', 'id: other-id\n')
fixtureWrite(userRoot, 'id-mismatch/role.md', 'body\n')
fixtureWrite(userRoot, 'no-manifest/role.md', 'body but no expert.yml\n')
fixtureWrite(userRoot, 'Bad_Folder/expert.yml', 'id: Bad_Folder\n')
fixtureWrite(userRoot, 'Bad_Folder/role.md', 'body\n')

const roots = buildDiscoveryRoots({ projectRoot, dshHome: join(fixture, 'user-home', '.dsh') })
const scan = await scanDiscoveryRoots(roots)
const byId = new Map(scan.experts.map((expert) => [expert.id, expert]))

// Inventory: 1 valid user expert + 1 project override winner + 4 broken rows.
assert.deepEqual(scan.experts.map((expert) => expert.id).sort(),
  ['Bad_Folder', 'id-mismatch', 'no-manifest', 'no-role', 'shared', 'video-editor'],
  'valid AND broken experts are all listed, never silently hidden')

// Valid card shape.
{
  const card = byId.get('video-editor')
  assert.equal(card.broken, undefined)
  assert.equal(card.displayName, '视频剪辑专家')
  assert.equal(card.description, '负责短视频剪辑、字幕烧录与导出')
  assert.equal(card.order, 50)
  assert.equal(card.rank, RANK_USER)
  assert.equal(card.root, 'user')
  assert.ok(card.dir.endsWith(join('experts', 'video-editor')))
  assert.ok(!card.roleText.includes('\r'), 'role.md CRLF is stripped on the card')
  assert.ok(card.roleText.includes('{{model}}') && card.roleText.includes('{{cwd}}'),
    'registered variables survive verbatim in role.md')
  assert.ok(card.roleText.includes('{ { y: -2 }}') && card.roleText.includes('{ {.CurrentDate}}'),
    'unregistered groups are escaped in role.md')
  assert.deepEqual(card.skills.map((skill) => [skill.name, skill.hasSkillMd]),
    [['cut-video', true], ['data-only', false]], 'skills listed with the SKILL.md convention flag')
  assert.ok(card.skills[0].text.includes('{ { bogus }}') && card.skills[0].text.includes('{{provider}}'),
    'SKILL.md content is sanitized with the same pipeline')
  assert.equal(card.trustScripts, false, 'trust_scripts defaults to false')
}

// Broken rows carry reasons.
assert.equal(byId.get('no-role').broken, 'role.md missing')
assert.ok(byId.get('id-mismatch').broken.includes('does not match folder name'))
assert.equal(byId.get('no-manifest').broken, 'expert.yml missing')
assert.ok(byId.get('Bad_Folder').broken.includes('folder name'), 'an invalid folder name is a broken row, not a drop')
for (const id of ['no-role', 'id-mismatch', 'no-manifest', 'Bad_Folder']) {
  assert.equal(byId.get(id).root, 'user', `${id}: broken rows keep their root label`)
}

// Rank override: project wins, loser warned.
assert.equal(byId.get('shared').rank, RANK_PROJECT)
assert.equal(byId.get('shared').root, 'project')
assert.equal(byId.get('shared').displayName, '项目同名专家')
assert.equal(scan.experts.filter((expert) => expert.id === 'shared').length, 1, 'exactly one shared card survives')
assert.equal(scan.warnings.filter((w) => w.includes('"shared"') && w.includes('overridden')).length, 1,
  'the overridden user entry is reported once')

// Ordering: (order, id) — video-editor (order 50) before shared (default 100).
assert.ok(scan.experts.indexOf(byId.get('video-editor')) < scan.experts.indexOf(byId.get('shared')),
  'order 50 sorts before the default 100')

// A missing root contributes nothing, silently.
{
  const emptyScan = await scanDiscoveryRoots([
    { path: join(fixture, 'definitely', 'missing'), rank: 100, label: 'project', trust: 'project' },
  ])
  assert.deepEqual(emptyScan, { experts: [], warnings: [] }, 'missing root → empty table, no warnings')
}

// Single-folder scan export works standalone.
{
  const card = await scanExpertFolder(join(userRoot, 'video-editor'), 'video-editor',
    { rank: RANK_USER, label: 'user', path: userRoot, trust: 'user' })
  assert.equal(card.broken, undefined)
}

// ── 4. registry cache ────────────────────────────────────────────────────────

{
  let scans = 0
  const registry = createRegistry({
    roots,
    scan: async (r) => { scans += 1; return scanDiscoveryRoots(r) },
    ttlMs: 60_000,
  })
  const first = await registry.list()
  assert.equal(scans, 1, 'the first list() scans')
  assert.equal(await registry.list(), first, 'a TTL hit returns the identical cached object')
  assert.equal(scans, 1, 'a TTL hit does not rescan')
  registry.invalidate()
  await registry.list()
  assert.equal(scans, 2, 'invalidate() forces a rescan')
  // A scan that THROWS degrades to an empty table with a warning, never rejects.
  const throwing = createRegistry({ roots, scan: async () => { throw new Error('boom') } })
  const degraded = await throwing.list()
  assert.deepEqual(degraded.experts, [])
  assert.equal(degraded.warnings.length, 1)
  assert.ok(degraded.warnings[0].includes('boom'))
}

// ── 5. watcher (fs.watch + debounce) ─────────────────────────────────────────

const { watchRoots } = await import(join(root, 'src', 'watch.js'))

/** Poll until fn() is truthy, failing after a timeout guard. */
async function until(description, fn, timeoutMs = 5_000) {
  const start = Date.now()
  for (;;) {
    if (await fn()) return
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for: ${description}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

{
  // TTL long enough that ONLY watcher invalidation can surface changes.
  const registry = createRegistry({ roots, scan: scanDiscoveryRoots, ttlMs: 600_000 })
  const stop = watchRoots(roots.map((r) => r.path), () => registry.invalidate())
  try {
    assert.ok((await registry.list()).experts.some((e) => e.id === 'video-editor'), 'baseline list before changes')
    // Build the new expert COMPLETELY outside the watched roots, then rename
    // it in as one atomic add — no half-written folder can ever be observed.
    fixtureWrite(stagingRoot, 'late-expert/expert.yml', 'id: late-expert\ndisplay_name: 后到专家\n')
    fixtureWrite(stagingRoot, 'late-expert/role.md', 'late body {{model}}\n')
    renameSync(join(stagingRoot, 'late-expert'), join(userRoot, 'late-expert'))
    await until('late-expert appears without restart', async () =>
      (await registry.list()).experts.some((e) => e.id === 'late-expert' && e.broken === undefined))
    // Remove it again — the watcher must drop it from the list.
    rmSync(join(userRoot, 'late-expert'), { recursive: true, force: true })
    await until('late-expert disappears after removal', async () =>
      !(await registry.list()).experts.some((e) => e.id === 'late-expert'))
  } finally {
    stop()
  }
}

// ── 6. /expert command over a fake commands service ─────────────────────────

const { renderExpertList, registerExpertCommand } = await import(join(root, 'src', 'command.js'))

function makeFakeCommands() {
  const definitions = new Map()
  return {
    definitions,
    register(definition) {
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
  }
}

{
  const commands = makeFakeCommands()
  const logs = []
  const fakeCtx = {
    get: (serviceName) => (serviceName === 'commands' ? commands : undefined),
    logger: { warn: (message) => logs.push(message) },
  }
  const registry = createRegistry({ roots, scan: scanDiscoveryRoots })
  const off = registerExpertCommand(fakeCtx, registry, roots.map((r) => r.path))
  assert.equal(commands.definitions.size, 1, 'the /expert command registered')
  const definition = commands.definitions.get('expert')
  assert.equal(definition.name, 'expert')

  const listed = await definition.handler({ rawInput: '' })
  assert.equal(listed.kind, 'success')
  assert.ok(listed.text.includes('video-editor') && listed.text.includes('视频剪辑专家'),
    'the list renders the valid expert')
  assert.ok(listed.text.includes('role.md missing'), 'the list renders broken rows with reasons')
  assert.ok(listed.text.includes('Bad_Folder'), 'an invalid folder name still shows as a broken row')
  assert.ok(listed.text.includes('[project]') && listed.text.includes('[user]'), 'root labels ride along')

  const withArgument = await definition.handler({ rawInput: 'video-editor' })
  assert.equal(withArgument.kind, 'error')
  assert.ok(withArgument.text.includes('not implemented yet'), 'an argument answers with an explicit not-yet error')

  off()
  assert.equal(commands.definitions.size, 0, 'the command disposer unregisters')

  // Missing commands service: one warning, inert, disposable.
  logs.length = 0
  const offMissing = registerExpertCommand({ get: () => undefined, logger: { warn: (m) => logs.push(m) } }, registry)
  assert.equal(logs.filter((m) => m.includes('commands service')).length, 1, 'exactly one warning when commands is absent')
  offMissing()
}

// renderExpertList empty state names the roots.
{
  const text = renderExpertList({ experts: [], warnings: [] }, ['/a/experts', '/b/experts'])
  assert.ok(text.includes('/a/experts') && text.includes('/b/experts'), 'the empty state lists the discovery roots')
}

// ── 7. full apply() wiring over a fake cordis context ───────────────────────

const plugin = await import(join(root, 'src', 'index.js'))
assert.equal(plugin.name, 'dsh-workbuddy-expert')

{
  const commands = makeFakeCommands()
  const provided = new Map()
  const disposers = []
  const fakeCtx = {
    get: (serviceName) => (serviceName === 'commands' ? commands : undefined),
    logger: { warn: () => {} },
    reflect: {
      provide: (serviceName, value) => {
        provided.set(serviceName, value)
        return () => provided.delete(serviceName)
      },
    },
    effect(fn, label) {
      const dispose = fn()
      disposers.push({ label, dispose: typeof dispose === 'function' ? dispose : () => {} })
      return disposers[disposers.length - 1].dispose
    },
  }

  const originalCwd = process.cwd
  const originalDshHome = process.env.DSH_HOME
  try {
    process.cwd = () => projectRoot
    process.env.DSH_HOME = join(fixture, 'user-home', '.dsh')
    plugin.apply(fakeCtx, {})
  } finally {
    process.cwd = originalCwd
    if (originalDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalDshHome
  }

  assert.ok(provided.has('experts'), 'the ctx.experts service is provided')
  const service = provided.get('experts')
  const result = await service.list()
  assert.ok(result.experts.some((expert) => expert.id === 'video-editor'),
    'the provided service lists the fixture experts end to end')
  assert.ok(result.experts.some((expert) => expert.id === 'shared' && expert.root === 'project'),
    'the project root was derived from the patched cwd')
  assert.equal(commands.definitions.size, 1, 'apply() registered the /expert command')

  for (const { dispose } of disposers) dispose()
  assert.ok(!provided.has('experts'), 'the service disposer unpublishes')
  assert.equal(commands.definitions.size, 0, 'the command disposer unregisters')
}

rmSync(fixture, { recursive: true, force: true })

console.log('smoke: all checks passed')
