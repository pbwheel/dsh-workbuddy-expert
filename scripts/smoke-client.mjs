/**
 * Offline smoke checks for the ticket-05 client surface — no browser, no
 * live profile, zero dependencies: `node scripts/smoke-client.mjs`.
 *
 *   1. package contract: "./client" export + dsh.client.inject fields
 *      (connection / runtime / locale) + web platform;
 *   2. bundle syntax + module load through a stub __ModuleLoader__ with a
 *      storing React stub: the wrapper shape, single external 'react',
 *      plugin metadata (name/inject), zh/en dictionaries key-aligned;
 *   3. pure derivations: selector ordering (order asc, unordered last, id
 *      tiebreak, broken rows INCLUDED), broken detection, name fallback,
 *      tolerant session-id prop shapes, expertsUrl encoding;
 *   4. component machine (ExpertSelector over the storing React stub and
 *      a scripted fetch): current-expert face off initialData, broken
 *      cards render disabled with their reason, live-session pick →
 *      POST /api/switch {sessionId, expertId} with the control disabled
 *      showing the TARGET expert until the transaction settles (then the
 *      refetch moves the ✓), no-session pick → STAGED draft (no POST),
 *      and the moment a session id appears the /api/after-create
 *      handshake fires EXACTLY ONCE and consumes the draft;
 *   5. apply(): BOTH seat registrations (conversation.input.left selector +
 *      settings.section market page, ticket 08), the two scoped
 *      <style data-plugin> tags (one namespace per feature) injected after
 *      the registrations and removed by the returned disposer (re-apply is
 *      idempotent);
 *   6. selector routes (src/selector-routes.js) over a fake webServer:
 *      GET /api/experts shape (+?sessionId → currentExpertId via
 *      stateOf), POST /api/switch and /api/after-create bodies and
 *      switcher/composeForCreation delegation, missing-agent degradation,
 *      405/403 rejection, the 4 KiB body cap, no-store on every JSON
 *      response, and full disposal;
 *   7. the market page (ticket 08): pure derivations (locale name chains,
 *      category labels/chips with unknown-key fallback, three-way
 *      stackable status × category filters crossed with zh/en search, card
 *      actions per install state, team grouping/fold rules — kept green
 *      while the team UI is display-hidden behind TEAM_UI_ENABLED) and a
 *      component machine over a scripted /api/state fixture — cards with
 *      the installed/updatable/broken overlay, flat grid while the team
 *      UI is hidden,
 *      orphan + unmatched-broken sections, warnings fold, install confirm
 *      pair → cancel reverts / confirm POSTs {id} to /api/install and
 *      adopts the response's inline state, chip filter behavior, and zh
 *      search narrowing.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const root = new URL('..', import.meta.url).pathname

// ── 1. package contract ──────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
assert.equal(pkg.exports['./client'], './client/client.js', 'client bundle exported')
assert.equal(pkg.files.includes('client'), true, 'client directory shipped')
assert.deepEqual(pkg.dsh.client.inject, [
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-settings',
], 'client inject composes connection + the locale service + the conversation slot owner + the settings slot owner')
assert.equal(pkg.dsh.client.platform, 'web', 'client platform declared')
for (const target of [pkg.exports['./client'], pkg.exports['./cordis.patch.yml']]) {
  assert.ok(readFileSync(join(root, target), 'utf8') !== undefined, `exports target exists: ${target}`)
}

// ── 2. bundle syntax + module load through stubs ─────────────────────────────

const bundleSource = readFileSync(join(root, 'client', 'client.js'), 'utf8')
assert.ok(bundleSource.includes('window.__ModuleLoader__.load({ id: "dsh-workbuddy-expert"'),
  'the hand-written module-loader wrapper declares the plugin id')
assert.ok(bundleSource.includes("require('react')"), 'single external: react through the injected require')
assert.ok(!/<[A-Z][A-Za-z]*\s*\/>/.test(bundleSource), 'no JSX in the bundle')

// A storing React stub: hooks that actually persist across re-renders of
// one component instance (the sister smoke's approach).
function makeReactStub() {
  let current = null
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) }
    },
    useState(initial) {
      const inst = current
      const idx = inst.hookIndex++
      if (!(idx in inst.hooks)) inst.hooks[idx] = typeof initial === 'function' ? initial() : initial
      return [inst.hooks[idx], (value) => {
        inst.hooks[idx] = typeof value === 'function' ? value(inst.hooks[idx]) : value
        inst.schedule()
      }]
    },
    useRef(initial) {
      const inst = current
      const idx = inst.hookIndex++
      if (!(idx in inst.hooks)) inst.hooks[idx] = { current: initial }
      return inst.hooks[idx]
    },
    useEffect(fn, deps) {
      const inst = current
      const idx = inst.hookIndex++
      const prev = inst.deps[idx]
      const changed = !Array.isArray(prev) || !Array.isArray(deps)
        || deps.length !== prev.length || deps.some((d, i) => d !== prev[i])
      if (changed) {
        if (typeof inst.cleanups[idx] === 'function') inst.cleanups[idx]()
        inst.deps[idx] = Array.isArray(deps) ? deps.slice() : deps
        const off = fn()
        if (typeof off === 'function') inst.cleanups[idx] = off
      }
    },
    _bind(instance) { current = instance },
  }
  return React
}

const reactStub = makeReactStub()

let bundleDef = null
const sandbox = {
  window: { __ModuleLoader__: { load(def) { bundleDef = def } } },
}
vm.runInNewContext(bundleSource, sandbox, { filename: 'client/client.js' })
assert.ok(bundleDef !== null, 'the loader captured the module definition')
assert.equal(bundleDef.id, 'dsh-workbuddy-expert', 'module id matches the plugin name')

const mod = bundleDef.factory((name) => {
  assert.equal(name, 'react', 'the only external ever required is react')
  return reactStub
})
assert.equal(mod.name, 'dsh-workbuddy-expert')
assert.deepEqual([...mod.inject], ['slots', 'locale'])

const zhKeys = Object.keys(mod.DICTS.zh).sort()
assert.deepEqual(Object.keys(mod.DICTS.en).sort(), zhKeys, 'zh/en dictionaries stay key-aligned')
assert.equal(typeof mod.apply, 'function')

// A real interpolating zh translator for the component checks below.
const zhDict = mod.DICTS.zh
const t = (key, params) => (zhDict[key] ?? key).replace(/\{(\w+)\}/g, (whole, name2) =>
  params && params[name2] !== undefined ? String(params[name2]) : whole)

// ── 3. pure derivations ──────────────────────────────────────────────────────

assert.deepEqual(mod.sortExpertCards([
  { id: 'b-brk', order: 0, broken: 'expert.yml missing' },
  { id: 'beta', order: 20 },
  { id: 'alpha', order: 10 },
  { id: 'zzz' },
  { id: 'aaa' },
]).map((card) => card.id), ['b-brk', 'alpha', 'beta', 'aaa', 'zzz'],
'order asc with unordered cards last, id tiebreak, broken rows INCLUDED')

assert.equal(mod.isBrokenCard({ id: 'x', broken: 'reason' }), true)
assert.equal(mod.isBrokenCard({ id: 'x', broken: '' }), false)
assert.equal(mod.isBrokenCard({ id: 'x' }), false)
assert.equal(mod.isBrokenCard(null), false)

assert.equal(mod.nameOf({ id: 'e', displayName: '剪辑' }), '剪辑')
assert.equal(mod.nameOf({ id: 'e' }), 'e')
assert.equal(mod.nameOf(null), '')

assert.equal(mod.sessionIdOf({}), '', 'no props → no session')
assert.equal(mod.sessionIdOf({ sessionId: 's1' }), 's1')
assert.equal(mod.sessionIdOf({ session: { id: 's2' } }), 's2')
assert.equal(mod.sessionIdOf({ session: { sessionId: 's3' } }), 's3')
assert.equal(mod.sessionIdOf({ sessionId: '  ' }), '', 'blank sessionId is no session')

assert.equal(mod.expertsUrl(''), '/dsh-workbuddy-expert/api/experts')
assert.equal(mod.expertsUrl('s 1'), '/dsh-workbuddy-expert/api/experts?sessionId=s%201',
  'the session id is URL-encoded')

// ── 4. the component machine ─────────────────────────────────────────────────

/**
 * A scripted fetch: exact (method, url) matches resolve with their queued
 * body; anything else throws (so an unexpected call fails the test).
 */
