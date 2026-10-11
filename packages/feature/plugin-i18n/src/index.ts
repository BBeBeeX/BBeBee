/**
 * `plugin-i18n` — built-in implementation of `ctx.i18n`.
 *
 * Catalogues and lookup live in `./service.ts`; this module is the loadable
 * plugin shell (the shape every feature plugin shares). The service reads
 * `settings.language` and `ctx.device.locale`, so it declares both as
 * injections — `settings` comes from `plugin-settings` (a feature plugin,
 * hence the manifest dependency) and `device` from the bootstrap services.
 */

import type { Context } from '@BBeBee/kernel'

import { I18nPlugin } from './service.js'

export { I18nPlugin, flattenCatalogue, negotiateLocale } from './service.js'

export const name = 'plugin-i18n'
export const inject = ['settings', 'device']

export async function apply(ctx: Context): Promise<() => void> {
  ctx.logger.info('plugin-i18n: applied')
  const fiber = await ctx.plugin(I18nPlugin)
  // `ctx.i18n` is typed as the protocol interface; the concrete class owns
  // the teardown the disposer needs.
  const service = ctx.i18n as I18nPlugin
  return () => {
    service.stop()
    void fiber.dispose()
  }
}

export default { name, inject, apply }
