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
 *      lists experts including broken rows with reasons, an argument performs
 *      the soft-switch transaction (ticket 03), a missing commands service
 *      warns and stays inert;
 *   7. full apply() wiring over a fake cordis context (process.cwd patched
 *      into the fixture): service provided as `experts`, command registered,
 *      list() works end to end, every effect disposer runs;
 *   8. compose/dispose over a fake agent ctx: role section (name, order,
 *      sanitized body + meta line) + per-skill registration labeled
 *      `expert:<id>`, non-SKILL.md subdirectories skipped, a throwing
 *      skills.register degrades into the role-section catalog with one
 *      warning, dispose runs everything in reverse order;
 *   9. switch transaction serialization: two concurrent switches over one
 *      session are applied strictly in order; a busy (running) agent's
 *      transaction waits for whenIdle() before touching anything;
 *  10. switch and switch back: the previous composition is fully disposed
 *      (reverse), the new one registered, `expert/selected` events are
 *      appended BEFORE the composition commit, the switch notice is injected;
 *  11. an expert with an empty skills/ tree composes the role section only;
 *  12. generation stamping: the composition holds its startup role text and
 *      (mtime+size) stamp; on-disk edits surface only after the registry
 *      cache is invalidated AND a later switch re-reads the folder.
 *  13. script trust gating (ticket 04): trust_scripts parses onto the card
 *      (default false) with the computed scriptsAllowed field; an untrusted
 *      project expert composes with the guard paragraph + one degrade
 *      warning when no tools.guard contract exists; a trusting project
 *      expert composes with the one-time release notice; a user-rank expert
 *      gets neither; commandTargetsExpertScripts matches only the expert's
 *      own scripts/ references; mountScriptGuard denies a referencing bash
 *      call, passes unrelated calls through, unmounts, and degrades with
 *      one warning when guard registration throws.
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
const { compose, ROLE_SECTION_NAME, ROLE_SECTION_ORDER, stampExpertDir } = await import(join(root, 'src', 'compose.js'))
const { createSwitcher, EXPERT_SELECTED_EVENT } = await import(join(root, 'src', 'switch.js'))

/** A fake agent: agent-scoped ctx with systemPrompt/skills + session/inject records. */
function makeFakeAgent(sessionId) {
  const events = []
  const injections = []
  const sections = new Map()
  const registeredSkills = new Map()
  const agent = {
    id: sessionId,
    status: 'idle',
    whenIdle: async () => {},
    ctx: {
      get(serviceName) {
        if (serviceName === 'systemPrompt') {
          return {
            section(section) {
              sections.set(section.name, section)
              return () => sections.delete(section.name)
            },
          }
        }
        if (serviceName === 'skills') {
          return {
            register(skill) {
              registeredSkills.set(skill.name, skill)
              return () => registeredSkills.delete(skill.name)
            },
          }
        }
        return undefined
      },
    },
    session: {
      append(type, data) {
        const event = { type, data }
        events.push(event)
        return event
      },
    },
    inject(message) {
      injections.push(message)
    },
    events,
    injections,
    sections,
    registeredSkills,
  }
  return agent
}

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
  const switcher = createSwitcher({ registry, logger: { warn: (m) => logs.push(m) } })
  const off = registerExpertCommand(fakeCtx, registry, switcher, roots.map((r) => r.path))
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

  // /expert <id> performs the soft switch (success) against the invocation's agent.
  const agent = makeFakeAgent('cmd-session')
  const withArgument = await definition.handler({ rawInput: 'video-editor', agent })
  assert.equal(withArgument.kind, 'success')
  assert.ok(withArgument.text.includes('video-editor'), 'a switch success names the target expert')
  assert.ok(agent.sections.has(ROLE_SECTION_NAME), 'the switch composed the role section')
  // /expert <unknown-id> answers with an error listing the available experts.
  const unknown = await definition.handler({ rawInput: 'no-such-expert', agent })
  assert.equal(unknown.kind, 'error')
  assert.ok(unknown.text.includes('no-such-expert') && unknown.text.includes('video-editor'),
    'an unknown id errors and lists the available experts')
  // A broken id names the broken reason.
  const brokenTarget = await definition.handler({ rawInput: 'no-role', agent })
  assert.equal(brokenTarget.kind, 'error')
  assert.ok(brokenTarget.text.includes('role.md missing'), 'a broken id carries its broken reason')
  // No agent in the invocation: error, no crash.
  const noAgent = await definition.handler({ rawInput: 'video-editor' })
  assert.equal(noAgent.kind, 'error')

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

