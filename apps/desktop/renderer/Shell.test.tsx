// @vitest-environment jsdom
/**
 * The pane that renders other people's code.
 *
 * The shell resolves a contributed route to a view it did not write and
 * renders it. Two of the three outcomes are normal — a view, or a placeholder
 * where a target has none — and the third is a view that throws, which used to
 * take the whole window with it: React unmounts the root when a render throws
 * uncaught, so the app became the body's background colour with the reason
 * visible only in devtools.
 */

import { describe, expect, it, vi } from 'vitest'
import { act, createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { SleepTimerState } from '@BBeBee/protocol'
import { resetSearchSourceSelection } from '@BBeBee/plugin-sources/hooks'
import { Shell } from './Shell.js'

/** Just the slice of `ctx.ui` the shell reads. */
class UiStub extends Service {
  readonly views = new Map<string, unknown>()
  routes: { kind: 'route'; id: string; path: string; title: string; placement?: string[]; icon?: string }[] = []
  settings: { kind: 'settings'; id: string; section?: string; title: string }[] = []
  private trayItems: { kind?: 'tray'; id: string; title: string; icon?: string; targetRoute?: string; order?: number; action?: () => void | Promise<void> }[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  get tray() {
    const fromRoutes = this.routes
      .filter((r) => r.placement?.includes('tray') && !this.trayItems.some((t) => t.id === r.id))
      .map((r) => ({
        kind: 'tray' as const,
        id: r.id,
        title: r.title,
        icon: r.icon,
        targetRoute: r.id,
      }))
    return [...this.trayItems, ...fromRoutes]
  }

  set tray(items) {
    this.trayItems = items
  }

  contribute(c: { kind: string; id: string; [key: string]: unknown }) {
    if (c.kind === 'tray') {
      this.trayItems.push(c as any)
      this.ctx.emit('ui/changed')
    }
    return () => {}
  }

  viewFor(id: string) {
    return this.views.get(id)
  }

  navigate(id: string, params?: Record<string, unknown>) {
    this.ctx.emit('ui/navigate', id, params)
  }
}

class SourcesStub extends Service {
  sources = [
    { id: 'bilibili', name: 'Bilibili', enabled: true },
    { id: 'netease', name: 'Netease', enabled: true },
  ]
  providers = [
    {
      sourceId: 'bilibili',
      search: vi.fn(),
      capabilities: {
        search: { tracks: true, artists: false, albums: false, playlists: false },
      },
    },
    {
      sourceId: 'netease',
      search: vi.fn(),
      capabilities: {
        search: { tracks: true, artists: false, albums: false, playlists: false },
      },
    },
  ]

  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
}

class SleepTimerStub extends Service {
  state: SleepTimerState = { active: false }
  cancel = vi.fn(() => {
    this.state = { active: false }
    this.ctx.emit('sleep-timer/changed', this.state)
  })
  constructor(ctx: Context) {
    super(ctx, 'sleepTimer')
  }
}

class ShareStub extends Service {
  static override readonly name = 'share'
  openImport = vi.fn()
  constructor(ctx: Context) {
    super(ctx, 'share')
  }
}

async function mount(
  register: (ui: UiStub) => void,
  setupCtx?: (ctx: Context) => void | Promise<void>,
) {
  const ctx = new Context()
  await ctx.plugin(UiStub)
  if (setupCtx) await setupCtx(ctx)
  await new Promise((resolve) => setTimeout(resolve, 10))
  register(ctx.ui as unknown as UiStub)

  // The context the shell is really given: `app.ready(['ui'])`, which has
  // `ui` injected and nothing else.
  const shellCtx = await new Promise<Context>((resolve) => {
    void ctx.inject(['ui'], (scoped) => void resolve(scoped))
  })
  await new Promise((resolve) => setTimeout(resolve, 10))

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(h(Shell, { ctx: shellCtx })))
  return { container, root, ctx: shellCtx }
}

const route = (id: string, title: string) =>
  ({ kind: 'route' as const, id, path: `/${id}`, title })

describe('the desktop shell', () => {
  it('renders a contributed view', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [route('good', 'Good')]
      ui.views.set('good', () => h('p', null, 'the view rendered'))
    })
    expect(container.textContent).toContain('the view rendered')
  })

  it('keeps a throwing view from taking the whole app down', async () => {
    /*
     * ⚠️ The regression this file exists for. Before the boundary, this test
     * left `container` empty — React had unmounted everything, which on a real
     * window is a black page with no sidebar and no way back.
     */
    const { container } = await mount((ui) => {
      ui.routes = [route('bad', 'Bad')]
      ui.views.set('bad', () => {
        throw new Error('cannot get property "inspector" without inject')
      })
    })

    // The failure is named, and it says which view failed.
    expect(container.textContent).toContain('"Bad" failed to render')
    expect(container.textContent).toContain('without inject')
    // And the app is still there: the sidebar survived.
    expect(container.textContent).toContain('BBeBee')
  })

  it('says so when a contribution has no view on this target', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [route('viewless', 'Viewless')]
    })
    expect(container.textContent).toContain('has no desktop view')
  })

  it('switches views when ui/navigate is emitted', async () => {
    const { container, ctx } = await mount((ui) => {
      ui.routes = [route('first', 'First'), route('second', 'Second')]
      ui.views.set('first', () => h('p', null, 'first view'))
      ui.views.set('second', () => h('p', null, 'second view'))
    })
    expect(container.textContent).toContain('first view')
    await act(async () => {
      ctx.emit('ui/navigate', 'second')
    })
    expect(container.textContent).toContain('second view')
  })

  it('opens and closes fullscreen now playing page', async () => {
    const { container, ctx } = await mount((ui) => {
      ui.routes = [route('queue', 'Queue'), route('now-playing.view', 'Now playing')]
      ui.views.set('queue', () => h('p', null, 'queue view'))
      ui.views.set('now-playing.view', ({ onClose }: { onClose?: () => void }) =>
        h(
          'div',
          null,
          h('p', null, 'now playing fullscreen view'),
          h('button', { 'aria-label': 'Close now playing', onClick: onClose }, 'Close'),
        ),
      )
      ui.views.set('now-playing.bar', () => h('div', null, 'bottom bar'))
    })

    expect(container.textContent).toContain('queue view')
    expect(container.querySelector('[data-testid="fullscreen-now-playing"]')).toBeNull()

    // Navigate to now-playing
    await act(async () => {
      ctx.emit('ui/navigate', 'now-playing.view')
    })

    expect(container.textContent).toContain('now playing fullscreen view')
    expect(container.querySelector('[data-testid="fullscreen-now-playing"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="fullscreen-top-bar"]')).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="fullscreen-top-bar"] button[aria-label="Minimize window"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="fullscreen-top-bar"] button[aria-label="Maximize window"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="fullscreen-top-bar"] button[aria-label="Close window"]',
      ),
    ).not.toBeNull()
    expect(container.querySelector('[data-testid="hover-bottom-bar-container"]')).not.toBeNull()

    // Moving mouse to top area (clientY <= 64) reveals top bar with drag region
    const fullscreenContainer = container.querySelector('[data-testid="fullscreen-now-playing"]') as HTMLElement
    const topBar = container.querySelector('[data-testid="fullscreen-top-bar"]') as HTMLElement
    expect(topBar).not.toBeNull()

    await act(async () => {
      fireEvent.mouseMove(fullscreenContainer, { clientY: 30 })
    })
    expect(topBar.style.transform).toBe('translateY(0)')
    expect(topBar.style.visibility).toBe('visible')

    // Moving mouse down (clientY >= 76) schedules hide of top bar
    await act(async () => {
      fireEvent.mouseMove(fullscreenContainer, { clientY: 100 })
      await new Promise((r) => setTimeout(r, 300))
    })
    expect(topBar.style.transform).toBe('translateY(-100%)')

    // Moving back to top re-reveals top bar
    await act(async () => {
      fireEvent.mouseMove(fullscreenContainer, { clientY: 20 })
    })
    expect(topBar.style.transform).toBe('translateY(0)')
    expect(topBar.style.visibility).toBe('visible')

    // Click close button
    const closeBtn = container.querySelector(
      'button[aria-label="Close now playing"]',
    ) as HTMLButtonElement
    expect(closeBtn).not.toBeNull()
    await act(async () => {
      closeBtn.click()
    })

    // Closed, returns to queue view
    expect(container.querySelector('[data-testid="fullscreen-now-playing"]')).toBeNull()
    expect(container.textContent).toContain('queue view')
  })

  it('opens the queue drawer over the fullscreen play page without leaving it', async () => {
    const { container, ctx } = await mount((ui) => {
      ui.routes = [route('home', 'Home'), route('now-playing.view', 'Now playing')]
      ui.views.set('home', () => h('p', null, 'home view'))
      ui.views.set('now-playing.view', () => h('p', null, 'now playing fullscreen view'))
      ui.views.set('queue.view', () => h('div', { 'data-testid': 'queue-content' }, 'Queue Aside Content'))
      ui.views.set('now-playing.bar', () => h('div', null, 'Player Bar'))
    })

    await act(async () => {
      ctx.emit('ui/navigate', 'now-playing.view')
    })
    expect(container.querySelector('[data-testid="fullscreen-now-playing"]')).not.toBeNull()

    // Opening the queue from the play page floats the drawer above it —
    // it must not eject the user out of the play page.
    await act(async () => {
      ctx.emit('ui/navigate', 'queue.view')
    })
    expect(container.querySelector('[data-testid="fullscreen-now-playing"]')).not.toBeNull()
    const aside = container.querySelector('[data-testid="queue-sidebar-panel"]') as HTMLElement
    expect(aside).not.toBeNull()
    expect(Number(aside.style.zIndex)).toBeGreaterThan(100)
    expect(container.textContent).toContain('now playing fullscreen view')

    // A second toggle closes the drawer and still keeps the play page.
    await act(async () => {
      ctx.emit('ui/navigate', 'queue.view')
    })
    expect(container.querySelector('[data-testid="queue-sidebar-panel"]')).toBeNull()
    expect(container.querySelector('[data-testid="fullscreen-now-playing"]')).not.toBeNull()
  })

  it('keeps page state intact across a fullscreen now-playing round trip', async () => {
    function StatefulPage() {
      const [count, setCount] = useState(0)
      return h(
        'button',
        { 'data-testid': 'stateful-page-btn', onClick: () => setCount(count + 1) },
        `clicked ${count}`,
      )
    }

    const { container, ctx } = await mount((ui) => {
      ui.routes = [route('home', 'Home'), route('now-playing.view', 'Now playing')]
      ui.views.set('home', StatefulPage)
      ui.views.set('now-playing.view', () => h('p', null, 'now playing fullscreen view'))
      ui.views.set('now-playing.bar', () => h('div', null, 'Player Bar'))
    })

    const btn = () => container.querySelector('[data-testid="stateful-page-btn"]') as HTMLButtonElement
    await act(async () => {
      btn().click()
    })
    await act(async () => {
      btn().click()
    })
    expect(btn().textContent).toBe('clicked 2')

    // Into the play page…
    await act(async () => {
      ctx.emit('ui/navigate', 'now-playing.view')
    })
    expect(container.querySelector('[data-testid="fullscreen-now-playing"]')).not.toBeNull()

    // …and back out via the top bar's close button.
    const closeBtn = container.querySelector(
      'button[aria-label="Close now playing"]',
    ) as HTMLButtonElement
    await act(async () => {
      closeBtn.click()
    })
    expect(container.querySelector('[data-testid="fullscreen-now-playing"]')).toBeNull()

    // The page behind was never unmounted, so its state survived the trip.
    expect(btn().textContent).toBe('clicked 2')
  })

  it('renders in-app Spotify-style top bar with controls', async () => {
    const minimizeMock = vi.fn()
    const maximizeMock = vi.fn().mockResolvedValue(true)
    const closeMock = vi.fn()

    ;(window as any).BBeBee = {
      window: {
        minimize: minimizeMock,
        maximize: maximizeMock,
        close: closeMock,
        isMaximized: vi.fn().mockResolvedValue(false),
      },
    }

    const { container } = await mount((ui) => {
      ui.routes = [route('home', 'Home')]
      ui.views.set('home', () => h('p', null, 'home page'))
    })

    const header = container.querySelector('header[aria-label="Application Header"]')
    expect(header).not.toBeNull()

    // Left controls: More, Back, Forward
    const moreBtn = container.querySelector('button[aria-label="More options"]') as HTMLButtonElement
    const backBtn = container.querySelector('button[aria-label="Go back"]') as HTMLButtonElement
    const forwardBtn = container.querySelector('button[aria-label="Go forward"]') as HTMLButtonElement
    expect(moreBtn).not.toBeNull()
    expect(backBtn).not.toBeNull()
    expect(forwardBtn).not.toBeNull()

    // Center controls: Search. (Home navigation lives on the brand logo and
    // the More menu — the standalone Home button was removed.)
    const logoBtn = container.querySelector('button[aria-label="BBeBee Home"]') as HTMLButtonElement
    const searchInput = container.querySelector('input[aria-label="Search"]') as HTMLInputElement
    expect(logoBtn).not.toBeNull()
    expect(searchInput).not.toBeNull()

    // Right controls: Profile, Minimize, Maximize, Close
    const profileBtn = container.querySelector('button[aria-label="User profile"]') as HTMLButtonElement
    const minBtn = container.querySelector('button[aria-label="Minimize window"]') as HTMLButtonElement
    const maxBtn = container.querySelector('button[aria-label="Maximize window"]') as HTMLButtonElement
    const closeBtn = container.querySelector('button[aria-label="Close window"]') as HTMLButtonElement
    expect(profileBtn).not.toBeNull()
    expect(minBtn).not.toBeNull()
    expect(maxBtn).not.toBeNull()
    expect(closeBtn).not.toBeNull()

    // Test window controls click
    await act(async () => {
      minBtn.click()
      maxBtn.click()
      closeBtn.click()
    })
    expect(minimizeMock).toHaveBeenCalledTimes(1)
    expect(maximizeMock).toHaveBeenCalledTimes(1)
    expect(closeMock).toHaveBeenCalledTimes(1)

    // Test more options dropdown
    await act(async () => {
      moreBtn.click()
    })
    expect(container.textContent).toContain('Settings')
  })

  it('applies rounded card layout with dark grey background and gaps', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [route('home', 'Home')]
      ui.views.set('home', () => h('p', null, 'home page'))
      ui.views.set('now-playing.bar', () => h('div', null, 'player bar'))
    })

    const nav = container.querySelector('nav') as HTMLElement
    const main = container.querySelector('main') as HTMLElement
    const footer = container.querySelector('footer') as HTMLElement
    expect(nav).not.toBeNull()
    expect(main).not.toBeNull()
    expect(footer).not.toBeNull()

    // Left and right panels: theme primary background, 8px border radius
    expect(nav.style.background).toContain('--bg-primary')
    expect(nav.style.borderRadius).toBe('8px')
    expect(main.style.background).toContain('--bg-primary')
    expect(main.style.borderRadius).toBe('8px')

    // Bottom bar: theme player background
    expect(footer.style.background).toContain('--player-bg')

    // Workspace container: 8px gap and 8px padding
    const workspace = nav.parentElement as HTMLElement
    expect(workspace).not.toBeNull()
    expect(workspace.style.gap).toBe('8px')
    expect(workspace.style.padding).toBe('8px')
  })

  it('navigates right pane to album view while keeping sidebar intact', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [route('library.home', 'Library')]
      ui.views.set('library.home', ({ onOpenAlbum }: { onOpenAlbum?: (urn: string) => void }) =>
        h(
          'div',
          null,
          h('p', null, 'library list'),
          h(
            'button',
            {
              'aria-label': 'Test Album',
              onClick: () => onOpenAlbum?.('BBeBee:local:album:test-42'),
            },
            'Open Album',
          ),
        ),
      )
      ui.views.set('album.view', ({ urn }: { urn?: string }) =>
        h('div', { 'data-testid': 'album-screen' }, `Album Detail: ${urn}`),
      )
    })

    expect(container.textContent).toContain('library list')
    const nav = container.querySelector('nav')
    expect(nav).not.toBeNull()
    expect(nav?.textContent).toContain('Library')

    // Click album to navigate
    const albumBtn = container.querySelector('button[aria-label="Test Album"]') as HTMLButtonElement
    expect(albumBtn).not.toBeNull()
    await act(async () => {
      albumBtn.click()
    })

    // Right pane is now album screen with correct URN
    expect(container.textContent).toContain('Album Detail: BBeBee:local:album:test-42')
    // Sidebar is still mounted and intact
    expect(container.querySelector('nav')).toBe(nav)
    expect(nav?.textContent).toContain('Library')
  })

  it('controls right-side route history via TopBar Back, Forward, and Home buttons', async () => {
    const { container, ctx } = await mount((ui) => {
      ui.routes = [
        route('home', 'Home'),
        route('page-a', 'Page A'),
        route('page-b', 'Page B'),
      ]
      ui.views.set('home', () => h('p', null, 'Home Screen'))
      ui.views.set('page-a', () => h('p', null, 'Page A Content'))
      ui.views.set('page-b', () => h('p', null, 'Page B Content'))
    })

    const backBtn = container.querySelector('button[aria-label="Go back"]') as HTMLButtonElement
    const forwardBtn = container.querySelector('button[aria-label="Go forward"]') as HTMLButtonElement
    const homeBtn = container.querySelector('button[aria-label="BBeBee Home"]') as HTMLButtonElement

    // Initial state: on Home, cannot go back or forward
    expect(container.textContent).toContain('Home Screen')
    expect(backBtn.disabled).toBe(true)
    expect(forwardBtn.disabled).toBe(true)

    // Navigate to Page A
    await act(async () => {
      ctx.emit('ui/navigate', 'page-a')
    })
    expect(container.textContent).toContain('Page A Content')
    expect(backBtn.disabled).toBe(false)
    expect(forwardBtn.disabled).toBe(true)

    // Navigate to Page B
    await act(async () => {
      ctx.emit('ui/navigate', 'page-b')
    })
    expect(container.textContent).toContain('Page B Content')
    expect(backBtn.disabled).toBe(false)
    expect(forwardBtn.disabled).toBe(true)

    // Click Back: returns to Page A
    await act(async () => {
      backBtn.click()
    })
    expect(container.textContent).toContain('Page A Content')
    expect(backBtn.disabled).toBe(false)
    expect(forwardBtn.disabled).toBe(false)

    // Click Back again: returns to Home
    await act(async () => {
      backBtn.click()
    })
    expect(container.textContent).toContain('Home Screen')
    expect(backBtn.disabled).toBe(true)
    expect(forwardBtn.disabled).toBe(false)

    // Click Forward: returns to Page A
    await act(async () => {
      forwardBtn.click()
    })
    expect(container.textContent).toContain('Page A Content')
    expect(backBtn.disabled).toBe(false)
    expect(forwardBtn.disabled).toBe(false)

    // Click Home: navigates back to Home
    await act(async () => {
      homeBtn.click()
    })
    expect(container.textContent).toContain('Home Screen')
    expect(backBtn.disabled).toBe(false)
  })

  it('renders desktop-lyrics.floating view if contributed', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [route('home', 'Home')]
      ui.views.set('home', () => h('p', null, 'Home Screen'))
      ui.views.set('desktop-lyrics.floating', () =>
        h('div', { 'data-testid': 'desktop-lyrics-widget' }, 'floating lyrics'),
      )
    })
    expect(container.querySelector('[data-testid="desktop-lyrics-widget"]')).not.toBeNull()
    expect(container.textContent).toContain('floating lyrics')
  })

  it('excludes dsp, music sources, music folders, downloads, settings, history, and visualizer from sidebar navigation', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [
        { kind: 'route', id: 'library.home', path: '/library', title: 'Library', placement: ['sidebar'] },
        { kind: 'route', id: 'sources.search', path: '/search', title: 'Search', placement: ['sidebar'] },
        { kind: 'route', id: 'settings.view', path: '/settings', title: '设置', placement: ['sidebar'] },
        { kind: 'route', id: 'sources.import', path: '/sources/import', title: 'Import a source', placement: [] },
        { kind: 'route', id: 'sources.test', path: '/sources/test', title: 'Test a source', placement: [] },
        { kind: 'route', id: 'history.view', path: '/history', title: '播放历史', placement: ['more-menu'] },
        { kind: 'route', id: 'dsp', path: '/dsp', title: '音频效果 (DSP)', placement: [] },
        { kind: 'route', id: 'inspector', path: '/inspector', title: 'Inspector', placement: [] },
      ]
      ui.views.set('library.home', () => h('p', null, 'Library Screen'))
      ui.settings = [
        { kind: 'settings', id: 'sources.settings', title: 'Music sources' },
        { kind: 'settings', id: 'scanner.settings', title: 'Music folders' },
        { kind: 'settings', id: 'downloads.page', title: 'Downloads' },
        { kind: 'settings', id: 'dsp.settings', title: '音频效果与均衡器' },
        { kind: 'settings', id: 'settings.dsp', title: '均衡器设置' },
        { kind: 'settings', id: 'settings.view', title: '设置' },
        { kind: 'settings', id: 'sources.import', title: '导入音源' },
        { kind: 'settings', id: 'visualizer.settings', title: '音频可视化' },
        { kind: 'settings', id: 'custom.settings', title: 'Custom Setting' },
      ]
      ui.views.set('sources.settings', () => h('p', null, 'sources'))
      ui.views.set('scanner.settings', () => h('p', null, 'scanner'))
      ui.views.set('downloads.page', () => h('p', null, 'downloads'))
      ui.views.set('dsp.settings', () => h('p', null, 'dsp'))
      ui.views.set('settings.dsp', () => h('p', null, 'dsp'))
      ui.views.set('settings.view', () => h('p', null, 'settings'))
      ui.views.set('sources.import', () => h('p', null, 'import'))
      ui.views.set('visualizer.settings', () => h('p', null, 'visualizer'))
      ui.views.set('custom.settings', () => h('p', null, 'custom'))
    })

    const nav = container.querySelector('nav')
    expect(nav?.textContent).toContain('Library')
    expect(nav?.textContent).not.toContain('Search')
    expect(nav?.textContent).not.toContain('设置')
    expect(nav?.textContent).not.toContain('Import a source')
    expect(nav?.textContent).not.toContain('Test a source')
    expect(nav?.textContent).not.toContain('导入音源')
    expect(nav?.textContent).not.toContain('音频可视化')
    expect(nav?.textContent).not.toContain('播放历史')
    expect(nav?.textContent).not.toContain('音频效果 (DSP)')
    expect(nav?.textContent).not.toContain('Inspector')
    expect(nav?.textContent).not.toContain('Music sources')
    expect(nav?.textContent).not.toContain('Music folders')
    expect(nav?.textContent).not.toContain('Downloads')
    expect(nav?.textContent).not.toContain('音频效果与均衡器')
    expect(nav?.textContent).not.toContain('均衡器设置')
    expect(nav?.textContent).toContain('Custom Setting')
  })

  it('toggles right-side queue aside panel without replacing the main view', async () => {
    const { container, ctx } = await mount((ui) => {
      ui.routes = [route('library.home', 'Library')]
      ui.views.set('library.home', () => h('div', { 'data-testid': 'main-library' }, 'Main Library Content'))
      ui.views.set('queue.view', ({ onClose }: { onClose?: () => void }) =>
        h(
          'div',
          { 'data-testid': 'queue-content' },
          'Queue Aside Content',
          h('button', { 'aria-label': 'Close queue', onClick: onClose }, 'Close'),
        ),
      )
      ui.views.set('now-playing.bar', () => h('div', null, 'Player Bar'))
    })

    const workspace = container.querySelector('nav')?.parentElement as HTMLElement
    expect(workspace).not.toBeNull()
    expect(workspace.style.gridTemplateColumns).toBe('280px 1fr')
    expect(container.querySelector('[data-testid="queue-sidebar-panel"]')).toBeNull()
    expect(container.textContent).toContain('Main Library Content')

    // Navigate to queue.view toggles queue panel open
    await act(async () => {
      ctx.emit('ui/navigate', 'queue.view')
    })

    // The queue is a right-side drawer: it takes no grid column, so the main
    // view keeps its width.
    expect(workspace.style.gridTemplateColumns).toBe('280px 1fr')
    const aside = container.querySelector('[data-testid="queue-sidebar-panel"]') as HTMLElement
    expect(aside).not.toBeNull()
    expect(aside.style.position).toBe('absolute')
    expect(aside.style.right).toBe('8px')
    expect(aside.textContent).toContain('Queue Aside Content')
    // Main view is still mounted!
    expect(container.querySelector('[data-testid="main-library"]')).not.toBeNull()
    expect(container.textContent).toContain('Main Library Content')

    // Clicking close in queue panel closes it
    const closeBtn = aside.querySelector('button[aria-label="Close queue"]') as HTMLButtonElement
    expect(closeBtn).not.toBeNull()
    await act(async () => {
      closeBtn.click()
    })

    expect(container.querySelector('[data-testid="queue-sidebar-panel"]')).toBeNull()
    expect(workspace.style.gridTemplateColumns).toBe('280px 1fr')
    expect(container.textContent).toContain('Main Library Content')

    // Navigate to queue.view opens it again
    await act(async () => {
      ctx.emit('ui/navigate', 'queue.view')
    })
    expect(container.querySelector('[data-testid="queue-sidebar-panel"]')).not.toBeNull()

    // Navigating to queue.view a second time toggles it closed
    await act(async () => {
      ctx.emit('ui/navigate', 'queue.view')
    })
    expect(container.querySelector('[data-testid="queue-sidebar-panel"]')).toBeNull()
    expect(workspace.style.gridTemplateColumns).toBe('280px 1fr')
  })

  it('keeps the top bar above the main view while the library column runs full height', async () => {
    const { container, ctx } = await mount((ui) => {
      ui.routes = [route('home', 'Home')]
      ui.views.set('home', () => h('p', null, 'home page'))
      ui.views.set('queue.view', () => h('div', null, 'queue content'))
      ui.views.set('now-playing.bar', () => h('div', null, 'player bar'))
    })

    const header = container.querySelector('header[aria-label="Application Header"]') as HTMLElement
    const main = container.querySelector('main') as HTMLElement
    const nav = container.querySelector('nav') as HTMLElement
    expect(header).not.toBeNull()

    // The top bar sits directly above the main view — inside the main card,
    // not stretched across the whole window — while the library nav column
    // runs from the top of the window (it wraps no header of its own).
    expect(main.contains(header)).toBe(true)
    expect(nav.contains(header)).toBe(false)

    // Opened, the queue drawer overlays the content: absolute within the
    // workspace grid, starting below the top bar so window controls stay
    // reachable, and never resizing the grid.
    await act(async () => {
      ctx.emit('ui/navigate', 'queue.view')
    })
    const aside = container.querySelector('[data-testid="queue-sidebar-panel"]') as HTMLElement
    expect(aside).not.toBeNull()
    expect(aside.style.position).toBe('absolute')
    expect(aside.style.top).toBe('64px')
    expect(aside.style.width).toBe('340px')
  })

  it('navigates to settings.view when profile avatar is clicked', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [route('home', 'Home'), route('settings.view', 'Settings Center')]
      ui.views.set('home', () => h('p', null, 'Home Screen'))
      ui.views.set('settings.view', () => h('div', { 'data-testid': 'settings-screen' }, 'Settings Center Content'))
    })

    const profileBtn = container.querySelector('button[aria-label="User profile"]') as HTMLButtonElement
    expect(profileBtn).not.toBeNull()
    await act(async () => {
      profileBtn.click()
    })
    expect(container.querySelector('[data-testid="settings-screen"]')).not.toBeNull()
    expect(container.textContent).toContain('Settings Center Content')
  })

  it('opens 2x2 matrix under topbar search with source toggle buttons and search history, and submits search', async () => {
    window.localStorage?.clear()
    resetSearchSourceSelection(new Set())

    const { container } = await mount(
      (ui) => {
        ui.routes = [route('library.home', 'Library'), route('sources.search', 'Search Result Screen')]
        ui.views.set('library.home', () => h('p', null, 'Library Screen'))
        ui.views.set('sources.search', ({ query, sourceIds }: { query?: string; sourceIds?: readonly string[] }) =>
          h(
            'div',
            { 'data-testid': 'search-screen', 'data-source-ids': sourceIds?.join(',') },
            `Search Results for: ${query}`,
          ),
        )
      },
      async (ctx) => {
        await ctx.plugin(SourcesStub)
      },
    )

    const searchInput = container.querySelector('input[aria-label="Search"]') as HTMLInputElement
    expect(searchInput).not.toBeNull()

    // 1. Initial state: search icon at left, submit button does not exist, matrix closed
    expect(container.querySelector('button[aria-label="Submit search"]')).toBeNull()
    expect(container.querySelector('[data-testid="search-matrix-panel"]')).toBeNull()

    // 2. Focus search input -> search icon jumps to right, 2x2 matrix appears
    await act(async () => {
      searchInput.focus()
    })

    const submitBtn = container.querySelector('button[aria-label="Submit search"]') as HTMLButtonElement
    expect(submitBtn).not.toBeNull()
    const matrix = container.querySelector('[data-testid="search-matrix-panel"]') as HTMLElement
    expect(matrix).not.toBeNull()
    expect(matrix.textContent).toContain('搜索范围')
    expect(matrix.textContent).toContain('搜索历史')
    expect(matrix.textContent).toContain('暂无搜索历史')

    // Source toggle button exists from SourcesStub
    const bilibiliToggle = container.querySelector('[data-testid="search-source-toggle-bilibili:track"]') as HTMLButtonElement
    const neteaseToggle = container.querySelector('[data-testid="search-source-toggle-netease:track"]') as HTMLButtonElement
    expect(bilibiliToggle).not.toBeNull()
    expect(neteaseToggle).not.toBeNull()
    expect(bilibiliToggle.getAttribute('aria-pressed')).toBe('true')
    expect(neteaseToggle.getAttribute('aria-pressed')).toBe('true')

    // Click netease to toggle off
    await act(async () => {
      neteaseToggle.click()
    })
    expect(neteaseToggle.getAttribute('aria-pressed')).toBe('false')
    expect(bilibiliToggle.getAttribute('aria-pressed')).toBe('true')

    // 3. Click outside -> closes matrix and icon returns to left
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="search-matrix-panel"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Submit search"]')).toBeNull()

    // 4. Focus again, type query and press Enter -> submits search, navigates to sources.search with restricted sources
    await act(async () => {
      searchInput.focus()
      const tracker = (searchInput as any)._valueTracker
      if (tracker) {
        tracker.setValue('')
      }
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set
      nativeInputValueSetter?.call(searchInput, 'Chopin')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      searchInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () => {
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    // Navigated to search results screen with restricted sources (only bilibili)
    expect(container.querySelector('[data-testid="search-matrix-panel"]')).toBeNull()
    const searchScreen = container.querySelector('[data-testid="search-screen"]') as HTMLElement
    expect(searchScreen).not.toBeNull()
    expect(searchScreen.getAttribute('data-source-ids')).toBe('bilibili')
    expect(container.textContent).toContain('Search Results for: Chopin')

    // 5. Open search again -> search history now has 'Chopin'
    await act(async () => {
      searchInput.click()
    })
    const historyItem = container.querySelector('[data-testid="search-history-item-Chopin"]') as HTMLButtonElement
    expect(historyItem).not.toBeNull()

    // 6. Test clicking history item searches again
    await act(async () => {
      historyItem.click()
    })
    expect(container.querySelector('[data-testid="search-matrix-panel"]')).toBeNull()
    expect(container.textContent).toContain('Search Results for: Chopin')

    // 7. Open search again and clear history
    await act(async () => {
      searchInput.click()
    })
    const clearHistoryBtn = container.querySelector('button[aria-label="清空搜索历史"]') as HTMLButtonElement
    expect(clearHistoryBtn).not.toBeNull()
    await act(async () => {
      clearHistoryBtn.click()
    })
    expect(container.querySelector('[data-testid="search-history-item-Chopin"]')).toBeNull()
    expect(container.textContent).toContain('暂无搜索历史')
  })

  it('renders sleep timer alarm icon in topbar when active, shows countdown on hover, and allows cancellation', async () => {
    let sleepTimerRef!: SleepTimerStub
    const { container, ctx } = await mount(
      (ui) => {
        ui.routes = [route('good', 'Good')]
        ui.views.set('good', () => h('p', null, 'content'))
      },
      async (baseCtx) => {
        sleepTimerRef = new SleepTimerStub(baseCtx)
      },
    )

    // Initially no sleep timer indicator
    expect(container.querySelector('[data-testid="topbar-sleep-timer-indicator"]')).toBeNull()

    // Activate sleep timer (15 minutes = 900,000 ms)
    await act(async () => {
      sleepTimerRef.state = {
        active: true,
        mode: 'duration',
        durationMs: 15 * 60 * 1000,
        targetEpochMs: Date.now() + 15 * 60 * 1000,
      }
      ctx.emit('sleep-timer/changed', sleepTimerRef.state)
    })

    const indicator = container.querySelector('[data-testid="topbar-sleep-timer-indicator"]') as HTMLButtonElement
    expect(indicator).not.toBeNull()
    expect(indicator.textContent).toContain('15分00秒')

    // Hover to reveal popover
    const parentContainer = indicator.parentElement as HTMLElement
    await act(async () => {
      parentContainer.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    const popover = container.querySelector('[data-testid="sleep-timer-popover"]')
    expect(popover).not.toBeNull()
    expect(popover?.textContent).toContain('睡眠定时器运行中')

    const cancelBtn = container.querySelector('[data-testid="cancel-sleep-timer-button"]') as HTMLButtonElement
    expect(cancelBtn).not.toBeNull()

    // Click cancel in popover
    await act(async () => {
      cancelBtn.click()
    })

    expect(sleepTimerRef.cancel).toHaveBeenCalled()
    expect(container.querySelector('[data-testid="topbar-sleep-timer-indicator"]')).toBeNull()
  })

  it('preserves component state and keep-alive when navigating between routes and returning', async () => {
    function StatefulView() {
      const [count, setCount] = useState(0)
      return h(
        'div',
        { 'data-testid': 'stateful-view' },
        h('span', { 'data-testid': 'counter-value' }, `Count: ${count}`),
        h('button', { 'data-testid': 'increment-btn', onClick: () => setCount((c) => c + 1) }, 'Increment'),
      )
    }

    const { container, ctx } = await mount((ui) => {
      ui.routes = [route('stateful', 'Stateful'), route('other', 'Other')]
      ui.views.set('stateful', StatefulView)
      ui.views.set('other', () => h('div', { 'data-testid': 'other-view' }, 'Other Page Content'))
    })

    expect(container.querySelector('[data-testid="counter-value"]')?.textContent).toBe('Count: 0')

    // Increment count to 5
    const incrementBtn = container.querySelector('[data-testid="increment-btn"]') as HTMLButtonElement
    await act(async () => {
      incrementBtn.click()
      incrementBtn.click()
      incrementBtn.click()
      incrementBtn.click()
      incrementBtn.click()
    })
    expect(container.querySelector('[data-testid="counter-value"]')?.textContent).toBe('Count: 5')

    // Navigate away to 'other'
    await act(async () => {
      ctx.emit('ui/navigate', 'other')
    })
    expect(container.querySelector('[data-testid="other-view"]')).not.toBeNull()
    const statefulContainer = container.querySelector('[data-testid="view-page-stateful"]') as HTMLElement
    expect(statefulContainer.style.display).toBe('none')

    // Navigate back to 'stateful'
    const backBtn = container.querySelector('button[aria-label="Go back"]') as HTMLButtonElement
    await act(async () => {
      backBtn.click()
    })

    // Stateful view is visible again and count is still 5!
    expect(statefulContainer.style.display).toBe('flex')
    expect(container.querySelector('[data-testid="counter-value"]')?.textContent).toBe('Count: 5')
  })

  it('closes More options menu when clicking outside', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [route('home', 'Home')]
      ui.views.set('home', () => h('p', null, 'Home Screen'))
    })

    const moreBtn = container.querySelector('button[aria-label="More options"]') as HTMLButtonElement
    expect(moreBtn).not.toBeNull()

    // Click more button to open dropdown
    await act(async () => {
      moreBtn.click()
    })
    expect(container.textContent).toContain('Settings')

    // Click outside on document body
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    // Dropdown is closed
    expect(container.textContent).not.toContain('Settings')
  })

  it('allows adjusting sidebar and queue widths via draggable splitters', async () => {
    const { container, ctx } = await mount((ui) => {
      ui.routes = [route('home', 'Home')]
      ui.views.set('home', () => h('div', { 'data-testid': 'home-view' }, 'Home View'))
      ui.views.set('queue.view', () => h('div', { 'data-testid': 'queue-view' }, 'Queue View'))
    })

    const workspace = container.querySelector('nav')?.parentElement as HTMLElement
    expect(workspace).not.toBeNull()
    expect(workspace.style.gridTemplateColumns).toBe('280px 1fr')

    const sidebarSplitter = container.querySelector('[data-testid="sidebar-splitter"]') as HTMLElement
    expect(sidebarSplitter).not.toBeNull()

    // Mock getBoundingClientRect for workspace
    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 1000,
      top: 0,
      bottom: 800,
      width: 1000,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    })

    // Drag sidebar splitter to 350px
    fireEvent.mouseDown(sidebarSplitter, { clientX: 288 })
    fireEvent(window, new MouseEvent('mousemove', { clientX: 358 }))
    fireEvent(window, new MouseEvent('mouseup', {}))

    expect(workspace.style.gridTemplateColumns).toBe('350px 1fr')

    // Double click resets sidebar width to 280px
    fireEvent.doubleClick(sidebarSplitter)
    expect(workspace.style.gridTemplateColumns).toBe('280px 1fr')

    // Open queue view
    await act(async () => {
      ctx.emit('ui/navigate', 'queue.view')
    })

    const queueSplitter = container.querySelector('[data-testid="queue-splitter"]') as HTMLElement
    expect(queueSplitter).not.toBeNull()
    // The drawer takes no grid column, so opening it changes nothing here.
    expect(workspace.style.gridTemplateColumns).toBe('280px 1fr')

    const aside = () => container.querySelector('[data-testid="queue-sidebar-panel"]') as HTMLElement
    expect(aside().style.width).toBe('340px')

    // Drag queue splitter to 320px
    fireEvent.mouseDown(queueSplitter, { clientX: 700 })
    fireEvent(window, new MouseEvent('mousemove', { clientX: 672 })) // 1000 - 8 - 672 = 320
    fireEvent(window, new MouseEvent('mouseup', {}))

    expect(workspace.style.gridTemplateColumns).toBe('280px 1fr')
    expect(aside().style.width).toBe('320px')

    // Double click resets queue width to the drawer default
    fireEvent.doubleClick(queueSplitter)
    expect(aside().style.width).toBe('340px')
  })

  it('renders topbar tray button with chevron-down, expands to chevron-up on click, shows plugin icons, and navigates on click', async () => {
    const { container } = await mount((ui) => {
      ui.routes = [
        { kind: 'route', id: 'library.home', path: '/library', title: 'Library', placement: ['sidebar'] },
        { kind: 'route', id: 'dsp.view', path: '/dsp', title: '音频效果 (DSP)', placement: ['tray'] },
        { kind: 'route', id: 'inspector.panel', path: '/inspector', title: 'Inspector', placement: ['tray'] },
      ]
      ui.views.set('library.home', () => h('p', null, 'Library Screen'))
      ui.views.set('dsp.view', () => h('p', null, 'DSP Screen'))
      ui.views.set('inspector.panel', () => h('p', null, 'Inspector Screen'))
      ui.tray = [
        { kind: 'tray', id: 'dsp.view', title: '音频效果 (DSP)', icon: 'tune', targetRoute: 'dsp.view' },
        { kind: 'tray', id: 'inspector.panel', title: 'Inspector', icon: 'bug', targetRoute: 'inspector.panel' },
      ]
    })

    const trayButton = container.querySelector('[data-testid="topbar-tray-button"]') as HTMLButtonElement
    expect(trayButton).not.toBeNull()

    // Initially collapsed: downward arrow (chevron-down)
    expect(trayButton.querySelector('svg')?.getAttribute('data-icon')).toBe('chevron-down')
    expect(container.querySelector('[data-testid="topbar-tray-popover"]')).toBeNull()

    // Click tray button to expand
    await act(async () => {
      fireEvent.click(trayButton)
    })

    // Now expanded: upward arrow (chevron-up)
    expect(trayButton.querySelector('svg')?.getAttribute('data-icon')).toBe('chevron-up')
    const popover = container.querySelector('[data-testid="topbar-tray-popover"]') as HTMLElement
    expect(popover).not.toBeNull()
    expect(popover.textContent).toContain('插件托盘')

    // Contributed plugin items rendered in tray
    const dspItem = container.querySelector('[data-testid="topbar-tray-item-dsp.view"]') as HTMLButtonElement
    const inspectorItem = container.querySelector('[data-testid="topbar-tray-item-inspector.panel"]') as HTMLButtonElement
    expect(dspItem).not.toBeNull()
    expect(inspectorItem).not.toBeNull()
    expect(dspItem.title).toBe('音频效果 (DSP)')
    expect(inspectorItem.title).toBe('Inspector')

    // Click DSP plugin icon in tray
    await act(async () => {
      fireEvent.click(dspItem)
    })

    // Tray popover closes
    expect(container.querySelector('[data-testid="topbar-tray-popover"]')).toBeNull()
    expect(trayButton.querySelector('svg')?.getAttribute('data-icon')).toBe('chevron-down')

    // Main interface navigated to DSP screen
    expect(container.textContent).toContain('DSP Screen')

    // Reopen tray and click outside to verify close
    await act(async () => {
      fireEvent.click(trayButton)
    })
    expect(container.querySelector('[data-testid="topbar-tray-popover"]')).not.toBeNull()

    await act(async () => {
      fireEvent.mouseDown(document.body)
    })
    expect(container.querySelector('[data-testid="topbar-tray-popover"]')).toBeNull()
  })

  it('renders history, download manager, and import share in tray rather than more menu', async () => {
    let shareStub: ShareStub | undefined
    const { container } = await mount(
      (ui) => {
        ui.routes = [
          { kind: 'route', id: 'library.home', path: '/library', title: 'Library', placement: ['sidebar'] },
          { kind: 'route', id: 'history.view', path: '/history', title: '播放历史', icon: 'history', placement: ['tray', 'tab-bar'] },
          { kind: 'route', id: 'downloads.page', path: '/downloads', title: '下载管理', icon: 'download', placement: ['tray'] },
        ]
        ui.views.set('library.home', () => h('p', null, 'Library Screen'))
        ui.views.set('history.view', () => h('p', null, 'History Screen'))
        ui.views.set('downloads.page', () => h('p', null, 'Downloads Screen'))
        ui.tray = [
          {
            kind: 'tray',
            id: 'share.import',
            title: '导入分享',
            icon: 'share-box',
            order: 40,
            action: () => {
              shareStub?.openImport()
            },
          },
        ]
      },
      async (c) => {
        await c.plugin(ShareStub)
        shareStub = (c as unknown as { share: ShareStub }).share
      },
    )

    // TopBar right group does NOT have standalone import share button
    expect(container.querySelector('[data-testid="topbar-import-share-button"]')).toBeNull()

    // 1. Verify More Menu does NOT contain history, downloads, or import share
    const moreButton = container.querySelector('[data-testid="topbar-more-button"]') as HTMLButtonElement
    expect(moreButton).not.toBeNull()
    await act(async () => {
      fireEvent.click(moreButton)
    })
    const moreDropdown = container.querySelector('[data-testid="topbar-more-menu-dropdown"]') as HTMLElement
    expect(moreDropdown).not.toBeNull()
    expect(moreDropdown.textContent).toContain('Home')
    expect(moreDropdown.textContent).toContain('Settings')
    expect(moreDropdown.textContent).not.toContain('播放历史')
    expect(moreDropdown.textContent).not.toContain('下载管理')
    expect(moreDropdown.textContent).not.toContain('导入分享')
    await act(async () => {
      fireEvent.click(moreButton)
    })
    expect(container.querySelector('[data-testid="topbar-more-menu-dropdown"]')).toBeNull()

    // 2. Verify Tray contains history, downloads, and import share
    const trayButton = container.querySelector('[data-testid="topbar-tray-button"]') as HTMLButtonElement
    expect(trayButton).not.toBeNull()
    await act(async () => {
      fireEvent.click(trayButton)
    })
    const trayPopover = container.querySelector('[data-testid="topbar-tray-popover"]') as HTMLElement
    expect(trayPopover).not.toBeNull()

    const historyTrayItem = container.querySelector('[data-testid="topbar-tray-item-history.view"]') as HTMLButtonElement
    const downloadsTrayItem = container.querySelector('[data-testid="topbar-tray-item-downloads.page"]') as HTMLButtonElement
    const importShareTrayItem = container.querySelector('[data-testid="topbar-tray-item-share.import"]') as HTMLButtonElement

    expect(historyTrayItem).not.toBeNull()
    expect(downloadsTrayItem).not.toBeNull()
    expect(importShareTrayItem).not.toBeNull()

    expect(historyTrayItem.title).toBe('播放历史')
    expect(downloadsTrayItem.title).toBe('下载管理')
    expect(importShareTrayItem.title).toBe('导入分享')

    // Click '播放历史' in tray
    await act(async () => {
      fireEvent.click(historyTrayItem)
    })
    expect(container.querySelector('[data-testid="topbar-tray-popover"]')).toBeNull()
    expect(container.textContent).toContain('History Screen')

    // Reopen tray and click '下载管理'
    await act(async () => {
      fireEvent.click(trayButton)
    })
    await act(async () => {
      fireEvent.click(container.querySelector('[data-testid="topbar-tray-item-downloads.page"]')!)
    })
    expect(container.querySelector('[data-testid="topbar-tray-popover"]')).toBeNull()
    expect(container.textContent).toContain('Downloads Screen')

    // Reopen tray and click '导入分享'
    await act(async () => {
      fireEvent.click(trayButton)
    })
    await act(async () => {
      fireEvent.click(container.querySelector('[data-testid="topbar-tray-item-share.import"]')!)
    })
    expect(container.querySelector('[data-testid="topbar-tray-popover"]')).toBeNull()
    expect(shareStub?.openImport).toHaveBeenCalled()
  })

  it('switches to local music and passes highlightUrns when files are dropped', async () => {
    class MockScanner extends Service {
      constructor(ctx: Context) {
        super(ctx, 'scanner')
      }
      importFiles = vi.fn().mockResolvedValue({ added: 1, updated: 0, removed: 0, errors: 0 })
    }

    class MockFs extends Service {
      constructor(ctx: Context) {
        super(ctx, 'fs')
      }
      stat = vi.fn().mockResolvedValue({ isDirectory: false })
    }

    class MockDb extends Service {
      constructor(ctx: Context) {
        super(ctx, 'db')
      }
      query = vi.fn().mockResolvedValue([{ track_urn: 'BBeBee:local:track:dropped-1' }])
    }

    let localProps: any = null
    const { container } = await mount(
      (ui) => {
        ui.routes = [
          route('sources.recommend', 'Home'),
          route('library.local', '本地文件'),
        ]
        ui.views.set('sources.recommend', () => h('div', null, 'Home Screen'))
        ui.views.set('library.local', (props: any) => {
          localProps = props
          return h('div', { 'data-testid': 'local-music-view' }, `Local Music: ${props.highlightUrn}`)
        })
      },
      async (ctx) => {
        await ctx.plugin(MockFs)
        await ctx.plugin(MockScanner)
        await ctx.plugin(MockDb)
      },
    )

    const file = new File(['audio content'], 'dropped.mp3')
    window.BBeBee = {
      files: { getPath: () => '/music/dropped.mp3' },
    } as any

    const rootDiv = container.firstElementChild as HTMLElement
    await act(async () => {
      fireEvent.drop(rootDiv, {
        dataTransfer: {
          files: [file],
          types: ['Files'],
        },
      })
    })

    // Wait for async importDroppedFiles and navigation
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
    })

    expect(container.querySelector('[data-testid="local-music-view"]')).not.toBeNull()
    expect(localProps?.highlightUrn).toBe('BBeBee:local:track:dropped-1')
    expect(localProps?.highlightUrns).toEqual(['BBeBee:local:track:dropped-1'])
  })
})

