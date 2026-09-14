/**
 * Importer segment entry (design §7, ticket 06): mounts the WorkBuddy
 * source settings namespace + the read-only API routes on one shared scan
 * catalog. `src/index.js` wiring is done by the integrator later — this
 * module only exposes `mountImporter(ctx)`.
 *
 * Everything the segment registers is disposed by the returned disposer
 * (or, for the settings namespace, by the calling plugin fiber itself —
 * the settings service removes namespaces when their registering fiber
 * disposes, so the disposer here drops only this segment's own watcher
 * and the routes).
 */

import { createCatalog } from './catalog.js'
import { mountImporterRoutes } from './routes.js'
import { mountImporterSettings } from './settings.js'
import { resolveSchemastery } from './util.js'

/**
 * Mount the WorkBuddy importer: settings registration (needs a live
 * schemastery factory — resolved through the layered tiers in util.js),
 * the shared scan cache, and the read-only routes.
 * @param {object} ctx - Cordis plugin context exposing `webServer` + `settings`
 * @returns {Promise<() => void>} disposer dropping every registration
 */
export async function mountImporter(ctx) {
  if (ctx.get('webServer') === undefined || ctx.get('settings') === undefined) {
    throw new Error('dsh-workbuddy-expert importer requires the webServer and settings services')
  }
  const z = await resolveSchemastery()
  const catalog = createCatalog()
  const offSettings = mountImporterSettings(ctx.settings, z, catalog)
  const offRoutes = mountImporterRoutes(ctx, { catalog })
  return () => {
    offRoutes()
    offSettings()
  }
}
