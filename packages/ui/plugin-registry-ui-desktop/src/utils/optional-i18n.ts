/**
 * `useI18n` for view components whose `ctx` prop is optional.
 *
 * Unit tests render these leaf components without a kernel context, so the
 * prop is optional. When the context (or the i18n service) is absent, the
 * hook falls back to the English catalogue instead of returning raw keys —
 * English is the source language, so it is always a readable degradation.
 * Never used with a real context: callers always pass theirs through.
 */

import type { Context } from 'cordis'
import { useI18n } from '@BBeBee/ui-kit-desktop'
import enApp from '../../../../feature/plugin-i18n/src/locales/en.json'
import registryCatalogue from '../../../../feature/plugin-i18n/src/locales/registry.json'
import settingsCatalogue from '../../../../feature/plugin-i18n/src/locales/settings.json'

const EN: Record<string, unknown> = {
  app: enApp,
  registry: (registryCatalogue as { en: unknown }).en,
  settings: (settingsCatalogue as { en: unknown }).en,
}

function lookupEn(key: string, params?: Record<string, string | number>): string {
  const sep = key.indexOf(':')
  if (sep < 0) return key
  let cur: unknown = EN[key.slice(0, sep)]
  if (!cur) return key
  for (const part of key.slice(sep + 1).split('.')) {
    cur = (cur as Record<string, unknown> | undefined)?.[part]
  }
  if (typeof cur !== 'string') return key
  return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
}

/** Answers "no service" to every `reflect.get` — enough for `serviceOf`. */
const STUB_CTX = { reflect: { get: () => undefined } } as unknown as Context

export function useOptionalI18n(ctx: Context | undefined) {
  const { t: serviceT, locale } = useI18n(ctx ?? STUB_CTX)
  // When the service is absent `useI18n` returns the key; fall back to English.
  const t = (key: string, params?: Record<string, string | number>): string => {
    const out = serviceT(key, params)
    return out === key ? lookupEn(key, params) : out
  }
  return { t, locale }
}
