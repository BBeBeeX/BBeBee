// @vitest-environment jsdom
import { createElement as h } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import type { NowPlayingStyleMeta, QueueItem, Track, TransportState } from '@BBeBee/protocol'
import { NowPlayingPlugin } from '@bbebee/plugin-now-playing'
import { SandboxedLayout } from './styles/SandboxedLayout.js'
import { buildSandboxedHtml } from './styles/sandboxed-html.js'
import type { NowPlayingLayoutProps } from './styles/index.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const IDLE: TransportState = {
  status: 'playing',
  positionMs: 30000,
  durationMs: 180000,
  bufferedMs: 60000,
  volume: 1,
  muted: false,
  repeat: 'off',
  shuffle: false,
  playMode: 'sequence',
  trackUrn: 'BBeBee:local:track:1',
  nowPlaying: {
    title: 'Starman',
    artist: 'David Bowie',
    album: 'Ziggy Stardust',
    artwork: {
      id: 'art-1',
      sourceUrl: 'file:///home/user/Music/cover.jpg',
      dominantColor: '#123456',
    },
  },
}

const DEFAULT_CAN: NowPlayingLayoutProps['can'] = {
  canPlay: true,
  canPause: true,
  canSeek: true,
  canNext: true,
  canPrevious: true,
}

class DefaultI18nStub extends Service {
  locale = 'en'
  listeners = new Set<(locale: string) => void>()
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  t = (key: string) => key
  onLocaleChange = (cb: (locale: string) => void): (() => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
}

async function harness(state: Partial<TransportState> = {}) {
  const calls: string[] = []
  const transport: TransportState = { ...IDLE, ...state }

  class PlayerStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'player')
    }
    get state() {
      return transport
    }
    get queue(): QueueItem[] {
      return []
    }
    play = async () => void calls.push('play')
    pause = () => void calls.push('pause')
    togglePlay = () => void calls.push('togglePlay')
    next = async () => void calls.push('next')
    previous = async () => void calls.push('previous')
    seek = async (ms: number) => void calls.push(`seek:${ms}`)
  }

  class LibraryStub extends Service {
    saved = new Set<string>()
    constructor(ctx: Context) {
      super(ctx, 'library')
    }
    isSaved = async (urn: string) => this.saved.has(urn)
    setSaved = async (urn: string, s: boolean) => {
      if (s) this.saved.add(urn)
      else this.saved.delete(urn)
      calls.push(`setSaved:${urn}:${s}`)
      this.ctx.emit('library/changed', 'track', [urn])
    }
  }

  class SourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sources')
    }
    getTracks = async (_urns: readonly string[]): Promise<Track[]> => []
  }

  class LyricsStub extends Service {
    state = {
      status: 'ready' as const,
      trackUrn: IDLE.trackUrn,
      lyrics: {
        format: 'lrc' as const,
        content: '[00:10.00]First line\n[00:30.00]Second line\n[01:00.00]Third line',
        synced: true,
      },
      offsetMs: 0,
    }
    constructor(ctx: Context) {
      super(ctx, 'lyrics')
    }
  }

  const root = new Context()
  await root.plugin(PlayerStub)
  await root.plugin(LibraryStub)
  await root.plugin(SourcesStub)
  await root.plugin(LyricsStub)
  await root.plugin(DefaultI18nStub)
  await root.plugin(NowPlayingPlugin)

  let scoped: Context | undefined
  root.inject(['player', 'nowPlaying', 'library', 'sources', 'lyrics', 'i18n'], (s) => void (scoped = s))
  await new Promise((r) => setTimeout(r, 0))
  if (!scoped) throw new Error('failed to scope')

  return { ctx: scoped, calls }
}

