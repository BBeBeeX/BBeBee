// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { Context, Service } from 'cordis'
import { isMacPlatform } from './platform.js'
import { TopBar } from './TopBar.js'
import { Shell } from './Shell.js'
import enCatalogue from '../../../packages/feature/plugin-i18n/src/locales/en.json'
import zhCatalogue from '../../../packages/feature/plugin-i18n/src/locales/zh.json'

const CATALOGUES: Record<string, { en: unknown; zh: unknown }> = {
  app: { en: enCatalogue, zh: zhCatalogue },
}

class TestI18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  private listeners = new Set<(locale: string) => void>()
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0) return key
    const ns = key.slice(0, sep)
    const catalogue = CATALOGUES[ns]?.[this.locale === 'zh' ? 'zh' : 'en']
    if (!catalogue) return key
    let cur: unknown = catalogue
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
  }
  onLocaleChange = (cb: (locale: string) => void): (() => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
}

class TestUiStub extends Service {
  static override readonly name = 'ui'
  readonly views = new Map<string, unknown>()
  routes: { kind: 'route'; id: string; path: string; title: string; placement?: string[]; icon?: string }[] = [
    { kind: 'route', id: 'library.home', path: '/library', title: 'Library', placement: ['sidebar'] },
  ]
  settings: { kind: 'settings'; id: string; section?: string; title: string }[] = []
  tray: unknown[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  viewFor(id: string) {
    return this.views.get(id)
  }

  navigate(id: string, params?: Record<string, unknown>) {
    this.ctx.emit('ui/navigate', id, params)
  }
}

describe('macOS traffic lights adaptation', () => {
  let originalBBeBee: unknown
  let container: HTMLDivElement

  beforeEach(() => {
    originalBBeBee = (window as unknown as { BBeBee?: unknown }).BBeBee
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    ;(window as unknown as { BBeBee?: unknown }).BBeBee = originalBBeBee
    container.remove()
  })

  describe('isMacPlatform', () => {
    it('returns true when window.BBeBee.platform is darwin', () => {
      ;(window as unknown as { BBeBee: { platform: string } }).BBeBee = { platform: 'darwin' }
      expect(isMacPlatform()).toBe(true)
    })

    it('returns false when window.BBeBee.platform is win32 or linux', () => {
      ;(window as unknown as { BBeBee: { platform: string } }).BBeBee = { platform: 'win32' }
      expect(isMacPlatform()).toBe(false)
      ;(window as unknown as { BBeBee: { platform: string } }).BBeBee = { platform: 'linux' }
      expect(isMacPlatform()).toBe(false)
    })
  })

  describe('TopBar component', () => {
    it('hides WindowControls and applies right padding on macOS', async () => {
      ;(window as unknown as { BBeBee: { platform: string } }).BBeBee = { platform: 'darwin' }
      const ctx = new Context()
      ctx.plugin(TestI18nStub)

      const root = createRoot(container)
      await act(async () => {
        root.render(h(TopBar, { ctx }))
      })

      const header = container.querySelector('header')
      expect(header).not.toBeNull()
      // TopBar on macOS has 14px right padding
      expect(header?.style.paddingRight).toBe('14px')

      // WindowControls should not exist on macOS
      const windowControls = container.querySelector('[role="group"][aria-label="Window controls"]')
      expect(windowControls).toBeNull()

      await act(async () => {
        root.unmount()
      })
    })

    it('renders WindowControls and has 0px right padding on Linux/Windows', async () => {
      ;(window as unknown as { BBeBee: { platform: string } }).BBeBee = { platform: 'linux' }
      const ctx = new Context()
      ctx.plugin(TestI18nStub)

      const root = createRoot(container)
      await act(async () => {
        root.render(h(TopBar, { ctx }))
      })

      const header = container.querySelector('header')
      expect(header).not.toBeNull()
      expect(header?.style.paddingRight).toBe('0px')

      // WindowControls should be present on non-macOS
      const windowControls = container.querySelector('[role="group"][aria-label="Window controls"]')
      expect(windowControls).not.toBeNull()

      await act(async () => {
        root.unmount()
      })
    })

    it('applies insetLeftForTrafficLights when requested', async () => {
      ;(window as unknown as { BBeBee: { platform: string } }).BBeBee = { platform: 'darwin' }
      const ctx = new Context()
      ctx.plugin(TestI18nStub)

      const root = createRoot(container)
      await act(async () => {
        root.render(h(TopBar, { ctx, insetLeftForTrafficLights: true }))
      })

      const header = container.querySelector('header')
      expect(header?.style.paddingLeft).toBe('78px')

      await act(async () => {
        root.unmount()
      })
    })
  })

  describe('Shell component sidebar', () => {
    it('renders sidebar traffic lights drag region on macOS', async () => {
      ;(window as unknown as { BBeBee: { platform: string } }).BBeBee = { platform: 'darwin' }
      const ctx = new Context()
      ctx.plugin(TestI18nStub)
      ctx.plugin(TestUiStub)

      const root = createRoot(container)
      await act(async () => {
        root.render(h(Shell, { ctx }))
      })

      const dragRegion = container.querySelector('[data-testid="sidebar-traffic-lights-drag-region"]')
      expect(dragRegion).not.toBeNull()
      expect((dragRegion as HTMLElement).style.height).toBe('36px')

      await act(async () => {
        root.unmount()
      })
    })

    it('does not render sidebar traffic lights drag region on Linux', async () => {
      ;(window as unknown as { BBeBee: { platform: string } }).BBeBee = { platform: 'linux' }
      const ctx = new Context()
      ctx.plugin(TestI18nStub)
      ctx.plugin(TestUiStub)

      const root = createRoot(container)
      await act(async () => {
        root.render(h(Shell, { ctx }))
      })

      const dragRegion = container.querySelector('[data-testid="sidebar-traffic-lights-drag-region"]')
      expect(dragRegion).toBeNull()

      await act(async () => {
        root.unmount()
      })
    })
  })
})