// ── 8. compose/dispose over a fake agent ctx ────────────────────────────────

{
  const agent = makeFakeAgent('compose-session')
  const logs = []
  const { experts } = await createRegistry({ roots, scan: scanDiscoveryRoots }).list()
  const card = experts.find((expert) => expert.id === 'video-editor')
  const composition = await compose(agent, card, { warn: (m) => logs.push(m) })

  assert.equal(composition.expertId, 'video-editor')
  assert.ok(Array.isArray(composition.generation) && composition.generation.length > 0,
    'the composition carries its startup generation stamp')
  assert.ok(composition.generation.every(([rel, mtime, size]) => typeof rel === 'string' && Number.isFinite(mtime) && Number.isFinite(size)),
    'generation entries are (relPath, mtimeMs, size) triples')

  const section = agent.sections.get(ROLE_SECTION_NAME)
  assert.ok(section !== undefined, 'the role section registered in the agent scope')
  assert.equal(section.order, ROLE_SECTION_ORDER)
  assert.ok(section.text.includes('你是视频剪辑专家') && section.text.includes('{{model}}'),
    'the sanitized role body rides the section')
  assert.ok(section.text.includes('你当前承担以下专家角色'), 'the meta line is appended')
  assert.deepEqual([...agent.registeredSkills.keys()].sort(), ['cut-video'],
    'only the SKILL.md subdirectory registers as a skill')
  assert.equal(agent.registeredSkills.get('cut-video').provider, 'expert:video-editor',
    'the skill registration carries the expert provider tag')
  assert.equal(logs.length, 0, 'a healthy compose logs nothing')

  // Dispose order is reverse: record the disposal sequence.
  const disposalOrder = []
  const originalDelete = agent.sections.delete.bind(agent.sections)
  agent.sections.delete = (name) => { disposalOrder.push(`section:${name}`); return originalDelete(name) }
  composition.dispose()
  assert.equal(agent.sections.size, 0, 'dispose removes the role section')
  assert.equal(agent.registeredSkills.size, 0, 'dispose removes every skill')
  assert.deepEqual(disposalOrder, [`section:${ROLE_SECTION_NAME}`], 'the section disposer ran')

  // A throwing skills.register degrades to the role-section catalog + ONE warning per failure.
  const agent2 = makeFakeAgent('compose-degrade')
  const originalGet = agent2.ctx.get.bind(agent2.ctx)
  agent2.ctx.get = (serviceName) => {
    if (serviceName === 'skills') return { register: () => { throw new Error('nope') } }
    return originalGet(serviceName)
  }
  const logs2 = []
  const composition2 = await compose(agent2, card, { warn: (m) => logs2.push(m) })
  const section2 = agent2.sections.get(ROLE_SECTION_NAME)
  assert.ok(section2.text.includes('skill: cut-video'), 'the failed skill degrades into the role-section catalog')
  assert.equal(logs2.filter((m) => m.includes('cut-video')).length, 1, 'exactly one warning for the failed skill')
  composition2.dispose()
  assert.equal(agent2.sections.size, 0, 'the degraded composition still disposes')
}

// ── 9. switch transaction serialization + busy-agent boundary ───────────────

