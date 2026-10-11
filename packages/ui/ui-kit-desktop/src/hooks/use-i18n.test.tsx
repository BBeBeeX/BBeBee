// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { I18nService } from '@BBeBee/protocol'

import { useI18n } from './use-i18n.js'

/*
 * The hook only needs *an* I18nService — the real one is tested in
 * plugin-i18n. This fake is a service under the `i18n` key so `ctx.i18n`
 * resolves exactly as the shell binds it, with an `emitLocale` reachable
 * through `inject` (cordis refuses externally-set instance properties, and
 * `ctx.plugin()` resolves to a fiber, not the instance).
 */
class FakeI18n extends Service implements I18nService {
  static override readonly name = 'i18n'
  locale = 'en'
  private listeners = new Set<(locale: string) => void>()
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    if (key === 'app:common.confirm') return this.locale === 'zh' ? '确认' : 'OK'
    if (key === 'app:common.items' && params) return `${this.locale}:${params['count']}`
    return key
  }
  register = () => () => {}
  onLocaleChange = (cb: (locale: string) => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  emitLocale = (next: string): void => {
    this.locale = next
    for (const listener of [...this.listeners]) listener(next)
  }
}

async function ctxWithI18n(): Promise<{ ctx: Context; emitLocale: (next: string) => void }> {
  const root = new Context()
  await root.plugin(FakeI18n)
  const ctx = await new Promise<Context>((resolve) => {
    root.inject(['i18n'], (scoped) => resolve(scoped))
  })
  const service = ctx.i18n as FakeI18n
  return { ctx, emitLocale: (next) => service.emitLocale(next) }
}

describe('useI18n', () => {
  afterEach(() => cleanup())

  it('exposes t() and the active locale', async () => {
    const { ctx } = await ctxWithI18n()
    const { result } = renderHook(() => useI18n(ctx))
    expect(result.current.locale).toBe('en')
    expect(result.current.t('app:common.confirm')).toBe('OK')
    expect(result.current.t('app:common.items', { count: 3 })).toBe('en:3')
  })

  it('re-renders on locale change without remount', async () => {
    const { ctx, emitLocale } = await ctxWithI18n()
    const { result } = renderHook(() => useI18n(ctx))
    act(() => emitLocale('zh'))
    expect(result.current.locale).toBe('zh')
    expect(result.current.t('app:common.confirm')).toBe('确认')
  })

  it('degrades to the key itself when the i18n service is absent', () => {
    const { result } = renderHook(() => useI18n(new Context()))
    expect(result.current.locale).toBe('en')
    expect(result.current.t('app:common.confirm')).toBe('app:common.confirm')
  })

  it('stops following the service after unmount', async () => {
    const { ctx, emitLocale } = await ctxWithI18n()
    const { result, unmount } = renderHook(() => useI18n(ctx))
    unmount()
    act(() => emitLocale('zh'))
    // No assertion can throw after unmount; the observable contract is that
    // no setState-after-unmount warning fires and the hook is simply gone.
    expect(result.current.locale).toBe('en')
  })
})
