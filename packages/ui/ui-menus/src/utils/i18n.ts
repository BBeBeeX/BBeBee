import type { Context } from 'cordis'
import type { I18nService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'

export function menuTranslate(
  ctx: Context | undefined,
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
): string {
  if (!ctx) return fallback
  const i18n = serviceOf<I18nService>(ctx, 'i18n')
  if (!i18n) return fallback
  const translated = i18n.t(key, params)
  return translated === key ? fallback : translated
}

export function resolveMenuLabel(
  ctxOrT: Context | ((k: string, p?: Record<string, string | number>) => string) | undefined,
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
): string {
  if (!ctxOrT) return fallback
  if (typeof ctxOrT === 'function') {
    const res = ctxOrT(key, params)
    return res === key ? fallback : res
  }
  return menuTranslate(ctxOrT, key, fallback, params)
}
