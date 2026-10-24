// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest'
import { createElement as h } from 'react'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { Context, Service } from 'cordis'
import pluginShareUi from './index.js'
import shareCatalogue from '../../../feature/plugin-i18n/src/locales/share.json'
import { ShareCardPreview } from './components/ShareCardPreview.js'
import { ShareTrackModal } from './components/ShareTrackModal.js'
import { SharePlaylistModal } from './components/SharePlaylistModal.js'
import { ShareAlbumModal } from './components/ShareAlbumModal.js'
import { ShareLyricsModal } from './components/ShareLyricsModal.js'
import { ImportShareModal } from './components/ImportShareModal.js'

class UiStub extends Service {
  public views = new Map<string, any>()
  public contributions: any[] = []

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: any) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }

  contribute(contribution: any) {
    this.contributions.push(contribution)
    return () => {}
  }

  viewFor(id: string) {
    return this.views.get(id)
  }
}

class ShareStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'share')
  }
}

class PlayerStub extends Service {
  public playedNowUrns: string[][] = []
  public enqueuedUrns: string[][] = []

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  async playNow(urns: string[]) {
    this.playedNowUrns.push(urns)
  }

  enqueueLast(urns: string[]) {
    this.enqueuedUrns.push(urns)
  }
}

/**
 * English-only i18n stub — the same shape as `DefaultI18nStub` in
 * `apps/desktop/renderer/Shell.test.tsx`, but serving the `share` catalogue so
 * components under test render the copy the app shows.
 */
class EnglishI18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0) return key
    let cur: unknown = (shareCatalogue as { en: Record<string, unknown> }).en
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
  }
  onLocaleChange = (_cb: (locale: string) => void): (() => void) => () => {}
}

/** A context with the English i18n stub installed — views render real copy. */
async function testCtx(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(EnglishI18nStub)
  return ctx
}

