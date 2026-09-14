/**
 * dsh-workbuddy-expert browser client (ticket 05): the composer's expert
 * selector, hand-written in the harness client-bundle format:
 * `window.__ModuleLoader__.load({ id, factory })`, CJS-style module,
 * externals resolved through the injected `require` (react only), zero
 * build step — this file IS the artifact package.json exports as
 * "./client". The engineering form ports the sister plugin's verified
 * bundle (dsh-workbuddy-market/client/client.js) verbatim where the two
 * surfaces overlap: the wrapper shape, the theme-token CSS with hard
 * fallbacks, the scoped `<style data-plugin>` tag cleaned up by the
 * disposer apply() returns, and the zh/en dictionaries.
 *
 * ONE seat, two behaviors (design §3 + §8, ticket 05):
 *
 *   - conversation.input.left (list slot, verified in design §11 #5): a
 *     compact 专家 pill. In a live session, opening the popover lists the
 *     expert cards (displayName / description / broken badge + reason,
 *     ordered by card.order then id — the host already sorts, the client
 *     re-sorts defensively) with the session's CURRENT expert marked (from
 *     GET /api/experts?sessionId=… → currentExpertId, the stateOf-backed
 *     projection). Picking a card POSTs /api/switch; the control shows the
 *     TARGET expert while the transaction runs and stays disabled until it
 *     settles, then refetches so the ✓ marker follows.
 *
 *   - the staged-draft creation branch: when the seat renders WITHOUT a
 *     session id (props carry none), a pick is held as a STAGED DRAFT,
 *     frontend-only (there is no session yet, so no event can land). The
 *     moment a session id appears on the seat's props while a draft is
 *     staged, the client fires POST /api/after-create {sessionId,
 *     expertId} EXACTLY ONCE (a ref guards the "once") — the host side
 *     runs switcher.composeForCreation on the just-created agent, which
 *     composes the expert and appends the expert/selected event. There is
 *     therefore never a "已选未生效" state: the draft either lands through
 *     this handshake or dies with the un-created session.
 *
 *     VERIFIED DEVIATION (harness source, dsh-client-ui-conversation): the
 *     shipped composer renders conversation.input.left ONLY when a
 *     sessionId exists (`input === void 0 || sessionId === void 0 ? null :
 *     renderSlot(...)`), so today the staged branch is defensive — the
 *     after-create handshake is fully implemented on BOTH halves and fires
 *     the moment the seat gains a session id; it merely needs a host-side
 *     pre-session seat (or a hero-slot change) to become user-reachable.
 *
 * Not depended on: any '@' trigger source slot (none exists in the live
 * Slots tree, design §11 #5) and conversation.hero.agentPreset (single,
 * occupied). Broken experts render in the list with their reason and are
 * not pickable. Cold-session (no live agent) Remote lookup stays deferred
 * — the routes answer a clean domain error there.
 */
