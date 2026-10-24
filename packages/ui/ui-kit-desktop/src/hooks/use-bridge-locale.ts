/**
 * `useBridgeLocale()` — React binding for the preload `locale` bridge.
 *
 * For renderer windows that never boot the Cordis app (desktop-lyrics,
 * mini-player): no `ctx`, no `ctx.i18n`. The main window's renderer pushes
 * the resolved locale through the preload bridge (`window.BBeBee.locale`),
 * and this hook subscribes to it so the component re-renders on language
 * change without a window restart.
 *
 * Key resolution is local: `BUILT_IN_CATALOGUES` (the same JSON the i18n
 * service registers) with the same per-key fallback the service uses —
 * `locale` → `en` → the key itself — plus `{name}` interpolation. Only
 * built-in namespaces are visible here; third-party `register()`
 * contributions live in the main window's service and are out of reach by
 * design (the ctx-less windows only read built-in keys).
 *
 * Degradation is deliberate: without the bridge (tests, storybook) the hook
 * renders English — byte-identical to the pre-i18n hardcoded strings — and
 * never throws.
 */

import { useCallback, useEffect, useState } from 'react'
import { BUILT_IN_CATALOGUES } from '@bbebee/plugin-i18n'

/** Subset of the preload bridge this hook needs; everything is optional. */
interface BridgeLocaleApi {
  getLocale?: () => Promise<string | undefined>
  onLocaleChange?: (callback: (locale: string) => void) => () => void
}

function bridgeLocale(): BridgeLocaleApi | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { BBeBee?: { locale?: BridgeLocaleApi } }).BBeBee?.locale
}

/** `{name}` placeholders; a missing param keeps its placeholder visible. */
const PARAM_PATTERN = /\{(\w+)\}/g

function resolveKey(
  key: string,
  locale: string,
  params?: Record<string, string | number>,
): string {
  const separator = key.indexOf(':')
  if (separator <= 0 || separator === key.length - 1) return key
  const namespace = key.slice(0, separator)
  const path = key.slice(separator + 1)
  const catalogues = BUILT_IN_CATALOGUES[namespace]
  const template = catalogues?.[locale]?.[path] ?? catalogues?.['en']?.[path] ?? key
  if (!template.includes('{')) return template
  return template.replace(PARAM_PATTERN, (placeholder, name: string) => {
    const value = params?.[name]
    return value === undefined ? placeholder : String(value)
  })
}

export interface UseBridgeLocaleResult {
  /** The active interface locale, e.g. `'zh'` or `'en'`. */
  locale: string
  /** Translate `namespace:path.to.key`; per-key fallback `locale` → `en` → key. */
  t: (key: string, params?: Record<string, string | number>) => string
}

export function useBridgeLocale(): UseBridgeLocaleResult {
  const [locale, setLocale] = useState('en')

  useEffect(() => {
    const bridge = bridgeLocale()
    if (!bridge) return
    let cancelled = false
    void bridge.getLocale?.().then((next) => {
      if (!cancelled && typeof next === 'string' && next.length > 0) setLocale(next)
    })
    const off = bridge.onLocaleChange?.((next) => setLocale(next))
    return () => {
      cancelled = true
      off?.()
    }
  }, [])

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => resolveKey(key, locale, params),
    [locale],
  )

  return { locale, t }
}
