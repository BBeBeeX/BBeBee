/**
 * `ctx.i18n` — interface-language resolution, catalogue registry and lookup.
 *
 * The service owns no UI strings of its own beyond the catalogues it ships in
 * `./locales/`: every feature plugin contributes (or doesn't) its namespace
 * through `register()`, and views read through `t()`. Three invariants shape
 * the implementation:
 *
 * 1. **Fallback is per key, never per catalogue.** A third-party plugin that
 *    ships only English must not drag the rest of a Chinese UI to English:
 *    a missing key falls back (`locale` → `en` → the key itself) while every
 *    key that *is* present keeps rendering in the user's language.
 * 2. **`t()` never returns empty.** The last link of the chain is the key
 *    itself, so a screen degrades to readable identifiers instead of blank
 *    labels.
 * 3. **Namespace isolation.** The disposer `register()` returns removes
 *    exactly what that registration added — a plugin unloading cannot take
 *    another plugin's strings with it. Lookups are last-registration-wins
 *    per key, so re-registering a namespace patches rather than clobbers.
 *
 * The language itself is not set here: `settings.language` ('zh' | 'en' |
 * 'system') is the single source of truth, and this service subscribes to it.
 * 'system' resolves through `ctx.device.locale` (the OS tag, e.g. `fr-FR`)
 * with BCP 47 negotiation — full tag, then primary subagent, then `en`.
 */

import { Service, type Context } from '@BBeBee/kernel'
import type { Disposable, I18nService } from '@BBeBee/protocol'

import enApp from './locales/en.json'
import zhApp from './locales/zh.json'
import registryLocales from './locales/registry.json'
import settingsLocales from './locales/settings.json'

/** A single `register()` call's payload, removable as a unit by its disposer. */
interface Registration {
  /** Locale tag (lowercase BCP 47 primary form, e.g. `en`) → dotted-key catalogue. */
  locales: Record<string, Record<string, string>>
}

type Catalogues = Record<string, Record<string, string>>

/** Collapses a nested catalogue JSON (`{ common: { confirm: … } }`) to dotted keys (`common.confirm`). */
export function flattenCatalogue(nested: unknown, prefix = ''): Record<string, string> {
  const flat: Record<string, string> = {}
  if (typeof nested !== 'object' || nested === null) return flat
  for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      flat[path] = value
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(flat, flattenCatalogue(value, path))
    }
  }
  return flat
}

/** Flattens a per-locale catalogue file (`{ en: nested, zh: nested }`) into `register()`'s shape. */
function flattenPerLocale(catalogues: Record<string, unknown>): Record<string, Record<string, string>> {
  const flat: Record<string, Record<string, string>> = {}
  for (const [locale, nested] of Object.entries(catalogues)) {
    flat[locale] = flattenCatalogue(nested)
  }
  return flat
}

/** Lowercases and normalizes `_` separators so `zh_Hans_CN` compares like `zh-hans-cn`. */
function normalizeTag(tag: string): string {
  return tag.trim().replace(/_/g, '-').toLowerCase()
}

/**
 * BCP 47 negotiation: exact tag → primary subagent → `en`.
 *
 * `fr-FR` against catalogues in `en`/`zh` lands on `en`; `zh-Hans-CN` lands
 * on `zh` because the primary subagent matches. A language the catalogues
 * do know (`fr` registered by a plugin) wins over the `en` fallback.
 */
export function negotiateLocale(tag: string, available: readonly string[]): string {
  const wanted = normalizeTag(tag)
  if (wanted === '') return 'en'
  const normalized = available.map(normalizeTag)
  const exact = normalized.indexOf(wanted)
  if (exact >= 0) return available[exact]!
  const primary = wanted.split('-')[0]!
  const partial = normalized.findIndex((candidate) => candidate.split('-')[0] === primary)
  if (partial >= 0) return available[partial]!
  return 'en'
}

/** `{name}` placeholders; a missing param keeps its placeholder visible. */
const PARAM_PATTERN = /\{(\w+)\}/g

export class I18nPlugin extends Service implements I18nService {
  static override readonly name = 'i18n'
  static readonly inject = ['settings', 'device']