window.__ModuleLoader__.load({ id: "dsh-workbuddy-expert", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

var NS = 'dsh-workbuddy-expert'
var API_BASE = '/dsh-workbuddy-expert/api'

// The directory's second voice: ids and counts run in mono.
var MONO = 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)'

var CSS = `
.wbe-wrap { position: relative; }
.wbe-btn { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border: none;
  border-radius: 24px; background: transparent; color: var(--dsw-alias-label-secondary, inherit);
  font-size: 13px; line-height: 20px; font-weight: 500; cursor: pointer; max-width: 220px; }
.wbe-btn:hover:not(:disabled) { background: var(--dsw-interactive-bg-hover, rgba(127,127,127,.12)); color: var(--dsw-alias-label-primary, inherit); }
.wbe-btn:disabled { opacity: .6; cursor: default; }
.wbe-btn[data-staged="true"] { color: var(--dsw-alias-brand-primary, #4f6ef7); }
.wbe-btn-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wbe-caret { flex: none; font-size: 10px; line-height: 1; color: var(--dsw-alias-label-tertiary, inherit); }
.wbe-spin { display: inline-block; width: 11px; height: 11px; border-radius: 50%;
  border: 1.5px solid currentColor; border-top-color: transparent; animation: wbe-spin .9s linear infinite; }
@keyframes wbe-spin { to { transform: rotate(360deg); } }
.wbe-menu { position: absolute; bottom: calc(100% + 4px); left: 0; box-sizing: border-box; padding: 4px;
  display: flex; flex-direction: column; width: 320px; max-width: 360px; max-height: 320px; overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-inverted, rgba(127,127,127,.35)); border-radius: 12px;
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, inherit));
  box-shadow: var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,.18)); z-index: 10000; }
.wbe-menu-title { padding: 8px 10px 6px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary, inherit); }
.wbe-item { display: flex; flex-direction: column; gap: 1px; width: 100%; padding: 8px 10px;
  border: none; border-radius: 10px; background: transparent; cursor: pointer; text-align: left;
  color: var(--dsw-alias-label-primary, inherit); box-sizing: border-box; }
.wbe-item:hover:not(:disabled), .wbe-item:focus-visible { background: var(--dsw-interactive-bg-hover, rgba(127,127,127,.12)); }
.wbe-item:disabled { opacity: .55; cursor: default; }
.wbe-item[data-current="true"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f6ef7) 8%, transparent); }
.wbe-item-line { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.wbe-item-name { font-size: 13px; line-height: 18px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wbe-item-id { font-family: ${MONO}; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, inherit);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wbe-item-desc { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary, inherit);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wbe-item-broken { display: inline-flex; align-items: baseline; gap: 4px; flex: none; font-size: 10px; line-height: 1.5;
  padding: 1px 7px; border-radius: 999px; white-space: nowrap;
  color: var(--dsw-alias-state-warn-primary, #c77700);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c77700) 45%, transparent); }
.wbe-item-reason { font-size: 11px; line-height: 16px; color: var(--dsw-alias-state-warn-primary, #c77700); }
.wbe-current-mark { flex: none; font-size: 11px; color: var(--dsw-alias-state-success-primary, #2e9e5b); }
.wbe-empty { padding: 8px 10px; font-size: 13px; color: var(--dsw-alias-label-secondary, inherit); }
.wbe-foot { margin-top: 4px; padding: 7px 10px 5px; font-size: 11px; line-height: 1.5;
  color: var(--dsw-alias-label-tertiary, inherit);
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); }
.wbe-notice { padding: 6px 10px; margin: 4px 6px 2px; font-size: 11px; line-height: 1.5; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));
  color: var(--dsw-alias-state-error-primary, #d5484f); }
.wbe-btn:focus-visible, .wbe-item:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, currentColor); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .wbe-spin { animation: none; } }
`

/**
 * Inject the scoped stylesheet, idempotently. Returns the tag THIS call
 * created (the caller's disposer owns removing it), or null when a tag is
 * already present from a sibling apply of the same module instance.
 */
function ensureStyle () {
  if (typeof document === 'undefined' || document === null) return null
  var tagId = NS + '/selector.css'
  if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return null
  var tag = document.createElement('style')
  tag.dataset.plugin = NS
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
  return tag
}

/** Remove a tag ensureStyle() created; absent-safe. */
function removeStyle (tag) {
  if (tag === null || tag === undefined) return
  tag.remove()
}

var React = require('react')
var el = React.createElement

var DICTS = {
  zh: {
    buttonLabel: '专家',
    buttonTitle: '切换本会话的专家角色',
    menuTitle: '选择专家',
    menuTitleDraft: '选择专家（创建后生效）',
    emptyMenu: '暂无可用专家',
    currentMark: '当前',
    stagedMark: '待创建',
    brokenStamp: '不可用',
    switchingTo: '切换到 {name}…',
    stagedAs: '创建后启用 {name}',
    noneSelected: '未选择',
    loadFailed: '专家列表加载失败',
    retry: '重试',
    switchFailed: '切换失败',
    afterCreateFailed: '创建后组装专家失败',
    footSession: '选择即在下一个模型请求边界切换，会话历史保留',
    footDraft: '会话创建后立即应用所选专家'
  },
  en: {
    buttonLabel: 'Expert',
    buttonTitle: 'Switch this session\'s expert role',
    menuTitle: 'Choose an expert',
    menuTitleDraft: 'Choose an expert (applied after creation)',
    emptyMenu: 'No experts available yet',
    currentMark: 'current',
    stagedMark: 'staged',
    brokenStamp: 'unavailable',
    switchingTo: 'Switching to {name}…',
    stagedAs: 'Applying {name} after creation',
    noneSelected: 'none',
    loadFailed: 'Failed to load experts',
    retry: 'Retry',
    switchFailed: 'Switch failed',
    afterCreateFailed: 'Composing the expert after creation failed',
    footSession: 'Picking switches at the next model request boundary; history is kept',
    footDraft: 'The pick is applied the moment the session is created'
  }
}

/** Fallback translator: zh dict → key, with {placeholder} interpolation. */
function fallbackT (key, params) {
  var template = DICTS.zh[key] || key
  return interpolate(template, params)
}

function interpolate (template, params) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, function (whole, name) {
    return params[name] !== undefined ? String(params[name]) : whole
  })
}

