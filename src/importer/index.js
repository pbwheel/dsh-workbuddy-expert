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

import { homedir } from 'node:os'
import { join } from 'node:path'

import { createCatalog } from './catalog.js'
import { createExporter } from './export.js'
import { mountImporterRoutes } from './routes.js'
import { mountImporterSettings } from './settings.js'
import { namespaceDescriptor } from './settings.js'
import { resolveSchemastery } from './util.js'

/**
 * Mount the WorkBuddy importer: settings registration (needs a live
 * schemastery factory — resolved through the layered tiers in util.js),
 * the shared scan cache, the read-only routes, and — on a full Cordis
 * context — the ticket-07 export engine (install/update/uninstall as
 * expert-folder export + the /api/state installed overlay).
 *
 * The engine mounts only when the context exposes `effect` (a full
 * plugin fiber): plain test doubles of ctx keep the read-only ticket-06
 * surface, while the live plugin gets the mutating routes without any
 * caller-side change. `options.expertsRoot` overrides the export root
 * (default `<DSH_HOME|~/.dsh>/experts`, design §7).
 *
 * @param {object} ctx - Cordis plugin context exposing `webServer` + `settings`
 * @param {{expertsRoot?: string}} [options]
 * @returns {Promise<() => void>} disposer dropping every registration
 */
export async function mountImporter(ctx, options = {}) {
  if (ctx.get('webServer') === undefined || ctx.get('settings') === undefined) {
    throw new Error('dsh-workbuddy-expert importer requires the webServer and settings services')
  }
  const z = await resolveSchemastery()
  const catalog = createCatalog()
  const offSettings = mountImporterSettings(ctx.settings, z, catalog)

  const engineCapable = typeof ctx.effect === 'function' || options.expertsRoot !== undefined
  const exporter = engineCapable
    ? createExporter({
      expertsRoot: options.expertsRoot ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'experts'),
      catalog,
      getRawSourcePath: () => namespaceDescriptor(ctx.settings).value.sourcePath,
    })
    : undefined

  const offRoutes = mountImporterRoutes(ctx, { catalog, exporter })
  return () => {
    offRoutes()
    offSettings()
  }
}