function makeFetchScript(scripts) {
  const calls = []
  const fetchStub = (url, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: init.body })
    const hit = scripts.find((entry) => entry.method === method && entry.url === url)
    if (hit === undefined) return Promise.reject(new Error(`unexpected fetch ${method} ${url}`))
    return Promise.resolve({ ok: true, json: () => Promise.resolve(hit.body) })
  }
  return { fetchStub, calls }
}

/**
 * Render one component instance whose hooks persist; rerun() re-renders
 * synchronously, setProps() merges and re-renders. Effects run after each
 * render body (the stub's _bind dance below mirrors React's ordering
 * closely enough for these flows).
 */
function renderComponent(Component, initialProps) {
  const instance = {
    hookIndex: 0, hooks: {}, deps: {}, cleanups: {},
    props: initialProps, tree: null, scheduled: false,
    schedule() { if (!instance.scheduled) { instance.scheduled = true; queueMicrotask(() => { instance.scheduled = false; rerender() }) } },
  }
  function rerender() {
    instance.hookIndex = 0
    reactStub._bind(instance)
    instance.tree = Component(instance.props)
    reactStub._bind(null)
  }
  rerender()
  return {
    tree: () => instance.tree,
    setProps(patch) { instance.props = { ...instance.props, ...patch }; rerender() },
    rerender,
    instance,
  }
}

/** Depth-first walk collecting nodes matching a predicate. */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const child of node) findAll(child, predicate, out); return out }
  if (predicate(node)) out.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, out)
  return out
}

/** Concatenated text content of a stub element node. */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') return (node.children ?? []).map(textOf).join('')
  return ''
}

/**
 * One-shot expansion of component-typed nodes: the storing React stub keeps
 * `el(Component, props)` children as references, so the market checks render
 * them through a fresh throwaway hook context (AvatarFace's useState is the
 * only hook below MarketPage itself, and the smoke never fires its setter).
 */
