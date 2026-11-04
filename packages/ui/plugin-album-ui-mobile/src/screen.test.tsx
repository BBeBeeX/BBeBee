// @vitest-environment jsdom
/**
 * The mobile album screen, rendered and pressed.
 *
 * The same playback contract as the desktop twin — Play album replaces the
 * queue, a row tap carries the album context — plus the phone-only affordance:
 * a back control that works even when the shell passed no `onBack`.
 *
 * React Native is injected as DOM host components, the same seam
 * `apps/mobile` uses to hand over the real `react-native`.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { AlbumDetail, DownloadTask, Track } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'
import albumCatalogue from '../../../feature/plugin-i18n/src/locales/album.json'
import appCatalogue from '../../../feature/plugin-i18n/src/locales/en.json'
import { AlbumScreen } from './index.js'

afterEach(cleanup)

/**
 * English-only i18n stub: components under test render the same copy the
 * app shows. Both `album` and `app` namespaces are supported.
 */
class I18nStub extends Service {
  static override readonly name = 'i18n'
  readonly locale = 'en'
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    const ns = sep < 0 ? '' : key.slice(0, sep)
    const rest = sep < 0 ? key : key.slice(sep + 1)
    let cur: unknown
    if (ns === 'album') {
      cur = (albumCatalogue as { en: unknown }).en
    } else if (ns === 'app') {
      cur = appCatalogue
    } else {
      return key
    }
    for (const part of rest.split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
  }
  onLocaleChange = (): (() => void) => () => {}
}

const ALBUM_URN = 'BBeBee:remote:album:one'
const TRACK_A = 'BBeBee:remote:track:a'
const TRACK_B = 'BBeBee:remote:track:b'

const detail: AlbumDetail = {
  urn: ALBUM_URN,
  title: 'Homogenic',
  artists: [{ urn: 'BBeBee:remote:artist:bjork', name: 'Björk', role: 'main', ordinal: 0 }],
  tracks: [
    { urn: TRACK_A, title: 'Hunter', artists: [] },
    { urn: TRACK_B, title: 'Jóga', artists: [] },
  ],
}

/** A fake native host: a `div` that keeps the RN props it was given. */
function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, onPress, testID } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick:
          typeof onPress === 'function'
            ? (e: React.MouseEvent) => {
                e.stopPropagation()
                ;(onPress as () => void)()
              }
            : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  FlashList: function FlashList(props: {
    data?: readonly unknown[]
    renderItem?: (info: { item: unknown; index: number }) => ReactNode
    ListEmptyComponent?: ReactNode
    accessibilityLabel?: string
  }) {
    const items = props.data ?? []
    return h(
      'div',
      { 'data-host': 'FlashList', 'data-label': props.accessibilityLabel, role: 'list' },
      items.length === 0
        ? (props.ListEmptyComponent as ReactNode)
        : items.map((item, index) =>
            h('div', { key: index, role: 'listitem' }, props.renderItem?.({ item, index })),
          ),
    )
  },
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

class SourcesStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sources')
  }
  async getAlbum(urn: string): Promise<AlbumDetail | undefined> {
    return urn === ALBUM_URN ? detail : undefined
  }
}

class PlayerStub extends Service {
  readonly calls: { method: string; urn?: string; urns?: readonly string[]; context?: unknown }[] = []
  constructor(ctx: Context) {
    super(ctx, 'player')
  }
  async playNow(urns: string[]): Promise<void> {
    this.calls.push({ method: 'playNow', urns })
  }
  async playFromContext(
    urn: string,
    urns?: readonly string[],
    opts?: { context?: unknown },
  ): Promise<void> {
    this.calls.push({ method: 'playFromContext', urn, urns, context: opts?.context })
  }
}

class DownloadsStub extends Service {
  readonly queued: (string | Track)[][] = []
  constructor(ctx: Context) {
    super(ctx, 'downloads')
  }
  async enqueue(urns: (string | Track)[]): Promise<DownloadTask[]> {
    this.queued.push(urns)
    return []
  }
}

