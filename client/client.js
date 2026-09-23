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
 *     composes the expert (in-memory selection state; nothing is appended
 *     to the durable session log). There is
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
 *
 * Ticket 08 adds the bundle's second voice on the SAME module: the settings
 * 「WorkBuddy 专家」market page (settings.section), ported from wb-market's
 * client with the adaptations spelled out at the market block below —
 * expert-folder install semantics (安装 = 导出到用户专家目录，装好即可
 * /expert 切换), the /api/state installed/broken/orphans overlay, and the
 * project-wide chip/danger color convention. One wrapper, one shared zh/en
 * dict (merged keys), one style-block namespace per feature (.wbe- selector,
 * .wbx- market).
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
.wbe-btn-avatar { width: 18px; height: 18px; flex: none; border-radius: 5px; object-fit: cover;
  display: inline-flex; align-items: center; justify-content: center; font-size: 11px; line-height: 1;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.18)); }
.wbe-btn-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* inline-flex, not inline: an inline seat reserves baseline descent under the
   svg and floats the glyph off-center in the 28px trigger (host .chevron). */
.wbe-caret { display: inline-flex; flex: none; color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary, inherit));
  transition: transform 120ms ease; }
.wbe-caret[data-open="true"] { transform: rotate(180deg); }
.wbe-spin { display: inline-block; width: 11px; height: 11px; border-radius: 50%;
  border: 1.5px solid currentColor; border-top-color: transparent; animation: wbe-spin .9s linear infinite; }
@keyframes wbe-spin { to { transform: rotate(360deg); } }
.wbe-menu { position: absolute; bottom: calc(100% + 4px); left: 0; box-sizing: border-box; padding: 4px;
  display: flex; flex-direction: column; width: 320px; max-width: 360px; max-height: 320px; overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-inverted, rgba(127,127,127,.35)); border-radius: 12px;
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, inherit));
  box-shadow: var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,.18)); z-index: 10000; }
.wbe-menu-title { padding: 8px 10px 6px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary, inherit); }
.wbe-item { display: flex; gap: 8px; align-items: flex-start; width: 100%; padding: 8px 10px;
  border: none; border-radius: 10px; background: transparent; cursor: pointer; text-align: left;
  color: var(--dsw-alias-label-primary, inherit); box-sizing: border-box; }
.wbe-item-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
.wbe-avatar { width: 28px; height: 28px; flex: none; border-radius: 8px; object-fit: cover;
  display: inline-flex; align-items: center; justify-content: center; font-size: 15px; line-height: 1;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.18)); }
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
/* The removal lane — project-wide danger convention (10% red tint on hover). */
.wbe-remove { display: flex; align-items: center; gap: 6px; width: 100%; padding: 7px 10px; font-size: 12px;
  line-height: 1.4; text-align: left; cursor: pointer; background: none;
  color: var(--dsw-alias-state-error-primary, #d5484f);
  border: 0; border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); }
.wbe-remove:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d5484f) 10%, transparent); }
.wbe-remove:disabled { opacity: .5; cursor: default; }
.wbe-remove:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, currentColor); outline-offset: -2px; }
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

// ── ticket 08: the market settings page ──────────────────────────────────────
//
// The market page's own style-block namespace (.wbx-, ported from wb-market's
// .wbm- with the summon/bulk-update surfaces dropped). One namespace per
// feature: the selector keeps .wbe-, the market owns .wbx-, each with its own
// <style data-plugin> tag so either surface can ship or unload alone.

var AVATAR_EMOJI = '🧑‍💻'