{
  const orderLog = []
  const registry = createRegistry({
    roots,
    scan: async (r) => {
      orderLog.push('scan-start')
      await new Promise((resolve) => setTimeout(resolve, 20))
      orderLog.push('scan-end')
      return scanDiscoveryRoots(r)
    },
    ttlMs: 600_000, // caching on: only the first transaction pays the scan
  })
  const switcher = createSwitcher({ registry, logger: { warn: () => {} } })
  const agent = makeFakeAgent('serial-session')
  const first = switcher.switch(agent, 'video-editor')
  const second = switcher.switch(agent, 'shared')
  await Promise.all([first, second])
  // Serialized: the two scans (first transaction only; the second reuses the
  // cached table) plus the two event appends never interleave.
  assert.deepEqual(orderLog, ['scan-start', 'scan-end'], 'the second transaction reuses the cached scan')
  assert.deepEqual(agent.events.map((event) => event.data.expert), ['video-editor', 'shared'],
    'the two concurrent switches were applied strictly in order')
  assert.equal(switcher.stateOf('serial-session').id, 'shared', 'the last switch wins')
  assert.ok(agent.sections.has(ROLE_SECTION_NAME) && agent.registeredSkills.size === 0,
    'the final composition (shared: role only) is in place')

  // Busy agent: the transaction waits for whenIdle() before anything else.
  const busyAgent = makeFakeAgent('busy-session')
  let idleResolved = false
  busyAgent.status = 'running'
  busyAgent.whenIdle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    idleResolved = true
    busyAgent.status = 'idle'
  }
  const result = await switcher.switch(busyAgent, 'video-editor')
  assert.equal(result.kind, 'success')
  assert.ok(idleResolved, 'whenIdle() resolved before the transaction applied')
  assert.ok(busyAgent.events.every((event) => idleResolved), 'every event landed after the turn boundary')
  assert.equal(switcher.stateOf('busy-session').id, 'video-editor')

  // Switching to the SAME expert is an idempotent no-op success.
  const again = await switcher.switch(busyAgent, 'video-editor')
  assert.equal(again.kind, 'success')
  assert.ok(again.text.includes('无需切换'))
  assert.equal(busyAgent.events.length, 1, 'an idempotent switch records no new event')

  // Unknown/broken ids answer with an error listing the experts.
  const missing = await switcher.switch(agent, 'no-such-expert')
  assert.equal(missing.kind, 'error')
  assert.ok(missing.text.includes('video-editor') && missing.text.includes('shared'))
  const broken = await switcher.switch(agent, 'no-role')
  assert.equal(broken.kind, 'error')
  assert.ok(broken.text.includes('role.md missing'))
  assert.equal(switcher.stateOf('serial-session').id, 'shared', 'a failed switch leaves the current composition intact')
}

// ── 10. switch → switch back: dispose correctness + event-before-commit ─────

{
  const registry = createRegistry({ roots, scan: scanDiscoveryRoots, ttlMs: 600_000 })
  const switcher = createSwitcher({ registry, logger: { warn: () => {} } })
  const agent = makeFakeAgent('round-trip')

  const first = await switcher.switch(agent, 'video-editor')
  assert.equal(first.kind, 'success')
  const composedSection = agent.sections.get(ROLE_SECTION_NAME)
  assert.ok(composedSection.text.includes('你是视频剪辑专家'))
  assert.deepEqual([...agent.registeredSkills.keys()], ['cut-video'])
  assert.deepEqual(agent.events, [{ type: EXPERT_SELECTED_EVENT, data: { expert: 'video-editor', previous: null } }],
    'the first selection is recorded with previous: null')

  const injectionsBefore = agent.injections.length
  const second = await switcher.switch(agent, 'shared')
  assert.equal(second.kind, 'success')
  assert.ok(agent.registeredSkills.size === 0, 'switching away disposed the expert skills')
  assert.ok(!agent.sections.get(ROLE_SECTION_NAME).text.includes('你是视频剪辑专家'),
    'the role section was replaced by the new expert body')
  assert.equal(agent.events.at(-1).data.previous, 'video-editor', 'the switch event names the previous expert')
  assert.equal(agent.injections.length, injectionsBefore + 1, 'the switch notice was injected once')
  assert.ok(agent.injections.at(-1).content[0].text.includes('已从专家 video-editor 切换为'),
    'the notice states the from→to switch')
  assert.equal(agent.injections.at(-1).source.plugin, 'dsh-workbuddy-expert')

  const back = await switcher.switch(agent, 'video-editor')
  assert.equal(back.kind, 'success')
  assert.deepEqual([...agent.registeredSkills.keys()], ['cut-video'], 'switching back re-registers the skills')
  assert.ok(agent.sections.get(ROLE_SECTION_NAME).text.includes('你是视频剪辑专家'))
  assert.equal(agent.events.length, 3)

  // Event-before-commit: the append happens while the OLD composition is
  // already disposed but the NEW one is not yet in place (observable here as
  // every event preceding its composition's section update — guaranteed by
  // the serialized body's internal order; asserted via the append hook).
  const orderAgent = makeFakeAgent('order-session')
  const seenAtAppend = []
  orderAgent.session.append = (type, data) => {
    seenAtAppend.push([...orderAgent.registeredSkills.keys()])
    return { type, data }
  }
  await switcher.switch(orderAgent, 'video-editor')
  assert.deepEqual(seenAtAppend, [[]], 'at event-append time the new composition is not yet registered')
}

