/**
 * `useI18n(ctx)` — React binding for `ctx.i18n`.
 *
 * Returns the active `locale` and a `t()` bound to the service; the component
 * re-renders when the interface language changes because the hook subscribes
 * to `onLocaleChange` and disposes on unmount. The context comes in as a prop
 * (the shell's own convention — views receive `ctx`, not a provider), so no
 * React context machinery is introduced here.
 *
 * Degradation is deliberate: when the i18n plugin is disabled or still
 * starting, `t()` returns the key itself and `locale` reads `'en'` — a screen
 * renders readable identifiers instead of crashing on a missing service.
 *
 * Kept byte-identical in behaviour with the desktop kit's hook (the parity
 * rule): the two files differ only in this header comment.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { I18nService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'

export interface UseI18nResult {
  /** The resolved interface locale, e.g. `'zh'`, `'en'`, or a plugin-registered tag. */
  locale: string
  /** Translate `namespace:path.to.key`; falls back to the key itself without the service. */
  t: I18nService['t']
}

export function useI18n(ctx: Context): UseI18nResult {
  // `serviceOf` — not bare `ctx.i18n` — because a cordis context *throws* on
  // property access for a service it does not provide, and the hook's whole
  // point is to degrade quietly when the i18n plugin is absent.
  const [locale, setLocale] = useState(() => serviceOf<I18nService>(ctx, 'i18n')?.locale ?? 'en')

  useEffect(() => {
    const i18n = serviceOf<I18nService>(ctx, 'i18n')
    if (!i18n) return
    setLocale(i18n.locale)
    return i18n.onLocaleChange((next) => setLocale(next))
  }, [ctx])

  const t = useCallback<I18nService['t']>(
    (key, params) => serviceOf<I18nService>(ctx, 'i18n')?.t(key, params) ?? key,
    [ctx, locale],
  )

  return { locale, t }
}
