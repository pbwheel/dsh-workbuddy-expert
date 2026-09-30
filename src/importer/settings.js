/**
 * Settings access for the WorkBuddy importer — rewritten for the DSH
 * 0.2 settings model (Config-derived forms).
 *
 * DSH 0.1 model (gone): the plugin called `settings.register(ns, schema,
 * { base })` and owned a custom `workbuddy-expert` namespace. The live
 * 0.2 `settings` service (`@deepseek-ai/dsh-settings` SettingsForms) has
 * NO register method: forms are projected from each active profile
 * entry's exported schemastery `Config`, editable fields must be
 * `.volatile()`, and every describe/update address is the ENTRY id of
 * the plugin (`entry.options.id` — for this bundle `dsh-workbuddy-expert`,
 * the id its cordis.patch.yml insert declares).
 *
 * What this module now owns:
 *
 *   - `entryIdOf(ctx)` — this plugin's live entry id off the Cordis
 *     fiber (`ctx.fiber.entry.options.id`), with the patch id as the
 *     fallback for plain test doubles;
 *   - `readSourcePath(config)` — one live read over EITHER shape the
 *     config can take: a schemastery volatile reference (`{ get() }`,
 *     what the Loader hands apply() when Config is exported) or a plain
 *     string (no schema resolved / test doubles);
 *   - `settingsRowOf(settings, ns)` — this entry's describe() row
 *     (value/revision), tolerant of a missing row;
 *   - `namespaceDescriptor(settings, ns)` — the strict row lookup the
 *     routes use for revision-protected reads;
 *   - `mountVolatileWatch(ctx, onChange)` — `loader/volatile-update`
 *     listener (paths carry the changed config paths) replacing the old
 *     scope.watch cache invalidation;
 *   - `mountPagePolicy(ctx)` — `settings.configure({ auto: false })`
 *     hygiene for a plugin that ships its own settings page, per the
 *     dsh-settings authoring note.
 */

import { DEFAULT_SOURCE_PATH } from './scanner.js'

/**
 * Fallback entry id: the id this bundle's cordis.patch.yml insert
 * declares. Used whenever a context carries no fiber (test doubles) —
 * the live host always answers the real entry id.
 */
export const SETTINGS_NS = 'dsh-workbuddy-expert'

/**
 * This plugin's live profile entry id — the address settings.describe()
 * and settings.update() expect.
 * @param {object} ctx - cordis context (or a plain double)
 * @returns {string}
 */
export function entryIdOf(ctx) {
  const id = ctx?.fiber?.entry?.options?.id
  return typeof id === 'string' && id.trim() !== '' ? id : SETTINGS_NS
}

/**
 * One live sourcePath read over both config shapes.
 * @param {object} config - the plugin's config (volatile ref or plain)
 * @returns {string} the RAW stored path (tilde intact)
 */
export function readSourcePath(config) {
  const value = config?.sourcePath
  const raw = typeof value?.get === 'function' ? value.get() : value
  return typeof raw === 'string' && raw.trim() !== '' ? raw : DEFAULT_SOURCE_PATH
}

/**
 * This entry's describe() row, or undefined when the settings service
 * carries none (entry inactive, Config not resolved, plain doubles).
 * @param {object} settingsService - host settings service
 * @param {string} ns - entry id
 * @returns {{ns: string, value: object, revision: number} | undefined}
 */
export function settingsRowOf(settingsService, ns) {
  if (typeof settingsService?.describe !== 'function') return undefined
  let rows
  try {
    rows = settingsService.describe()
  } catch {
    return undefined
  }
  const row = Array.isArray(rows) ? rows.find((entry) => entry?.ns === ns) : undefined
  return row === null ? undefined : row
}

/**
 * The strict row lookup: describe() must carry this entry's form.
 * @param {object} settingsService - host settings service
 * @param {string} [ns] - entry id (entryIdOf(ctx) when omitted is NOT
 *   possible here — always pass the resolved ns explicitly)
 * @returns {{ns: string, value: {sourcePath: string}, revision: number}}
 * @throws when the entry has no settings form (no exported Config with
 *   volatile fields, or the entry is not active)
 */
export function namespaceDescriptor(settingsService, ns) {
  const row = settingsRowOf(settingsService, ns)
  if (row === undefined) {
    throw new Error(`settings entry "${ns}" has no configurable form (the plugin's Config schema with a volatile sourcePath is required)`)
  }
  return row
}

/**
 * Watch volatile config commits for sourcePath changes and invalidate
 * the scan cache — the 0.2 replacement of the old scope.watch. The
 * Loader emits `loader/volatile-update` on the owning fiber's context
 * with the changed config paths after committing new values into the
 * running references.
 * @param {object} ctx - the plugin's own context (fiber owner)
 * @param {{invalidate(): void}} catalog - scan cache invalidated on change
 * @returns {() => void} disposer (no-op when ctx.on is unavailable)
 */
export function mountVolatileWatch(ctx, catalog) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.on !== 'function') return () => {}
  const off = ctx.on('loader/volatile-update', (paths) => {
    const touched = Array.isArray(paths) && paths.some((path) => Array.isArray(path) && path[0] === 'sourcePath')
    if (touched) catalog.invalidate()
  })
  return typeof off === 'function' ? off : () => {}
}

/**
 * Page policy hygiene (dsh-settings authoring note): a plugin that
 * ships its own settings page registers `configure({ auto: false })` so
 * schema-driven clients do not ALSO render a generated form for this
 * entry. Registered through the settings-injected context so the policy
 * names this plugin's fiber; every failure is inert.
 * @param {object} ctx - the settings-injected context (carries the fiber)
 * @returns {() => void} disposer
 */
export function mountPagePolicy(ctx) {
  const settings = typeof ctx?.get === 'function' ? ctx.get('settings') : undefined
  if (typeof settings?.configure !== 'function') return () => {}
  try {
    const off = settings.configure({ auto: false }, ctx.fiber)
    return typeof off === 'function' ? off : () => {}
  } catch {
    return () => {}
  }
}