// ── 11. empty-skills expert: role section only ─────────────────────────────

{
  const registry = createRegistry({ roots, scan: scanDiscoveryRoots, ttlMs: 600_000 })
  const switcher = createSwitcher({ registry, logger: { warn: () => {} } })
  const agent = makeFakeAgent('role-only')
  const result = await switcher.switch(agent, 'shared') // shared has NO skills/ tree
  assert.equal(result.kind, 'success')
  assert.ok(agent.sections.has(ROLE_SECTION_NAME), 'the role section registered')
  assert.equal(agent.registeredSkills.size, 0, 'no skills registered for an empty-skills expert')
  assert.ok(agent.sections.get(ROLE_SECTION_NAME).text.includes('你当前承担以下专家角色'))
  // composeForCreation: the ticket-05 helper runs the same transaction.
  const creationAgent = makeFakeAgent('creation-session')
  const created = await switcher.composeForCreation(creationAgent, 'shared')
  assert.equal(created.kind, 'success')
  assert.equal(switcher.stateOf('creation-session').id, 'shared')
  assert.deepEqual(creationAgent.events.at(-1).data, { expert: 'shared', previous: null })
}

// ── 12. generation stamping: running compositions keep their startup text ──

{
  const registry = createRegistry({ roots, scan: scanDiscoveryRoots, ttlMs: 600_000 })
  const switcher = createSwitcher({ registry, logger: { warn: () => {} } })
  const agent = makeFakeAgent('generation-session')
  await switcher.switch(agent, 'video-editor')
  const startupText = agent.sections.get(ROLE_SECTION_NAME).text
  const startupStamp = switcher.stateOf('generation-session').generation
  assert.ok(startupText.includes('你是视频剪辑专家'))

  // Mutate the folder on disk AFTER composition: the running composition is
  // untouched (its role text and stamp are startup snapshots).
  writeFileSync(join(userRoot, 'video-editor', 'role.md'), '你现在是完全不同的角色。\n')
  assert.equal(agent.sections.get(ROLE_SECTION_NAME).text, startupText,
    'a running composition keeps its startup role text')
  const stampNow = await stampExpertDir(join(userRoot, 'video-editor'))
  assert.notDeepEqual(stampNow, startupStamp, 'the on-disk stamp changed (mtime/size)')

  // While the cache is warm the switch still serves the startup generation;
  // after invalidate() the next switch re-reads the folder.
  await switcher.switch(agent, 'shared')
  const cached = await switcher.switch(agent, 'video-editor')
  assert.equal(cached.kind, 'success')
  assert.ok(agent.sections.get(ROLE_SECTION_NAME).text.includes('你是视频剪辑专家'),
    'a warm-cache switch keeps the startup generation')
  registry.invalidate()
  await switcher.switch(agent, 'shared')
  const fresh = await switcher.switch(agent, 'video-editor')
  assert.equal(fresh.kind, 'success')
  assert.ok(agent.sections.get(ROLE_SECTION_NAME).text.includes('你现在是完全不同的角色'),
    'an invalidated registry re-reads the folder for future switches')

  // Restore the fixture content for any later reader.
  writeFileSync(join(userRoot, 'video-editor', 'role.md'), [
    '你是视频剪辑专家。变量 {{model}} 与 {{cwd}} 已注册，保留。(#1)',
    '未注册组必须拆括号：{{ y: -2 }} 与 {{.CurrentDate}}。(#2)',
  ].join('\r\n').concat('\r\n'))
}

// ── 13. script trust gating (ticket 04) ─────────────────────────────────────

const { SCRIPT_GUARD_PARAGRAPH, SCRIPT_TRUST_NOTICE_PARAGRAPH, commandTargetsExpertScripts, mountScriptGuard } =
  await import(join(root, 'src', 'trust.js'))

