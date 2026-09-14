/**
 * Offline smoke checks for the WorkBuddy importer segment (ticket 06) —
 * no browser, no live profile, zero dependencies:
 * `node scripts/smoke-importer.mjs`.
 *
 *   1. scanner over the pathology fixture: a CRLF solo expert, a
 *      three-agent team with per-member avatars + team.png, a `git:`
 *      duplicate directory, a cross-plugin same-id pair (first-wins),
 *      and a skills subdirectory without SKILL.md — plus the shared
 *      sanitize pipeline (registered-variable whitelist, `\r`-free
 *      personas) and tilde expansion rules;
 *   2. catalog fingerprint + cache: auto-rescan on an edit of an
 *      EXISTING agent file, on a NEW agent file inside an existing
 *      plugin, and on a plugin.json edit; cache hits re-read zero
 *      content; invalidate() forces a rescan; concurrent misses
 *      coalesce into one scan;
 *   3. settings mount against a fake settings service + fake
 *      schemastery: base default, raw `~` storage, nonexistent path
 *      allowed, watcher dropping the cache on a sourcePath change;
 *   4. routes over a fake webServer with duck-typed request/response:
 *      /api/state shape (cards with id/name/zhName/description/
 *      zhDescription/skills/avatarUrl/pluginDir/teamSize/category,
 *      sourcePath raw, pathExists, warnings, no-store), nonexistent
 *      sourcePath → pathExists=false + warning, /api/refresh,
 *      same-origin rejection + 405 + the 4 KiB body cap, and full
 *      disposal;
 *   5. avatar route: byte-exact PNG stream (image/png + max-age=60 +
 *      content-length), the uniform 404 (unknown id, ID_RE reject,
 *      missing id, PNG-less expert), and a declared plugin.json avatar
 *      escaping the source root via `..` → 404 while an innocent avatar
 *      in the same tree still serves identical bytes;
 *   6. mountImporter end-to-end against a fake ctx when — and only
 *      when — a real dsh harness is resolvable on this machine (the
 *      schemastery resolver's tier list); skipped silently otherwise
 *      (this section reports, it never gates).
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

// ── 1. scanner over the pathology fixture ───────────────────────────────────

const { DEFAULT_SOURCE_PATH, ID_RE, expandTildePath, scanWorkbuddyRoot } =
  await import(join(root, 'src', 'importer', 'scanner.js'))
const { REGISTERED_PROMPT_VARIABLES } = await import(join(root, 'src', 'sanitize.js'))

assert.equal(DEFAULT_SOURCE_PATH, '~/.workbuddy/plugins/marketplaces/experts/plugins',
  'default source path is the raw tilde string, echoed verbatim')
assert.equal(expandTildePath('~'), homedir(), 'bare tilde expands')
assert.equal(expandTildePath('~/plugins'), join(homedir(), 'plugins'), 'tilde prefix expands')
assert.equal(expandTildePath('/absolute/path'), '/absolute/path', 'absolute path untouched')
assert.equal(expandTildePath('~foo/bar'), '~foo/bar', 'other-user tilde untouched')

assert.deepEqual(await scanWorkbuddyRoot('/definitely/not/scanned/yet'),
  { experts: [], warnings: [] },
  'missing root → empty table with NO scanner warning (the state layer owns the pathExists warning)')

/** Complete {{…}} group names in a persona. */
const templateGroupsOf = (text) => [...text.matchAll(/\{\{([^{}]*)\}\}/g)].map((match) => match[1])

const fixtureRoot = mkdtempSync(join(tmpdir(), 'dsh-wbe-importer-scan-'))
const FIXTURE_PNG = Buffer.from('89504e470d0a1a0a-fixture-png')