var MARKET_CSS = `
.wbx-page { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 2px; }

/* ── the yellow banner: source path missing ─────────────────────────────── */
.wbx-banner { display: flex; align-items: baseline; gap: 6px 8px; flex-wrap: wrap;
  padding: 9px 12px; font-size: 12px; line-height: 1.6; border-radius: 10px;
  color: var(--dsw-alias-state-warn-primary, #c77700);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c77700) 9%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c77700) 42%, transparent); }
.wbx-banner-path { font-family: ${MONO}; font-size: 11px; }
.wbx-banner-hint { color: var(--dsw-alias-label-tertiary, inherit); }

/* ── header: title block + quiet mono census ─────────────────────────────── */
.wbx-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; }
.wbx-head-main { min-width: 0; }
.wbx-head h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }
.wbx-subtitle { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, inherit); }
.wbx-census { display: inline-flex; gap: 12px; flex: none; padding-bottom: 2px;
  font-family: ${MONO}; font-size: 11px; line-height: 1.5; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary, inherit); white-space: nowrap; }
.wbx-census-item { border-radius: 4px; padding: 0 2px; }

/* ── the mutating topbar: source path input + apply + refresh ────────────── */
.wbx-pathbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.wbx-path-field { flex: 1 1 240px; min-width: 0; }
.wbx-path-input { width: 100%; box-sizing: border-box; padding: 7px 10px; font-size: 12px; border-radius: 8px;
  font-family: ${MONO};
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35)); outline: none;
  background: var(--dsw-alias-bg-layer-1, transparent); color: var(--dsw-alias-label-primary, inherit); }
.wbx-path-input:focus { border-color: var(--dsw-alias-brand-primary, currentColor); }
.wbx-path-input::placeholder { color: var(--dsw-alias-label-tertiary, inherit); }
.wbx-refresh { display: inline-flex; align-items: center; gap: 5px; }
.wbx-spin { animation: wbx-spin .9s linear infinite; }
@keyframes wbx-spin { to { transform: rotate(360deg); } }

/* ── the revision conflict box: both sides' revisions + retry ────────────── */
.wbx-conflict { display: flex; gap: 6px 10px; flex-wrap: wrap; align-items: center;
  padding: 9px 12px; font-size: 12px; line-height: 1.6; border-radius: 10px;
  color: var(--dsw-alias-state-warn-primary, #c77700);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c77700) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c77700) 42%, transparent); }
.wbx-conflict-body { flex: 1 1 240px; min-width: 0; }
.wbx-conflict-title { display: block; font-weight: 600; }
.wbx-conflict-detail { display: block; font-family: ${MONO}; font-size: 11px; }

/* ── search owns its row ──────────────────────────────────────────────────── */
.wbx-search { width: 100%; box-sizing: border-box; padding: 9px 12px; font-size: 13px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35)); outline: none;
  background: var(--dsw-alias-bg-layer-1, transparent); color: var(--dsw-alias-label-primary, inherit); }
.wbx-search:focus { border-color: var(--dsw-alias-brand-primary, currentColor); }
.wbx-search::placeholder { color: var(--dsw-alias-label-tertiary, inherit); }

/* ── filter chips ──────────────────────────────────────────────────────────── */
/* Project-wide color convention: selected chip = brand fill with the theme's
   designed foreground token (white in light mode, near-black in dark mode
   where --dsw-alias-brand-primary flips — a hardcoded #fff would vanish
   white-on-white there). */
.wbx-toolbar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.wbx-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; font-size: 12px; line-height: 1.4;
  border-radius: 999px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35));
  background: transparent; color: var(--dsw-alias-label-secondary, inherit); }
.wbx-chip:hover { background: var(--dsw-interactive-bg-hover, rgba(127,127,127,.1)); }
.wbx-chip[data-active="true"] { background: var(--dsw-alias-brand-primary, #4f6ef7); border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground, #fff); }
.wbx-chip-count { font-family: ${MONO}; font-size: 10px; line-height: 1;
  font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-tertiary, inherit); }
.wbx-chip[data-active="true"] .wbx-chip-count { color: color-mix(in srgb, var(--dsw-alias-label-primary-foreground, #fff) 78%, transparent); }

/* ── the category chip row: a SECOND, orthogonal filter dimension ────────── */
.wbx-catrow { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.wbx-catrow .wbx-chip-label { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── match feedback ────────────────────────────────────────────────────────── */
.wbx-matchline { margin: 0; font-family: ${MONO}; font-size: 11px; line-height: 1.5;
  font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-tertiary, inherit); }

/* ── scan warnings: a quiet fold, collapsed by default ───────────────────── */
.wbx-warns { border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c77700) 38%, transparent);
  border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c77700) 4%, transparent); }
.wbx-warns-toggle { display: flex; width: 100%; box-sizing: border-box; align-items: center; gap: 6px;
  padding: 8px 12px; font-size: 12px; line-height: 1.5; border: none; border-radius: 10px;
  background: transparent; cursor: pointer; text-align: left;
  color: var(--dsw-alias-state-warn-primary, #c77700); }
.wbx-warns-toggle:hover { background: var(--dsw-interactive-bg-hover, rgba(127,127,127,.1)); }
.wbx-warns-caret { flex: none; font-size: 10px; line-height: 1; }
.wbx-warns-list { margin: 0; padding: 0 14px 10px; font-size: 12px; line-height: 1.7; list-style: disc;
  color: var(--dsw-alias-label-secondary, inherit); }
.wbx-warns-list li + li { margin-top: 2px; }
.wbx-warns-list li::marker { color: var(--dsw-alias-state-warn-primary, #c77700); }

/* ── the card grid ────────────────────────────────────────────────────────── */
.wbx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 10px;
  list-style: none; margin: 0; padding: 0; }
.wbx-card { position: relative; display: flex; flex-direction: column; gap: 7px; box-sizing: border-box; min-width: 0;
  padding: 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28)); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, transparent); }
.wbx-card:hover { background: var(--dsw-interactive-bg-hover, rgba(127,127,127,.06)); }
.wbx-card[data-installed="true"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2e9e5b) 4%, transparent); }
.wbx-card[data-broken="true"] { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c77700) 45%, transparent); }
.wbx-card-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.wbx-avatar { width: 40px; height: 40px; flex: none; border-radius: 10px; object-fit: cover;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.18)); }
.wbx-emoji { display: inline-flex; width: 40px; height: 40px; flex: none; align-items: center; justify-content: center;
  font-size: 22px; line-height: 1; border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.18)); }
.wbx-card-title { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wbx-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wbx-id { font-family: ${MONO}; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-tertiary, inherit);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wbx-desc { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary, inherit);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wbx-badges { display: flex; flex-wrap: wrap; gap: 4px 6px; }
.wbx-badge { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  box-sizing: border-box; padding: 2px 7px; font-size: 10px; line-height: 1.5; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3));
  color: var(--dsw-alias-label-tertiary, inherit); }
.wbx-badge[data-kind="plugin"] { font-family: ${MONO}; font-size: 10px; }
.wbx-badge[data-kind="category"] { color: var(--dsw-alias-label-secondary, inherit);
  border-color: color-mix(in srgb, var(--dsw-alias-label-secondary, rgba(127,127,127,.6)) 30%, transparent); }
.wbx-badge[data-kind="team"] { color: var(--dsw-alias-brand-primary, #4f6ef7);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f6ef7) 40%, transparent); }

/* ── the card footer: the status marks row (actions live in the corner) ──── */
.wbx-foot { margin-top: auto; padding-top: 7px; display: flex; flex-direction: column; gap: 6px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18)); }
.wbx-status { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }
.wbx-mark { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; white-space: nowrap; }
.wbx-mark[data-kind="ok"] { color: var(--dsw-alias-state-success-primary, #2e9e5b); }
.wbx-mark[data-kind="upd"] { color: var(--dsw-alias-brand-primary, #4f6ef7); }
.wbx-mark[data-kind="bad"] { color: var(--dsw-alias-state-warn-primary, #c77700); }
.wbx-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

/* The card's action corner: top-right, revealed on card hover — or on
   focus-within, so keyboard users tabbing into the buttons see them. Its
   opaque backdrop keeps the row readable over the title/id it overlays. */
.wbx-corner { position: absolute; top: 8px; right: 8px; z-index: 1; display: flex; flex-wrap: wrap;
  gap: 6px; align-items: center; justify-content: flex-end; padding: 4px; border-radius: 10px;
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, rgba(30,30,30,.92)));
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28));
  opacity: 0; pointer-events: none; transition: opacity .12s ease; }
.wbx-card:hover .wbx-corner, .wbx-card:focus-within .wbx-corner { opacity: 1; pointer-events: auto; }

/* ── the team group view: one collapsible section per team ───────────────── */
.wbx-group { grid-column: 1 / -1; list-style: none; }
.wbx-group-head { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; width: 100%;
  box-sizing: border-box; padding: 10px 12px; font-size: 12px; line-height: 1.5; text-align: left;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28)); border-radius: 12px; cursor: pointer;
  background: var(--dsw-alias-bg-layer-1, transparent); color: var(--dsw-alias-label-secondary, inherit); }
.wbx-group-head:hover { background: var(--dsw-interactive-bg-hover, rgba(127,127,127,.06)); }
.wbx-group-caret { flex: none; font-size: 10px; line-height: 1; color: var(--dsw-alias-label-tertiary, inherit); }
.wbx-group-faces { flex: none; display: inline-flex; align-items: center; }
.wbx-gavatar { width: 20px; height: 20px; border-radius: 6px; object-fit: cover; font-size: 11px;
  display: inline-flex; align-items: center; justify-content: center; line-height: 1;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.18)); box-sizing: content-box;
  border: 2px solid var(--dsw-alias-bg-layer-1, transparent); margin-right: -6px; }
.wbx-group-name { font-family: ${MONO}; font-size: 11px; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary, inherit); }
.wbx-group-count { font-family: ${MONO}; font-size: 11px; line-height: 1.5; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary, inherit); white-space: nowrap; }
.wbx-group-marks { display: inline-flex; gap: 4px 10px; flex-wrap: wrap; }

/* ── the orphans / broken-exports panels ─────────────────────────────────── */
.wbx-orphans { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28)); border-radius: 12px;
  padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.wbx-orphans-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.wbx-orphans-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }
.wbx-orphans-count { font-family: ${MONO}; font-size: 11px; line-height: 1.4;
  font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-tertiary, inherit); }
.wbx-orphans-hint { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, inherit); }
.wbx-orphan { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: space-between;
  padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22)); border-radius: 10px; }
.wbx-orphan[data-broken="true"] { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c77700) 45%, transparent); }
.wbx-orphan-main { min-width: 0; flex: 1 1 260px; display: flex; flex-direction: column; gap: 2px; }
.wbx-orphan-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
.wbx-orphan-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }
.wbx-orphan-id { font-family: ${MONO}; font-size: 11px; line-height: 1.4;
  color: var(--dsw-alias-label-tertiary, inherit); word-break: break-all; }
.wbx-orphan-broken { flex: none; font-size: 10px; line-height: 1.5; padding: 1px 7px; border-radius: 999px; white-space: nowrap;
  color: var(--dsw-alias-state-warn-primary, #c77700);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c77700) 45%, transparent); }
.wbx-orphan-meta { font-family: ${MONO}; font-size: 11px; line-height: 1.6;
  color: var(--dsw-alias-label-tertiary, inherit); overflow-wrap: anywhere; }

/* ── states: skeleton loading, actionable empty, error + retry ───────────── */
.wbx-skel { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 10px; }
.wbx-skel-card { height: 128px; border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.2)); animation: wbx-skel 1.4s ease-in-out infinite; }
.wbx-skel-card:nth-child(3n) { animation-delay: .12s; }
@keyframes wbx-skel { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
.wbx-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 36px 12px; text-align: center; }
.wbx-empty-face { font-size: 28px; line-height: 1; opacity: .55; }
.wbx-empty-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary, inherit); }
.wbx-empty-tip { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, inherit); }
.wbx-notice { padding: 8px 12px; font-size: 12px; line-height: 1.6; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); }
.wbx-notice[data-kind="ok"] { color: var(--dsw-alias-state-success-primary, #2e9e5b); }
.wbx-notice[data-kind="error"] { color: var(--dsw-alias-state-error-primary, #d5484f); }
.wbx-btn { padding: 5px 12px; font-size: 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35)); background: transparent;
  color: var(--dsw-alias-label-primary, inherit); }
.wbx-btn:hover:not(:disabled) { background: var(--dsw-interactive-bg-hover, rgba(127,127,127,.1)); }
.wbx-btn:disabled { opacity: .55; cursor: default; }
.wbx-btn[data-variant="primary"] { background: var(--dsw-alias-brand-primary, #4f6ef7); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }
.wbx-btn[data-variant="primary"]:hover:not(:disabled) { background: var(--dsw-alias-brand-primary, #4f6ef7); opacity: .9; }
/* Project-wide danger convention: hover = a 10% color-mix red tint. */
.wbx-btn[data-variant="danger"] { color: var(--dsw-alias-state-error-primary, #d5484f);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d5484f) 45%, transparent); }
.wbx-btn[data-variant="danger"]:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d5484f) 10%, transparent); }
.wbx-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* ── quality floor: visible keyboard focus, calm motion ──────────────────── */
.wbx-btn:focus-visible, .wbx-chip:focus-visible, .wbx-search:focus-visible, .wbx-path-input:focus-visible,
.wbx-warns-toggle:focus-visible, .wbx-group-head:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, currentColor); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .wbx-skel-card { animation: none; }
  .wbx-spin { animation: none; }
  .wbx-corner { transition: none; }
}
`

/**
 * Inject the market stylesheet — the selector twin's pattern under a SECOND
 * tag id, so the two features' style blocks live and die independently.
 */
