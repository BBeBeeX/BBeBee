/**
 * `plugin-i18n` unit tests.
 *
 * The service runs against stub `settings` and `device` services the way the
 * shells bind them: a real cordis `Context`, real `I18nPlugin`, fakes only
 * for its two injections. Everything the acceptance list names — the
 * three-link fallback, interpolation, missing params, register/dispose
 * isolation, BCP 47 negotiation — is exercised here against that wiring.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@BBeBee/protocol'

import { apply } from './index.js'
import { flattenCatalogue, negotiateLocale } from './service.js'

/* ── Stubs ──────────────────────────────────────────────────────────────── */

interface Harness {
  ctx: Context
  settings: { emit(language: AppSettings['language']): void }
  warns: string[]
  unload: () => Promise<void>
}

async function harness(language: AppSettings['language'], deviceLocale = 'en'): Promise<Harness> {
  const root = new Context()
  const warns: string[] = []
  /*
   * Warnings are captured through cordis's exporter API: the service's
   * derived context logs through the root LoggerService, and an exporter
   * sits under every `logger.warn` call regardless of which context makes
   * it. A `vi.spyOn` on one context's shadow method would never see another
   * context's call.
   */
  root.logger.exporter({
    export(message) {
      if (message.type === 'warn') warns.push(message.args.map(String).join(' '))
    },
  })
  /*
   * Stub state lives in this closure, touched through class-field arrows:
   * cordis wraps service instances in proxies that refuse externally-set
   * properties, so `harness` hands its own holder to the stubs the same way
   * the registry suite's stubs capture theirs.
   */
  const state = { language, deviceLocale }
  const settingsListeners = new Set<(settings: AppSettings) => void>()

  class SettingsStub extends Service {
    static override readonly name = 'settings'
    constructor(ctx: Context) {
      super(ctx, 'settings')
    }
    getSync = (): AppSettings => ({ ...DEFAULT_APP_SETTINGS, language: state.language })
    onSettingsChange = (listener: (settings: AppSettings) => void): (() => void) => {
      settingsListeners.add(listener)
      return () => settingsListeners.delete(listener)
    }
    /** Pretends the user just picked a different language on the settings page. */
    emit = (next: AppSettings['language']): void => {
      state.language = next
      const snapshot = this.getSync()
      for (const listener of [...settingsListeners]) listener(snapshot)
    }
  }

  class DeviceStub extends Service {
    static override readonly name = 'device'
    constructor(ctx: Context) {
      super(ctx, 'device')
    }
    get locale(): string {
      return state.deviceLocale
    }
  }

  await root.plugin(SettingsStub)
  await root.plugin(DeviceStub)
  // The stubs carry their state already — `apply` starts the i18n service,
  // whose init reads both.
  const disposer = await apply(root)
  const scoped = await new Promise<Context>((resolve) => {
    root.inject(['i18n'], (s) => resolve(s))
  })
  if (!scoped) throw new Error('i18n service did not start')

  // The emit handle, fetched through inject — the callback yields the derived
  // context, whose `.settings` is the service instance (`plugin()` itself
  // resolves to a fiber, not the service).
  const settingsService = await new Promise<{ emit: (next: AppSettings['language']) => void }>(
    (resolve) => {
      root.inject(['settings'], (scoped) => {
        resolve(scoped.settings as unknown as { emit: (next: AppSettings['language']) => void })
      })
    },
  )
  return {
    ctx: scoped,
    settings: settingsService,
    warns,
    unload: async () => {
      disposer()
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

/* ── Locale resolution ──────────────────────────────────────────────────── */

describe('locale resolution', () => {
  it('mirrors settings.language when it names a catalogue locale', async () => {
    const zh = await harness('zh')
    expect(zh.ctx.i18n.locale).toBe('zh')
    const en = await harness('en')
    expect(en.ctx.i18n.locale).toBe('en')
  })

  it("resolves 'system' through ctx.device.locale with BCP 47 negotiation", async () => {
    // `zh-Hans-CN` has no exact catalogue; the primary subagent matches zh.
    const hans = await harness('system', 'zh-Hans-CN')
    expect(hans.ctx.i18n.locale).toBe('zh')

    // `fr-FR` matches nothing: the chain bottoms out at en.
    const fr = await harness('system', 'fr-FR')
    expect(fr.ctx.i18n.locale).toBe('en')

    // A locale a plugin registered is a real negotiation target, not a
    // hypothetical: once `fr` exists, `fr-FR` resolves to it.
    await fr.ctx.i18n.register('extra', { fr: { greeting: 'Bonjour' }, en: { greeting: 'Hello' } })
    fr.settings.emit('system')
    expect(fr.ctx.i18n.locale).toBe('fr')
    expect(fr.ctx.i18n.t('extra:greeting')).toBe('Bonjour')
  })

  it('follows settings.language changes and stops following after unload', async () => {
    const { ctx, settings, unload } = await harness('zh')
    const seen: string[] = []
    const off = ctx.i18n.onLocaleChange((locale) => seen.push(locale))

    settings.emit('en')
    expect(ctx.i18n.locale).toBe('en')
    expect(seen).toEqual(['en'])
    expect(ctx.i18n.t('app:common.confirm')).toBe('OK')

    off()
    settings.emit('zh')
    expect(ctx.i18n.locale).toBe('zh')
    expect(seen).toEqual(['en'])

    await unload()
    // After unload the service is gone — cordis refuses property access on a
    // disposed fiber — and the settings emit must not throw against its
    // cleared listener set.
    expect(() => settings.emit('en')).not.toThrow()
  })
})

/* ── t(): lookup, fallback, interpolation ───────────────────────────────── */

describe('t()', () => {
  it('returns the catalogue entry for the active locale', async () => {
    const { ctx } = await harness('zh')
    expect(ctx.i18n.t('app:common.confirm')).toBe('确认')
    expect(ctx.i18n.t('app:common.loading')).toBe('加载中…')
    const en = await harness('en')
    expect(en.ctx.i18n.t('app:common.confirm')).toBe('OK')
  })

  it('falls back per key: a gap in zh shows en without dragging the rest over', async () => {
    const { ctx } = await harness('zh')
    await ctx.i18n.register('partial', {
      en: { greeting: 'Hello', farewell: 'Goodbye' },
      zh: { greeting: '你好' },
    })
    // `partial:greeting` exists in zh; `partial:farewell` only in en. One
    // gap must not demote the whole namespace.
    expect(ctx.i18n.t('partial:greeting')).toBe('你好')
    expect(ctx.i18n.t('partial:farewell')).toBe('Goodbye')
    expect(ctx.i18n.t('app:common.confirm')).toBe('确认')
  })

  it('returns the key itself when both locale and en are missing', async () => {
    const { ctx } = await harness('zh')
    expect(ctx.i18n.t('nowhere:at.all')).toBe('nowhere:at.all')
    expect(ctx.i18n.t('nowhere:at.other')).toBe('nowhere:at.other')
    expect(ctx.i18n.t('app:common.confirm')).toBe('确认')
  })

  it('never returns empty for malformed keys', async () => {
    const { ctx } = await harness('en')
    expect(ctx.i18n.t('no-separator')).toBe('no-separator')
    expect(ctx.i18n.t(':leading-separator')).toBe(':leading-separator')
    expect(ctx.i18n.t('ns:')).toBe('ns:')
  })

  it('interpolates {name} params', async () => {
    const { ctx } = await harness('en')
    expect(ctx.i18n.t('settings:github.endpointLabel', { index: 3 })).toBe('Acceleration endpoint 3')
    expect(ctx.i18n.t('settings:github.deleteEndpoint', { index: 1 })).toBe(
      'Delete acceleration endpoint 1',
    )
  })

  it('keeps the placeholder when a param is missing', async () => {
    const { ctx } = await harness('en')
    expect(ctx.i18n.t('settings:github.endpointLabel')).toBe('Acceleration endpoint {index}')
    // Numbers and strings interpolate alike; unknown params stay put.
    expect(ctx.i18n.t('settings:github.endpointLabel', { other: 'x' })).toBe(
      'Acceleration endpoint {index}',
    )
  })
})

/* ── Warnings: deduped, never crashing ──────────────────────────────────── */

describe('warnings', () => {
  it('warns once per message on missing keys', async () => {
    const { ctx, warns } = await harness('zh')
    expect(ctx.i18n.t('nowhere:at.all')).toBe('nowhere:at.all')
    expect(ctx.i18n.t('nowhere:at.all')).toBe('nowhere:at.all')
    expect(ctx.i18n.t('nowhere:at.other')).toBe('nowhere:at.other')
    expect(warns.filter((w) => w.includes('nowhere:at.all'))).toHaveLength(1)
  })

  it('warns on malformed keys', async () => {
    const { ctx, warns } = await harness('en')
    expect(ctx.i18n.t('no-separator')).toBe('no-separator')
    expect(warns.length).toBeGreaterThan(0)
  })

  it('warns once per missing param and keeps the placeholder', async () => {
    const { ctx, warns } = await harness('en')
    expect(ctx.i18n.t('settings:github.endpointLabel', { other: 'x' })).toBe(
      'Acceleration endpoint {index}',
    )
    expect(ctx.i18n.t('settings:github.endpointLabel', { other: 'y' })).toBe(
      'Acceleration endpoint {index}',
    )
    expect(warns.filter((w) => w.includes('missing param'))).toHaveLength(1)
  })
})

/* ── register(): isolation and disposal ─────────────────────────────────── */

describe('register()', () => {
  it('isolates namespaces: disposing plugin A leaves plugin B intact', async () => {
    const { ctx } = await harness('en')
    const disposeA = ctx.i18n.register('a', { en: { word: 'alpha' } })
    const disposeB = ctx.i18n.register('b', { en: { word: 'beta' } })
    expect(ctx.i18n.t('a:word')).toBe('alpha')
    expect(ctx.i18n.t('b:word')).toBe('beta')

    disposeA()
    expect(ctx.i18n.t('a:word')).toBe('a:word')
    expect(ctx.i18n.t('b:word')).toBe('beta')

    disposeB()
    expect(ctx.i18n.t('b:word')).toBe('b:word')
  })

  it('is idempotent: a disposer run twice removes once', async () => {
    const { ctx } = await harness('en')
    const dispose = ctx.i18n.register('once', { en: { word: 'one' } })
    dispose()
    dispose()
    expect(ctx.i18n.t('once:word')).toBe('once:word')
  })

  it('last registration wins per key, so re-registering patches', async () => {
    const { ctx } = await harness('en')
    ctx.i18n.register('layered', { en: { keep: 'original', patch: 'old' } })
    ctx.i18n.register('layered', { en: { patch: 'new' } })
    expect(ctx.i18n.t('layered:keep')).toBe('original')
    expect(ctx.i18n.t('layered:patch')).toBe('new')
  })

  it('a registration missing the active locale falls through to en', async () => {
    const { ctx } = await harness('zh')
    ctx.i18n.register('thirdparty', { en: { only: 'English only' } })
    expect(ctx.i18n.t('thirdparty:only')).toBe('English only')
    expect(ctx.i18n.t('app:common.confirm')).toBe('确认')
  })
})

/* ── Negotiation helper ─────────────────────────────────────────────────── */

describe('negotiateLocale()', () => {
  const available = ['en', 'zh']
  it.each([
    ['en', 'en'],
    ['en-US', 'en'],
    ['zh', 'zh'],
    ['zh-Hans-CN', 'zh'],
    ['fr-FR', 'en'],
    ['fr', 'en'],
    ['', 'en'],
  ])('%s → %s', (tag, expected) => {
    expect(negotiateLocale(tag, available)).toBe(expected)
  })

  it('prefers an exact match over the primary subagent', () => {
    expect(negotiateLocale('zh-TW', ['en', 'zh', 'zh-TW'])).toBe('zh-TW')
  })

  it('is case- and separator-insensitive', () => {
    expect(negotiateLocale('ZH_hans_CN', available)).toBe('zh')
  })
})

/* ── Catalogue helper ───────────────────────────────────────────────────── */

describe('flattenCatalogue()', () => {
  it('collapses nested objects to dotted paths and ignores non-strings', () => {
    expect(
      flattenCatalogue({ common: { confirm: 'OK', nested: { deep: 'v' } }, skip: 42, nil: null }),
    ).toEqual({ 'common.confirm': 'OK', 'common.nested.deep': 'v' })
  })
})