  /** Namespace → registrations in call order; lookups walk the array backwards. */
  private registrations = new Map<string, Registration[]>()
  private listeners = new Set<(locale: string) => void>()
  /** Warn-once dedupe: the same gap must not spam on every render pass. */
  private warned = new Set<string>()
  private currentLocale = 'en'
  private unsubscribeSettings: (() => void) | undefined

  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }

  get locale(): string {
    return this.currentLocale
  }

  async [Service.init](): Promise<void> {
    // Built-in catalogues ship with the plugin: the `app` commons plus the
    // namespaces the pilot migrations read. Registered first, so a plugin
    // re-registering one of these namespaces overrides key-by-key. The
    // per-namespace files nest keys for readability — flattened here, since
    // `register()`'s contract is dotted-key maps per locale.
    this.register('app', {
      en: flattenCatalogue(enApp),
      zh: flattenCatalogue(zhApp),
    })
    this.register('registry', flattenPerLocale(registryLocales))
    this.register('settings', flattenPerLocale(settingsLocales))

    // Subscribe before reading: a change landing between read and subscribe
    // would otherwise be lost, leaving the locale stale until the next edit.
    this.unsubscribeSettings = this.ctx.settings.onSettingsChange((settings) => {
      this.applyLanguage(settings.language)
    })
    this.applyLanguage(this.ctx.settings.getSync().language)
  }

  /**
   * Tears down what `[Service.init]` attached. Called from `apply()`'s
   * disposer — cordis's `Service` has no dispose lifecycle of its own.
   */
  stop(): void {
    this.unsubscribeSettings?.()
    this.unsubscribeSettings = undefined
    this.listeners.clear()
    this.warned.clear()
  }

  t(key: string, params?: Record<string, string | number>): string {
    const separator = key.indexOf(':')
    if (separator <= 0 || separator === key.length - 1) {
      this.warnOnce(`i18n: key "${key}" is not in "namespace:path" form — returning it verbatim`)
      return key
    }
    const namespace = key.slice(0, separator)
    const path = key.slice(separator + 1)

    const direct = this.lookup(namespace, path, this.currentLocale)
    if (direct !== undefined) return this.interpolate(key, direct, params)

    const english = this.lookup(namespace, path, 'en')
    if (english !== undefined) return this.interpolate(key, english, params)

    this.warnOnce(`i18n: no entry for "${key}" in "${this.currentLocale}" or "en" — returning the key`)
    return key
  }

  register(namespace: string, catalogues: Catalogues): Disposable {
    const registration: Registration = { locales: catalogues }
    const list = this.registrations.get(namespace) ?? []
    list.push(registration)
    this.registrations.set(namespace, list)
    if (this.unsubscribeSettings) {
      this.applyLanguage(this.ctx.settings.getSync().language)
    }

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const current = this.registrations.get(namespace)
      if (!current) return
      const index = current.indexOf(registration)
      if (index >= 0) current.splice(index, 1)
      if (current.length === 0) this.registrations.delete(namespace)
      if (this.unsubscribeSettings) {
        this.applyLanguage(this.ctx.settings.getSync().language)
      }
    }
  }

  onLocaleChange(cb: (locale: string) => void): Disposable {
    this.listeners.add(cb)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.listeners.delete(cb)
    }
  }

  /** Resolves `settings.language` and, when it changed, retargets `locale` and notifies. */
  private applyLanguage(language: 'zh' | 'en' | 'system'): void {
    const next =
      language === 'system'
        ? negotiateLocale(this.ctx.device?.locale ?? 'en', this.knownLocales())
        : language
    if (next === this.currentLocale) return
    this.currentLocale = next
    for (const listener of [...this.listeners]) listener(next)
  }

  /** Every locale tag any registration has offered — the negotiation search space. */
  private knownLocales(): string[] {
    const tags = new Set<string>(['en', 'zh'])
    for (const list of this.registrations.values()) {
      for (const registration of list) {
        for (const tag of Object.keys(registration.locales)) tags.add(tag)
      }
    }
    return [...tags]
  }

  /** Last-registration-wins per key: later `register()` calls patch earlier ones. */
  private lookup(namespace: string, path: string, locale: string): string | undefined {
    const list = this.registrations.get(namespace)
    if (!list) return undefined
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i]!.locales[locale]?.[path]
      if (entry !== undefined) return entry
    }
    return undefined
  }

  private interpolate(key: string, template: string, params?: Record<string, string | number>): string {
    if (!template.includes('{')) return template
    return template.replace(PARAM_PATTERN, (placeholder, name: string) => {
      const value = params?.[name]
      if (value === undefined) {
        this.warnOnce(`i18n: key "${key}" is missing param "{${name}}" — keeping the placeholder`)
        return placeholder
      }
      return String(value)
    })
  }

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return
    this.warned.add(message)
    this.ctx.logger.warn(message)
  }
}