class UiStub extends Service {
  readonly navigated: string[] = []
  constructor(ctx: Context) {
    super(ctx, 'ui')
  }
  navigate(id: string): void {
    this.navigated.push(id)
  }
}

async function harness() {
  const root = new Context()
  await root.plugin(SourcesStub)
  await root.plugin(PlayerStub)
  await root.plugin(DownloadsStub)
  await root.plugin(UiStub)
  await root.plugin(I18nStub)
  let scoped: Context | undefined
  root.inject(['ui', 'sources', 'player', 'downloads'], (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('no scoped context')
  return {
    ctx: scoped,
    player: root.player as unknown as PlayerStub,
    downloads: root.downloads as unknown as DownloadsStub,
    ui: root.ui as unknown as UiStub,
  }
}

describe('AlbumScreen on mobile', () => {
  it('draws the album and plays it from the top', async () => {
    const { ctx, player } = await harness()
    const { container } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('Homogenic')
    await act(async () => {
      ;(container.querySelector('[data-testid="album-play-all"]') as HTMLElement).click()
      await tick()
    })

    expect(player.calls).toEqual([{ method: 'playNow', urns: [TRACK_A, TRACK_B] }])
  })

  it('plays a tapped row with the whole album as its context', async () => {
    const { ctx, player } = await harness()
    const { getByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
    await act(async () => {
      await tick()
    })
    await act(async () => {
      getByText('Jóga').click()
      await tick()
    })

    expect(player.calls).toEqual([
      {
        method: 'playFromContext',
        urn: TRACK_B,
        urns: [TRACK_A, TRACK_B],
        context: { kind: 'album', urn: ALBUM_URN, label: 'Homogenic' },
      },
    ])
  })

  it('queues download all from the menu', async () => {
    const { ctx, downloads } = await harness()
    const { container } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
    await act(async () => {
      await tick()
    })
    await act(async () => {
      ctx.emit('library/open-header-menu')
      await tick()
    })
    await act(async () => {
      ;(container.querySelector('[data-testid="download-all"]') as HTMLElement).click()
      await tick()
    })

    expect(downloads.queued).toEqual([[detail.tracks[0], detail.tracks[1]]])
  })

  it('offers a way back when the album cannot be shown', async () => {
    const { ctx, ui } = await harness()
    const { getByText } = render(h(AlbumScreen, { ctx, urn: 'BBeBee:local:album:missing' }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      getByText('Back to library').click()
      await tick()
    })

    // No `onBack` from this harness, so the screen falls back to the library
    // by its own route id rather than rendering a dead end.
    expect(ui.navigated).toEqual([LIBRARY_VIEWS.home])
  })

  it('opens header menu on library/open-header-menu event', async () => {
    const { ctx } = await harness()
    const { container, getByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      ctx.emit('library/open-header-menu')
      await tick()
    })

    // ContextMenu should now display header menu options
    expect(container.textContent).toContain('Batch operations')
    expect(container.textContent).toContain('View mode')
    expect(container.textContent).toContain('Sort by')

    // Click into View mode submenu
    await act(async () => {
      getByText('View mode').click()
      await tick()
    })
    expect(container.textContent).toContain('List')
    expect(container.textContent).toContain('Compact')
  })

  it('supports batch mode selection and batch play', async () => {
    const { ctx, player } = await harness()
    const { container, getByText } = render(h(AlbumScreen, { ctx, urn: ALBUM_URN }))
    await act(async () => {
      await tick()
    })

    // Open header menu and enter batch mode
    await act(async () => {
      ctx.emit('library/open-header-menu')
      await tick()
    })
    await act(async () => {
      getByText('Batch operations').click()
      await tick()
    })

    // Select all button should be in the batch bar
    expect(container.textContent).toContain('Select all')
    await act(async () => {
      getByText('Select all').click()
      await tick()
    })

    expect(container.textContent).toContain('Selected 2 / 2 songs')

    // Batch play button
    await act(async () => {
      getByText('Play').click()
      await tick()
    })

    expect(player.calls).toEqual([{ method: 'playNow', urns: [TRACK_A, TRACK_B] }])
  })
})
