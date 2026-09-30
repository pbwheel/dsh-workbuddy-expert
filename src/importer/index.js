/**
 * Importer segment entry (design §7, ticket 06): mounts the WorkBuddy
 * read-only API routes and — on a full Cordis context — the ticket-07
 * export engine (install/update/uninstall as expert-folder export +
 * the /api/state installed overlay) on one shared scan catalog.
 *
 * Settings persistence rides the DSH 0.2 Config model (see
 * ./settings.js): no custom namespace registration — the plugin's
 * exported schemastery `Config` (volatile `sourcePath`) is the form the
 * settings service projects under THIS entry's id, and volatile commits
 * invalidate the scan cache through `loader/volatile-update`.
 *
 * Everything the segment registers is disposed by the returned
 * disposer; the settings page policy follows the calling fiber itself.
 *
 * `options.config` is the plugin's live config reference (volatile
 * sourcePath ref on the live host, plain object for test doubles) —
 * the fallback read whenever the settings form row is absent.
 * `options.expertsRoot` fixes the export root explicitly (the caller
 * resolves it from the SAME dshHome the discovery roots use, keeping
 * 安装 = 导出 与 discovery 一致).
 * `options.ownerCtx` is the plugin's ROOT apply context. Fiber identity
 * matters for two of the mounts: the Loader dispatches
 * `loader/volatile-update` with an `owner.fiber === entry fiber` filter,
 * and settings.configure() keys its page policy by the entry FIBER —
 * neither matches the inject-child fiber this function's `ctx` normally
 * is, so without ownerCtx those two registrations silently no-op (the
 * bug fixed 2026-09-30). Test doubles may omit it: the fallback is `ctx`.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { createCatalog } from './catalog.js'
import { createExporter } from './export.js'
import { mountImporterRoutes } from './routes.js'
import { entryIdOf, mountPagePolicy, mountVolatileWatch } from './settings.js'

/**
 * Mount the WorkBuddy importer: the volatile-commit watcher, the page
 * policy, the shared scan cache, the read-only routes, and the export
 * engine.
 *
 * @param {object} ctx - Cordis plugin context exposing `webServer` + `settings`
 * @param {{config?: object, expertsRoot?: string, ownerCtx?: object}} [options]
 * @returns {Promise<() => void>} disposer dropping every registration
 */
export async function mountImporter(ctx, options = {}) {
  if (ctx.get('webServer') === undefined || ctx.get('settings') === undefined) {
    throw new Error('dsh-workbuddy-expert importer requires the webServer and settings services')
  }
  const ns = entryIdOf(ctx)
  const catalog = createCatalog()
  // Entry-scoped mounts (see the module header): the volatile watcher and
  // the page policy both key on the ENTRY fiber, so they receive the root
  // apply context; the policy's service lookup stays on the injected ctx,
  // where `settings` is guaranteed live.
  const ownerCtx = options.ownerCtx ?? ctx
  const offWatch = mountVolatileWatch(ownerCtx, catalog)
  const offPolicy = mountPagePolicy(ctx, ownerCtx.fiber)

  // The engine mounts whenever the context can own effects (a full
  // plugin fiber) or the caller pins the root explicitly (tests). The
  // default root keeps the old env precedence for direct callers; the
  // live wiring always passes the caller-resolved dshHome root so
  // 安装 = 导出 lands in the SAME experts tree discovery scans.
  const engineCapable = typeof ctx.effect === 'function' || options.expertsRoot !== undefined
  const exporter = engineCapable
    ? createExporter({
      expertsRoot: options.expertsRoot ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'experts'),
      catalog,
      getRawSourcePath: () => {
        const settings = ctx.get('settings')
        const row = typeof settings?.describe === 'function' ? settings.describe().find((entry) => entry?.ns === ns) : undefined
        const fromForm = row?.value?.sourcePath
        if (typeof fromForm === 'string' && fromForm.trim() !== '') return fromForm
        const value = options.config?.sourcePath
        const raw = typeof value?.get === 'function' ? value.get() : value
        return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined
      },
    })
    : undefined

  const offRoutes = mountImporterRoutes(ctx, { catalog, exporter, ns, config: options.config })
  return () => {
    offRoutes()
    offPolicy()
    offWatch()
  }
}