/**
 * Same-origin JSON fetch; throws host-sent error messages when present.
 */
function api (path, options) {
  var init = Object.assign({ credentials: 'same-origin' }, options || {})
  return fetch(path, init).then(function (response) {
    return response.json().catch(function () { return {} }).then(function (body) {
      if (!response.ok) {
        throw new Error(body && body.error ? body.error : 'HTTP ' + response.status)
      }
      return body
    })
  })
}

/** Same-origin JSON POST (the only shape the mutating routes accept). */
function postJson (path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

// ── pure derivations (exported for the offline smoke) ────────────────────────

/** A trimmed string field ('' for anything else). */
function strOf (value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Broken card = the host table carries a `broken` reason on the row. */
function isBrokenCard (expert) {
  return expert !== null && typeof expert === 'object' && strOf(expert.broken) !== ''
}

/**
 * The selector ordering (design §1: `order` for the selector): ascending
 * card.order (absent/invalid → Infinity keeps unordered cards last), then
 * id ascending. The registry already sorts this way; the client re-sorts
 * defensively so any payload shape renders deterministically.
 */
function sortExpertCards (experts) {
  var list = (Array.isArray(experts) ? experts : []).filter(function (expert) {
    return expert !== null && typeof expert === 'object' && strOf(expert.id) !== ''
  })
  return list.slice().sort(function (a, b) {
    var ao = typeof a.order === 'number' && isFinite(a.order) ? a.order : Infinity
    var bo = typeof b.order === 'number' && isFinite(b.order) ? b.order : Infinity
    if (ao !== bo) return ao - bo
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** The card's display name (displayName → id). */
function nameOf (expert) {
  if (expert === null || typeof expert !== 'object') return ''
  var name = strOf(expert.displayName)
  return name !== '' ? name : strOf(expert.id)
}

/**
 * The session id of one seat render, tolerant to the prop shapes the live
 * composer may hand the slot: props.session?.id, props.sessionId, or
 * props.session?.sessionId. '' when no session exists yet (the composer's
 * no-session inert state — the staged-draft branch).
 */
function sessionIdOf (props) {
  props = props || {}
  if (typeof props.sessionId === 'string' && props.sessionId.trim() !== '') return props.sessionId.trim()
  var session = props.session
  if (session !== null && typeof session === 'object') {
    if (typeof session.id === 'string' && session.id.trim() !== '') return session.id.trim()
    if (typeof session.sessionId === 'string' && session.sessionId.trim() !== '') return session.sessionId.trim()
  }
  return ''
}

/** The experts URL for one session id ('' → the plain table). */
function expertsUrl (sessionId) {
  var id = strOf(sessionId)
  return id === '' ? API_BASE + '/experts' : API_BASE + '/experts?sessionId=' + encodeURIComponent(id)
}

/** Pointer target inside the control or the popover: keep the menu. */
function pointerInsideSelectorUi (target) {
  if (target === null || target === undefined || typeof target.closest !== 'function') return false
  return target.closest('.wbe-menu') !== null || target.closest('.wbe-wrap') !== null
}

// ── the selector control ─────────────────────────────────────────────────────

/**
 * The 专家 control. One component covers both seat behaviors; the branch
 * is purely `sessionId === ''`:
 *
 *   live session → pick = POST /api/switch (switching state: disabled,
 *                  label shows the TARGET expert until the transaction
 *                  settles, then the table refetches and the ✓ follows);
 *   no session   → pick = STAGED DRAFT held in state; the effect watching
 *                  sessionId fires POST /api/after-create ONCE (a ref
 *                  guards re-entry) the moment a session id appears, then
 *                  clears the draft — the host composes the expert and
 *                  appends expert/selected on the just-created agent, so
 *                  no "已选未生效" window ever exists.
 *
 * Optional `initialData` seam (undefined in production) lets the offline
 * smoke render real states without a fetch layer.
 */
function ExpertSelector (props) {
  var t = props.t
  var sessionId = sessionIdOf(props)

  var dataState = React.useState(props.initialData === undefined ? null : props.initialData)
  var setData = dataState[1]
  var data = dataState[0]
  var experts = data !== null && data !== undefined && Array.isArray(data.experts) ? data.experts : null
  var currentExpertId = data !== null && data !== undefined && typeof data.currentExpertId === 'string'
    ? data.currentExpertId : ''

  var openState = React.useState(false)
  var open = openState[0]
  var setOpen = openState[1]

  var switchingState = React.useState(null)
  var switching = switchingState[0]
  var setSwitching = switchingState[1]

  var stagedState = React.useState(null)
  var staged = stagedState[0]
  var setStaged = stagedState[1]

  var errorState = React.useState('')
  var setError = errorState[1]
  var error = errorState[0]

  // The once-guard of the after-create handshake: keyed by the staged
  // expert id, so exactly ONE POST fires per staged draft even if React
  // re-runs the effect (strict mode double-invoke, refetch churn).
  var firedAfterCreateRef = React.useRef('')

  /** Adopt a fresh /api/experts payload. */
  function adopt (payload) {
    setData(payload)
    setError('')
  }

  /** One table pull; failures land in `error`, never a throw. */
  function pull () {
    return api(expertsUrl(sessionId)).then(adopt, function (err) {
      setError(err && err.message ? err.message : String(err))
      return undefined
    })
  }

  // (Re)pull when the session identity changes — including the very first
  // mount — so the ✓ marker follows the seat.
  React.useEffect(function () { pull() }, [sessionId])

  // The staged-draft handshake (design §3): a draft staged in the
  // no-session state fires /api/after-create EXACTLY ONCE when a session
  // id appears on the seat. Failures surface as an error notice and the
  // draft is consumed either way — the host owns the compose + the
  // expert/selected event once the POST is accepted.
  React.useEffect(function () {
    if (staged === null || sessionId === '') return undefined
    if (firedAfterCreateRef.current === staged.expertId) return undefined
    firedAfterCreateRef.current = staged.expertId
    postJson(API_BASE + '/after-create', { sessionId: sessionId, expertId: staged.expertId })
      .then(function (result) {
        if (result !== null && typeof result === 'object' && result.kind === 'error') {
          setError(t('afterCreateFailed') + '：' + (result.text || ''))
        }
        return pull()
      }, function (err) {
        setError(t('afterCreateFailed') + '：' + (err && err.message ? err.message : String(err)))
        return pull()
      })
      .then(function () { setStaged(null) })
    return undefined
  }, [sessionId, staged])

  // Popover dismissal: outside pointerdown + Escape (sister pattern).
  React.useEffect(function () {
    if (!open || typeof document === 'undefined' || document === null) return undefined
    var onPointerDown = function (event) {
      if (pointerInsideSelectorUi(event && event.target)) return
      setOpen(false)
    }
    var onKeyDown = function (event) {
      if (event !== null && event !== undefined && event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return function () {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  var cards = experts === null ? [] : sortExpertCards(experts)
  var byId = {}
  for (var i = 0; i < cards.length; i++) byId[cards[i].id] = cards[i]

  /** Pick: live session → switch transaction; no session → staged draft. */
  var pick = function (expert) {
    setOpen(false)
    if (isBrokenCard(expert)) return
    if (sessionId !== '') {
      setSwitching({ expertId: expert.id })
      postJson(API_BASE + '/switch', { sessionId: sessionId, expertId: expert.id })
        .then(function (result) {
          if (result !== null && typeof result === 'object' && result.kind === 'error') {
            setError(t('switchFailed') + '：' + (result.text || ''))
          }
          return pull()
        }, function (err) {
          setError(t('switchFailed') + '：' + (err && err.message ? err.message : String(err)))
          return pull()
        })
        .then(function () { setSwitching(null) })
    } else {
      firedAfterCreateRef.current = ''
      setStaged({ expertId: expert.id })
    }
  }

  // The button's face: the switching target while a transaction runs
  // (disabled), the staged pick while no session exists, otherwise the
  // current expert's name (or the bare 专家 label when none).
  var busy = switching !== null
  var faceName = ''
  if (busy) faceName = nameOf(byId[switching.expertId]) || switching.expertId
  else if (staged !== null) faceName = nameOf(byId[staged.expertId]) || staged.expertId
  else if (currentExpertId !== '') faceName = nameOf(byId[currentExpertId]) || currentExpertId

  var buttonLabel = t('buttonLabel')
  if (busy) buttonLabel = t('switchingTo', { name: faceName })
  else if (staged !== null) buttonLabel = t('stagedAs', { name: faceName })
  else if (faceName !== '') buttonLabel = faceName

  var menu = null
  if (open) {
    var items = cards.map(function (expert) {
      var broken = isBrokenCard(expert)
      var current = !broken && expert.id === currentExpertId && staged === null
      var isStaged = staged !== null && staged.expertId === expert.id
      return el('button', {
        key: expert.id,
        type: 'button',
        className: 'wbe-item',
        'data-current': current || isStaged ? 'true' : undefined,
        disabled: busy || broken,
        title: broken ? strOf(expert.broken) : strOf(expert.description),
        onClick: function () { pick(expert) }
      },
        el('span', { className: 'wbe-item-line' },
          el('span', { className: 'wbe-item-name' }, nameOf(expert)),
          el('span', { className: 'wbe-item-id' }, strOf(expert.id)),
          broken ? el('span', { className: 'wbe-item-broken' }, '⚠ ', t('brokenStamp')) : null,
          current ? el('span', { className: 'wbe-current-mark' }, '✓ ', t('currentMark')) : null,
          isStaged ? el('span', { className: 'wbe-current-mark' }, t('stagedMark')) : null),
        strOf(expert.description) !== '' && !broken
          ? el('span', { className: 'wbe-item-desc' }, strOf(expert.description))
          : null,
        broken ? el('span', { className: 'wbe-item-reason' }, strOf(expert.broken)) : null)
    })
    menu = el('div', { className: 'wbe-menu', role: 'listbox', 'aria-label': t('menuTitle') },
      el('div', { className: 'wbe-menu-title' }, t(sessionId !== '' ? 'menuTitle' : 'menuTitleDraft')),
      error !== '' ? el('div', { className: 'wbe-notice', role: 'alert' }, t('loadFailed') + '：' + error,
        el('button', {
          type: 'button', className: 'wbe-btn', style: { height: 'auto', padding: '2px 6px' },
          onClick: function (event) { event.stopPropagation(); pull() }
        }, t('retry'))) : null,
      experts !== null && items.length === 0
        ? el('div', { className: 'wbe-empty' }, t('emptyMenu'))
        : items,
      el('div', { className: 'wbe-foot' }, t(sessionId !== '' ? 'footSession' : 'footDraft')))
  }

  return el('div', { className: 'wbe-wrap' },
    el('button', {
      type: 'button',
      className: 'wbe-btn',
      'data-staged': staged !== null ? 'true' : undefined,
      title: t('buttonTitle'),
      'aria-haspopup': 'listbox',
      'aria-expanded': open ? 'true' : 'false',
      'aria-busy': busy ? 'true' : undefined,
      disabled: busy,
      onClick: function () { setOpen(function (prev) { return !prev }) }
    },
      busy ? el('span', { className: 'wbe-spin', 'aria-hidden': 'true' }) : null,
      el('span', { className: 'wbe-btn-label' }, buttonLabel),
      el('span', { className: 'wbe-caret', 'aria-hidden': 'true' }, '▴')),
    menu)
}

function apply (ctx) {
  var t = fallbackT
  var locale = ctx.locale
  if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
    try {
      locale.register(NS, DICTS)
      var bound = locale.bind(NS)
      if (typeof bound === 'function') {
        t = function (key, params) {
          var text = bound(key, params)
          return typeof text === 'string' ? text : fallbackT(key, params)
        }
      }
    } catch (error) {
      t = fallbackT
    }
  }

  // Current UI language, read LIVE off the locale service; zh when the
  // service is missing or has not resolved a language yet.
  var getLocale = function () { return 'zh' }
  if (locale && typeof locale.getLocale === 'function') {
    getLocale = function () {
      var snapshot = locale.getLocale()
      return snapshot !== undefined && snapshot !== null && typeof snapshot.active === 'string' && snapshot.active !== ''
        ? snapshot.active
        : 'zh'
    }
  }

  var slots = ctx.slots
  if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    if (ctx.logger && typeof ctx.logger.warn === 'function') {
      ctx.logger.warn('dsh-workbuddy-expert: slots service unavailable; expert selector not registered')
    }
    return
  }

  // Every registration below returns a disposer — collect them all so one
  // call releases the whole surface (the slot entry + the scoped style
  // tag, which this fiber owns removing; see the sister's header note).
  var disposers = []
  function collect (disposer) {
    if (typeof disposer === 'function') disposers.push(disposer)
  }

  // The one seat (design §11 #5): conversation.input.left, the composer
  // tool row's left side. NOTE (verified in the harness source): the
  // shipped composer renders this seat only when a session id exists, so
  // the staged-draft branch below is today defensive — the after-create
  // handshake activates the moment the seat gains a session id (see the
  // header's VERIFIED DEVIATION note). conversation.hero.agentPreset is
  // single and occupied; no '@' trigger source exists — neither is touched.
  collect(slots.inject('conversation.input.left', function () {
    return slots.register({
      name: 'conversation.input.left',
      id: 'workbuddy-expert',
      order: 2,
      locale: NS
    }, function (props) {
      props = props || {}
      return el(ExpertSelector, {
        t: t,
        getLocale: getLocale,
        session: props.session,
        sessionId: props.sessionId,
        initialData: props.initialData
      })
    })
  }))

  // The scoped style tag is injected only after every registration
  // succeeded (a failed apply must not leak it), and its removal joins
  // the disposers.
  var styleTag = ensureStyle()
  collect(function () { removeStyle(styleTag) })

  return function () {
    for (var i = 0; i < disposers.length; i++) disposers[i]()
  }
}

// Array-form inject only (object form means intercept config in this
// cordis). 'slots' comes with the client runtime core; 'locale' is
// provided by dsh-client-locale, composed through package.json
// dsh.client.inject.
module.exports = { name: NS, inject: ['slots', 'locale'], apply: apply }
// Extra exports for offline smoke checks (scripts/smoke-client.mjs); the
// module loader treats unknown plugin keys as inert.
module.exports.DICTS = DICTS
module.exports.CSS = CSS
module.exports.ensureStyle = ensureStyle
module.exports.removeStyle = removeStyle
module.exports.sortExpertCards = sortExpertCards
module.exports.isBrokenCard = isBrokenCard
module.exports.nameOf = nameOf
module.exports.sessionIdOf = sessionIdOf
module.exports.expertsUrl = expertsUrl
module.exports.ExpertSelector = ExpertSelector
return module.exports;
} });