{
  // A trusting project expert: trust_scripts: true + a SKILL.md that
  // references ./scripts/ under its own skill folder.
  const projectExperts = join(projectRoot, '.agents', 'experts')
  fixtureWrite(projectExperts, 'trusted-proj/expert.yml', [
    'id: trusted-proj',
    'display_name: 受信项目专家',
    'trust_scripts: true',
  ].join('\n'))
  fixtureWrite(projectExperts, 'trusted-proj/role.md', '你是受信的项目专家。\n')
  fixtureWrite(projectExperts, 'trusted-proj/skills/deploy/SKILL.md',
    '运行 `./skills/deploy/scripts/deploy.sh` 完成部署。\n')

  const { experts: fresh } = await createRegistry({ roots, scan: scanDiscoveryRoots, ttlMs: 600_000 }).list()
  const untrusted = fresh.find((expert) => expert.id === 'shared')            // project, no declaration
  const trusting = fresh.find((expert) => expert.id === 'trusted-proj')       // project, trust_scripts: true
  const userRank = fresh.find((expert) => expert.id === 'video-editor')       // user rank

  // Card shape: trust_scripts parses; scriptsAllowed is the computed gate.
  assert.equal(untrusted.trustScripts, false, 'project card without declaration: trustScripts false')
  assert.equal(untrusted.scriptsAllowed, false, 'project card without declaration: scripts NOT allowed')
  assert.equal(trusting.trustScripts, true, 'trust_scripts: true parses onto the card')
  assert.equal(trusting.scriptsAllowed, true, 'project card with declaration: scripts allowed')
  assert.equal(userRank.trustScripts, false, 'user card needs no declaration')
  assert.equal(userRank.scriptsAllowed, true, 'user rank: scripts always allowed')

  // Untrusted project expert: guard paragraph + one degrade warning (the
  // fake agent ctx has NO tools service, so the hard-enforcement contract
  // cannot be confirmed and the paragraph-only path engages).
  {
    const agent = makeFakeAgent('gate-untrusted')
    const logs = []
    const composition = await compose(agent, untrusted, { warn: (m) => logs.push(m) })
    const text = agent.sections.get(ROLE_SECTION_NAME).text
    assert.ok(text.includes(SCRIPT_GUARD_PARAGRAPH), 'the untrusted project expert carries the guard paragraph')
    assert.ok(!text.includes(SCRIPT_TRUST_NOTICE_PARAGRAPH), 'no release notice for the untrusted expert')
    assert.ok(text.includes('trust_scripts: true'), 'the guard paragraph names the unlock')
    assert.equal(logs.filter((m) => m.includes('拦截不可用')).length, 1,
      'exactly one warning when the tools.guard contract is unavailable')
    composition.dispose()
  }

  // Trusting project expert: the one-time (per composition) release notice,
  // no guard paragraph, and no warnings.
  {
    const agent = makeFakeAgent('gate-trusted')
    const logs = []
    const composition = await compose(agent, trusting, { warn: (m) => logs.push(m) })
    const text = agent.sections.get(ROLE_SECTION_NAME).text
    assert.ok(text.includes(SCRIPT_TRUST_NOTICE_PARAGRAPH), 'the trusting project expert carries the release notice')
    assert.ok(!text.includes(SCRIPT_GUARD_PARAGRAPH), 'no guard paragraph for the trusting expert')
    assert.equal(text.split(SCRIPT_TRUST_NOTICE_PARAGRAPH).length - 1, 1, 'the notice appears exactly once')
    assert.equal(logs.length, 0, 'a trusted compose probes no guard and logs nothing')
    composition.dispose()
  }

  // User-rank expert: neither paragraph.
  {
    const agent = makeFakeAgent('gate-user')
    const logs = []
    const composition = await compose(agent, userRank, { warn: (m) => logs.push(m) })
    const text = agent.sections.get(ROLE_SECTION_NAME).text
    assert.ok(!text.includes(SCRIPT_GUARD_PARAGRAPH) && !text.includes(SCRIPT_TRUST_NOTICE_PARAGRAPH),
      'a user-rank expert carries neither trust paragraph')
    assert.equal(logs.length, 0)
    composition.dispose()
  }

  // commandTargetsExpertScripts: only THIS expert's scripts/ references match.
  {
    const dir = untrusted.dir
    assert.equal(commandTargetsExpertScripts(`bash ${join(dir, 'skills', 'deploy', 'scripts', 'deploy.sh')}`, untrusted), true,
      'the absolute expert scripts path matches')
    assert.equal(commandTargetsExpertScripts('sh ./skills/deploy/scripts/deploy.sh', { id: 'shared', dir: '/nowhere' }), false,
      'a relative scripts/ path without the expert id does not match')
    assert.equal(commandTargetsExpertScripts('bash shared/skills/deploy/scripts/deploy.sh', { id: 'shared', dir: '/nowhere' }), true,
      'the <id>/skills/<skill>/scripts/ segment matches without the absolute dir')
    assert.equal(commandTargetsExpertScripts('node scripts/smoke.mjs', untrusted), false,
      "another tool's plain scripts/ reference never matches")
    assert.equal(commandTargetsExpertScripts('', untrusted), false, 'an empty command never matches')
  }

  // mountScriptGuard over a fake ctx.tools.guard: deny referencing bash
  // calls, pass unrelated calls through, unmount cleanly, degrade on throw.
  {
    const mounted = []
    let guardExec = null
    const toolsService = {
      guard(guardDef) {
        mounted.push(guardDef)
        guardExec = guardDef.exec
        return () => { mounted.pop(); guardExec = null }
      },
    }
    const gateAgent = makeFakeAgent('gate-hard')
    const originalGet = gateAgent.ctx.get.bind(gateAgent.ctx)
    gateAgent.ctx.get = (serviceName) => (serviceName === 'tools' ? toolsService : originalGet(serviceName))

    const logs = []
    const unguard = mountScriptGuard(gateAgent.ctx, untrusted, { warn: (m) => logs.push(m) })
    assert.equal(mounted.length, 1, 'a callable tools.guard mounted the interceptor')
    assert.ok(mounted[0].name.startsWith('expert-script-guard:shared'), 'the guard is labeled per expert')
    assert.equal(logs.length, 0, 'a confirmed contract logs nothing')

    // Deny: a bash call referencing the expert's scripts/ directory.
    await assert.rejects(
      () => guardExec({ name: 'bash', args: { command: `bash ${join(untrusted.dir, 'scripts', 'x.sh')}` } }, async (c) => ({ ok: true })),
      /trust_scripts/,
      'a referencing bash invocation is rejected with the unlock hint')
    // Pass-through: an unrelated command reaches next().
    let nextArg = null
    const passResult = await guardExec({ name: 'bash', args: { command: 'node scripts/smoke.mjs' } }, async (c) => { nextArg = c; return { ok: true } })
    assert.deepEqual(nextArg, { name: 'bash', args: { command: 'node scripts/smoke.mjs' } }, 'unrelated commands reach next() untouched')
    assert.deepEqual(passResult, { ok: true })

    unguard()
    assert.equal(mounted.length, 0, 'the disposer unmounts the guard')
    unguard()
    assert.equal(mounted.length, 0, 'the disposer is idempotent')

    // Degrade: a tools.guard that throws at registration → one warning.
    const logs2 = []
    const throwingCtx = { get: (serviceName) => (serviceName === 'tools' ? { guard: () => { throw new Error('bad shape') } } : undefined) }
    mountScriptGuard(throwingCtx, untrusted, { warn: (m) => logs2.push(m) })
    assert.equal(logs2.filter((m) => m.includes('拒绝注册')).length, 1, 'a throwing registration degrades with one warning')

    // Full compose with a mountable guard: the disposer rides the group.
    const agent3 = makeFakeAgent('gate-compose')
    const originalGet3 = agent3.ctx.get.bind(agent3.ctx)
    agent3.ctx.get = (serviceName) => (serviceName === 'tools' ? toolsService : originalGet3(serviceName))
    const composition3 = await compose(agent3, untrusted, { warn: () => {} })
    assert.equal(mounted.length, 1, 'compose mounted the hard guard for the untrusted expert')
    composition3.dispose()
    assert.equal(mounted.length, 0, 'composition dispose unmounts the hard guard')
  }
}

rmSync(fixture, { recursive: true, force: true })

console.log('smoke: all checks passed')