/** Write one fixture file, creating parent directories as needed. */
function fixtureWrite(relative, content) {
  const path = join(fixtureRoot, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

// Solo expert #1: skills (one subdir WITHOUT SKILL.md + an empty one) +
// rules + PNG + template variables + full plugin.json metadata.
fixtureWrite('solo-one/agents/solo-one.md', [
  '---',
  'name: solo-one',
  'description: Use when asked to review code paths end to end.',
  'displayName:',
  '  en: "Solo One"',
  '  zh: "独奏一号"',
  '---',
  '',
  '# 评审专家',
  '',
  '模板变量 {{model}} 与 {{provider}} 已注册，保留原样。',
  '未注册组必须拆括号：{{ y: -2 }}、{{ github.sha }}、{{ cwd }}（带空格同样未注册）。',
  '嵌套大括号 {{ {a:1} }}、三连 {{{ ninja }}} 都不允许让插值器抛错。',
  '',
].join('\n'))
fixtureWrite('solo-one/rules/quality.md', '---\ndescription: quality gate\n---\n\n规则正文：所有输出必须自证。规则里的 {{ item.name }} 同样要被转义。\n')
fixtureWrite('solo-one/skills/main-skill/SKILL.md', 'SKILL: main\n')
fixtureWrite('solo-one/skills/references/data.md', 'reference data with no SKILL.md\n')
mkdirSync(join(fixtureRoot, 'solo-one', 'skills', 'empty-skill'), { recursive: true })
fixtureWrite('solo-one/avatars/solo-one.png', FIXTURE_PNG)
fixtureWrite('solo-one/.codebuddy-plugin/plugin.json', JSON.stringify({
  name: 'solo-one',
  profession: { en: 'Solo Review Expert', zh: '评审专家' },
  displayDescription: { en: 'English display', zh: '来自 plugin.json 的中文描述。' },
  avatar: 'avatars/solo-one.png',
  categoryId: '02-Engineering',
}))

// Solo expert #2: every file CRLF, no frontmatter displayName/profession
// (zhName from plugin.json profession.zh), dangling avatar reference.
const crlf = (text) => text.split('\n').join('\r\n')
fixtureWrite('solo-two/agents/solo-two.md', crlf([
  '---',
  'name: solo-two',
  'description: Use when asked to containerize workloads.',
  '---',
  '',
  '# 容器器（Dockerfile 生成专家）',
  '',
  'CRLF 正文第一行。多阶段构建与镜像瘦身是本职。\r',
  '第二行同样以 CRLF 结尾，抽取后不得残留 \\r。',
  '',
].join('\n')))
fixtureWrite('solo-two/avatars/actual.png', FIXTURE_PNG)
fixtureWrite('solo-two/.codebuddy-plugin/plugin.json', crlf(JSON.stringify({
  name: 'solo-two',
  profession: { en: 'Container Expert', zh: '容器专家' },
  displayDescription: { en: 'English display', zh: 'CRLF plugin.json 的中文描述。' },
  avatar: 'avatars/ghost-does-not-exist.png',
  categoryId: '77-Future-Tech',
})))

// Three-agent team: every member owns <agentName>.png, team.png exists,
// one member is CRLF without frontmatter displayName (zhName from
// profession.zh), plugin.json has no displayDescription (README fallback).
fixtureWrite('team-x/agents/team-x-lead.md', [
  '---',
  'name: team-x-lead',
  'description: Lead of the fixture team.',
  'profession:',
  '  en: "Team Lead"',
  '  zh: "队长"',
  'displayName:',
  '  en: "Lead Person"',
  '  zh: "队长甲"',
  '---',
  '',
  '# 队长',
  '',
  '统筹全局。',
].join('\n'))
fixtureWrite('team-x/agents/team-x-maker.md', crlf([
  '---',
  'name: team-x-maker',
  'description: Maker of the fixture team.',
  'profession:',
  '  en: "Maker"',
  '  zh: "制造工程师"',
  '---',
  '',
  '# 制造',
  '',
  'CRLF 成员正文，没有 frontmatter displayName。',
].join('\n')))
fixtureWrite('team-x/agents/team-x-checker.md', [
  '---',
  'name: team-x-checker',
  'description: Checker of the fixture team.',
  'displayName:',
  '  en: "Checker Person"',
  '  zh: "质检乙"',
  '---',
  '',
  '# 质检',
  '',
  '把关交付。',
].join('\n'))
for (const member of ['team-x-lead', 'team-x-maker', 'team-x-checker', 'team']) {
  fixtureWrite(`team-x/avatars/${member}.png`, FIXTURE_PNG)
}
fixtureWrite('team-x/README.md', '# 团队插件\n\nREADME 首段中文兜底描述。\n\n## 后文\n\n不取。\n')
fixtureWrite('team-x/.codebuddy-plugin/plugin.json', JSON.stringify({
  name: 'team-x',
  expertType: 'team',
  profession: { en: 'Fixture Team', zh: '夹具团队' },
  categoryId: '01-ProductDesign',
}))

// A `git:`-prefixed duplicate-install copy of the team — skipped whole.
for (const file of ['agents/team-x-lead.md', 'agents/team-x-maker.md', 'agents/team-x-checker.md']) {
  fixtureWrite(`git:team-x:copy/${file}`, readFileSync(join(fixtureRoot, 'team-x', file)))
}
fixtureWrite('git:team-x:copy/.codebuddy-plugin/plugin.json',
  readFileSync(join(fixtureRoot, 'team-x', '.codebuddy-plugin', 'plugin.json')))

// Cross-plugin duplicate-id pair: alpha wins (name-sorted first), zeta
// is skipped with a warning.
fixtureWrite('alpha-dup/agents/one.md', '---\nname: dup-expert\ndescription: First definition.\n---\n\n# 阿尔法（重复名专家）\n\n胜者正文。\n')
fixtureWrite('alpha-dup/.codebuddy-plugin/plugin.json', JSON.stringify({ name: 'alpha-dup' }))
fixtureWrite('zeta-dup/agents/one.md', '---\nname: dup-expert\ndescription: Second definition.\n---\n\n# 失败者\n\n败者正文。\n')
fixtureWrite('zeta-dup/.codebuddy-plugin/plugin.json', JSON.stringify({ name: 'zeta-dup' }))

// PNG-less solo (avatar route's 404 matrix) — English-only metadata.
fixtureWrite('solo-three/agents/solo-three.md', '---\nname: solo-three\ndescription: Use when asked to check the terminal fallback.\ndisplayName:\n  en: "Solo Three"\n---\n\n# Plain English Title\n\nNo Chinese metadata anywhere.\n')
fixtureWrite('solo-three/.codebuddy-plugin/plugin.json', JSON.stringify({ name: 'solo-three' }))

// The declared-avatar escape: plugin.json points at
// `../../<outside>/escape.png`, which EXISTS but strictly OUTSIDE the
// source root — the scan keeps the path, the avatar route must 404 it.
const OUTSIDE_DIR = join(dirname(fixtureRoot), `dsh-wbe-importer-outside-${Date.now()}`)
mkdirSync(OUTSIDE_DIR, { recursive: true })
writeFileSync(join(OUTSIDE_DIR, 'escape.png'), FIXTURE_PNG)
fixtureWrite('escape-solo/agents/escape-solo.md', '---\nname: escape-solo\ndescription: Declared avatar escapes the root.\n---\n\n正文。\n')
fixtureWrite('escape-solo/.codebuddy-plugin/plugin.json', JSON.stringify({
  name: 'escape-solo',
  avatar: `../../${basename(OUTSIDE_DIR)}/escape.png`,
}))

const scan = await scanWorkbuddyRoot(fixtureRoot)
const byId = new Map(scan.experts.map((expert) => [expert.id, expert]))

// Card inventory: git: copy and zeta-dup contribute nothing.
assert.deepEqual(scan.experts.map((expert) => expert.id), [
  'dup-expert', 'escape-solo', 'solo-one', 'solo-three', 'solo-two',
  'team-x-checker', 'team-x-lead', 'team-x-maker',
].sort(), 'exactly the eight surviving cards, in deterministic order')
assert.equal(scan.experts.filter((expert) => expert.pluginDir.startsWith('git:')).length, 0,
  'git: copy contributes no card at all')
assert.equal(scan.experts.filter((expert) => expert.pluginDir === 'zeta-dup').length, 0,
  'duplicate loser is invisible')
assert.equal(scan.warnings.filter((warning) => warning.includes('duplicate expert id "dup-expert"')).length, 1,
  'duplicate id reported once, first-wins')

// Solo #1: metadata chain, verbatim skills, rules appended, escaping.
{
  const soloOne = byId.get('solo-one')
  assert.equal(soloOne.name, 'Solo One', 'name ← frontmatter displayName.en')
  assert.equal(soloOne.zhName, '评审专家', 'single card zhName ← plugin.json profession.zh (plugin.json first)')
  assert.equal(soloOne.zhDescription, '来自 plugin.json 的中文描述。')
  assert.ok(soloOne.avatarPath.endsWith(join('solo-one', 'avatars', 'solo-one.png')))
  assert.deepEqual(soloOne.skills, ['empty-skill', 'main-skill', 'references'],
    'skills copies every subdirectory verbatim, including the one without SKILL.md')
  assert.equal(soloOne.teamSize, 1)
  assert.equal(soloOne.category, '02-Engineering')
  assert.ok(soloOne.persona.includes('# 附加规则：rules/quality.md'), 'rules are appended under a title')
  assert.ok(!soloOne.persona.includes('\r'), 'persona never carries \\r')
  const groups = templateGroupsOf(soloOne.persona)
  assert.ok(groups.includes('model') && groups.includes('provider'), 'registered groups survive verbatim')
  assert.ok(soloOne.persona.includes('{ { y: -2 }}'), 'code-example groups are split at the opening braces')
}

// Solo #2: CRLF everywhere, dangling avatar fallback.
{
  const soloTwo = byId.get('solo-two')
  assert.ok(!soloTwo.persona.includes('\r'), 'CRLF persona is \\r-free')
  assert.ok(soloTwo.persona.includes('CRLF 正文第一行'), 'CRLF body extracted past the frontmatter')
  assert.equal(soloTwo.zhName, '容器专家', 'zhName ← plugin.json profession.zh over CRLF boundaries')
  assert.equal(soloTwo.zhDescription, 'CRLF plugin.json 的中文描述。')
  assert.ok(soloTwo.avatarPath.endsWith(join('solo-two', 'avatars', 'actual.png')),
    'dangling avatar reference falls back to the first PNG')
  assert.equal(soloTwo.category, '77-Future-Tech', 'category parses from a CRLF plugin.json')
}

// Team: split into per-agent cards, each member's own PNG, README fallback.
{
  const lead = byId.get('team-x-lead')
  const maker = byId.get('team-x-maker')
  const checker = byId.get('team-x-checker')
  assert.ok(lead !== undefined && maker !== undefined && checker !== undefined, 'team splits one card per agent md')
  for (const [id, expert] of [['team-x-lead', lead], ['team-x-maker', maker], ['team-x-checker', checker]]) {
    assert.equal(expert.teamSize, 3, `${id}: teamSize counts the directory's agent files`)
    assert.equal(expert.pluginDir, 'team-x')
    assert.equal(expert.category, '01-ProductDesign', `${id}: the plugin-level category reaches every team member`)
    assert.ok(expert.avatarPath.endsWith(join('team-x', 'avatars', `${id}.png`)),
      `${id}: avatar hits its own <agentName>.png (never team.png / first PNG)`)
  }
  assert.equal(lead.zhName, '队长', 'team zhName ← frontmatter profession.zh first (functional name priority)')
  assert.equal(checker.zhName, '质检乙', 'member with displayName.zh only → displayName.zh serves as the fallback')
  assert.equal(maker.zhName, '制造工程师', 'CRLF member without displayName takes zhName from frontmatter profession.zh')
  assert.ok(!maker.persona.includes('\r'), 'CRLF member persona is \\r-free')
  assert.equal(lead.zhDescription, 'README 首段中文兜底描述。', 'zhDescription falls back to the README first non-title paragraph')
}

// Duplicate winner: body-H1 zhName extension + undefined avatarPath.
{
  const winner = byId.get('dup-expert')
  assert.equal(winner.pluginDir, 'alpha-dup', 'first (name-sorted) definition wins the shared id')
  assert.equal(winner.zhName, '重复名专家', 'body-H1 extension: the parenthesized functional name serves when no Chinese metadata exists')
  assert.equal(winner.avatarPath, undefined, 'PNG-less expert has no avatarPath')
}

// Terminal fallback + escape card.
assert.equal(byId.get('solo-three').zhName, 'Solo Three', 'zhName terminal fallback is the name field, not the raw id')
assert.equal(byId.get('solo-three').category, undefined, 'a plugin.json without categoryId leaves the card uncategorized')
assert.equal(byId.get('escape-solo').avatarPath, join(OUTSIDE_DIR, 'escape.png'),
  'the scanner keeps a declared avatar that exists (the ROUTE must reject it, not the scan)')

// Every card: id shape, no \r anywhere, personas escape-checked.
for (const expert of scan.experts) {
  assert.match(expert.id, ID_RE, `expert id ${expert.id} conforms`)
  assert.ok(!expert.persona.includes('\r'), `persona of ${expert.id} carries no \\r`)
  for (const group of templateGroupsOf(expert.persona)) {
    assert.ok(REGISTERED_PROMPT_VARIABLES.includes(group),
      `persona of ${expert.id} keeps only registered template variables (got "{{${group}}}")`)
  }
}

// ── 2. catalog fingerprint + auto-rescan ────────────────────────────────────

const { createCatalog, computeSourceFingerprint } = await import(join(root, 'src', 'importer', 'catalog.js'))

const cacheRoot = mkdtempSync(join(tmpdir(), 'dsh-wbe-importer-cache-'))
function cacheWrite(relative, content) {
  const path = join(cacheRoot, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** Push one file's mtime deterministically ahead (same-ms writes must not mask a change). */
function bumpMtime(path) {
  const at = new Date(Date.now() + 5000)
  utimesSync(path, at, at)
}

cacheWrite('plug-one/agents/cache-one.md', '---\nname: cache-one\ndescription: v1 trigger text\n---\n\nv1 正文。\n')
cacheWrite('plug-one/skills/skill-a/SKILL.md', 'SKILL: a\n')
cacheWrite('plug-one/avatars/a.png', FIXTURE_PNG)
cacheWrite('plug-one/.codebuddy-plugin/plugin.json', JSON.stringify({
  name: 'plug-one',
  displayDescription: { zh: '插件描述 v1' },
}))

assert.equal(await computeSourceFingerprint(cacheRoot), await computeSourceFingerprint(cacheRoot),
  'the fingerprint is stable across repeated computations')
assert.equal(await computeSourceFingerprint('/definitely/not/fingerprinted'),
  await computeSourceFingerprint('/also/not/fingerprinted'),
  'an unreachable root hashes to the stable marker (the empty scan stays cacheable)')

// git: copies cannot move the key — the scanner skips them, so the key
// must skip them too.
{
  const withoutGit = await computeSourceFingerprint(cacheRoot)
  for (const rel of ['agents/cache-one.md', 'skills/skill-a/SKILL.md', 'avatars/a.png', '.codebuddy-plugin/plugin.json']) {
    cacheWrite(`git:plug-one:copy/${rel}`, readFileSync(join(cacheRoot, 'plug-one', rel)))
  }
  assert.equal(await computeSourceFingerprint(cacheRoot), withoutGit,
    'git: copies cannot move the fingerprint')
}

let cacheScans = 0
const cacheCatalog = createCatalog(
  async (rawPath) => { cacheScans += 1; return scanWorkbuddyRoot(rawPath) },
)
const cardOf = (state, id) => state.experts.find((expert) => expert.id === id)

const firstState = await cacheCatalog.stateOf(cacheRoot)
assert.equal(cacheScans, 1, 'the first request scans')
assert.equal((await cacheCatalog.stateOf(cacheRoot)), firstState,
  'unchanged fingerprint → the cached result object serves the request (zero content re-reads)')

// Fingerprint change #1: edit of an EXISTING agent file.
cacheWrite('plug-one/agents/cache-one.md', '---\nname: cache-one\ndescription: v2 trigger text, longer\n---\n\nv2 正文更长。\n')
bumpMtime(join(cacheRoot, 'plug-one', 'agents', 'cache-one.md'))
assert.equal(cardOf(await cacheCatalog.stateOf(cacheRoot), 'cache-one').description, 'v2 trigger text, longer',
  'an edit of an existing agent file auto-rescans (the fingerprint moved)')

// Fingerprint change #2: a NEW agent file inside an existing plugin
// directory — the regression anchor that kills top-level-mtime schemes.
{
  const plugDirMtime = statSync(join(cacheRoot, 'plug-one')).mtimeMs
  const rootMtime = statSync(cacheRoot).mtimeMs
  cacheWrite('plug-one/agents/cache-two.md', '---\nname: cache-two\ndescription: second card\n---\n\n正文。\n')
  assert.equal(statSync(join(cacheRoot, 'plug-one')).mtimeMs, plugDirMtime,
    'scenario anchor: the plugin directory mtime did NOT move')
  assert.equal(statSync(cacheRoot).mtimeMs, rootMtime,
    'scenario anchor: the root mtime did NOT move either')
  const grown = await cacheCatalog.stateOf(cacheRoot)
  assert.ok(cardOf(grown, 'cache-two') !== undefined, 'the new card is visible with no manual refresh')
}

// Fingerprint change #3: a plugin.json edit.
cacheWrite('plug-one/.codebuddy-plugin/plugin.json',
  JSON.stringify({ name: 'plug-one', displayDescription: { zh: '插件描述 v2' } }))
const manifestState = await cacheCatalog.stateOf(cacheRoot)
assert.equal(cardOf(manifestState, 'cache-one').zhDescription, '插件描述 v2',
  'a plugin.json edit invalidates the cache and the metadata change is visible')

assert.equal(cacheScans, 4, 'one scan per fingerprint move: initial + edit + new file + manifest')

// invalidate() forces a rescan of an unchanged tree (the refresh seam).
cacheCatalog.invalidate()
await cacheCatalog.stateOf(cacheRoot)
assert.equal(cacheScans, 5, 'invalidate() forces a rescan of an unchanged tree')

// Concurrent misses over one (path, fingerprint) share a single in-flight scan.
{
  cacheWrite('plug-one/agents/cache-three.md', '---\nname: cache-three\ndescription: third card\n---\n\n正文。\n')
  let releaseScan
  const scanGate = new Promise((resolve) => { releaseScan = resolve })
  const gatedCatalog = createCatalog(async (rawPath) => {
    cacheScans += 1
    await scanGate
    return scanWorkbuddyRoot(rawPath)
  })
  const shared = Promise.all([gatedCatalog.stateOf(cacheRoot), gatedCatalog.stateOf(cacheRoot)])
  releaseScan()
  const [sharedOne, sharedTwo] = await shared
  assert.equal(sharedOne, sharedTwo, 'both callers receive the same result object (one coalesced scan)')
  assert.ok(cardOf(sharedOne, 'cache-three') !== undefined, 'the coalesced scan is the post-change one')
}

rmSync(cacheRoot, { recursive: true, force: true })

// ── 3. settings mount over fakes ────────────────────────────────────────────

const { SETTINGS_NS, buildSourcePathSchema, mountImporterSettings, namespaceDescriptor } =
  await import(join(root, 'src', 'importer', 'settings.js'))

/** Minimal schemastery stand-in: callable object schema + toJSON. */
function makeFakeZ() {
  return {
    string: () => ({ type: 'string' }),
    object(dict) {
      const schema = (value) => {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new TypeError('expected an object')
        }
        const resolved = {}
        for (const [key, child] of Object.entries(dict)) {
          const raw = value[key]
          if (raw !== undefined) {
            if (child.type === 'string' && typeof raw !== 'string') {
              throw new TypeError(`expected string at ${key}`)
            }
            resolved[key] = raw
          }
        }
        return resolved
      }
      schema.toJSON = () => ({ type: 'object', dict })
      return schema
    },
  }
}

/** Fake settings service mirroring the contract the routes rely on. */
function makeFakeSettings() {
  const registrations = new Map()
  return {
    register(ns, schema, options) {
      if (registrations.has(ns)) throw new Error(`settings namespace "${ns}" is already registered`)
      const reg = {
        ns, schema, base: options?.base, user: undefined, revision: 0, watchers: [],
        resolved: schema({ ...(options?.base ?? {}) }),
      }
      registrations.set(ns, reg)
      return {
        get: () => reg.resolved,
        watch: (callback) => { reg.watchers.push(callback); return () => reg.watchers.splice(reg.watchers.indexOf(callback), 1) },
        update: (patch) => this.update(ns, patch),
      }
    },
    describe: () => [...registrations.values()].map((reg) => ({ ns: reg.ns, value: reg.resolved, revision: reg.revision })),
    get: (ns) => registrations.get(ns)?.resolved,
    async update(ns, patch, expectedRevision) {
      const reg = registrations.get(ns)
      if (reg === undefined) throw new Error(`settings namespace "${ns}" is not registered`)
      if (expectedRevision !== undefined && expectedRevision !== reg.revision) {
        const error = new Error(
          `settings namespace "${ns}" changed since it was read (expected revision ${String(expectedRevision)}, now ${String(reg.revision)})`)
        error.code = 'SETTINGS_CONFLICT'
        error.expected = expectedRevision
        error.actual = reg.revision
        throw error
      }
      const before = reg.user === undefined ? undefined : { ...reg.user }
      const nextUser = { ...(reg.user ?? {}), ...patch }
      const previous = reg.resolved
      reg.resolved = reg.schema({ ...(reg.base ?? {}), ...nextUser })
      reg.user = nextUser
      if (JSON.stringify(before) !== JSON.stringify(nextUser)) reg.revision += 1
      for (const watcher of [...reg.watchers]) watcher(reg.resolved, previous)
    },
  }
}

const fakeZ = makeFakeZ()
const fakeSettings = makeFakeSettings()
const settingsCatalog = createCatalog(async () => ({ experts: [], warnings: [] }))
const offSettings = mountImporterSettings(fakeSettings, fakeZ, settingsCatalog)

assert.equal(SETTINGS_NS, 'workbuddy-expert', 'namespace is workbuddy-expert (decision #8)')
let descriptor = namespaceDescriptor(fakeSettings)
assert.equal(descriptor.value.sourcePath, DEFAULT_SOURCE_PATH, 'base default resolves untouched')
assert.equal(descriptor.revision, 0, 'fresh registration carries revision 0')

// Raw `~` storage + nonexistent path allowed (existence is reported per
// state request, never validated at write time).
await fakeSettings.update(SETTINGS_NS, { sourcePath: '~/kept-raw' })
descriptor = namespaceDescriptor(fakeSettings)
assert.equal(descriptor.value.sourcePath, '~/kept-raw', '~ survives the write round-trip verbatim')
await fakeSettings.update(SETTINGS_NS, { sourcePath: '/definitely/not/here' })
descriptor = namespaceDescriptor(fakeSettings)
assert.equal(descriptor.value.sourcePath, '/definitely/not/here', 'a nonexistent path saves fine')

const schema = buildSourcePathSchema(fakeZ)
assert.equal(typeof schema, 'function' && typeof schema.toJSON, 'function', 'schema is callable and exposes toJSON')

// Watcher: a sourcePath change drops the cache; a same-value update does not.
{
  let watcherScans = 0
  const watcherCatalog = createCatalog(async (rawPath) => { watcherScans += 1; return scanWorkbuddyRoot(rawPath) })
  const watcherSettings = makeFakeSettings()
  const off = mountImporterSettings(watcherSettings, fakeZ, watcherCatalog)
  await watcherSettings.update(SETTINGS_NS, { sourcePath: fixtureRoot })
  await watcherCatalog.stateOf(fixtureRoot)
  assert.equal(watcherScans, 1, 'first request over the fixture scans')
  await watcherCatalog.stateOf(fixtureRoot)
  assert.equal(watcherScans, 1, 'unchanged tree serves from cache')
  await watcherSettings.update(SETTINGS_NS, { sourcePath: fixtureRoot }) // same value
  await watcherCatalog.stateOf(fixtureRoot)
  assert.equal(watcherScans, 1, 'a same-value update does not drop the cache (the watcher path guard)')
  await watcherSettings.update(SETTINGS_NS, { sourcePath: '/definitely/not/here' }) // different value
  await watcherCatalog.stateOf('/definitely/not/here')
  assert.equal(watcherScans, 2, 'a sourcePath change drops the cache — the new path forces its own scan')
  off()
}
offSettings()

// ── 4 + 5. routes over a fake webServer ─────────────────────────────────────

const { mountImporterRoutes } = await import(join(root, 'src', 'importer', 'routes.js'))

/** Capturing stand-in for the injected webServer service. */
function makeFakeServer() {
  const routes = new Map()
  return {
    routes,
    register(route) {
      const key = `${route.kind} ${route.path}`
      if (routes.has(key)) throw new Error(`duplicate route ${key}`)
      routes.set(key, route)
      return () => routes.delete(key)
    },
  }
}

/**
 * Duck-typed ServerResponse capturing status/headers/body. Chunks keep
 * their kind: string chunks feed the `body` text view (JSON payloads),
 * while `buffer` concatenates every chunk's bytes in order — the avatar
 * route's binary bodies are asserted byte-exactly through it.
 */
function makeResponse() {
  const res = { status: null, headers: null, chunks: [], ended: false }
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
  res.end = (chunk) => { if (chunk !== undefined && chunk !== null) res.chunks.push(chunk); res.ended = true }
  Object.defineProperty(res, 'body', {
    get: () => res.chunks.map((chunk) => (typeof chunk === 'string' ? chunk : '')).join(''),
  })
  Object.defineProperty(res, 'buffer', {
    get: () => Buffer.concat(res.chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')))),
  })
  return res
}

/** Duck-typed IncomingMessage; `chunks` is an array of body chunks. */
function makeRequest({ method = 'GET', url = '/', headers = {}, chunks }) {
  const request = { method, url, headers }
  if (chunks !== undefined) {
    request[Symbol.asyncIterator] = async function* () {
      for (const chunk of chunks) yield chunk
    }
  }
  return request
}

const server = makeFakeServer()
const routeSettings = makeFakeSettings()
const routeZ = makeFakeZ()
const routeCatalog = createCatalog()
mountImporterSettings(routeSettings, routeZ, routeCatalog)
const offRoutes = mountImporterRoutes({ webServer: server, settings: routeSettings }, { catalog: routeCatalog })
await routeSettings.update(SETTINGS_NS, { sourcePath: fixtureRoot })

assert.deepEqual([...server.routes.keys()].sort(), [
  'exact /dsh-workbuddy-expert/api/avatar',
  'exact /dsh-workbuddy-expert/api/config',
  'exact /dsh-workbuddy-expert/api/refresh',
  'exact /dsh-workbuddy-expert/api/state',
].sort(), 'exactly the four read-only importer routes under the plugin prefix')

const stateRoute = server.routes.get('exact /dsh-workbuddy-expert/api/state')
const avatarRoute = server.routes.get('exact /dsh-workbuddy-expert/api/avatar')
const configRoute = server.routes.get('exact /dsh-workbuddy-expert/api/config')
const refreshRoute = server.routes.get('exact /dsh-workbuddy-expert/api/refresh')

const sameOriginHeaders = { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' }

// /api/state over the pathology fixture.
{
  const res = makeResponse()
  await stateRoute.handler(makeRequest({ url: '/dsh-workbuddy-expert/api/state' }), res)
  assert.equal(res.status, 200)
  assert.equal(res.headers['cache-control'], 'no-store', 'JSON responses carry no-store')
  const state = JSON.parse(res.body)
  assert.equal(state.sourcePath, fixtureRoot, 'the RAW stored path is echoed')
  assert.equal(state.pathExists, true)
  assert.equal(typeof state.revision, 'number')
  assert.ok(state.warnings.some((warning) => warning.includes('duplicate expert id "dup-expert"')))
  const soloOne = state.experts.find((expert) => expert.id === 'solo-one')
  for (const field of ['id', 'name', 'zhName', 'description', 'zhDescription', 'skills', 'pluginDir', 'teamSize', 'category']) {
    assert.ok(field in soloOne, `state card carries ${field}`)
  }
  assert.equal(soloOne.avatarUrl, '/dsh-workbuddy-expert/api/avatar?id=solo-one')
  assert.equal('avatarPath' in soloOne, false, 'the internal absolute avatarPath never leaks')
  const dup = state.experts.find((expert) => expert.id === 'dup-expert')
  assert.equal('avatarUrl' in dup, false, 'PNG-less experts carry no avatarUrl')
}

// Nonexistent sourcePath → pathExists=false + warning (through /api/config).
{
  const res = makeResponse()
  await configRoute.handler(makeRequest({
    method: 'POST',
    url: '/dsh-workbuddy-expert/api/config',
    headers: sameOriginHeaders,
    chunks: [JSON.stringify({ sourcePath: '/definitely/not/here' })],
  }), res)
  assert.equal(res.status, 200, 'saving a nonexistent path is allowed')
  const state = JSON.parse(res.body)
  assert.equal(state.sourcePath, '/definitely/not/here')
  assert.equal(state.pathExists, false)
  assert.ok(state.warnings.some((warning) => warning === 'source path does not exist: /definitely/not/here'),
    'the nonexistent path carries its own warning')
  assert.deepEqual(state.experts, [], 'the empty scan still answers an empty table')
  // Back to the fixture for the remaining checks.
  const back = makeResponse()
  await configRoute.handler(makeRequest({
    method: 'POST', url: '/dsh-workbuddy-expert/api/config', headers: sameOriginHeaders,
    chunks: [JSON.stringify({ sourcePath: fixtureRoot })],
  }), back)
  assert.equal(back.status, 200)
}

// Method + origin + body-cap rejection on the mutating routes.
{
  let res = makeResponse()
  await refreshRoute.handler(makeRequest({ method: 'GET', url: '/dsh-workbuddy-expert/api/refresh' }), res)
  assert.equal(res.status, 405, 'refresh rejects GET')

  res = makeResponse()
  await refreshRoute.handler(makeRequest({
    method: 'POST', url: '/dsh-workbuddy-expert/api/refresh',
    headers: { origin: 'http://evil.example', host: '127.0.0.1:3080' },
  }), res)
  assert.equal(res.status, 403, 'cross-origin POST rejected')
  res = makeResponse()
  await refreshRoute.handler(makeRequest({ method: 'POST', url: '/dsh-workbuddy-expert/api/refresh', headers: {} }), res)
  assert.equal(res.status, 403, 'a POST without an Origin header is rejected too')

  res = makeResponse()
  await configRoute.handler(makeRequest({
    method: 'POST', url: '/dsh-workbuddy-expert/api/config', headers: sameOriginHeaders,
    chunks: ['x'.repeat(5000)],
  }), res)
  assert.equal(res.status, 400, 'bodies over 4 KiB are rejected')
  assert.ok(JSON.parse(res.body).error.includes('too large'))
}

// /api/refresh forces a rescan of an unchanged tree.
{
  const before = makeResponse()
  await stateRoute.handler(makeRequest({ url: '/dsh-workbuddy-expert/api/state' }), before)
  fixtureWrite('solo-one/agents/solo-four.md', '---\nname: solo-four\ndescription: refresh probe\n---\n\n正文。\n')
  bumpMtime(join(fixtureRoot, 'solo-one', 'agents', 'solo-four.md'))
  const res = makeResponse()
  await refreshRoute.handler(makeRequest({ method: 'POST', url: '/dsh-workbuddy-expert/api/refresh', headers: sameOriginHeaders }), res)
  assert.equal(res.status, 200)
  assert.ok(JSON.parse(res.body).experts.some((expert) => expert.id === 'solo-four'),
    'refresh answers a freshly scanned state')
}

// Avatar route: bytes, headers, 404 matrix, and the `..` escape.
{
  // Byte-exact stream of a declared avatar.
  let res = makeResponse()
  await avatarRoute.handler(makeRequest({ url: '/dsh-workbuddy-expert/api/avatar?id=solo-one' }), res)
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'image/png')
  assert.equal(res.headers['cache-control'], 'max-age=60', 'the avatar route is the one cacheable response')
  assert.equal(res.headers['content-length'], String(FIXTURE_PNG.length))
  assert.ok(res.buffer.equals(FIXTURE_PNG), 'avatar bytes are byte-exact')

  // A team member's own PNG.
  res = makeResponse()
  await avatarRoute.handler(makeRequest({ url: '/dsh-workbuddy-expert/api/avatar?id=team-x-maker' }), res)
  assert.equal(res.status, 200)
  assert.ok(res.buffer.equals(FIXTURE_PNG))

  // Uniform 404s: unknown id, ID_RE rejects, missing id, PNG-less expert.
  const notFoundBodies = new Set()
  for (const url of [
    '/dsh-workbuddy-expert/api/avatar?id=never-scanned',
    '/dsh-workbuddy-expert/api/avatar?id=../outside-assets/escape.png',
    '/dsh-workbuddy-expert/api/avatar?id=',
    '/dsh-workbuddy-expert/api/avatar',
    '/dsh-workbuddy-expert/api/avatar?id=dup-expert',
  ]) {
    res = makeResponse()
    await avatarRoute.handler(makeRequest({ url }), res)
    assert.equal(res.status, 404, `${url} answers 404`)
    notFoundBodies.add(res.body)
  }
  assert.equal(notFoundBodies.size, 1, 'every 404 answers ONE uniform no-detail body')

  // The declared `../outside-assets/escape.png` avatar: the scan kept it,
  // the containment chain must 404 it — while an innocent avatar in the
  // same tree still serves byte-identical bytes.
  res = makeResponse()
  await avatarRoute.handler(makeRequest({ url: '/dsh-workbuddy-expert/api/avatar?id=escape-solo' }), res)
  assert.equal(res.status, 404, 'a declared avatar resolving outside the source root is rejected (path traversal guard)')
  res = makeResponse()
  await avatarRoute.handler(makeRequest({ url: '/dsh-workbuddy-expert/api/avatar?id=solo-two' }), res)
  assert.equal(res.status, 200)
  assert.ok(res.buffer.equals(FIXTURE_PNG), 'the innocent avatar still serves after the escape probe')
}

// Full disposal: every route drops, a second mount registers cleanly.
offRoutes()
assert.equal(server.routes.size, 0, 'disposal removes every importer route')
const offRoutesTwo = mountImporterRoutes({ webServer: server, settings: routeSettings }, { catalog: routeCatalog })
assert.equal(server.routes.size, 4, 'a re-mount after dispose registers idempotently')
offRoutesTwo()

rmSync(fixtureRoot, { recursive: true, force: true })
rmSync(OUTSIDE_DIR, { recursive: true, force: true })

// ── 6. mountImporter end-to-end, only when a real harness resolves ─────────

try {
  const { mountImporter } = await import(join(root, 'src', 'importer', 'index.js'))
  const harnessServer = makeFakeServer()
  const harnessSettings = makeFakeSettings()
  const fakeCtx = {
    webServer: harnessServer,
    settings: harnessSettings,
    get: (name) => (name === 'webServer' ? harnessServer : name === 'settings' ? harnessSettings : undefined),
  }
  const dispose = await mountImporter(fakeCtx)
  assert.equal(harnessSettings.describe()[0]?.ns, 'workbuddy-expert', 'mountImporter registered the settings namespace')
  assert.equal(harnessServer.routes.size, 4, 'mountImporter registered every route through the real catalog')
  dispose()
  assert.equal(harnessServer.routes.size, 0, 'the mountImporter disposer drops every route')
} catch (error) {
  // Outside a dsh host the schemastery resolver cannot resolve — the
  // layered tier list is by design a hard error there. This section
  // reports when a harness is present, it never gates.
  if (!/cannot resolve @deepseek-ai\/schemastery/.test(String(error.message))) throw error
}

console.log('smoke-importer: all checks passed')