function ensureMarketStyle () {
  if (typeof document === 'undefined' || document === null) return null
  var tagId = NS + '/market.css'
  if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return null
  var tag = document.createElement('style')
  tag.dataset.plugin = NS
  tag.dataset.pluginCss = tagId
  tag.textContent = MARKET_CSS
  document.head.appendChild(tag)
  return tag
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
    removeExpert: '移除专家，恢复默认',
    removeExpertTitle: '移除当前专家，恢复默认 agent（会话历史保留）',
    clearing: '正在移除专家…',
    clearFailed: '移除专家失败',
    cancelStaged: '取消暂存的选择',
    cancelStagedTitle: '放弃创建后才生效的专家选择',
    footSession: '选择即在下一个模型请求边界切换，会话历史保留',
    footDraft: '会话创建后立即应用所选专家',
    // ── ticket 08: the market settings page (shared dict, merged keys; the
    // keys the selector already owns keep their selector meaning, the market
    // twins get distinct names where the copy differs) ─────────────────────
    nav: 'WorkBuddy 专家',
    marketTitle: 'WorkBuddy 专家市场',
    marketSubtitle: '浏览本地 WorkBuddy 源扫描表，安装专家（导出到用户专家目录），装好即可用 /expert 切换。',
    censusExperts: '专家 {n}',
    censusPlugins: '来源插件 {n}',
    censusCategories: '分类 {n}',
    search: '搜索名称、描述或 id —— 中英文都行',
    filterAll: '全部',
    filterInstalled: '已装',
    filterUpdatable: '可更新',
    filterSkills: '含技能',
    filterTeam: '团队',
    categoryAll: '全部分类',
    categoryNone: '未分类',
    categoryRowLabel: '按分类筛选',
    matchesPlain: '共 {n} 位',
    matchesEcho: '匹配 {n} 位 ·「{q}」',
    emptyHint: '没有匹配的专家',
    emptyTip: '若源目录为空，先看上方的路径提醒。',
    clearFilters: '清除筛选',
    bannerMissingPath: '源路径不存在：',
    bannerMissingHint: '目录未挂载或路径有误——修复后此提醒自动消失。',
    warningsToggle: '扫描警告 {n} 条',
    marketLoadFailed: '市场数据加载失败',
    busy: '加载中…',
    installedStamp: '已装',
    updatableStamp: '可更新',
    exportBrokenStamp: '导出损坏',
    skillsBadge: '技能 {n}',
    teamBadge: '团队 ·{n}',
    pathLabel: '源路径',
    apply: '应用',
    applying: '应用中…',
    refreshBtn: '刷新',
    pathApplied: '源路径已更新：{path}',
    configFailed: '路径保存失败',
    refreshFailed: '刷新失败',
    conflictTitle: '设置冲突：源路径已被其他页面修改。',
    conflictDetail: '本页基于修订 {expected}，当前已是修订 {actual}。',
    conflictRetry: '拉取新修订并重试',
    laneBusy: '另一个变更正在进行，请稍后重试',
    installBtn: '安装',
    updateBtn: '更新',
    uninstallBtn: '卸载',
    confirmInstall: '确认安装？（导出到专家目录）',
    confirmUpdate: '确认更新？',
    confirmUninstall: '确认卸载？（删除导出的专家文件夹）',
    cancel: '取消',
    actionBusy: '处理中…',
    installDone: '已安装「{name}」',
    updateDone: '已更新「{name}」',
    uninstallDone: '已卸载「{name}」',
    installFailed: '安装失败',
    updateFailed: '更新失败',
    uninstallFailed: '卸载失败',
    orphansTitle: '已安装但不在当前源',
    orphansHint: '这些专家装自别的源目录（或其卡已不在当前源）——只呈列，不自动卸载；确认后可删除导出文件夹。',
    orphanImported: '安装于 {when}',
    brokenTitle: '导出损坏',
    brokenHint: '这些导出文件夹的来源清单已损坏——卸载后重装即可恢复。',
    groupExpand: '展开团队成员',
    groupCollapse: '收起团队成员',
    groupMembers: '成员 {shown}/{total}',
    installedCount: '已装 {n}',
    updatableCount: '可更新 {n}',
    brokenCount: '损坏 {n}'
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
    removeExpert: 'Remove expert, back to default',
    removeExpertTitle: 'Remove the current expert and return to the default agent (history is kept)',
    clearing: 'Removing expert…',
    clearFailed: 'Remove failed',
    cancelStaged: 'Cancel staged pick',
    cancelStagedTitle: 'Drop the pick that would apply after creation',
    footSession: 'Picking switches at the next model request boundary; history is kept',
    footDraft: 'The pick is applied the moment the session is created',
    nav: 'WorkBuddy Experts',
    marketTitle: 'WorkBuddy Expert Market',
    marketSubtitle: 'Browse the local WorkBuddy source scan, install experts (exported into the user experts directory), and switch with /expert once installed.',
    censusExperts: '{n} experts',
    censusPlugins: '{n} plugins',
    censusCategories: '{n} categories',
    search: 'Search names, descriptions, or ids — both languages',
    filterAll: 'All',
    filterInstalled: 'Installed',
    filterUpdatable: 'Updatable',
    filterSkills: 'With skills',
    filterTeam: 'Team',
    categoryAll: 'All categories',
    categoryNone: 'Uncategorized',
    categoryRowLabel: 'Filter by category',
    matchesPlain: '{n} shown',
    matchesEcho: '{n} matches for "{q}"',
    emptyHint: 'No matching experts',
    emptyTip: 'If the source directory is empty, check the path notice above.',
    clearFilters: 'Clear filters',
    bannerMissingPath: 'Source path does not exist:',
    bannerMissingHint: 'The directory is missing or mistyped — the notice clears once it is fixed.',
    warningsToggle: '{n} scan warnings',
    marketLoadFailed: 'Failed to load market data',
    busy: 'Loading…',
    installedStamp: 'installed',
    updatableStamp: 'updatable',
    exportBrokenStamp: 'export broken',
    skillsBadge: '{n} skills',
    teamBadge: 'team ·{n}',
    pathLabel: 'Source path',
    apply: 'Apply',
    applying: 'Applying…',
    refreshBtn: 'Refresh',
    pathApplied: 'Source path updated: {path}',
    configFailed: 'Failed to save the path',
    refreshFailed: 'Refresh failed',
    conflictTitle: 'Settings conflict: the source path was changed on another page.',
    conflictDetail: 'This page was on revision {expected}; the current revision is {actual}.',
    conflictRetry: 'Pull the new revision and retry',
    laneBusy: 'Another change is in progress — try again shortly',
    installBtn: 'Install',
    updateBtn: 'Update',
    uninstallBtn: 'Uninstall',
    confirmInstall: 'Install now? (exports into the experts directory)',
    confirmUpdate: 'Update now?',
    confirmUninstall: 'Uninstall now? (deletes the exported expert folder)',
    cancel: 'Cancel',
    actionBusy: 'Working…',
    installDone: 'Installed "{name}"',
    updateDone: 'Updated "{name}"',
    uninstallDone: 'Uninstalled "{name}"',
    installFailed: 'Install failed',
    updateFailed: 'Update failed',
    uninstallFailed: 'Uninstall failed',
    orphansTitle: 'Installed but not in the current source',
    orphansHint: 'These experts came from another source directory (or their card left this one) — listed, never auto-uninstalled; confirm to delete the exported folder.',
    orphanImported: 'installed {when}',
    brokenTitle: 'Broken exports',
    brokenHint: 'These exported folders carry a corrupt source manifest — uninstall then reinstall to recover.',
    groupExpand: 'Expand team members',
    groupCollapse: 'Collapse team members',
    groupMembers: '{shown}/{total} members',
    installedCount: '{n} installed',
    updatableCount: '{n} updatable',
    brokenCount: '{n} broken'
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
 * Thrown errors carry the HTTP status and, when the host sent them, the
 * structured fields the market page's conflict flow keys off: `code`
 * (SETTINGS_CONFLICT) and the two revisions of a config conflict.
 */
function api (path, options) {
  var init = Object.assign({ credentials: 'same-origin' }, options || {})
  return fetch(path, init).then(function (response) {
    return response.json().catch(function () { return {} }).then(function (body) {
      if (!response.ok) {
        var error = new Error(body && body.error ? body.error : 'HTTP ' + response.status)
        error.status = response.status
        if (body !== null && typeof body === 'object') {
          if (typeof body.code === 'string') error.code = body.code
          if (body.expectedRevision !== undefined) error.expectedRevision = body.expectedRevision
          if (body.revision !== undefined) error.revision = body.revision
        }
        throw error
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

/** The scope-selector trigger's chevron: the host's ic_ds_chevron_down_outline_14
 * (dsh-client-ui-primitives), verbatim; currentColor so the trigger tints it. */
function caretChevron () {
  return el('svg', {
    viewBox: '0 0 14 14', width: 14, height: 14, fill: 'none', 'aria-hidden': 'true'
  }, el('path', {
    d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z',
    fill: 'currentColor'
  }))
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
 *                  clears the draft — the host composes the expert on the
 *                  just-created agent (in-memory state, no durable event),
 *                  so no "已选未生效" window ever exists.
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
  // draft is consumed either way — the host owns the compose once the
  // POST is accepted (selection state stays host-side, in memory).
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

  /** Remove: live session → clear transaction; staged draft → drop it. */
  var removeCurrent = function () {
    setOpen(false)
    if (staged !== null) {
      setStaged(null)
      return
    }
    if (sessionId === '' || currentExpertId === '') return
    setSwitching({ clear: true })
    postJson(API_BASE + '/clear', { sessionId: sessionId })
      .then(function (result) {
        if (result !== null && typeof result === 'object' && result.kind === 'error') {
          setError(t('clearFailed') + '：' + (result.text || ''))
        }
        return pull()
      }, function (err) {
        setError(t('clearFailed') + '：' + (err && err.message ? err.message : String(err)))
        return pull()
      })
      .then(function () { setSwitching(null) })
  }

  // The button's face: the switching target while a transaction runs
  // (disabled), the staged pick while no session exists, otherwise the
  // current expert's name (or the bare 专家 label when none). The face
  // expert rides the same resolution so the button shows the avatar
  // beside the name whenever a concrete expert occupies the seat. A clear
  // transaction keeps the CURRENT expert's face with a removing label.
  var busy = switching !== null
  var clearing = busy && switching.clear === true
  var faceExpert = null
  var faceName = ''
  if (clearing) faceExpert = byId[currentExpertId]
  else if (busy) faceExpert = byId[switching.expertId]
  else if (staged !== null) faceExpert = byId[staged.expertId]
  else if (currentExpertId !== '') faceExpert = byId[currentExpertId]
  if (clearing) faceName = nameOf(byId[currentExpertId]) || currentExpertId
  else if (busy) faceName = nameOf(byId[switching.expertId]) || switching.expertId
  else if (staged !== null) faceName = nameOf(byId[staged.expertId]) || staged.expertId
  else if (currentExpertId !== '') faceName = nameOf(byId[currentExpertId]) || currentExpertId

  var buttonLabel = t('buttonLabel')
  if (clearing) buttonLabel = t('clearing')
  else if (busy) buttonLabel = t('switchingTo', { name: faceName })
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
        el(AvatarFace, { expert: expert, imgClass: 'wbe-avatar', glyphClass: 'wbe-avatar' }),
        el('span', { className: 'wbe-item-main' },
          el('span', { className: 'wbe-item-line' },
            el('span', { className: 'wbe-item-name' }, nameOf(expert)),
            el('span', { className: 'wbe-item-id' }, strOf(expert.id)),
            broken ? el('span', { className: 'wbe-item-broken' }, '⚠ ', t('brokenStamp')) : null,
            current ? el('span', { className: 'wbe-current-mark' }, '✓ ', t('currentMark')) : null,
            isStaged ? el('span', { className: 'wbe-current-mark' }, t('stagedMark')) : null),
          strOf(expert.description) !== '' && !broken
            ? el('span', { className: 'wbe-item-desc' }, strOf(expert.description))
            : null,
          broken ? el('span', { className: 'wbe-item-reason' }, strOf(expert.broken)) : null))
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
      // The removal lane: a staged draft cancels locally; a live selection
      // POSTs the clear transaction (dispose + default agent). Rendered
      // only when something is actually selected.
      staged !== null
        ? el('button', {
            type: 'button', className: 'wbe-remove', onClick: removeCurrent,
            title: t('cancelStagedTitle')
          }, '✕ ', t('cancelStaged'))
        : sessionId !== '' && currentExpertId !== ''
          ? el('button', {
              type: 'button', className: 'wbe-remove', disabled: busy,
              onClick: removeCurrent, title: t('removeExpertTitle')
            }, '✕ ', t('removeExpert'))
          : null,
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
      faceExpert !== null && faceExpert !== undefined
        ? el(AvatarFace, { expert: faceExpert, imgClass: 'wbe-btn-avatar', glyphClass: 'wbe-btn-avatar' })
        : null,
      el('span', { className: 'wbe-btn-label' }, buttonLabel),
      el('span', {
        className: 'wbe-caret', 'data-open': open ? 'true' : undefined, 'aria-hidden': 'true'
      }, caretChevron())),
    menu)
}

// ── the market page (ticket 08): pure derivations + components ───────────────
//
// Ported from wb-market's client with three adaptations:
//   - install/update/uninstall ride THIS plugin's routes and expert-folder
//     semantics (安装专家 = 导出到专家目录; 卸载 = 删除该文件夹);
//   - the per-card overlay comes from /api/state's installed/broken/orphans
//     lists — a card is broken when the broken list holds its id (a corrupt
//     export manifest never joins `installed`, so the broken flag must be
//     merged client-side);
//   - the engine responses carry the fresh state inline ({ ..., state }),
//     so a successful action adopts it directly and only falls back to a
//     refetch when it is missing.

/** The localized-then-base pick shared by the name and description chains. */
function localePick (zh, base, localeId) {
  return localeId === 'zh' ? (zh !== '' ? zh : base) : (base !== '' ? base : zh)
}

/** The card name under one UI language (localized first, base fallback, id last). */
function localeNameOf (expert, localeId) {
  var pick = localePick(strOf(expert.zhName), strOf(expert.name), localeId)
  return pick !== '' ? pick : strOf(expert.id)
}

/** The card description under one UI language, same localized-then-base chain. */
function localeDescriptionOf (expert, localeId) {
  return localePick(strOf(expert.zhDescription), strOf(expert.description), localeId)
}

/** Team card = the source plugin directory holds more than one agent file. */
function isTeam (expert) {
  return typeof expert.teamSize === 'number' && expert.teamSize > 1
}

/** Skills badge eligibility = the scan saw at least one skills/ subdirectory. */
function hasSkills (expert) {
  return Array.isArray(expert.skills) && expert.skills.length > 0
}

// The category dimension: the scanner keeps plugin.json `categoryId` VERBATIM
// on every card; the raw string is the filter key, only the DISPLAY label is
// derived here, so an unknown category from a future source directory still
// filters perfectly (prefix-stripped raw name).

/** Chip id for experts whose plugin.json carried no categoryId. */
var NO_CATEGORY = '·uncategorized·'

/** WorkBuddy marketplace grouping keys seen in the real corpus, localized. */
var KNOWN_CATEGORY_LABELS = {
  '01-ProductDesign': { zh: '产品设计', en: 'Product Design' },
  '02-Engineering': { zh: '工程开发', en: 'Engineering' },
  '04-DataAI': { zh: '数据与 AI', en: 'Data & AI' },
  '06-ContentCreative': { zh: '内容创作', en: 'Content & Creative' },
  '08-FinanceInvestment': { zh: '金融投资', en: 'Finance & Investment' },
  '10-ProjectQuality': { zh: '项目与质量', en: 'Project & Quality' }
}

/** The card's raw category string ('' when the source had none). */
function categoryOf (expert) {
  return strOf(expert !== null && typeof expert === 'object' ? expert.category : undefined)
}

/** The card's chip key: the raw category, or the uncategorized sentinel. */
function categoryKeyOf (expert) {
  var raw = categoryOf(expert)
  return raw !== '' ? raw : NO_CATEGORY
}

/** The display label of one raw categoryId (known map → prefix-stripped raw). */
function categoryLabelOf (rawCategory, localeId) {
  var raw = strOf(rawCategory)
  if (raw === '') return ''
  var known = KNOWN_CATEGORY_LABELS[raw]
  if (known !== undefined) return localeId === 'zh' ? known.zh : known.en
  var stripped = raw.replace(/^\d+[-_]/, '')
  return stripped !== '' ? stripped : raw
}

/** The searchable text one category contributes (both label spellings). */
function categoryHayshare (rawCategory) {
  var raw = strOf(rawCategory)
  if (raw === '') return ''
  return [raw, categoryLabelOf(raw, 'zh'), categoryLabelOf(raw, 'en')].join(' ').trim()
}

/** The category chip entries of one table: raw ids name-sorted + counts. */
function categoryChipsOf (experts) {
  var counts = {}
  var order = []
  var none = 0
  var list = Array.isArray(experts) ? experts : []
  for (var i = 0; i < list.length; i++) {
    var expert = list[i]
    if (expert === null || typeof expert !== 'object') continue
    var raw = categoryOf(expert)
    if (raw === '') { none++; continue }
    if (counts[raw] === undefined) { counts[raw] = 0; order.push(raw) }
    counts[raw]++
  }
  order.sort()
  var chips = order.map(function (raw) { return { id: raw, count: counts[raw] } })
  if (none > 0) chips.push({ id: NO_CATEGORY, count: none })
  return chips
}

/** The search haystack of one card: both languages, id, plugin, skills, category. */
function haystackOf (expert) {
  return [strOf(expert.id), strOf(expert.name), strOf(expert.zhName),
    strOf(expert.description), strOf(expert.zhDescription), strOf(expert.pluginDir),
    (Array.isArray(expert.skills) ? expert.skills : []).join(' '),
    categoryHayshare(categoryOf(expert))].join(' ').toLowerCase()
}

// TEMP: the team feature is not fully tested yet — hide every team-related
// piece of the market page (filter chip, card badge, group view) until it is.
// Flip to true to bring the display back; all logic below stays intact.
var TEAM_UI_ENABLED = false

/**
 * The five filter-chip states in toolbar order. Each `keep` predicate IS
 * the chip's tolerant contract: absent state fields never match.
 */
var FILTERS = [
  { id: 'all', key: 'filterAll', stat: 'total', keep: function () { return true } },
  { id: 'installed', key: 'filterInstalled', stat: 'installed',
    keep: function (expert) { return expert.installed === true } },
  { id: 'updatable', key: 'filterUpdatable', stat: 'updatable',
    keep: function (expert) { return expert.updatable === true } },
  { id: 'skills', key: 'filterSkills', stat: 'skills', keep: hasSkills },
  { id: 'team', key: 'filterTeam', stat: 'team', keep: isTeam }
]

/** The table entry of one filter id (unknown ids degrade to 'all'). */
function filterOf (filterId) {
  for (var i = 0; i < FILTERS.length; i++) {
    if (FILTERS[i].id === filterId) return FILTERS[i]
  }
  return FILTERS[0]
}

/**
 * One filter pass: the status chip crossed with the free-text query and the
 * category chip — three-way stackable, pure and synchronous (search and
 * filtering are purely client-side by design).
 */
function filterExperts (experts, filter, query, category) {
  var keep = filterOf(filter).keep
  var q = strOf(query).toLowerCase()
  var wantCategory = typeof category === 'string' && category !== '' && category !== 'all'
  return experts.filter(function (expert) {
    if (!keep(expert)) return false
    if (wantCategory && categoryKeyOf(expert) !== category) return false
    if (q === '') return true
    return haystackOf(expert).indexOf(q) !== -1
  })
}

/**
 * Group ALREADY-FILTERED cards by their source plugin directory, in
 * first-card order. A team (`teamSize > 1` or several members surviving the
 * filter) renders as a collapsible group; a lone solo card renders exactly
 * as the un-grouped grid always did. Grouping is PRESENTATION ONLY — chips,
 * match counts, and the census keep counting EXPERT CARDS.
 */
function groupCardsByPlugin (experts) {
  var groups = []
  var byDir = {}
  for (var i = 0; i < experts.length; i++) {
    var expert = experts[i]
    var dir = strOf(expert.pluginDir)
    var key = dir !== '' ? dir : '·no-plugin·'
    var group = byDir[key]
    if (group === undefined) {
      group = { pluginDir: key, members: [], team: false }
      byDir[key] = group
      groups.push(group)
    }
    group.members.push(expert)
  }
  for (var g = 0; g < groups.length; g++) {
    groups[g].team = groups[g].members.length > 1 || isTeam(groups[g].members[0])
  }
  return groups
}

/**
 * Whether one team group stands expanded: the user's EXPLICIT choice wins
 * either way; the default follows `filteredActive` (expanded under an active
 * query/filter so matched members are visible without a second click).
 */
function groupExpanded (openMap, pluginDir, filteredActive) {
  var choice = openMap === null || openMap === undefined ? undefined : openMap[pluginDir]
  if (choice === true) return true
  if (choice === false) return false
  return filteredActive === true
}

/** Aggregate status counts over a group's (filtered) members. */
function groupStatsOf (members) {
  var out = { installed: 0, updatable: 0, broken: 0 }
  for (var i = 0; i < members.length; i++) {
    var expert = members[i]
    if (expert.installed === true) out.installed++
    if (expert.updatable === true) out.updatable++
    if (expert.broken === true) out.broken++
  }
  return out
}

/**
 * The inline actions one card offers: broken export → uninstall only (its
 * fix is 卸载重装); installed + updatable → update THEN uninstall;
 * installed → uninstall; otherwise install.
 */
function cardActionsOf (expert) {
  if (expert.broken === true) return ['uninstall']
  if (expert.installed === true) {
    return expert.updatable === true ? ['update', 'uninstall'] : ['uninstall']
  }
  return ['install']
}

/** Dictionary keys per action — buttons, confirms, done/failed notices. */
var ACTION_TEXT = {
  install: { button: 'installBtn', confirm: 'confirmInstall', done: 'installDone', failed: 'installFailed' },
  update: { button: 'updateBtn', confirm: 'confirmUpdate', done: 'updateDone', failed: 'updateFailed' },
  uninstall: { button: 'uninstallBtn', confirm: 'confirmUninstall', done: 'uninstallDone', failed: 'uninstallFailed' }
}

/** The confirm-button variant per action: destructive → danger tone. */
function confirmVariantOf (action) {
  return action === 'uninstall' ? 'danger' : 'primary'
}

/** Locale-aware import timestamp; any unusable value falls back to raw. */
function formatWhen (value, localeId) {
  var raw = strOf(value)
  if (raw === '') return ''
  var date = new Date(raw)
  if (isNaN(date.getTime())) return raw
  try {
    return date.toLocaleString(localeId === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    })
  } catch (error) {
    return raw
  }
}

/** One default action button (factory: each captures ITS action). */
function actionButton (t, action, laneBusy, onConfirm) {
  return el('button', {
    key: action, className: 'wbx-btn', type: 'button',
    'data-variant': action === 'install' ? 'primary' : undefined,
    disabled: laneBusy,
    onClick: function () { onConfirm(action) }
  }, t(ACTION_TEXT[action].button))
}

/** The confirm/cancel pair one action swaps in (sister's inline confirm). */
function confirmPair (t, action, laneBusy, onAction, onCancelConfirm) {
  return [
    el('button', {
      key: action, className: 'wbx-btn', type: 'button',
      'data-variant': confirmVariantOf(action),
      disabled: laneBusy,
      onClick: function () { onAction(action) }
    }, t(ACTION_TEXT[action].confirm)),
    el('button', {
      key: 'cancel', className: 'wbx-btn', type: 'button',
      onClick: function () { onCancelConfirm() }
    }, t('cancel'))
  ]
}

/**
 * The single inline action-row renderer shared by expert cards and orphan /
 * broken rows. States, in priority order:
 *   busy (this row)      → one disabled 处理中… button;
 *   confirming (action)  → [确认…？ (variant)] [取消];
 *   default              → one button per action.
 */
function ActionRow (props) {
  var t = props.t
  var laneBusy = props.laneBusy === true
  var rowBusy = props.busyKey === props.rowKey
  var buttons = null

  if (rowBusy) {
    buttons = el('button', { className: 'wbx-btn', type: 'button', disabled: true }, t('actionBusy'))
  } else {
    buttons = []
    for (var i = 0; i < props.actions.length; i++) {
      var action = props.actions[i]
      if (props.confirmKey === props.rowKey + ':' + action) {
        buttons = confirmPair(t, action, laneBusy, props.onAction, props.onCancelConfirm)
        break
      }
      buttons.push(actionButton(t, action, laneBusy, props.onConfirm))
    }
  }
  return el('div', { className: 'wbx-actions' }, buttons)
}

/**
 * The shared avatar face: the card's PNG through avatarUrl when the payload
 * carries one AND it loads (onError flips to the glyph), the static 🧑‍💻
 * emoji otherwise — a PNG-less card or a failed load makes no placeholder
 * request.
 */
function AvatarFace (props) {
  var expert = props.expert
  var avatarState = React.useState(false)
  var avatarFailed = avatarState[0]
  var setAvatarFailed = avatarState[1]
  if (!avatarFailed && strOf(expert.avatarUrl) !== '') {
    return el('img', {
      className: props.imgClass,
      src: expert.avatarUrl,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      onError: function () { setAvatarFailed(true) }
    })
  }
  return el('span', { className: props.glyphClass, 'aria-hidden': 'true' }, AVATAR_EMOJI)
}

/**
 * One expert card: avatar (PNG via avatarUrl; onError OR a PNG-less card
 * falls back to the static emoji), a locale-following name over the mono
 * id, a locale-following two-line description, provenance badges (source
 * plugin / skills count / team), TOLERANT status marks — ✓ installed /
 * ↑ updatable / ⚠ broken render only when the merged card carries the
 * field — and the action row parked in the top-right corner, revealed on
 * hover/focus (安装 → 卸载/更新 per install state). Handler props are
 * optional so read-only renders (the smoke's card-only checks) keep
 * working.
 */
function ExpertCard (props) {
  var t = props.t
  var expert = props.expert
  var localeId = props.localeId

  var avatar = el(AvatarFace, { expert: expert, imgClass: 'wbx-avatar', glyphClass: 'wbx-emoji' })

  var name = localeNameOf(expert, localeId)
  var badges = []
  var pluginDir = strOf(expert.pluginDir)
  if (pluginDir !== '') {
    badges.push(el('span', { key: 'plugin', className: 'wbx-badge', 'data-kind': 'plugin', title: pluginDir }, pluginDir))
  }
  var category = categoryOf(expert)
  if (category !== '') {
    badges.push(el('span', {
      key: 'category', className: 'wbx-badge', 'data-kind': 'category', title: category
    }, categoryLabelOf(category, localeId)))
  }
  if (hasSkills(expert)) {
    badges.push(el('span', { key: 'skills', className: 'wbx-badge', 'data-kind': 'skills' },
      t('skillsBadge', { n: expert.skills.length })))
  }
  if (TEAM_UI_ENABLED && isTeam(expert)) {
    badges.push(el('span', { key: 'team', className: 'wbx-badge', 'data-kind': 'team' },
      t('teamBadge', { n: expert.teamSize })))
  }

  var marks = []
  if (expert.broken === true) {
    marks.push(el('span', { key: 'broken', className: 'wbx-mark', 'data-kind': 'bad' }, '⚠ ', t('exportBrokenStamp')))
  }
  if (expert.installed === true) {
    marks.push(el('span', { key: 'installed', className: 'wbx-mark', 'data-kind': 'ok' }, '✓ ', t('installedStamp')))
  }
  if (expert.updatable === true) {
    marks.push(el('span', { key: 'updatable', className: 'wbx-mark', 'data-kind': 'upd' }, '↑ ', t('updatableStamp')))
  }

  var actions = cardActionsOf(expert)
  var rowKey = 'expert:' + strOf(expert.id)

  return el('li', {
    className: 'wbx-card',
    'data-installed': expert.installed === true ? 'true' : undefined,
    'data-broken': expert.broken === true ? 'true' : undefined
  },
    el('div', { className: 'wbx-corner' },
      el(ActionRow, {
        t: t,
        rowKey: rowKey,
        actions: actions,
        laneBusy: props.laneBusy === true,
        busyKey: props.busyKey || '',
        confirmKey: props.confirmKey || '',
        onConfirm: function (action) {
          if (typeof props.onActionConfirm === 'function') props.onActionConfirm(rowKey + ':' + action)
        },
        onCancelConfirm: function () {
          if (typeof props.onCancelConfirm === 'function') props.onCancelConfirm()
        },
        onAction: function (action) {
          if (typeof props.onAction === 'function') props.onAction(expert, action)
        }
      })),
    el('div', { className: 'wbx-card-top' },
      avatar,
      el('div', { className: 'wbx-card-title' },
        el('span', { className: 'wbx-name', title: name }, name),
        el('span', { className: 'wbx-id' }, strOf(expert.id)))),
    el('p', { className: 'wbx-desc' }, localeDescriptionOf(expert, localeId)),
    badges.length > 0 ? el('div', { className: 'wbx-badges' }, badges) : null,
    marks.length > 0 ? el('div', { className: 'wbx-foot' },
      el('div', { className: 'wbx-status' }, marks)) : null)
}

/**
 * The full-width header of one team group: caret, first-four member faces,
 * the mono plugin directory, the team badge, the shown/total count, and
 * aggregated status counts over the SHOWN members. Member cards are
 * appended by the page as ordinary ExpertCards right after this header.
 */
function TeamGroup (props) {
  var t = props.t
  var group = props.group
  var expanded = props.expanded === true
  var members = group.members
  var stats = groupStatsOf(members)
  var teamSize = typeof members[0].teamSize === 'number' && members[0].teamSize > members.length
    ? members[0].teamSize : members.length

  var faces = []
  var faceCount = Math.min(members.length, 4)
  for (var i = 0; i < faceCount; i++) {
    faces.push(el(AvatarFace, {
      key: strOf(members[i].id), expert: members[i],
      imgClass: 'wbx-gavatar', glyphClass: 'wbx-gavatar'
    }))
  }

  var marks = []
  if (stats.broken > 0) {
    marks.push(el('span', { key: 'broken', className: 'wbx-mark', 'data-kind': 'bad' }, '⚠ ', t('brokenCount', { n: stats.broken })))
  }
  if (stats.installed > 0) {
    marks.push(el('span', { key: 'installed', className: 'wbx-mark', 'data-kind': 'ok' }, '✓ ', t('installedCount', { n: stats.installed })))
  }
  if (stats.updatable > 0) {
    marks.push(el('span', { key: 'updatable', className: 'wbx-mark', 'data-kind': 'upd' }, '↑ ', t('updatableCount', { n: stats.updatable })))
  }

  return el('li', { className: 'wbx-group' },
    el('button', {
      className: 'wbx-group-head', type: 'button',
      'aria-expanded': expanded ? 'true' : 'false',
      title: t(expanded ? 'groupCollapse' : 'groupExpand'),
      onClick: function () {
        if (typeof props.onToggle === 'function') props.onToggle(group.pluginDir)
      }
    },
      el('span', { className: 'wbx-group-caret', 'aria-hidden': 'true' }, expanded ? '▾' : '▸'),
      faces.length > 0 ? el('span', { className: 'wbx-group-faces', 'aria-hidden': 'true' }, faces) : null,
      el('span', { className: 'wbx-group-name', title: group.pluginDir }, group.pluginDir),
      el('span', { className: 'wbx-badge', 'data-kind': 'team' }, t('teamBadge', { n: teamSize })),
      el('span', { className: 'wbx-group-count' }, t('groupMembers', { shown: members.length, total: teamSize })),
      marks.length > 0 ? el('span', { className: 'wbx-group-marks' }, marks) : null))
}

/**
 * One orphan export: the mono id over a provenance meta line (source path ·
 * plugin dir · import date), and the same confirmed uninstall as the cards —
 * the host uninstalls by expert id off the export manifest, not the scan
 * table. Orphan entries carry no names (their card left this source), so
 * the id IS the name.
 */
function OrphanRow (props) {
  var t = props.t
  var orphan = props.orphan
  var localeId = props.localeId

  var meta = []
  if (strOf(orphan.sourcePath) !== '') meta.push(strOf(orphan.sourcePath))
  if (strOf(orphan.pluginDir) !== '') meta.push(strOf(orphan.pluginDir))
  var when = formatWhen(orphan.importedAt, localeId)
  if (when !== '') meta.push(t('orphanImported', { when: when }))

  var rowKey = 'orphan:' + strOf(orphan.id)
  var name = strOf(orphan.id)

  return el('li', { className: 'wbx-orphan' },
    el('div', { className: 'wbx-orphan-main' },
      el('div', { className: 'wbx-orphan-line' },
        el('span', { className: 'wbx-orphan-name', title: name }, name),
        el('span', { className: 'wbx-orphan-id' }, strOf(orphan.dir) !== '' ? strOf(orphan.dir) : name)),
      meta.length > 0 ? el('span', { className: 'wbx-orphan-meta' }, meta.join(' · ')) : null),
    el(ActionRow, {
      t: t,
      rowKey: rowKey,
      actions: ['uninstall'],
      laneBusy: props.laneBusy === true,
      busyKey: props.busyKey || '',
      confirmKey: props.confirmKey || '',
      onConfirm: function (action) {
        if (typeof props.onActionConfirm === 'function') props.onActionConfirm(rowKey + ':' + action)
      },
      onCancelConfirm: function () {
        if (typeof props.onCancelConfirm === 'function') props.onCancelConfirm()
      },
      onAction: function (action) {
        if (typeof props.onAction === 'function') props.onAction(orphan, action)
      }
    }))
}

/**
 * One broken export whose id left the scan table (a broken export whose id
 * is still in the table shows its ⚠ on the CARD instead): the id with the
 * ⚠ badge, the host's「清单缺失，请卸载重装」reason as the meta line, and
 * the confirmed uninstall that IS the recovery path.
 */
function BrokenRow (props) {
  var t = props.t
  var broken = props.broken

  var meta = []
  if (strOf(broken.dir) !== '') meta.push(strOf(broken.dir))
  if (strOf(broken.reason) !== '') meta.push(strOf(broken.reason))

  var rowKey = 'broken:' + strOf(broken.id)
  var name = strOf(broken.id)

  return el('li', { className: 'wbx-orphan', 'data-broken': 'true' },
    el('div', { className: 'wbx-orphan-main' },
      el('div', { className: 'wbx-orphan-line' },
        el('span', { className: 'wbx-orphan-name', title: name }, name),
        el('span', { className: 'wbx-orphan-broken' }, '⚠ ', t('exportBrokenStamp'))),
      meta.length > 0 ? el('span', { className: 'wbx-orphan-meta' }, meta.join(' · ')) : null),
    el(ActionRow, {
      t: t,
      rowKey: rowKey,
      actions: ['uninstall'],
      laneBusy: props.laneBusy === true,
      busyKey: props.busyKey || '',
      confirmKey: props.confirmKey || '',
      onConfirm: function (action) {
        if (typeof props.onActionConfirm === 'function') props.onActionConfirm(rowKey + ':' + action)
      },
      onCancelConfirm: function () {
        if (typeof props.onCancelConfirm === 'function') props.onCancelConfirm()
      },
      onAction: function (action) {
        if (typeof props.onAction === 'function') props.onAction(broken, action)
      }
    }))
}

/** The circular-arrow glyph; it spins while `spinning` (CSS class). */
function refreshIcon (spinning) {
  return el('svg', {
    viewBox: '0 0 16 16', width: 13, height: 13,
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
    'aria-hidden': 'true',
    className: spinning ? 'wbx-spin' : undefined
  },
    el('path', { d: 'M13.5 8a5.5 5.5 0 1 1-1.62-3.88' }),
    el('path', { d: 'M13.7 1.6v2.8h-2.8' }))
}

// ── the market page itself ───────────────────────────────────────────────────

/**
 * The settings.section「WorkBuddy 专家」page: one /api/state pull per mount
 * (bilingual payload; client-side search/filter), the path topbar (apply
 * with the optimistic-lock revision, conflict box + retry), the spinning
 * refresh, and inline confirmed install/update/uninstall on cards, orphans,
 * and broken exports.
 *
 * Lane discipline mirrors the host's single flight: at most ONE of {row
 * action, refresh, apply} is ever in flight from this page, so a 409 can
 * only arrive from a RACING tab — and when it does, the handler path is the
 * ordinary error path: notice + busy state released, buttons back.
 *
 * Optional `initialState` seam (undefined in production) lets the offline
 * smoke render real states without a fetch layer.
 */
function MarketPage (props) {
  var t = props.t

  var initialPath = props.initialState !== undefined && props.initialState !== null &&
    typeof props.initialState.sourcePath === 'string' ? props.initialState.sourcePath : ''
  var stateState = React.useState(props.initialState === undefined ? null : props.initialState)
  var setState = stateState[1]
  var body = stateState[0]
  var experts = body !== null && body !== undefined && Array.isArray(body.experts) ? body.experts : null
  var orphans = body !== null && body !== undefined && Array.isArray(body.orphans) ? body.orphans : []
  var brokenList = body !== null && body !== undefined && Array.isArray(body.broken) ? body.broken : []

  var errorState = React.useState('')
  var setError = errorState[1]
  var error = errorState[0]

  // busyKey: '' | 'expert:<id>' | 'orphan:<id>' | 'broken:<id>' — the row
  // whose lane action is in flight (one at a time).
  var busyState = React.useState('')
  var setBusyKey = busyState[1]
  var busyKey = busyState[0]

  // confirmKey: '' | '<rowKey>:<action>' — the row+action awaiting its
  // inline confirmation; auto-reverts after 4 seconds (sister pattern).
  var confirmState = React.useState('')
  var setConfirmKey = confirmState[1]
  var confirmKey = confirmState[0]

  // The refresh flight: the icon spins and the button disables for the
  // whole duration — no double submits.
  var refreshingState = React.useState(false)
  var setRefreshing = refreshingState[1]
  var refreshing = refreshingState[0]

  // The path-apply flight.
  var savingState = React.useState(false)
  var setSaving = savingState[1]
  var saving = savingState[0]

  // openGroups: the user's EXPLICIT per-pluginDir choice for team groups.
  var openGroupsState = React.useState({})
  var setOpenGroups = openGroupsState[1]
  var openGroups = openGroupsState[0]

  // A config 409 SETTINGS_CONFLICT: { expected, actual }.
  var conflictState = React.useState(null)
  var setConflict = conflictState[1]
  var conflict = conflictState[0]

  // Action feedback: ok fades after 6 seconds, errors stay until the next
  // action (sister pattern).
  var noticeState = React.useState(null)
  var setNotice = noticeState[1]
  var notice = noticeState[0]

  // The path draft. syncedRef holds the sourcePath the CURRENT draft was
  // synced from: while the user has not diverged from it, every fresh
  // payload re-syncs the draft; once the user typed, the draft is theirs
  // and only a successful apply of it re-syncs. draftRef is the async-safe
  // read the retry flow uses.
  var draftState = React.useState(initialPath)
  var setDraftPath = draftState[1]
  var draftPath = draftState[0]
  var syncedRef = React.useRef(initialPath)
  var draftRef = React.useRef(initialPath)

  var queryState = React.useState('')
  var setQuery = queryState[1]
  var query = queryState[0]

  var filterState = React.useState('all')
  var setFilter = filterState[1]
  var filter = filterState[0]

  // The category chip: 'all' | one raw categoryId | NO_CATEGORY.
  var categoryState = React.useState('all')
  var setCategory = categoryState[1]
  var category = categoryState[0]

  // Scan warnings fold: collapsed by default — warnings are provenance, not
  // an alarm; the count is visible either way.
  var warnOpenState = React.useState(false)
  var setWarnOpen = warnOpenState[1]
  var warnOpen = warnOpenState[0]

  // The UI language, synced LIVE off the locale service: names/descriptions
  // re-derive from the SAME bilingual snapshot on every render.
  var localeState = React.useState(function () { return props.getLocale() })
  var localeId = localeState[0]
  var setLocaleId = localeState[1]
  React.useEffect(function () {
    var next = props.getLocale()
    if (next !== localeId) setLocaleId(next)
  })

  // The inline confirm auto-reverts after 4 seconds (sister pattern).
  React.useEffect(function () {
    if (confirmKey === '') return undefined
    var timer = setTimeout(function () { setConfirmKey('') }, 4000)
    return function () { clearTimeout(timer) }
  }, [confirmKey])

  // Success notices fade themselves out; errors stay until the next action.
  React.useEffect(function () {
    if (notice === null || notice.kind !== 'ok') return undefined
    var timer = setTimeout(function () { setNotice(null) }, 6000)
    return function () { clearTimeout(timer) }
  }, [notice])

  /** Adopt a fresh /api/state payload (and keep the draft in step). */
  function adoptState (payload) {
    var nextPath = strOf(payload !== null && payload !== undefined ? payload.sourcePath : '')
    // Capture the pre-adopt synced value: the functional updater may run
    // LATER than everything below it (React defers it to the render), so it
    // must close over the value at QUEUE time.
    var prevSynced = syncedRef.current
    setState(payload)
    setDraftPath(function (prev) { return prev === prevSynced ? nextPath : prev })
    if (draftRef.current === prevSynced) draftRef.current = nextPath
    syncedRef.current = nextPath
  }

  /**
   * The one state pull (+ the retry affordance on failure). Returns the
   * payload on success, undefined on failure — the conflict-retry chain
   * stops when the pull itself fails.
   */
  function pullState () {
    return api(API_BASE + '/state').then(function (payload) {
      adoptState(payload)
      setError('')
      return payload
    }, function (err) {
      setError(err && err.message ? err.message : String(err))
      return undefined
    })
  }

  // One state pull per mount — except under the initialState smoke seam,
  // where the page renders the handed snapshot without a fetch layer.
  React.useEffect(function () {
    if (props.initialState !== undefined) return undefined
    pullState()
  }, [])

  /**
   * An error message for a failed mutating call: the single-flight 409 gets
   * its localized hint wrapped around the host's raw message; a config
   * conflict is NOT handled here (it gets its own box).
   */
  function failText (key, err) {
    var raw = err !== null && err !== undefined && err.message ? err.message : String(err)
    var lane = err !== null && typeof err === 'object' && err.status === 409 && err.code !== 'SETTINGS_CONFLICT'
    return t(key) + '：' + (lane ? t('laneBusy') + '（' + raw + '）' : raw)
  }

  /**
   * POST /api/config with one revision of the optimistic lock. Success
   * adopts the new state (the banner flips to match the path's existence);
   * a SETTINGS_CONFLICT 409 renders both revisions; anything else is an
   * ordinary error notice. Resolves true/false — the caller releases the
   * saving state either way.
   */
  function applyRequest (sourcePath, expectedRevision) {
    return postJson(API_BASE + '/config', { sourcePath: sourcePath, expectedRevision: expectedRevision })
      .then(function (payload) {
        adoptState(payload)
        setError('')
        setConflict(null)
        setNotice({ kind: 'ok', text: t('pathApplied', { path: sourcePath }) })
        return true
      }, function (err) {
        if (err !== null && typeof err === 'object' && err.code === 'SETTINGS_CONFLICT') {
          setConflict({
            expected: err.expectedRevision !== undefined ? err.expectedRevision : expectedRevision,
            actual: err.revision
          })
        } else {
          setNotice({ kind: 'error', text: failText('configFailed', err) })
        }
        return false
      })
  }

  var draftTrimmed = draftPath.trim()
  var applyDisabled = saving || refreshing || busyKey !== '' ||
    draftTrimmed === '' || draftTrimmed === syncedRef.current

  var onApply = function () {
    if (applyDisabled) return
    setConflict(null)
    setNotice(null)
    setSaving(true)
    applyRequest(draftRef.current.trim(), body !== null && body !== undefined ? body.revision : undefined)
      .then(function () { setSaving(false) })
  }

  /**
   * Conflict retry: re-pull the state (its payload carries the CURRENT
   * revision), then replay the SAME draft against that revision. A failed
   * pull leaves the conflict box up.
   */
  var onConflictRetry = function () {
    if (saving || refreshing || busyKey !== '') return
    setNotice(null)
    setSaving(true)
    pullState().then(function (payload) {
      if (payload === undefined) return undefined
      return applyRequest(draftRef.current.trim(), payload.revision)
    }).then(function () { setSaving(false) })
  }

  /** POST /api/refresh — forced rescan; spinner + disabled for the flight. */
  var onRefresh = function () {
    if (refreshing || saving || busyKey !== '') return
    setNotice(null)
    setRefreshing(true)
    postJson(API_BASE + '/refresh', {}).then(function (payload) {
      adoptState(payload)
      setError('')
    }, function (err) {
      setNotice({ kind: 'error', text: failText('refreshFailed', err) })
    }).then(function () { setRefreshing(false) })
  }

  /**
   * One lane action (install/update/uninstall): confirm cleared, busy key
   * on, POST, ok-notice + state adoption on success (the engine responses
   * carry the fresh state inline; a missing one falls back to a refetch),
   * error notice on failure — and the busy key ALWAYS released, so a 409
   * from a racing tab leaves every button usable.
   */
  var runAction = function (entry) {
    setConfirmKey('')
    setNotice(null)
    setBusyKey(entry.key)
    return postJson(API_BASE + '/' + entry.action, { id: entry.id }).then(function (result) {
      setNotice({ kind: 'ok', text: t(ACTION_TEXT[entry.action].done, { name: entry.name }) })
      if (result !== null && typeof result === 'object' && result.state !== null && typeof result.state === 'object') {
        adoptState(result.state)
        return undefined
      }
      return pullState()
    }, function (err) {
      setNotice({ kind: 'error', text: failText(ACTION_TEXT[entry.action].failed, err) })
    }).then(function () { setBusyKey('') })
  }

  // Any lane flight of this page: a row action, the refresh, or the apply.
  var laneBusy = busyKey !== '' || refreshing || saving

  var onCardAction = function (expert, action) {
    if (laneBusy) return
    runAction({
      key: 'expert:' + strOf(expert.id),
      action: action,
      id: strOf(expert.id),
      name: localeNameOf(expert, localeId)
    })
  }

  var onOrphanAction = function (orphan, action) {
    if (laneBusy) return
    var id = strOf(orphan.id)
    runAction({ key: 'orphan:' + id, action: action, id: id, name: id })
  }

  var onBrokenAction = function (broken, action) {
    if (laneBusy) return
    var id = strOf(broken.id)
    runAction({ key: 'broken:' + id, action: action, id: id, name: id })
  }

  var onActionConfirm = function (key) { setConfirmKey(key) }
  var onCancelConfirm = function () { setConfirmKey('') }

  /**
   * Toggle one team group's fold: the user's choice flips from the group's
   * CURRENT EFFECTIVE state and is then stored explicitly — it wins over
   * the default from then on, in either direction.
   */
  var filteredActivePre = experts !== null && (query.trim() !== '' || filter !== 'all' || category !== 'all')
  var onToggleGroup = function (pluginDir) {
    setOpenGroups(function (prev) {
      var next = {}
      for (var key in prev) {
        if (Object.prototype.hasOwnProperty.call(prev, key)) next[key] = prev[key]
      }
      next[pluginDir] = !groupExpanded(prev, pluginDir, filteredActivePre)
      return next
    })
  }

  var onDraftChange = function (event) {
    var value = event !== null && event !== undefined && event.target !== null && event.target !== undefined
      ? event.target.value : ''
    draftRef.current = value
    setDraftPath(value)
  }

  // Merge the overlay onto the cards: the payload's per-card
  // installed/updatable flags plus the broken-export flag (broken exports
  // never join `installed`, so the client merges the id match itself).
  var cards = []
  var expertIds = {}
  if (experts !== null) {
    var brokenById = {}
    for (var bi = 0; bi < brokenList.length; bi++) brokenById[strOf(brokenList[bi].id)] = brokenList[bi]
    for (var ei = 0; ei < experts.length; ei++) {
      var card = experts[ei]
      if (card === null || typeof card !== 'object') continue
      expertIds[strOf(card.id)] = true
      cards.push(brokenById[strOf(card.id)] !== undefined
        ? Object.assign({}, card, { broken: true })
        : card)
    }
  }
  // Broken exports whose id left the scan table get their own rows below.
  var unmatchedBroken = brokenList.filter(function (entry) {
    return !expertIds[strOf(entry.id)]
  })

  var filtered = filterExperts(cards, filter, query, category)

  // Census + per-chip counts, in one pass over the full table — the chip
  // predicates come from the shared FILTERS table, so a new chip counts
  // itself. The census's category count is the number of DISTINCT non-empty
  // category values.
  var stats = null
  if (experts !== null) {
    stats = { total: cards.length, plugins: 0, categories: 0 }
    var pluginDirs = {}
    var categoryValues = {}
    for (var f = 1; f < FILTERS.length; f++) stats[FILTERS[f].stat] = 0
    for (var i = 0; i < cards.length; i++) {
      var expert = cards[i]
      for (var g = 1; g < FILTERS.length; g++) {
        if (FILTERS[g].keep(expert)) stats[FILTERS[g].stat]++
      }
      pluginDirs[strOf(expert.pluginDir)] = true
      var rawCategory = categoryOf(expert)
      if (rawCategory !== '') categoryValues[rawCategory] = true
    }
    stats.plugins = Object.keys(pluginDirs).length
    stats.categories = Object.keys(categoryValues).length
  }

  var categoryChips = experts !== null ? categoryChipsOf(cards) : []

  var warnings = body !== null && body !== undefined && Array.isArray(body.warnings) ? body.warnings : []
  var missingPath = body !== null && body !== undefined && body.pathExists === false

  var clearFilters = function () {
    setQuery('')
    setFilter('all')
    setCategory('all')
  }

  // null (not undefined) before the first fetch lands — cover both so the
  // skeleton, not the empty state, owns the first paint.
  var loading = experts === null

  // Whether a query, filter chip, or category chip is active — the team
  // groups' DEFAULT fold follows it.
  var filteredActive = !loading && (query.trim() !== '' || filter !== 'all' || category !== 'all')

  var cardsView = null
  if (loading) {
    cardsView = el('div', { 'aria-hidden': 'true' },
      el('p', { className: 'wbx-sr-only', role: 'status' }, t('busy')),
      el('div', { className: 'wbx-skel' },
        [0, 1, 2, 3, 4, 5, 6, 7].map(function (n) {
          return el('div', { className: 'wbx-skel-card', key: n })
        })))
  } else if (filtered.length === 0) {
    cardsView = el('div', { className: 'wbx-empty' },
      el('span', { className: 'wbx-empty-face', 'aria-hidden': 'true' }, AVATAR_EMOJI),
      el('p', { className: 'wbx-empty-title' }, t('emptyHint')),
      el('p', { className: 'wbx-empty-tip' }, t('emptyTip')),
      el('button', { className: 'wbx-btn', type: 'button', onClick: clearFilters }, t('clearFilters')))
  } else {
    // The grouped grid: solo cards render exactly as they always did; a
    // team's members sit behind one collapsible group header. Grouping is
    // presentation only — the chips, the matchline, and the census above
    // kept counting EXPERT CARDS.
    var cardOf = function (expert) {
      return el(ExpertCard, {
        key: strOf(expert.id), t: t, expert: expert, localeId: localeId,
        laneBusy: laneBusy, busyKey: busyKey, confirmKey: confirmKey,
        onActionConfirm: onActionConfirm, onCancelConfirm: onCancelConfirm,
        onAction: onCardAction
      })
    }
    var items = []
    var groups = groupCardsByPlugin(filtered)
    for (var gi = 0; gi < groups.length; gi++) {
      var group = groups[gi]
      if (!TEAM_UI_ENABLED || !group.team) {
        for (var si = 0; si < group.members.length; si++) items.push(cardOf(group.members[si]))
        continue
      }
      var expanded = groupExpanded(openGroups, group.pluginDir, filteredActive)
      items.push(el(TeamGroup, {
        key: 'group:' + group.pluginDir, t: t, group: group, expanded: expanded,
        onToggle: onToggleGroup
      }))
      if (expanded) {
        for (var mi = 0; mi < group.members.length; mi++) items.push(cardOf(group.members[mi]))
      }
    }
    cardsView = el('ul', { className: 'wbx-grid' }, items)
  }

  return el('div', { className: 'wbx-page' },
    el('header', { className: 'wbx-head' },
      el('div', { className: 'wbx-head-main' },
        el('h2', null, t('marketTitle')),
        el('p', { className: 'wbx-subtitle' }, t('marketSubtitle'))),
      stats !== null
        ? el('span', { className: 'wbx-census' },
            el('span', { className: 'wbx-census-item' }, t('censusExperts', { n: stats.total })),
            el('span', { className: 'wbx-census-item' }, t('censusPlugins', { n: stats.plugins })),
            el('span', { className: 'wbx-census-item' }, t('censusCategories', { n: stats.categories })))
        : null),
    // The mutating topbar: path draft + apply + spinning refresh.
    el('div', { className: 'wbx-pathbar' },
      el('div', { className: 'wbx-path-field' },
        el('input', {
          className: 'wbx-path-input',
          type: 'text',
          value: draftPath,
          placeholder: t('pathLabel'),
          'aria-label': t('pathLabel'),
          disabled: saving,
          onChange: onDraftChange
        })),
      el('button', {
        className: 'wbx-btn', type: 'button',
        disabled: applyDisabled,
        onClick: onApply
      }, saving ? t('applying') : t('apply')),
      el('button', {
        className: 'wbx-btn wbx-refresh', type: 'button',
        title: t('refreshBtn'),
        'aria-label': t('refreshBtn'),
        'aria-busy': refreshing ? 'true' : undefined,
        disabled: refreshing || saving || busyKey !== '',
        onClick: onRefresh
      },
        refreshIcon(refreshing),
        t('refreshBtn'))),
    conflict !== null
      ? el('div', { className: 'wbx-conflict', role: 'alert' },
          el('span', { className: 'wbx-conflict-body' },
            el('span', { className: 'wbx-conflict-title' }, t('conflictTitle')),
            el('span', { className: 'wbx-conflict-detail' },
              t('conflictDetail', { expected: conflict.expected, actual: conflict.actual }))),
          el('button', {
            className: 'wbx-btn', type: 'button',
            disabled: saving || refreshing || busyKey !== '',
            onClick: onConflictRetry
          }, t('conflictRetry')))
      : null,
    missingPath
      ? el('div', { className: 'wbx-banner', role: 'alert' },
          el('span', null, t('bannerMissingPath')),
          el('span', { className: 'wbx-banner-path' }, strOf(body.sourcePath)),
          el('span', { className: 'wbx-banner-hint' }, t('bannerMissingHint')))
      : null,
    el('input', {
      className: 'wbx-search',
      type: 'search',
      value: query,
      placeholder: t('search'),
      onChange: function (event) { setQuery(event.target.value) }
    }),
    el('div', { className: 'wbx-toolbar' },
      FILTERS.filter(function (chip) {
        return TEAM_UI_ENABLED || chip.id !== 'team'
      }).map(function (chip) {
        var active = filter === chip.id
        return el('button', {
          key: chip.id,
          className: 'wbx-chip', type: 'button',
          'aria-pressed': active ? 'true' : 'false',
          'data-active': active ? 'true' : undefined,
          onClick: function () { setFilter(chip.id) }
        },
          t(chip.key),
          stats !== null
            ? el('span', { className: 'wbx-chip-count' }, String(stats[chip.stat]))
            : null)
      })),
    // The category chip row: a SECOND, orthogonal dimension — raw
    // WorkBuddy categoryId keys with live counts, uncategorized last,
    // hidden entirely when the table carries no category at all.
    !loading && categoryChips.length > 0
      ? el('div', { className: 'wbx-catrow', role: 'group', 'aria-label': t('categoryRowLabel') },
          el('button', {
            key: 'all',
            className: 'wbx-chip', type: 'button',
            'aria-pressed': category === 'all' ? 'true' : 'false',
            'data-active': category === 'all' ? 'true' : undefined,
            onClick: function () { setCategory('all') }
          },
            t('categoryAll'),
            stats !== null
              ? el('span', { className: 'wbx-chip-count' }, String(stats.total))
              : null),
          categoryChips.map(function (chip) {
            var active = category === chip.id
            var label = chip.id === NO_CATEGORY ? t('categoryNone') : categoryLabelOf(chip.id, localeId)
            return el('button', {
              key: chip.id,
              className: 'wbx-chip', type: 'button',
              title: chip.id === NO_CATEGORY ? undefined : chip.id,
              'aria-pressed': active ? 'true' : 'false',
              'data-active': active ? 'true' : undefined,
              onClick: function () { setCategory(chip.id) }
            },
              el('span', { className: 'wbx-chip-label' }, label),
              el('span', { className: 'wbx-chip-count' }, String(chip.count)))
          }))
      : null,
    filteredActive
      ? el('p', { className: 'wbx-matchline', role: 'status' },
          query.trim() !== ''
            ? t('matchesEcho', { n: filtered.length, q: query.trim() })
            : t('matchesPlain', { n: filtered.length }))
      : null,
    warnings.length > 0
      ? el('div', { className: 'wbx-warns' },
          el('button', {
            className: 'wbx-warns-toggle', type: 'button',
            'aria-expanded': warnOpen ? 'true' : 'false',
            onClick: function () { setWarnOpen(!warnOpen) }
          },
            el('span', { className: 'wbx-warns-caret', 'aria-hidden': 'true' }, warnOpen ? '▾' : '▸'),
            t('warningsToggle', { n: warnings.length })),
          warnOpen
            ? el('ul', { className: 'wbx-warns-list' },
                warnings.map(function (warning, index) {
                  return el('li', { key: index }, String(warning))
                }))
            : null)
      : null,
    notice !== null
      ? el('div', { className: 'wbx-notice', 'data-kind': notice.kind, role: 'status' }, notice.text)
      : null,
    error !== ''
      ? el('div', { className: 'wbx-notice', 'data-kind': 'error', role: 'alert' },
          t('marketLoadFailed') + '：' + error + ' ',
          el('button', { className: 'wbx-btn', type: 'button', onClick: pullState }, t('retry')))
      : null,
    cardsView,
    unmatchedBroken.length > 0
      ? el('section', { className: 'wbx-orphans', 'aria-label': t('brokenTitle') },
          el('div', { className: 'wbx-orphans-head' },
            el('h3', { className: 'wbx-orphans-title' }, t('brokenTitle')),
            el('span', { className: 'wbx-orphans-count' }, String(unmatchedBroken.length))),
          el('p', { className: 'wbx-orphans-hint' }, t('brokenHint')),
          unmatchedBroken.map(function (broken) {
            return el(BrokenRow, {
              key: 'broken:' + strOf(broken.id),
              t: t, broken: broken,
              laneBusy: laneBusy, busyKey: busyKey, confirmKey: confirmKey,
              onActionConfirm: onActionConfirm, onCancelConfirm: onCancelConfirm,
              onAction: onBrokenAction
            })
          }))
      : null,
    orphans.length > 0
      ? el('section', { className: 'wbx-orphans', 'aria-label': t('orphansTitle') },
          el('div', { className: 'wbx-orphans-head' },
            el('h3', { className: 'wbx-orphans-title' }, t('orphansTitle')),
            el('span', { className: 'wbx-orphans-count' }, String(orphans.length))),
          el('p', { className: 'wbx-orphans-hint' }, t('orphansHint')),
          orphans.map(function (orphan) {
            return el(OrphanRow, {
              key: 'orphan:' + strOf(orphan.id),
              t: t, orphan: orphan, localeId: localeId,
              laneBusy: laneBusy, busyKey: busyKey, confirmKey: confirmKey,
              onActionConfirm: onActionConfirm, onCancelConfirm: onCancelConfirm,
              onAction: onOrphanAction
            })
          }))
      : null)
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

  // The market page (ticket 08): settings.section「WorkBuddy 专家」. The
  // seat is owned by dsh-client-ui-settings; slots.inject keeps the
  // registration opportunistic — in compositions without the settings UI
  // the seat never fires and nothing else is affected.
  collect(slots.inject('settings.section', function () {
    return slots.register({
      name: 'settings.section',
      id: 'workbuddy-expert',
      order: 46,
      label: function () { return t('nav') },
      locale: NS,
      inject: function () { return { t: t } }
    }, function () {
      return el(MarketPage, { t: t, getLocale: getLocale })
    })
  }))

  // The scoped style tags are injected only after every registration
  // succeeded (a failed apply must not leak them), and their removal joins
  // the disposers — one namespace per feature, either can ship alone.
  var styleTag = ensureStyle()
  collect(function () { removeStyle(styleTag) })
  var marketStyleTag = ensureMarketStyle()
  collect(function () { removeStyle(marketStyleTag) })

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
module.exports.AvatarFace = AvatarFace
// The market page (ticket 08), same loader-tolerant export pattern.
module.exports.AVATAR_EMOJI = AVATAR_EMOJI
module.exports.NO_CATEGORY = NO_CATEGORY
module.exports.KNOWN_CATEGORY_LABELS = KNOWN_CATEGORY_LABELS
module.exports.MARKET_CSS = MARKET_CSS
module.exports.ensureMarketStyle = ensureMarketStyle
module.exports.categoryOf = categoryOf
module.exports.categoryKeyOf = categoryKeyOf
module.exports.categoryLabelOf = categoryLabelOf
module.exports.categoryChipsOf = categoryChipsOf
module.exports.filterExperts = filterExperts
module.exports.localeNameOf = localeNameOf
module.exports.localeDescriptionOf = localeDescriptionOf
module.exports.cardActionsOf = cardActionsOf
module.exports.groupCardsByPlugin = groupCardsByPlugin
module.exports.groupExpanded = groupExpanded
module.exports.groupStatsOf = groupStatsOf
module.exports.formatWhen = formatWhen
module.exports.ExpertCard = ExpertCard
module.exports.TeamGroup = TeamGroup
module.exports.OrphanRow = OrphanRow
module.exports.BrokenRow = BrokenRow
module.exports.MarketPage = MarketPage
return module.exports;
} });