function expandTree(node) {
  if (node === null || node === undefined) return []
  if (Array.isArray(node)) return node.flatMap(expandTree)
  if (typeof node !== 'object') return [node]
  if (typeof node.type === 'function') {
    const inst = { hookIndex: 0, hooks: {}, deps: {}, cleanups: {}, props: node.props, schedule() {} }
    reactStub._bind(inst)
    let out
    try { out = node.type(node.props) } finally { reactStub._bind(null) }
    return expandTree(out)
  }
  const children = (node.children ?? []).flatMap(expandTree)
  return [{ ...node, children }]
}

const TABLE = {
  experts: [
    { id: 'editor', displayName: '剪辑师', description: '负责剪辑', order: 10 },
    { id: 'writer', displayName: '撰稿人', description: '负责文字', order: 20 },
    { id: 'broken-one', displayName: '坏专家', order: 0, broken: 'expert.yml missing' },
  ],
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// 4a. Live session: current face, broken disabled, pick → switch flow.
{
  const script = makeFetchScript([
    { method: 'GET', url: '/dsh-workbuddy-expert/api/experts?sessionId=sess-1',
      // Post-switch refetches answer with the NEW current expert (what the
      // live host's stateOf would report once the transaction committed).
      body: { ...TABLE, sessionId: 'sess-1', currentExpertId: 'writer' } },
    { method: 'POST', url: '/dsh-workbuddy-expert/api/switch',
      body: { kind: 'success', text: 'ok' } },
  ])
  sandbox.fetch = script.fetchStub
  const view = renderComponent(mod.ExpertSelector, {
    t, sessionId: 'sess-1', initialData: { ...TABLE, currentExpertId: 'editor' },
  })

  const buttonOf = (tree) => tree.children.find((child) => child?.type === 'button' && child.props.className === 'wbe-btn')
  const labelOf = (button) => button.children.find((child) => child?.props?.className === 'wbe-btn-label').children.join('')
  let button = buttonOf(view.tree())
  assert.equal(button.props.disabled, false, 'idle control is enabled')
  assert.equal(labelOf(button), '剪辑师', 'the face shows the CURRENT expert name')

  // Open the popover: three cards in selector order, broken first.
  button.props.onClick()
  view.rerender()
  const items = findAll(view.tree(), (node) => node.type === 'button' && node.props.className === 'wbe-item')
  // Row shape: [AvatarFace, wbe-item-main] — the avatar leads every row,
  // the text column nests one level deeper than it used to.
  const mainOf = (item) => item.children.find((child) => child?.props?.className === 'wbe-item-main')
  assert.ok(items.every((item) => item.children[0]?.type === mod.AvatarFace), 'each row leads with the avatar face')
  assert.deepEqual(items.map((item) => mainOf(item).children[0].children[1].children[0]),
    ['broken-one', 'editor', 'writer'], 'cards render in (order, id) with broken rows listed')
  assert.equal(items[0].props.disabled, true, 'the broken card is not pickable')
  assert.ok(String(findAll(items[0], (n) => n?.props?.className === 'wbe-item-broken')[0]?.children ?? []).includes('不可用'),
    'the broken badge carries the localized stamp')
  assert.ok(String(findAll(items[0], (n) => n?.props?.className === 'wbe-item-reason')[0]?.children[0] ?? []).includes('expert.yml missing'),
    'the broken reason rides the row')
  const editorRow = items[1]
  assert.ok(mainOf(editorRow).children[0].children.some((c) => c?.props?.className === 'wbe-current-mark'),
    'the current expert is marked')

  // Pick the writer: busy state (disabled + target name) until settle.
  const pickWriter = items[2]
  pickWriter.props.onClick()
  view.rerender()
  button = buttonOf(view.tree())
  assert.equal(button.props.disabled, true, 'switching disables the control')
  assert.equal(button.props['aria-busy'], 'true')
  assert.equal(labelOf(button), '切换到 撰稿人…', 'the control shows the TARGET expert while switching')

  await flush()
  view.rerender()
  button = buttonOf(view.tree())
  assert.equal(button.props.disabled, false, 'the control re-enables once the transaction settles')
  assert.equal(labelOf(button), '撰稿人', 'the refetched currentExpertId moves the face')
  assert.deepEqual(script.calls.find((call) => call.method === 'POST')?.body,
    JSON.stringify({ sessionId: 'sess-1', expertId: 'writer' }), 'the switch POST body')
  assert.ok(script.calls.filter((call) => call.method === 'GET').length >= 2,
    'the table refetches after the switch')
  delete sandbox.fetch
}

// 4b. No session: the pick is a STAGED draft; the session id appearing
// fires /api/after-create exactly once and consumes the draft.
{
  const script = makeFetchScript([
    { method: 'GET', url: '/dsh-workbuddy-expert/api/experts', body: { ...TABLE } },
    { method: 'GET', url: '/dsh-workbuddy-expert/api/experts?sessionId=fresh-1',
      body: { ...TABLE, sessionId: 'fresh-1', currentExpertId: 'editor' } },
    { method: 'POST', url: '/dsh-workbuddy-expert/api/after-create',
      body: { kind: 'success', text: 'ok' } },
  ])
  sandbox.fetch = script.fetchStub
  const view = renderComponent(mod.ExpertSelector, { t, initialData: { ...TABLE } })

  const buttonOf = (tree) => tree.children.find((child) => child?.type === 'button' && child.props.className === 'wbe-btn')
  const labelOf = (button) => button.children.find((child) => child?.props?.className === 'wbe-btn-label').children.join('')
  let button = buttonOf(view.tree())
  assert.equal(labelOf(button), '专家', 'no session, no pick → the bare label')
  button.props.onClick()
  view.rerender()
  const items = findAll(view.tree(), (node) => node.type === 'button' && node.props.className === 'wbe-item')
  items.find((item) => item.children.find((c) => c?.props?.className === 'wbe-item-main')?.children[0].children[1].children[0] === 'writer').props.onClick()
  view.rerender()
  button = buttonOf(view.tree())
  assert.equal(labelOf(button), '创建后启用 撰稿人', 'the staged pick renames the control')
  assert.equal(button.props['data-staged'], 'true')
  assert.equal(script.calls.filter((call) => call.method === 'POST').length, 0,
    'staging alone fires NO request — the draft is frontend-only')

  // The session id appears: the handshake fires once and consumes the draft.
  view.setProps({ sessionId: 'fresh-1' })
  view.rerender()
  view.rerender() // a second render pass must not fire a second POST
  await flush()
  view.rerender()
  const afterCalls = script.calls.filter((call) => call.url.endsWith('/api/after-create'))
  assert.equal(afterCalls.length, 1, 'after-create fires EXACTLY once per staged draft')
  assert.deepEqual(afterCalls[0].body, JSON.stringify({ sessionId: 'fresh-1', expertId: 'writer' }))
  button = buttonOf(view.tree())
  assert.equal(button.props['data-staged'], undefined, 'the draft is consumed')
  delete sandbox.fetch
}

// ── 4c. the market page (ticket 08): pure derivations ───────────────────────

assert.equal(mod.localeNameOf({ id: 'x', name: 'Coder', zhName: '程序员' }, 'zh'), '程序员')
assert.equal(mod.localeNameOf({ id: 'x', name: 'Coder', zhName: '程序员' }, 'en'), 'Coder')
assert.equal(mod.localeNameOf({ id: 'x', name: 'Coder' }, 'zh'), 'Coder', 'zh falls back to the base name')
assert.equal(mod.localeNameOf({ id: 'x' }, 'en'), 'x', 'the id is the terminal name fallback')

assert.equal(mod.categoryLabelOf('02-Engineering', 'zh'), '工程开发')
assert.equal(mod.categoryLabelOf('02-Engineering', 'en'), 'Engineering')
assert.equal(mod.categoryLabelOf('99-Future', 'zh'), 'Future', 'unknown keys degrade to the prefix-stripped raw id')
assert.equal(mod.categoryLabelOf('', 'zh'), '')

assert.deepEqual([...mod.categoryChipsOf([
  { id: 'a', category: '04-DataAI' },
  { id: 'b', category: '02-Engineering' },
  { id: 'c', category: '04-DataAI' },
  { id: 'd' },
]).map((chip) => `${chip.id}:${chip.count}`)],
['02-Engineering:1', '04-DataAI:2', `${mod.NO_CATEGORY}:1`],
'category chips: raw ids name-sorted with live counts, uncategorized last')

// Three-way stackable filters: status chip × category chip × search.
const MARKET_TABLE = [
  { id: 'solo-a', name: 'Solo A', zhName: '独甲', description: 'does a', pluginDir: 'plug-a', skills: [], teamSize: 1, category: '02-Engineering', installed: false },
  { id: 'team-1', name: 'Member One', zhName: '成员一', description: 'first member', pluginDir: 'plug-team', skills: ['cut'], teamSize: 3, category: '04-DataAI', installed: true, updatable: true },
  { id: 'team-2', name: 'Member Two', zhName: '成员二', description: 'second member', pluginDir: 'plug-team', skills: [], teamSize: 3, category: '04-DataAI', installed: true },
  { id: 'corrupt-one', name: 'Corrupt', zhName: '坏档', description: 'corrupt export', pluginDir: 'plug-c', skills: [], teamSize: 1, installed: true, broken: true },
]
assert.deepEqual([...mod.filterExperts(MARKET_TABLE, 'all', '', 'all').map((e) => e.id)],
  ['solo-a', 'team-1', 'team-2', 'corrupt-one'], 'all keeps everything')
assert.deepEqual([...mod.filterExperts(MARKET_TABLE, 'installed', '', 'all').map((e) => e.id)],
  ['team-1', 'team-2', 'corrupt-one'], 'status chip: installed only')
assert.deepEqual([...mod.filterExperts(MARKET_TABLE, 'updatable', '', 'all').map((e) => e.id)],
  ['team-1'], 'status chip: updatable only')
assert.deepEqual([...mod.filterExperts(MARKET_TABLE, 'all', '', '04-DataAI').map((e) => e.id)],
  ['team-1', 'team-2'], 'category chip narrows independently')
assert.deepEqual([...mod.filterExperts(MARKET_TABLE, 'installed', '', '04-DataAI').map((e) => e.id)],
  ['team-1', 'team-2'], 'status × category stack')
assert.deepEqual([...mod.filterExperts(MARKET_TABLE, 'installed', '成员', 'all').map((e) => e.id)],
  ['team-1', 'team-2'], 'status × zh search stack (zh query hits zhName)')
assert.deepEqual([...mod.filterExperts(MARKET_TABLE, 'all', 'member one', 'all').map((e) => e.id)],
  ['team-1'], 'en query hits the base name field')
assert.deepEqual([...mod.filterExperts(MARKET_TABLE, 'all', '工程', 'all').map((e) => e.id)],
  ['solo-a'], 'the category\'s localized label is searchable too')

// Card actions per state: broken → uninstall only (卸载重装 fix).
assert.deepEqual([...mod.cardActionsOf({ installed: false })], ['install'])
assert.deepEqual([...mod.cardActionsOf({ installed: true })], ['uninstall'])
assert.deepEqual([...mod.cardActionsOf({ installed: true, updatable: true })], ['update', 'uninstall'])
assert.deepEqual([...mod.cardActionsOf({ installed: true, broken: true })], ['uninstall'])

assert.deepEqual([...mod.groupCardsByPlugin(MARKET_TABLE).map((group) => [group.pluginDir, group.team])],
  [['plug-a', false], ['plug-team', true], ['plug-c', false]], 'team grouping by source plugin')
assert.equal(mod.groupExpanded({}, 'plug-team', true), true, 'default: expanded under an active filter')
assert.equal(mod.groupExpanded({}, 'plug-team', false), false, 'default: collapsed on the plain browse')
assert.equal(mod.groupExpanded({ 'plug-team': false }, 'plug-team', true), false, 'an explicit fold wins over the default')
const groupStats = mod.groupStatsOf([{ installed: true }, { updatable: true }, { installed: true, updatable: true }, {}])
assert.equal(groupStats.installed, 2)
assert.equal(groupStats.updatable, 2)
assert.equal(groupStats.broken, 0)

// ── 4d. the market page component machine over a scripted /api/state ────────

// The vm realm has no host timers; inert stubs satisfy the confirm/notice
// auto-revert effects without firing anything.
sandbox.setTimeout = () => 0
sandbox.clearTimeout = () => {}

const MARKET_STATE = {
  sourcePath: '~/wb/plugins',
  pathExists: true,
  revision: 7,
  experts: MARKET_TABLE.map(({ broken, ...card }) => card), // broken is client-merged
  installed: [
    { id: 'team-1', dir: '/x/team-1', sourcePath: '~/wb/plugins', pluginDir: 'plug-team', fingerprint: 'f1', importedAt: '2026-01-02T03:04:05Z', updatable: true },
    { id: 'team-2', dir: '/x/team-2', sourcePath: '~/wb/plugins', pluginDir: 'plug-team', fingerprint: 'f2', importedAt: '2026-01-02T03:04:05Z', updatable: false },
    { id: 'corrupt-one', dir: '/x/corrupt-one', sourcePath: '~/wb/plugins', pluginDir: 'plug-c', fingerprint: 'f3', importedAt: '2026-01-02T03:04:05Z', updatable: false },
  ],
  broken: [
    { id: 'corrupt-one', dir: '/x/corrupt-one', reason: '清单缺失，请卸载重装' },
    { id: 'gone-broken', dir: '/x/gone-broken', reason: '清单缺失，请卸载重装' },
  ],
  orphans: [
    { id: 'old-expert', dir: '/x/old-expert', sourcePath: '~/other-source', pluginDir: 'old-plug', importedAt: '2025-12-31T23:59:59Z' },
  ],
  warnings: ['duplicate expert id "x" skipped', 'source path does not exist: ~/nope'],
}

{
  // The POST /api/install answer carries the fresh state inline (engine
  // shape) with solo-a newly installed — no follow-up refetch needed.
  const afterInstall = {
    ...MARKET_STATE,
    revision: 8,
    experts: MARKET_STATE.experts.map((e) => (e.id === 'solo-a' ? { ...e, installed: true, updatable: false } : e)),
    installed: [...MARKET_STATE.installed, { id: 'solo-a', dir: '/x/solo-a', fingerprint: 'f9', importedAt: '2026-02-01T00:00:00Z', updatable: false }],
  }
  const script = makeFetchScript([
    { method: 'POST', url: '/dsh-workbuddy-expert/api/install', body: { id: 'solo-a', changed: true, state: afterInstall } },
  ])
  sandbox.fetch = script.fetchStub
  const view = renderComponent(mod.MarketPage, {
    t, getLocale: () => 'zh', initialState: MARKET_STATE,
  })
  // The expanded tree: component-typed children (cards, rows, group headers)
  // rendered one-shot so host-element queries can see them.
  const page = () => expandTree(view.tree())[0]

  const cardNodes = () => findAll(page(), (n) => n.type === 'li' && n.props.className === 'wbx-card')
  const chipByText = (text) => findAll(page(),
    (n) => n.type === 'button' && n.props.className === 'wbx-chip' && textOf(n).startsWith(text))[0]
  const cardButtons = (card) => findAll(card,
    (n) => n.type === 'button' && n.props.className === 'wbx-btn').filter((b) => textOf(b) !== t('cancel'))

  // Grid: with TEAM_UI_ENABLED=false every expert renders as a flat solo
  // card — no collapsible group header, no team badge.
  let cards = cardNodes()
  assert.deepEqual(cards.map((card) => card.props['data-installed'] === 'true'), [false, true, true, true],
    'cards render with the installed flag; team members shown flat while the team UI is hidden')
  assert.ok(findAll(page(), (n) => n.type === 'button' && n.props.className === 'wbx-group-head').length === 0,
    'no collapsible group header while the team UI is hidden')
  assert.ok(!chipByText(t('filterTeam')), 'the team filter chip is hidden from the toolbar')

  // corrupt-one merged the broken flag: ⚠ mark + uninstall-only actions.
  const corrupt = cards.find((card) => findAll(card, (n) => n.type === 'span' && n.props.className === 'wbx-id')[0].children[0] === 'corrupt-one')
  assert.equal(corrupt.props['data-broken'], 'true')
  assert.ok(findAll(corrupt, (n) => n?.props?.['data-kind'] === 'bad').length >= 1, 'the ⚠ broken mark rides the card')
  assert.deepEqual(cardButtons(corrupt).map((b) => textOf(b)), ['卸载'], 'broken export → uninstall only')

  // Orphans + broken sections render with their provenance.
  const orphanRows = findAll(page(), (n) => n.type === 'li' && n.props.className === 'wbx-orphan')
  assert.equal(orphanRows.length, 2, 'one orphan row + one unmatched broken row')
  assert.ok(String(findAll(orphanRows[1], (n) => n?.props?.className === 'wbx-orphan-meta')[0]?.children[0]).includes('~/other-source'),
    'the orphan row carries its source provenance')
  assert.ok(String(findAll(orphanRows[0], (n) => n?.props?.className === 'wbx-orphan-meta')[0]?.children[0]).includes('清单缺失'),
    'the unmatched broken row carries the host reason')

  // Warnings fold: collapsed by default, expands on click.
  const warnToggle = findAll(page(), (n) => n.type === 'button' && n.props.className === 'wbx-warns-toggle')[0]
  assert.equal(warnToggle.props['aria-expanded'], 'false')
  assert.equal(findAll(page(), (n) => n.type === 'ul' && n.props.className === 'wbx-warns-list').length, 0)
  warnToggle.props.onClick()
  view.rerender()
  assert.equal(findAll(page(), (n) => n.type === 'ul' && n.props.className === 'wbx-warns-list').length, 1,
    'the warnings list expands')

  // Install: confirm pair appears, cancel reverts, confirm POSTs {id}.
  const solo = cards.find((card) => findAll(card, (n) => n.type === 'span' && n.props.className === 'wbx-id')[0].children[0] === 'solo-a')
  const installBtn = cardButtons(solo).find((b) => textOf(b) === '安装')
  installBtn.props.onClick()
  view.rerender()
  let confirm = findAll(page(), (n) => n.type === 'button' && textOf(n) === t('confirmInstall'))[0]
  assert.ok(confirm !== undefined, 'the install swaps in its inline confirmation')
  findAll(page(), (n) => n.type === 'button' && textOf(n) === t('cancel'))[0].props.onClick()
  view.rerender()
  assert.equal(findAll(page(), (n) => n.type === 'button' && textOf(n) === t('confirmInstall')).length, 0,
    'cancel reverts the confirmation')
  cardButtons(solo).find((b) => textOf(b) === '安装').props.onClick()
  view.rerender()
  confirm = findAll(page(), (n) => n.type === 'button' && textOf(n) === t('confirmInstall'))[0]
  confirm.props.onClick()
  await flush()
  view.rerender()
  assert.equal(script.calls.length, 1, 'exactly one POST fired (state adopted from the response)')
  assert.deepEqual(script.calls[0], {
    method: 'POST', url: '/dsh-workbuddy-expert/api/install', body: JSON.stringify({ id: 'solo-a' }),
  }, 'the confirm POSTs the expert id to /api/install')
  cards = cardNodes()
  const soloAfter = cards.find((card) => findAll(card, (n) => n.type === 'span' && n.props.className === 'wbx-id')[0].children[0] === 'solo-a')
  assert.equal(soloAfter.props['data-installed'], 'true', 'the card flips ✓ within the adopted state')
  assert.deepEqual(cardButtons(soloAfter).map((b) => textOf(b)), ['卸载'])

  // Chip filters: 已装 narrows to the installed cards; the category chip
  // stacks on top; 清除筛选 restores.
  chipByText(t('filterInstalled')).props.onClick()
  view.rerender()
  assert.deepEqual(cardNodes().map((card) => findAll(card, (n) => n?.props?.className === 'wbx-id')[0].children[0]),
    ['solo-a', 'team-1', 'team-2', 'corrupt-one'],
    'the installed chip filters the grid (team members stay flat)')
  const dataChip = chipByText(mod.categoryLabelOf('04-DataAI', 'zh'))
  dataChip.props.onClick()
  view.rerender()
  assert.deepEqual(cardNodes().map((card) => findAll(card, (n) => n?.props?.className === 'wbx-id')[0].children[0]),
    ['team-1', 'team-2'], 'status × category stacks')
  chipByText(t('filterAll')).props.onClick()
  chipByText(t('categoryAll')).props.onClick()
  view.rerender()
  assert.equal(cardNodes().length, 4, 'resetting both chips restores the plain browse (all cards flat)')

  // Search: a zh query narrows the grid through the same lane.
  const search = findAll(page(), (n) => n.type === 'input' && n.props.className === 'wbx-search')[0]
  search.props.onChange({ target: { value: '成员一' } })
  view.rerender()
  assert.deepEqual(cardNodes().map((card) => findAll(card, (n) => n?.props?.className === 'wbx-id')[0].children[0]),
    ['team-1'], 'the zh query matches the zhName field')
  delete sandbox.fetch
}

delete sandbox.setTimeout
delete sandbox.clearTimeout


function makeDocumentStub() {
  const tags = []
  return {
    tags,
    head: { appendChild(tag) { tags.push(tag) } },
    createElement() {
      const tag = {
        dataset: {},
        textContent: '',
        remove() { const i = tags.indexOf(tag); if (i >= 0) tags.splice(i, 1) },
      }
      return tag
    },
    querySelector(selector) {
      const match = /^style\[data-plugin-css="(.*)"\]$/.exec(selector)
      return match === null ? null : tags.find((tag) => tag.dataset.pluginCss === match[1]) ?? null
    },
    addEventListener() {},
    removeEventListener() {},
  }
}

{
  const document = makeDocumentStub()
  // The bundle runs in the vm realm: its `document` resolves against the
  // sandbox, so the stub is installed there.
  sandbox.document = document
  const seatSetups = new Map()
  const renderedBySeat = new Map()
  const slots = {
    inject(seat, setup) {
      assert.ok(['conversation.input.left', 'settings.section'].includes(seat),
        `known seat: ${seat}`)
      seatSetups.set(seat, setup)
      const off = setup() // the runtime runs the setup at inject time
      return () => { seatSetups.delete(seat); if (typeof off === 'function') off() }
    },
    register(definition, render) {
      assert.equal(definition.name, seatSetups.has('settings.section') && definition.id === 'workbuddy-expert' && definition.name === 'settings.section'
        ? 'settings.section' : definition.name)
      renderedBySeat.set(definition.name, render)
      return () => renderedBySeat.delete(definition.name)
    },
  }
  const ctx = { slots, logger: { warn: (message) => { throw new Error(message) } } }
  const dispose = mod.apply(ctx)
  assert.equal(typeof seatSetups.get('conversation.input.left') === 'function' &&
    typeof renderedBySeat.get('conversation.input.left') === 'function', true,
    'inject ran the setup and the composer seat registered')
  assert.equal(typeof seatSetups.get('settings.section') === 'function' &&
    typeof renderedBySeat.get('settings.section') === 'function', true,
    'the settings.section seat registered (ticket 08)')

  // One style tag per feature namespace: .wbe- selector + .wbx- market.
  assert.equal(document.tags.length, 2, 'both scoped style tags are injected')
  assert.ok(document.tags.every((tag) => tag.dataset.plugin === 'dsh-workbuddy-expert'))
  assert.ok(document.tags.some((tag) => tag.textContent.includes('.wbe-btn')), 'the selector CSS rides one tag')
  assert.ok(document.tags.some((tag) => tag.textContent.includes('.wbx-chip')), 'the market CSS rides the other tag')

  const tree = renderedBySeat.get('conversation.input.left')({ session: { id: 's' } })
  assert.equal(tree.type, mod.ExpertSelector, 'the composer seat renders the selector component')
  assert.equal(tree.props.session.id, 's')

  const page = renderedBySeat.get('settings.section')()
  assert.equal(page.type, mod.MarketPage, 'the settings seat renders the market page')

  dispose()
  assert.equal(document.tags.length, 0, 'the disposer removes both style tags')
  assert.equal(renderedBySeat.size, 0, 'the disposer drops every slot registration')

  // Re-apply after dispose is idempotent (fresh tags, fresh registrations).
  const dispose2 = mod.apply(ctx)
  assert.equal(document.tags.length, 2)
  dispose2()
  assert.equal(document.tags.length, 0)
  delete sandbox.document
}

// ── 6. selector routes over a fake webServer ─────────────────────────────────

const { mountSelectorRoutes } = await import(join(root, 'src', 'selector-routes.js'))

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

function makeResponse() {
  const res = { status: null, headers: null, chunks: [], ended: false }
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
  res.end = (chunk) => { if (chunk !== undefined && chunk !== null) res.chunks.push(chunk); res.ended = true }
  Object.defineProperty(res, 'body', {
    get: () => res.chunks.map((chunk) => (typeof chunk === 'string' ? chunk : '')).join(''),
  })
  return res
}

function makeRequest({ method = 'GET', url = '/', headers = {}, chunks } = {}) {
  const request = { method, url, headers }
  if (chunks !== undefined) {
    // Symbol.asyncIterator must be a METHOD (for-await calls it to obtain
    // the iterator), so hand it a function returning the async generator.
    request[Symbol.asyncIterator] = () => (async function* () { for (const chunk of chunks) yield chunk })()
  }
  return request
}

const SAME_ORIGIN = { origin: 'http://x.invalid', host: 'x.invalid' }

{
  const experts = [{ id: 'editor', displayName: '剪辑师', order: 10 }, { id: 'bad', broken: 'role.md missing' }]
  const registry = { list: async () => ({ experts, warnings: ['w1'] }) }
  const switchCalls = []
  const composeCalls = []
  const agent = { id: 'sess-1' }
  const switcher = {
    switch: async (a, expertId) => { switchCalls.push([a.id, expertId]); return { kind: 'success', text: 'ok' } },
    stateOf: (sessionId) => (sessionId === 'sess-1' ? { id: 'editor' } : undefined),
    composeForCreation: async (a, expertId) => { composeCalls.push([a.id, expertId]); return { kind: 'success', text: 'ok' } },
  }
  let resolveAgentCalls = 0
  const resolveAgent = (sessionId) => { resolveAgentCalls += 1; return sessionId === 'gone' ? undefined : { id: sessionId } }

  const server = makeFakeServer()
  const dispose = mountSelectorRoutes({ webServer: server }, { registry, switcher, resolveAgent })
  assert.deepEqual([...server.routes.keys()].sort(), [
    'exact /dsh-workbuddy-expert/api/after-create',
    'exact /dsh-workbuddy-expert/api/expert-avatar',
    'exact /dsh-workbuddy-expert/api/experts',
    'exact /dsh-workbuddy-expert/api/switch',
  ], 'exactly the four selector routes registered')

  const route = (path) => server.routes.get(`exact ${path}`).handler

  // GET without sessionId: full table incl. broken rows, no current.
  {
    const res = makeResponse()
    await route('/dsh-workbuddy-expert/api/experts')(makeRequest({ url: '/dsh-workbuddy-expert/api/experts' }), res)
    assert.equal(res.status, 200)
    assert.equal(res.headers['cache-control'], 'no-store', 'no-store on the JSON GET')
    const body = JSON.parse(res.body)
    assert.deepEqual(body.experts, experts, 'broken rows ride the table')
    assert.deepEqual(body.warnings, ['w1'])
    assert.equal(body.currentExpertId, undefined, 'no sessionId → no current field')
  }

  // GET with sessionId: stateOf-backed currentExpertId (null when unknown).
  {
    const res = makeResponse()
    await route('/dsh-workbuddy-expert/api/experts')(
      makeRequest({ url: '/dsh-workbuddy-expert/api/experts?sessionId=sess-1' }), res)
    assert.equal(JSON.parse(res.body).currentExpertId, 'editor')
    const res2 = makeResponse()
    await route('/dsh-workbuddy-expert/api/experts')(
      makeRequest({ url: '/dsh-workbuddy-expert/api/experts?sessionId=other' }), res2)
    assert.equal(JSON.parse(res2.body).currentExpertId, null, 'unknown session → null, not undefined')
  }

  // POST /api/switch: delegation + same-origin guard + body validation.
  {
    const res = makeResponse()
    await route('/dsh-workbuddy-expert/api/switch')(
      makeRequest({ method: 'POST', headers: SAME_ORIGIN, chunks: [JSON.stringify({ sessionId: 'sess-1', expertId: 'editor' })] }), res)
    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body), { kind: 'success', text: 'ok' })
    assert.deepEqual(switchCalls, [['sess-1', 'editor']], 'the switcher received the resolved agent')
    assert.equal(resolveAgentCalls, 1)
  }
  {
    const res = makeResponse()
    await route('/dsh-workbuddy-expert/api/switch')(makeRequest({ method: 'GET' }), res)
    assert.equal(res.status, 405, 'non-POST rejected')
    const res2 = makeResponse()
    await route('/dsh-workbuddy-expert/api/switch')(
      makeRequest({ method: 'POST', headers: { origin: 'http://evil.invalid', host: 'x.invalid' }, chunks: ['{}'] }), res2)
    assert.equal(res2.status, 403, 'cross-origin POST rejected')
    const res3 = makeResponse()
    await route('/dsh-workbuddy-expert/api/switch')(
      makeRequest({ method: 'POST', headers: SAME_ORIGIN, chunks: [JSON.stringify({ sessionId: 'sess-1' })] }), res3)
    assert.equal(res3.status, 400, 'missing expertId rejected')
    const res4 = makeResponse()
    await route('/dsh-workbuddy-expert/api/switch')(
      makeRequest({ method: 'POST', headers: SAME_ORIGIN, chunks: ['x'.repeat(5000)] }), res4)
    assert.equal(res4.status, 400, 'bodies over 4 KiB rejected')
  }

  // POST /api/after-create: composeForCreation on the just-created agent.
  {
    const res = makeResponse()
    await route('/dsh-workbuddy-expert/api/after-create')(
      makeRequest({ method: 'POST', headers: SAME_ORIGIN, chunks: [JSON.stringify({ sessionId: 'fresh', expertId: 'editor' })] }), res)
    assert.equal(res.status, 200)
    assert.deepEqual(composeCalls, [['fresh', 'editor']], 'after-create delegates to composeForCreation')
  }

  // Unresolvable agent: a clean domain error, never a crash.
  {
    const res = makeResponse()
    await route('/dsh-workbuddy-expert/api/switch')(
      makeRequest({ method: 'POST', headers: SAME_ORIGIN, chunks: [JSON.stringify({ sessionId: 'gone', expertId: 'editor' })] }), res)
    assert.equal(res.status, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.kind, 'error')
    assert.ok(body.text.includes('no live agent'))
  }

  // Domain error from the switcher stays HTTP 200 (transport succeeded).
  {
    const failing = { ...switcher, switch: async () => ({ kind: 'error', text: '无此可用专家' }) }
    const server2 = makeFakeServer()
    mountSelectorRoutes({ webServer: server2 }, { registry, switcher: failing, resolveAgent })
    const res = makeResponse()
    await server2.routes.get('exact /dsh-workbuddy-expert/api/switch').handler(
      makeRequest({ method: 'POST', headers: SAME_ORIGIN, chunks: [JSON.stringify({ sessionId: 'sess-1', expertId: 'nope' })] }), res)
    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body), { kind: 'error', text: '无此可用专家' })
  }

  // Disposal drops every route.
  dispose()
  assert.equal(server.routes.size, 0)
}

console.log('smoke-client: all checks passed')