describe('buildSandboxedHtml', () => {
  it('injects SDK script into head of full HTML document without nesting html/body tags', () => {
    const fullDoc = `<!DOCTYPE html>
<html>
<head>
  <title>Custom Skin</title>
  <style>body { background: black; }</style>
</head>
<body>
  <div id="content">Hello World</div>
</body>
</html>`

    const result = buildSandboxedHtml(fullDoc)
    expect(result).toContain('<title>Custom Skin</title>')
    expect(result).toContain('window.BBeBeePlayer')
    expect(result).toContain('onSnapshot: function')
    expect(result).toContain('onStateChange: function')
    // Should NOT contain a second <body> wrapping the entire document
    expect(result.indexOf('<!DOCTYPE html>')).toBe(0)
    const bodyMatches = result.match(/<body(\s[^>]*)?>/gi)
    expect(bodyMatches?.length).toBe(1)
  })

  it('wraps HTML fragment in valid document shell', () => {
    const fragment = '<div id="minimal-player">Minimal</div>'
    const result = buildSandboxedHtml(fragment)
    expect(result).toContain('<!DOCTYPE html>')
    expect(result).toContain('<div id="minimal-player">Minimal</div>')
    expect(result).toContain('window.BBeBeePlayer')
  })
})

describe('SandboxedLayout', () => {
  it('rewrites file:// cover URLs to bbebee-file:// and delivers snapshot via postMessage', async () => {
    const { ctx } = await harness()
    const meta: NowPlayingStyleMeta = {
      id: 'test-sandbox',
      name: 'Test Sandbox',
      description: 'Test sandbox layout',
      icon: 'sparkles',
      type: 'sandboxed',
      htmlContent: '<div>Player</div>',
    }

    const { container } = render(
      h(SandboxedLayout, {
        ctx,
        state: ctx.player.state,
        position: 30000,
        displayPosition: 30000,
        duration: 180000,
        can: DEFAULT_CAN,
        seekingPosition: undefined,
        onSeekChange: () => {},
        onSeekCommit: () => {},
        PanelComponent: null,
        VisualizerComponent: null,
        meta,
      }),
    )

    const iframe = container.querySelector('[data-testid="sandbox-iframe"]') as HTMLIFrameElement
    expect(iframe).toBeTruthy()

    // Mock postMessage on the iframe's contentWindow
    const mockPostMessage = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: mockPostMessage },
      writable: true,
    })

    // Simulate iframe load
    fireEvent.load(iframe)

    expect(mockPostMessage).toHaveBeenCalled()
    const calls = mockPostMessage.mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall).toBeDefined()
    expect(lastCall?.[0].type).toBe('NOW_PLAYING_SNAPSHOT')
    const payload = lastCall?.[0].payload
    expect(payload.title).toBe('Starman')
    expect(payload.artist).toBe('David Bowie')
    expect(payload.positionMs).toBe(30000)
    expect(payload.durationMs).toBe(180000)
    expect(payload.isPlaying).toBe(true)
    // In jsdom the origin is http://localhost:3000 (vite-like dev), so the dev proxy kicks in.
    expect(payload.cover).toBe('http://localhost:3000/__bbebee-file/home/user/Music/cover.jpg')
    // Lyrics should be parsed and active index computed for 30s
    expect(payload.lyrics.lines.length).toBe(3)
    expect(payload.lyrics.lines[0]?.text).toBe('First line')
    expect(payload.lyrics.activeIndex).toBe(1)
  })

  it('handles whitelisted actions sent from the sandboxed iframe', async () => {
    const { ctx, calls } = await harness()
    const meta: NowPlayingStyleMeta = {
      id: 'test-sandbox',
      name: 'Test Sandbox',
      description: 'Test sandbox layout',
      icon: 'sparkles',
      type: 'sandboxed',
      htmlContent: '<div>Player</div>',
    }

    const { container } = render(
      h(SandboxedLayout, {
        ctx,
        state: ctx.player.state,
        position: 30000,
        displayPosition: 30000,
        duration: 180000,
        can: DEFAULT_CAN,
        seekingPosition: undefined,
        onSeekChange: () => {},
        onSeekCommit: () => {},
        PanelComponent: null,
        VisualizerComponent: null,
        meta,
      }),
    )

    const iframe = container.querySelector('[data-testid="sandbox-iframe"]') as HTMLIFrameElement
    const iframeWindow = { postMessage: vi.fn() }
    Object.defineProperty(iframe, 'contentWindow', {
      value: iframeWindow,
      writable: true,
    })

    // Send action:togglePlay
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframeWindow as unknown as MessageEventSource,
        data: { type: 'action:togglePlay' },
      }),
    )
    expect(calls).toContain('togglePlay')

    // Send action:play
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframeWindow as unknown as MessageEventSource,
        data: { type: 'action:play' },
      }),
    )
    expect(calls).toContain('play')

    // Send action:pause
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframeWindow as unknown as MessageEventSource,
        data: { type: 'action:pause' },
      }),
    )
    expect(calls).toContain('pause')

    // Send action:next
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframeWindow as unknown as MessageEventSource,
        data: { type: 'action:next' },
      }),
    )
    expect(calls).toContain('next')

    // Send action:previous
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframeWindow as unknown as MessageEventSource,
        data: { type: 'action:previous' },
      }),
    )
    expect(calls).toContain('previous')

    // Send action:seek
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframeWindow as unknown as MessageEventSource,
        data: { type: 'action:seek', positionMs: 65000 },
      }),
    )
    expect(calls).toContain('seek:65000')

    // Send action:toggleFavorite
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframeWindow as unknown as MessageEventSource,
        data: { type: 'action:toggleFavorite' },
      }),
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(calls.some((c) => c.startsWith('setSaved:BBeBee:local:track:1:true'))).toBe(true)

    // Security check: Ignore message from non-iframe source
    const otherWindow = {}
    window.dispatchEvent(
      new MessageEvent('message', {
        source: otherWindow as unknown as MessageEventSource,
        data: { type: 'action:next' },
      }),
    )
    // next should not have been called a second time
    expect(calls.filter((c) => c === 'next').length).toBe(1)
  })

  it('uses window.BBeBee.sandbox.setHtml bridge when available to serve bbebee-sandbox://', async () => {
    const { ctx } = await harness()
    const setHtmlCalls: Array<{ id: string; html: string }> = []
    ;(window as unknown as { BBeBee: unknown }).BBeBee = {
      sandbox: {
        setHtml: async (id: string, html: string) => {
          setHtmlCalls.push({ id, html })
        },
      },
    }

    const meta: NowPlayingStyleMeta = {
      id: 'custom-skin',
      name: 'Custom Skin',
      description: 'Custom skin',
      icon: 'palette',
      type: 'sandboxed',
      htmlContent: '<div>Custom Skin HTML</div>',
    }

    const { container } = render(
      h(SandboxedLayout, {
        ctx,
        state: ctx.player.state,
        position: 0,
        displayPosition: 0,
        duration: 10000,
        can: DEFAULT_CAN,
        seekingPosition: undefined,
        onSeekChange: () => {},
        onSeekCommit: () => {},
        PanelComponent: null,
        VisualizerComponent: null,
        meta,
      }),
    )

    await new Promise((r) => setTimeout(r, 20))
    expect(setHtmlCalls.length).toBeGreaterThan(0)
    expect(setHtmlCalls[0]?.id).toBe('custom-skin')
    expect(setHtmlCalls[0]?.html).toContain('Custom Skin HTML')

    const iframe = container.querySelector('[data-testid="sandbox-iframe"]') as HTMLIFrameElement
    expect(iframe.src).toBe('bbebee-sandbox://now-playing/custom-skin')

    delete (window as unknown as { BBeBee?: unknown }).BBeBee
  })

  it('automatically upgrades sample-neon-player to v1.2.0 if older version is passed', async () => {
    const { ctx } = await harness()
    const meta: NowPlayingStyleMeta = {
      id: 'sample-neon-player',
      name: 'Neon Sandbox Player',
      description: 'Sample template',
      icon: 'sparkles',
      type: 'sandboxed',
      version: '1.0.0', // Older version
      htmlContent: '<div>Old Template</div>',
    }

    const { container } = render(
      h(SandboxedLayout, {
        ctx,
        state: ctx.player.state,
        position: 0,
        displayPosition: 0,
        duration: 10000,
        can: DEFAULT_CAN,
        seekingPosition: undefined,
        onSeekChange: () => {},
        onSeekCommit: () => {},
        PanelComponent: null,
        VisualizerComponent: null,
        meta,
      }),
    )

    const iframe = container.querySelector('[data-testid="sandbox-iframe"]') as HTMLIFrameElement
    expect(iframe).toBeTruthy()
    // The rendered html should be the updated v1.2.0 template, not the old htmlContent
    expect(iframe.getAttribute('srcdoc')).toContain('SANDBOX PLUGIN')
    expect(iframe.getAttribute('srcdoc')).not.toContain('<div>Old Template</div>')
  })
})