describe('plugin-share-ui-desktop', () => {
  afterEach(() => {
    cleanup()
  })

  it('registers share.host view in ctx.ui', async () => {
    const ctx = new Context()
    ctx.plugin(UiStub)
    ctx.plugin(ShareStub)
    await ctx.plugin(pluginShareUi)

    expect(ctx.ui.viewFor('share.host')).toBeDefined()
  })

  it('renders ShareCardPreview for track and lyrics', () => {
    const { container: trackContainer } = render(
      h(ShareCardPreview, {
        title: 'Orange Sky',
        subtitle: 'Demo Artist',
        themeColor: '#FF6B00',
        backgroundMode: 'gradient',
      }),
    )
    expect(trackContainer.textContent).toContain('Orange Sky')
    expect(trackContainer.textContent).toContain('Demo Artist')

    const { container: lyricsContainer } = render(
      h(ShareCardPreview, {
        title: 'Demo Song',
        subtitle: 'Demo Artist',
        themeColor: '#79486D',
        backgroundMode: 'cover',
        lyrics: ['Every setback finds its own reward', 'What was given truly always pays off'],
      }),
    )
    expect(lyricsContainer.textContent).toContain('Demo Song')
    expect(lyricsContainer.textContent).toContain('Every setback finds its own reward')
  })

  it('renders ShareTrackModal with background modes and action buttons', async () => {
    const ctx = await testCtx()
    const { baseElement } = render(
      h(ShareTrackModal, {
        ctx,
        open: true,
        onClose: () => {},
        track: {
          urn: 'source:test:track:1',
          title: 'Best Is Yet To Come',
          artist: 'Sandro Cavazza',
        },
      }),
    )
    expect(baseElement.textContent).toContain('Share song')
    expect(baseElement.textContent).toContain('Background')
    expect(baseElement.textContent).toContain('Solid theme color')
    expect(baseElement.textContent).toContain('Copy Base64')
    expect(baseElement.textContent).toContain('Download image')
  })

  it('renders SharePlaylistModal with background modes and action buttons', async () => {
    const ctx = await testCtx()
    const { baseElement } = render(
      h(SharePlaylistModal, {
        ctx,
        open: true,
        onClose: () => {},
        playlist: {
          urn: 'source:test:playlist:1',
          name: 'My Favorites',
          trackCount: 20,
        },
      }),
    )
    expect(baseElement.textContent).toContain('Share playlist')
    expect(baseElement.textContent).toContain('My Favorites')
    expect(baseElement.textContent).toContain('Background')
    expect(baseElement.textContent).toContain('Solid theme color')
    expect(baseElement.textContent).toContain('Copy Base64')
    expect(baseElement.textContent).toContain('Download image')
  })

  it('renders ShareLyricsModal with lyric lines', async () => {
    const ctx = await testCtx()
    const { baseElement } = render(
      h(ShareLyricsModal, {
        ctx,
        open: true,
        onClose: () => {},
        lyrics: {
          trackUrn: 'source:test:track:1',
          title: 'Demo Song',
          artist: 'Demo Artist',
          lines: ['Every setback finds its own reward', 'What was given truly always pays off'],
        },
      }),
    )
    expect(baseElement.textContent).toContain('Share lyrics')
    expect(baseElement.textContent).toContain('Every setback finds its own reward')
    expect(baseElement.textContent).toContain('Copy lyrics')
    expect(baseElement.textContent).toContain('Download image')
  })

  it('renders ImportShareModal with dropzone and base64 input', async () => {
    const ctx = await testCtx()
    const { baseElement } = render(
      h(ImportShareModal, {
        ctx,
        open: true,
        onClose: () => {},
      }),
    )
    expect(baseElement.textContent).toContain('Read / import share')
    expect(baseElement.textContent).toContain('Drop a share image here')
    expect(baseElement.textContent).toContain('Or paste Base64 data directly:')
  })

  it('handles play now and enqueue in ImportShareModal', async () => {
    const ctx = await testCtx()
    ctx.plugin(PlayerStub)
    const { serviceOf } = await import('@BBeBee/ui-core')
    const player = serviceOf<PlayerStub>(ctx, 'player')!

    const { encodeMetadata } = await import('@bbebee/plugin-share/metadata')
    const b64 = encodeMetadata('track', {
      urn: 'source:test:track:shared_99',
      title: 'Shared Song',
      artist: 'Shared Artist',
    })

    let closed = false
    const { getByPlaceholderText, getByText } = render(
      h(ImportShareModal, {
        ctx,
        open: true,
        onClose: () => {
          closed = true
        },
      }),
    )

    const input = getByPlaceholderText('Paste Base64 share data…')
    fireEvent.change(input, { target: { value: b64 } })

    expect(getByText('Shared Song')).toBeDefined()

    const playNowBtn = getByText('Play now')
    fireEvent.click(playNowBtn)
    await Promise.resolve()

    expect(player.playedNowUrns).toEqual([['source:test:track:shared_99']])
    expect(closed).toBe(true)
  })

  it('renders ShareAlbumModal with album details and actions', async () => {
    const ctx = await testCtx()
    const { baseElement } = render(
      h(ShareAlbumModal, {
        ctx,
        open: true,
        onClose: () => {},
        album: {
          urn: 'source:test:album:1',
          title: 'Fantasy',
          artist: 'Jay Chou',
          trackCount: 10,
        },
      }),
    )
    expect(baseElement.textContent).toContain('Share album')
    expect(baseElement.textContent).toContain('Fantasy')
    expect(baseElement.textContent).toContain('Jay Chou')
    expect(baseElement.textContent).toContain('Solid theme color')
    expect(baseElement.textContent).toContain('Copy Base64')
    expect(baseElement.textContent).toContain('Download image')
  })

  it('shows disabled explanation toast when disabled copy button is clicked in ShareLyricsModal', async () => {
    const ctx = await testCtx()
    const { getByTestId, queryByTestId, getAllByRole } = render(
      h(ShareLyricsModal, {
        ctx,
        open: true,
        onClose: () => {},
        lyrics: {
          trackUrn: 'source:test:track:1',
          title: 'Demo Song',
          artist: 'Demo Artist',
          lines: ['First demo lyric line', 'Second demo lyric line'],
        },
      }),
    )

    // Initially 2 lines are selected. Unselect them to make copy disabled.
    const lyricRowButtons = getAllByRole('button').filter(
      (el) => el.textContent?.includes('First demo lyric line') || el.textContent?.includes('Second demo lyric line'),
    )
    expect(lyricRowButtons.length).toBe(2)
    fireEvent.click(lyricRowButtons[0]!)
    fireEvent.click(lyricRowButtons[1]!)

    // Now disabled button should appear
    const disabledBtn = getByTestId('copy-lyrics-disabled-btn')
    expect(disabledBtn).toBeDefined()

    // No toast before click
    expect(queryByTestId('copy-disabled-reason-toast')).toBeNull()

    // Click disabled button -> toast appears
    fireEvent.click(disabledBtn)
    const toast = getByTestId('copy-disabled-reason-toast')
    expect(toast).toBeDefined()
    expect(toast.textContent).toContain("Can't copy lyrics: select at least one lyric line")
  })

  it('shows disabled explanation toast when metadata is invalid in ShareAlbumModal', async () => {
    const ctx = await testCtx()
    const { getByTestId, queryByTestId } = render(
      h(ShareAlbumModal, {
        ctx,
        open: true,
        onClose: () => {},
        album: {
          urn: 'source:test:album:empty',
          title: '', // Invalid empty title
          trackCount: 0,
        },
      }),
    )

    const disabledBtn = getByTestId('copy-base64-disabled-btn')
    expect(disabledBtn).toBeDefined()
    expect(queryByTestId('copy-disabled-reason-toast')).toBeNull()

    fireEvent.click(disabledBtn)
    const toast = getByTestId('copy-disabled-reason-toast')
    expect(toast).toBeDefined()
    expect(toast.textContent).toContain("Can't copy: the album is missing a valid title or other metadata")
  })

  it('displays warning banner and disables copy/download for local track', async () => {
    const ctx = await testCtx()
    const { getByTestId } = render(
      h(ShareTrackModal, {
        ctx,
        open: true,
        onClose: () => {},
        track: {
          urn: 'BBeBee:local:track:local_song_1',
          source: 'local',
          title: 'Local Music Track',
          artist: 'Local Artist',
        },
      }),
    )

    // Warning banner should be visible
    const warning = getByTestId('local-source-warning')
    expect(warning).toBeDefined()
    expect(warning.textContent).toContain("Can't share local music")

    // Copy and download buttons should be disabled
    const copyBtn = getByTestId('copy-base64-disabled-btn')
    const downloadBtn = getByTestId('download-disabled-btn')
    expect(copyBtn).toBeDefined()
    expect(downloadBtn).toBeDefined()

    // Clicking disabled copy button shows the local-music warning
    fireEvent.click(copyBtn)
    let toast = getByTestId('copy-disabled-reason-toast')
    expect(toast.textContent).toContain("Can't share local music")

    // Clicking disabled download button shows the local-music warning
    fireEvent.click(downloadBtn)
    toast = getByTestId('copy-disabled-reason-toast')
    expect(toast.textContent).toContain("Can't share local music")
  })

  it('displays warning banner and disables copy/download for local playlist and album', async () => {
    const ctx = await testCtx()
    const { getByTestId: getPlaylistTestId } = render(
      h(SharePlaylistModal, {
        ctx,
        open: true,
        onClose: () => {},
        playlist: {
          urn: 'local:playlist:1',
          name: 'Local Playlist',
          trackCount: 15,
        },
      }),
    )
    expect(getPlaylistTestId('local-source-warning').textContent).toContain("Can't share local music")
    expect(getPlaylistTestId('copy-base64-disabled-btn')).toBeDefined()
    expect(getPlaylistTestId('download-disabled-btn')).toBeDefined()

    cleanup()

    const { getByTestId: getAlbumTestId } = render(
      h(ShareAlbumModal, {
        ctx,
        open: true,
        onClose: () => {},
        album: {
          urn: 'local:album:1',
          title: 'Local Album',
          trackCount: 8,
        },
      }),
    )
    expect(getAlbumTestId('local-source-warning').textContent).toContain("Can't share local music")
    expect(getAlbumTestId('copy-base64-disabled-btn')).toBeDefined()
    expect(getAlbumTestId('download-disabled-btn')).toBeDefined()
  })

  it('correctly identifies local music via isLocalSource utility', async () => {
    const { isLocalSource } = await import('./utils/sourceHelper.js')
    expect(isLocalSource({ source: 'local' })).toBe(true)
    expect(isLocalSource({ source: 'netease' })).toBe(false)
    expect(isLocalSource({ urn: 'local:track:123' })).toBe(true)
    expect(isLocalSource({ urn: 'source:local:track:123' })).toBe(true)
    expect(isLocalSource({ urn: 'file:///path/song.mp3' })).toBe(true)
    expect(isLocalSource({ urn: 'bbebee-file://local/song.mp3' })).toBe(true)
    expect(isLocalSource({ urn: 'BBeBee:local:track:local_123' })).toBe(true)
    expect(isLocalSource({ urn: 'BBeBee:netease:track:182910' })).toBe(false)
    expect(isLocalSource(null)).toBe(false)
    expect(isLocalSource(undefined)).toBe(false)
  })

  it('handles clipboard writing and fallback in copyToClipboard utility', async () => {
    const { copyToClipboard } = await import('./utils/clipboard.js')

    // Scenario 1: navigator.clipboard succeeds
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })
    const res1 = await copyToClipboard('test payload')
    expect(res1).toBe(true)
    expect(writeTextMock).toHaveBeenCalledWith('test payload')

    // Scenario 2: navigator.clipboard fails, falls back to execCommand
    const writeTextFailMock = vi.fn().mockRejectedValue(new Error('Permission denied'))
    const execCommandMock = vi.fn().mockReturnValue(true)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextFailMock,
      },
    })
    document.execCommand = execCommandMock

    const res2 = await copyToClipboard('fallback payload')
    expect(res2).toBe(true)
    expect(execCommandMock).toHaveBeenCalledWith('copy')
  })

  it('extracts HTTP artwork URLs and prioritizes them in ImportShareModal', async () => {
    const { extractHttpArtworkUrl } = await import('./hooks/useShareModalState.js')

    // Test extraction utility
    expect(extractHttpArtworkUrl('https://example.com/cover.jpg')).toBe('https://example.com/cover.jpg')
    expect(extractHttpArtworkUrl('http://example.com/cover.png')).toBe('http://example.com/cover.png')
    expect(extractHttpArtworkUrl('file:///local/cover.jpg')).toBeUndefined()
    expect(extractHttpArtworkUrl({ sourceUrl: 'https://example.com/source.jpg' })).toBe('https://example.com/source.jpg')

    // Test ImportShareModal using HTTP cover
    const { encodeMetadata } = await import('@bbebee/plugin-share/metadata')
    const b64WithHttpCover = encodeMetadata('track', {
      urn: 'source:test:track:http_cover',
      title: 'HTTP Cover Song',
      artist: 'Online Artist',
      artwork: 'https://cdn.example.com/online_cover.jpg',
    })

    const ctx = await testCtx()
    const { getByPlaceholderText, getByAltText } = render(
      h(ImportShareModal, {
        ctx,
        open: true,
        onClose: () => {},
      }),
    )

    const input = getByPlaceholderText('Paste Base64 share data…')
    fireEvent.change(input, { target: { value: b64WithHttpCover } })

    const img = getByAltText('artwork') as HTMLImageElement
    expect(img).toBeDefined()
    expect(img.src).toBe('https://cdn.example.com/online_cover.jpg')
  })

  it('shows success toast and emits ui/toast when copying base64 in ShareTrackModal and ShareAlbumModal', async () => {
    const ctx = await testCtx()
    const toasts: { message: string; tone?: string }[] = []
    ctx.on('ui/toast', (t) => void toasts.push(t))

    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    const { getByRole, getByTestId, queryByTestId } = render(
      h(ShareTrackModal, {
        ctx,
        open: true,
        onClose: () => {},
        track: {
          urn: 'source:test:track:1',
          title: '晴天',
          artist: '周杰伦',
        },
      }),
    )

    expect(queryByTestId('share-success-toast')).toBeNull()

    const copyBtn = getByRole('button', { name: 'Copy Base64' })
    fireEvent.click(copyBtn)
    await vi.waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled()
      expect(toasts.length).toBe(1)
    })

    expect(toasts[0]?.message).toContain('Copied successfully, you can import string in Import Share')
    expect(toasts[0]?.tone).toBe('ok')

    const successToast = getByTestId('share-success-toast')
    expect(successToast).toBeDefined()
    expect(successToast.textContent).toContain('Copied successfully, you can import string in Import Share')

    cleanup()

    // Test ShareAlbumModal as well
    const { getByRole: getAlbumRole, getByTestId: getAlbumTestId } = render(
      h(ShareAlbumModal, {
        ctx,
        open: true,
        onClose: () => {},
        album: {
          urn: 'source:test:album:1',
          title: '范特西',
          artist: '周杰伦',
          trackCount: 10,
        },
      }),
    )

    const albumCopyBtn = getAlbumRole('button', { name: 'Copy Base64' })
    fireEvent.click(albumCopyBtn)
    await vi.waitFor(() => {
      expect(toasts.length).toBe(2)
    })

    expect(toasts[1]?.message).toContain('Copied successfully, you can import string in Import Share')
    const albumSuccessToast = getAlbumTestId('share-success-toast')
    expect(albumSuccessToast.textContent).toContain('Copied successfully, you can import string in Import Share')
  })

  it('shows success toast and emits ui/toast when downloading image in ShareTrackModal and ShareAlbumModal', async () => {
    const ctx = await testCtx()
    const toasts: { message: string; tone?: string }[] = []
    ctx.on('ui/toast', (t) => void toasts.push(t))

    const canvasRenderer = await import('./utils/canvasRenderer.js')
    vi.spyOn(canvasRenderer, 'generateTrackCardCanvas').mockResolvedValue(document.createElement('canvas'))
    vi.spyOn(canvasRenderer, 'generateAlbumCardCanvas').mockResolvedValue(document.createElement('canvas'))
    vi.spyOn(canvasRenderer, 'downloadCanvasAsPng').mockImplementation(() => {})

    const { getByRole, getByTestId } = render(
      h(ShareTrackModal, {
        ctx,
        open: true,
        onClose: () => {},
        track: {
          urn: 'source:test:track:1',
          title: '晴天',
          artist: '周杰伦',
        },
      }),
    )

    const downloadBtn = getByRole('button', { name: 'Download image' })
    fireEvent.click(downloadBtn)
    await vi.waitFor(() => {
      expect(toasts.length).toBe(1)
    })

    expect(toasts[0]?.message).toContain('Downloaded successfully, you can import image in Import Share')
    expect(toasts[0]?.tone).toBe('ok')
    expect(getByTestId('share-success-toast').textContent).toContain('Downloaded successfully, you can import image in Import Share')

    cleanup()

    // Test ShareAlbumModal as well
    const { getByRole: getAlbumRole, getByTestId: getAlbumTestId } = render(
      h(ShareAlbumModal, {
        ctx,
        open: true,
        onClose: () => {},
        album: {
          urn: 'source:test:album:1',
          title: '范特西',
          artist: '周杰伦',
          trackCount: 10,
        },
      }),
    )

    const albumDownloadBtn = getAlbumRole('button', { name: 'Download image' })
    fireEvent.click(albumDownloadBtn)
    await vi.waitFor(() => {
      expect(toasts.length).toBe(2)
    })

    expect(toasts[1]?.message).toContain('Downloaded successfully, you can import image in Import Share')
    expect(getAlbumTestId('share-success-toast').textContent).toContain('Downloaded successfully, you can import image in Import Share')
  })

  it('verifies exact Chinese locale strings for copy and download success toast', () => {
    const zh = (shareCatalogue as { zh: { shareActionButtons: Record<string, string> } }).zh
    expect(zh.shareActionButtons.copySuccessToast).toBe('复制成功，可在导入分享中导入 字符串')
    expect(zh.shareActionButtons.downloadSuccessToast).toBe('下载成功，可在导入分享中导入 图片')
  })
})


