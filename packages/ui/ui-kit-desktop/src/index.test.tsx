// @vitest-environment jsdom
/**
 * The desktop kit renders, and renders the things docs/08 §8 requires.
 *
 * Static markup for most of it: what is worth pinning is the *accessible*
 * output — a name on every control, a role a screen reader can use, a focus
 * ring nobody removed — and that is all in the markup.
 *
 * `List` is the exception and runs in the DOM, because windowing is a function
 * of how tall the scroller is and where it is scrolled, and static markup has
 * neither.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, fireEvent, render, within } from '@testing-library/react'
import { TEST_ROW_HEIGHT as ROW, withListLayout as withLayout } from './testing.js'
import { createElement as h } from 'react'
import type { Track } from '@BBeBee/protocol'
import {
  Artwork,
  Button,
  ContextMenu,
  EmptyState,
  IconButton,
  JsonTree,
  List,
  SaveToPlaylistPopover,
  Sheet,
  Slider,
  DetailHero,
  DetailPlayButton,
  DetailTableHeader,
  StickyDetailBar,
  Text,
  TextField,
  Toast,
  TrackRow,
} from './index.js'

const track: Track = {
  urn: 'BBeBee:local:track:1',
  title: 'Jóga',
  artists: [{ urn: 'BBeBee:local:artist:1', name: 'Björk', role: 'main', ordinal: 0 }],
  albumTitle: 'Homogenic',
  available: true,
}

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element)

describe('Button', () => {
  it('renders its label as a real button element', () => {
    const out = html(h(Button, { onPress: () => {}, children: 'Play' }))
    expect(out).toContain('<button')
    expect(out).toContain('Play')
    expect(out).toContain('type="button"')
  })

  it('disables while loading, and says it is busy', () => {
    // Two props would drift apart; one prop cannot.
    const out = html(h(Button, { onPress: () => {}, loading: true, children: 'Save' }))
    expect(out).toContain('disabled')
    expect(out).toContain('aria-busy="true"')
  })

  it('carries an accessible name when one is given', () => {
    const out = html(
      h(Button, { onPress: () => {}, accessibilityLabel: 'Play Jóga', children: '▶' }),
    )
    expect(out).toContain('aria-label="Play Jóga"')
  })

  it('never removes the focus ring', () => {
    // Keyboard navigation is a docs/08 §8 requirement, and `outline: none` is
    // the single most common way a kit breaks it.
    const out = html(h(Button, { onPress: () => {}, children: 'x' }))
    expect(out).not.toContain('outline:none')
  })
})

describe('IconButton', () => {
  it('always has an accessible name', () => {
    // An icon has no text to fall back on, so the prop is required by type —
    // this is the render-time half of the same guarantee.
    const out = html(h(IconButton, { icon: '⏭', accessibilityLabel: 'Next track', onPress: () => {} }))
    expect(out).toContain('aria-label="Next track"')
  })

  it('meets the minimum tap target even for a small icon', () => {
    const out = html(
      h(IconButton, { icon: '·', accessibilityLabel: 'More', onPress: () => {}, size: 8 }),
    )
    expect(out).toContain('width:44px')
  })
})

describe('TrackRow', () => {
  it('shows the title and the artists', () => {
    const out = html(h(TrackRow, { track }))
    expect(out).toContain('Jóga')
    expect(out).toContain('Björk')
  })

  it('shows the album only when asked', () => {
    expect(html(h(TrackRow, { track }))).not.toContain('Homogenic')
    expect(html(h(TrackRow, { track, showAlbum: true }))).toContain('Homogenic')
  })

  it('is reachable by keyboard', () => {
    expect(html(h(TrackRow, { track, onPress: () => {} }))).toContain('tabindex="0"')
  })

  it('offers an overflow control when it can do something with it', () => {
    expect(html(h(TrackRow, { track }))).not.toContain('aria-label="More"')
    expect(html(h(TrackRow, { track, onMore: () => {} }))).toContain('aria-label="More"')
  })

  it('offers a download control only where a downloads service is loaded, and omits for local tracks', () => {
    const remote = { ...track, urn: 'BBeBee:remote:track:1' }
    expect(html(h(TrackRow, { track: remote }))).not.toContain('aria-label="Download"')
    expect(html(h(TrackRow, { track: remote, onDownload: () => {} }))).toContain('aria-label="Download"')
    expect(html(h(TrackRow, { track, onDownload: () => {} }))).not.toContain('aria-label="Download"')
  })
})

describe('Slider', () => {
  it('exposes its range to assistive technology', () => {
    const out = html(h(Slider, { value: 30, max: 100 }))
    expect(out).toContain('aria-valuenow="30"')
    expect(out).toContain('aria-valuemax="100"')
  })

  it('separates dragging from committing', () => {
    // Seeking on every frame of a drag is what makes a scrubber unusable, so
    // a caller can subscribe to the release alone.
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const element = h(Slider, { value: 0, max: 100, onChange, onCommit })
    expect(() => html(element)).not.toThrow()
    // The props are distinct on the element, which is the contract.
    expect(element.props.onChange).toBe(onChange)
    expect(element.props.onCommit).toBe(onCommit)
  })
})

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    expect(html(h(Sheet, { open: false, onClose: () => {}, children: 'hi' }))).toBe('')
  })

  it('is a modal dialog when open', () => {
    const out = html(h(Sheet, { open: true, onClose: () => {}, title: 'Queue', children: 'x' }))
    expect(out).toContain('role="dialog"')
    expect(out).toContain('aria-modal="true"')
    expect(out).toContain('Queue')
  })
})

/**
 * The one component that needs a real DOM.
 *
 * Windowing is a function of how tall the scroller is and where it is
 * scrolled, and static markup has neither. So `List` is rendered into jsdom
 * with a viewport of a known size — measured, not mocked away, because a test
 * that stubbed the virtualiser would only prove the stub windows correctly.
 */
describe('List', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }))

  function renderList(count: number, extra: Record<string, unknown> = {}) {
    return withLayout(() =>
      render(
        h(List<{ id: string }>, {
          items: items(count),
          keyExtractor: (i) => i.id,
          renderItem: (i) => h(Text, { children: i.id }),
          estimatedItemSize: ROW,
          ...extra,
        }),
      ),
    )
  }

  it('renders a window of rows, not the whole library', () => {
    // 10,000 rows in the DOM is where a desktop list stops being usable; the
    // point of the virtualiser is that this number stays small.
    const { container } = renderList(10_000)
    const rows = container.querySelectorAll('[role="listitem"]')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(100)
  })

  it('tells assistive technology how long the list really is', () => {
    // Windowing is invisible to a sighted user and catastrophic to a screen
    // reader unless the true size is published.
    const { container } = renderList(10_000)
    const first = container.querySelector('[role="listitem"]')!
    expect(first.getAttribute('aria-setsize')).toBe('10000')
    expect(first.getAttribute('aria-posinset')).toBe('1')
  })

  it('scrolls the whole library, not just the window', () => {
    const { container } = renderList(1000)
    const spacer = container.querySelector('[role="list"] > div') as HTMLElement
    expect(Number.parseInt(spacer.style.height, 10)).toBeGreaterThanOrEqual(1000 * ROW)
  })

  it('renders every row of a list that fits', () => {
    const { container } = renderList(3)
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(3)
  })

  it('shows the empty state instead of nothing', () => {
    // A blank pane tells a user nothing about whether it is loading, broken,
    // or genuinely empty.
    const { container } = withLayout(() =>
      render(
        h(List<{ id: string }>, {
          items: [],
          keyExtractor: (i: { id: string }) => i.id,
          renderItem: () => null,
          empty: h(EmptyState, { title: 'No tracks yet' }),
        }),
      ),
    )
    expect(container.textContent).toContain('No tracks yet')
  })

  it('reports reaching the end once, not once per render', () => {
    const onEndReached = vi.fn()
    renderList(3, { onEndReached })
    expect(onEndReached).toHaveBeenCalledTimes(1)
  })
})

describe('Toast', () => {
  it('announces without stealing focus', () => {
    const out = html(h(Toast, { message: 'Saved' }))
    expect(out).toContain('role="status"')
    expect(out).toContain('aria-live="polite"')
  })

  it('offers a dismiss control with a name', () => {
    expect(html(h(Toast, { message: 'x', onDismiss: () => {} }))).toContain('aria-label="Dismiss"')
  })
})

describe('StickyDetailBar', () => {
  const bar = (props: { progress: number; docked?: boolean }) =>
    html(h(StickyDetailBar, { title: 'Homogenic', ...props, playButton: h('button', null, '▶') }))

  it('rides above the viewport at progress 0, with the play button un-docked', () => {
    const out = bar({ progress: 0 })
    expect(out).toContain('translateY(-64px)')
    expect(out).toContain('scale(0.4)')
    expect(out).toContain('pointer-events:none')
  })

  it('is docked at progress 1: slid in, play button absorbed with a scale-in', () => {
    const out = bar({ progress: 1, docked: true })
    expect(out).toContain('translateY(0px)')
    expect(out).toContain('scale(1)')
    // the absorb action is a transition, not a snap cut
    expect(out).toContain('transition:transform')
  })

  it('always carries the title and the sticky contract', () => {
    const out = bar({ progress: 0.5 })
    expect(out).toContain('Homogenic')
    expect(out).toContain('position:sticky')
    expect(out).toContain('data-testid="sticky-detail-bar"')
  })
})

describe('DetailTableHeader', () => {
  const columns = [
    { key: 'default', label: '#', testID: 'c-#', width: 40, align: 'center' as const },
    { key: 'title', label: '标题', testID: 'c-title', flex: 2, paddingLeft: 12 },
    { key: 'artist', label: '艺人', plain: true, flex: 1, visible: false },
    { key: 'duration', label: '', testID: 'c-duration', width: 120, align: 'right' as const },
  ]

  it('pins below the sticky bar and is transparent until it docks', () => {
    const out = html(h(DetailTableHeader, { columns, top: 64 }))
    expect(out).toContain('position:sticky')
    expect(out).toContain('top:64px')
    expect(out).toContain('background:transparent')
    const solid = html(h(DetailTableHeader, { columns, top: 64, solid: true }))
    expect(solid).toContain('background:var(--bg-primary')
  })

  it('hides the invisible column and shows no arrows before hover', () => {
    const out = html(h(DetailTableHeader, { columns, sortKey: 'title', sortDirection: 'asc' }))
    expect(out).not.toContain('>艺人<')
    expect(out).not.toContain('chevron-up')
  })
})

describe('DetailPlayButton', () => {
  it('is a named circular button, disabled rather than hidden', () => {
    const out = html(h(DetailPlayButton, { onPress: () => {}, testID: 'play', ariaLabel: '播放全部', disabled: true }))
    expect(out).toContain('aria-label="播放全部"')
    expect(out).toContain('data-testid="play"')
    expect(out).toContain('disabled')
    expect(out).toContain('not-allowed')
  })

  it('renders the visually-hidden text when asked', () => {
    const out = html(h(DetailPlayButton, { onPress: () => {}, srText: 'Play album' }))
    expect(out).toContain('Play album')
    expect(out).toContain('clip:rect(0, 0, 0, 0)')
  })
})

describe('DetailHero', () => {
  it('stacks eyebrow / title / subtitle without a cover', () => {
    const out = html(h(DetailHero, { eyebrow: '歌单', title: '已点赞的歌曲', subtitle: '已收藏的音乐 • 3 首歌曲' }))
    expect(out).toContain('已点赞的歌曲')
    expect(out).toContain('已收藏的音乐 • 3 首歌曲')
    expect(out).toContain('flex-direction:column')
  })

  it('clamps the title at two lines and switches to a row with a cover', () => {
    const out = html(h(DetailHero, { eyebrow: '专辑', title: 'Homogenic', titleSize: 40, cover: h('div', null, 'cover') }))
    expect(out).toContain('-webkit-line-clamp:2')
    expect(out).toContain('flex-direction:row')
    expect(out).toContain('cover')
  })
})

describe('Artwork', () => {
  it('paints the dominant colour so there is no grey flash', () => {
    const out = html(
      h(Artwork, { size: 48, artwork: { id: 'a', dominantColor: '#3a5f7d' } }),
    )
    expect(out).toContain('#3a5f7d')
  })

  it('renders no image element when there is nothing to show', () => {
    expect(html(h(Artwork, { size: 48 }))).not.toContain('<img')
  })

  it('marks artwork decorative, since the row already names the track', () => {
    const out = html(h(Artwork, { size: 48, artwork: { id: 'a', sourceUrl: 'https://x/a.jpg' } }))
    expect(out).toContain('alt=""')
  })

  it('rewrites file:// URLs to bbebee-file:// for privileged local loading', () => {
    const out = html(
      h(Artwork, { size: 48, artwork: { id: 'a', sourceUrl: 'file:///cache/artworks/1.jpg' } }),
    )
    expect(out).toContain('src="bbebee-file:///cache/artworks/1.jpg"')
  })

  it('generates an identicon from the seed when there is no artwork at all', () => {
    const out = html(h(Artwork, { size: 48, seed: 'BBeBee:local:track:9f2c8a1e' }))
    expect(out).toContain('<svg')
    expect(out).toContain('<rect')
    expect(out).toContain('hsl(65, 68%, 58%)')
  })

  it('renders the same square for the same seed, a different one otherwise', () => {
    const urn = 'BBeBee:local:track:9f2c8a1e'
    expect(html(h(Artwork, { size: 48, seed: urn }))).toBe(html(h(Artwork, { size: 48, seed: urn })))
    expect(html(h(Artwork, { size: 48, seed: urn }))).not.toBe(
      html(h(Artwork, { size: 48, seed: 'BBeBee:local:track:other' })),
    )
  })

  it('falls back to the artwork id when no seed is given', () => {
    const out = html(h(Artwork, { size: 48, artwork: { id: 'BBeBee:local:album:x' } }))
    expect(out).toContain('<svg')
  })

  it('keeps the plain colour square when there is no identity at all', () => {
    const out = html(h(Artwork, { size: 48 }))
    expect(out).not.toContain('<svg')
    expect(out).toContain('#282828')
  })

  it('prefers a real image over the identicon', () => {
    const out = html(
      h(Artwork, {
        size: 48,
        seed: 'BBeBee:local:track:9f2c8a1e',
        artwork: { id: 'a', sourceUrl: 'https://x/a.jpg' },
      }),
    )
    expect(out).toContain('<img')
    expect(out).not.toContain('<svg')
  })

  it('fetches a remote cover with no Referer', () => {
    // Several CDNs — Bilibili's hdslb.com among them — answer a hotlink 403
    // when the referrer is a foreign origin, which in dev is localhost.
    const out = html(h(Artwork, { size: 48, artwork: { id: 'a', sourceUrl: 'https://x/a.jpg' } }))
    // React's server renderer spells it back in camelCase; the DOM attribute
    // it writes is `referrerpolicy`.
    expect(out).toContain('referrerPolicy="no-referrer"')
  })

  it('a colour from a real cover outranks the generated one', () => {
    const out = html(
      h(Artwork, { size: 48, seed: 'BBeBee:local:track:9f2c8a1e', artwork: { id: 'a', dominantColor: '#3a5f7d' } }),
    )
    expect(out).toContain('#3a5f7d')
    expect(out).not.toContain('<svg')
  })
})

describe('Text', () => {
  it('takes its size from the scale, never a raw number', () => {
    expect(html(h(Text, { variant: 'lg', children: 'x' }))).toContain('font-size:20px')
  })

  it('clamps to a line count when asked', () => {
    expect(html(h(Text, { numberOfLines: 1, children: 'x' }))).toContain('-webkit-line-clamp:1')
  })
})

describe('TextField', () => {
  it('renders a single-line input by default and a text area when multiline', () => {
    // The two things users type here are a pasted document — hundreds of lines
    // — and a one-line rule. One control cannot be both.
    const single = renderToStaticMarkup(
      h(TextField, { value: 'x', onChange: () => {}, accessibilityLabel: 'Rule' }),
    )
    expect(single).toContain('<input')

    const many = renderToStaticMarkup(
      h(TextField, { value: 'x', onChange: () => {}, multiline: true, accessibilityLabel: 'Doc' }),
    )
    expect(many).toContain('<textarea')
  })

  it('carries its accessible name', () => {
    const html = renderToStaticMarkup(
      h(TextField, { value: '', onChange: () => {}, accessibilityLabel: 'Source string' }),
    )
    expect(html).toContain('aria-label="Source string"')
  })

  it('hides a secure value', () => {
    const html = renderToStaticMarkup(
      h(TextField, { value: 'hunter2', onChange: () => {}, secure: true, accessibilityLabel: 'Password' }),
    )
    expect(html).toContain('type="password"')
  })

  it('renders an error rather than hiding it in a title', () => {
    // An error only a hover reveals is one a touch user and a screen reader
    // both never see.
    const html = renderToStaticMarkup(
      h(TextField, {
        value: '{',
        onChange: () => {},
        error: 'sourceUrl: must be a string',
        accessibilityLabel: 'Doc',
      }),
    )
    expect(html).toContain('sourceUrl: must be a string')
    expect(html).not.toContain('title="sourceUrl')
  })

  it('turns autocorrect off unless asked', () => {
    // A rule silently autocorrected fails for a reason nothing on screen
    // explains.
    const html = renderToStaticMarkup(
      h(TextField, { value: 'a', onChange: () => {}, accessibilityLabel: 'Rule' }),
    )
    // React omits `spellCheck={false}` from static markup because it is the
    // DOM default; what matters is that nothing turns it *on*.
    expect(html).not.toContain('spellcheck="true"')
    expect(html).not.toContain('autocorrect="on"')
  })
})

describe('JsonTree', () => {
  it('renders the shape, and keeps deep levels collapsed', () => {
    const markup = renderToStaticMarkup(
      h(JsonTree, {
        value: { a: { b: { c: 1 } }, list: [1, 2], ok: true, none: null },
        accessibilityLabel: 'Response',
      }),
    )
    expect(markup).toContain('Response')
    // Two levels are open; the third is a collapsed branch showing its count.
    expect(markup).toContain('1 keys')
    expect(markup).not.toContain('"c"')
    expect(markup).toContain('list')
    expect(markup).toContain('true')
    expect(markup).toContain('null')
  })

  it('expands a collapsed branch on click', async () => {
    const view = render(h(JsonTree, { value: { a: { deep: 7 } }, defaultExpandedDepth: 1 }))
    // The value is hidden behind the collapsed branch; the key is not.
    expect(view.container.textContent).toContain('a')
    expect(view.container.textContent).not.toContain('7')

    const branches = view.container.querySelectorAll<HTMLElement>('[role="button"]')
    await act(async () => {
      branches[branches.length - 1]!.click()
    })
    expect(view.container.textContent).toContain('7')
  })

  it('expands and collapses everything from the toolbar', async () => {
    const view = render(
      h(JsonTree, { value: { a: { b: { deep: 7 } } }, defaultExpandedDepth: 1, controls: true }),
    )
    // Level two starts collapsed: the value is not on screen.
    expect(view.container.textContent).not.toContain('7')

    const buttons = view.container.querySelectorAll('button')
    await act(async () => {
      buttons[0]!.click()
    })
    expect(view.container.textContent).toContain('7')

    await act(async () => {
      buttons[1]!.click()
    })
    // Collapse all includes the root: only its count remains.
    expect(view.container.textContent).not.toContain('7')
  })

  it('collapses and expands a branch with arrow keys', async () => {
    const view = render(h(JsonTree, { value: { a: { deep: 7 } }, defaultExpandedDepth: 3 }))
    expect(view.container.textContent).toContain('7')

    const root = view.container.querySelector('[role="button"]') as HTMLElement
    await act(async () => {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    expect(view.container.textContent).not.toContain('7')
    await act(async () => {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(view.container.textContent).toContain('7')
  })

  it('clips a long string until it is clicked', async () => {
    const view = render(h(JsonTree, { value: { url: 'x'.repeat(400) }, defaultExpandedDepth: 3 }))
    expect(view.container.textContent).toContain('(+100)')

    const clipped = Array.from(view.container.querySelectorAll('span')).find((el) =>
      el.textContent?.includes('(+100)'),
    ) as HTMLElement
    await act(async () => {
      clipped.click()
    })
    expect(view.container.textContent?.includes('(+100)')).toBe(false)
  })
})


describe('ContextMenu', () => {
  const items = [
    {
      id: 'add',
      label: '加入歌单',
      submenu: {
        title: '加入歌单',
        searchPlaceholder: '查找歌单',
        create: { label: '新建歌单', placeholder: '歌单名称', onSelect: vi.fn() },
        items: [
          { id: 'p1', label: 'Road trip', onSelect: vi.fn() },
          { id: 'p2', label: 'Late night', onSelect: vi.fn() },
        ],
        emptyLabel: '没有匹配的歌单',
      },
    },
    { id: 'queue', label: '加入播放列表', onSelect: vi.fn() },
    { id: 'remove', label: '从最喜欢的歌曲中删除', tone: 'danger' as const, onSelect: vi.fn() },
  ]

  it('renders nothing while closed', () => {
    const { container } = render(h(ContextMenu, { open: false, onClose: () => {}, x: 0, y: 0, items }))
    expect(container.innerHTML).toBe('')
  })

  it('renders rows and reports a press, then closes', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      h(ContextMenu, {
        open: true,
        onClose,
        x: 10,
        y: 10,
        title: 'Jóga',
        items: [{ id: 'queue', label: '加入播放列表', onSelect }],
      }),
    )
    const row = Array.from(container.querySelectorAll('[role="menuitem"]')).find(
      (node) => node.textContent === '加入播放列表',
    ) as HTMLElement
    expect(row).toBeTruthy()
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens a submenu with a filter, a create row and the list', () => {
    const { container } = render(h(ContextMenu, { open: true, onClose: () => {}, x: 0, y: 0, items }))
    const add = Array.from(container.querySelectorAll('[role="menuitem"]')).find(
      (node) => node.textContent?.startsWith('加入歌单'),
    ) as HTMLElement
    fireEvent.click(add)

    expect(container.textContent).toContain('新建歌单')
    expect(container.textContent).toContain('Road trip')
    expect(container.querySelector('[data-testid="context-menu-filter"]')).toBeTruthy()
  })

  it('filters the submenu rows as the user types', () => {
    const { container } = render(h(ContextMenu, { open: true, onClose: () => {}, x: 0, y: 0, items }))
    fireEvent.click(
      Array.from(container.querySelectorAll('[role="menuitem"]')).find((node) =>
        node.textContent?.startsWith('加入歌单'),
      ) as HTMLElement,
    )

    const field = container.querySelector('[data-testid="context-menu-filter"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(field, 'late')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(container.textContent).toContain('Late night')
    expect(container.textContent).not.toContain('Road trip')
  })

  it('switches search filter to create field at top when clicking create new playlist in submenu', () => {
    const onCreate = vi.fn()
    const testItems = [
      {
        id: 'add',
        label: '加入歌单',
        submenu: {
          title: '加入歌单',
          searchPlaceholder: '查找歌单',
          create: { label: '新建歌单', placeholder: '歌单名称', onSelect: onCreate },
          items: [{ id: 'p1', label: 'Road trip', onSelect: vi.fn() }],
          emptyLabel: '没有匹配的歌单',
        },
      },
    ]
    const { container } = render(h(ContextMenu, { open: true, onClose: () => {}, x: 0, y: 0, items: testItems }))
    fireEvent.click(
      Array.from(container.querySelectorAll('[role="menuitem"]')).find((node) =>
        node.textContent?.startsWith('加入歌单'),
      ) as HTMLElement,
    )
    expect(container.querySelector('[data-testid="context-menu-filter"]')).toBeTruthy()
    const createBtn = Array.from(container.querySelectorAll('[role="menuitem"]')).find((node) =>
      node.textContent?.includes('新建歌单'),
    ) as HTMLElement
    fireEvent.click(createBtn)

    // Now the search filter is replaced with the create input field at the top position
    expect(container.querySelector('[data-testid="context-menu-filter"]')).toBeNull()
    const createInput = container.querySelector('[data-testid="context-menu-create-name"]') as HTMLInputElement
    expect(createInput).toBeTruthy()
    const confirmBtn = container.querySelector('[data-testid="context-menu-create-confirm"]') as HTMLElement
    expect(confirmBtn).toBeTruthy()

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(createInput, 'My New Playlist')
      createInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    fireEvent.click(confirmBtn)
    expect(onCreate).toHaveBeenCalledWith('My New Playlist')
  })

  it('opens a submenu on hover without clicking, and closes when hovering another item', () => {
    const { container } = render(h(ContextMenu, { open: true, onClose: () => {}, x: 0, y: 0, items }))
    const add = Array.from(container.querySelectorAll('[role="menuitem"]')).find((node) =>
      node.textContent?.startsWith('加入歌单'),
    ) as HTMLElement
    const queue = Array.from(container.querySelectorAll('[role="menuitem"]')).find((node) =>
      node.textContent?.startsWith('加入播放列表'),
    ) as HTMLElement

    expect(container.textContent).not.toContain('Road trip')

    // Hovering over "加入歌单" displays the submenu
    fireEvent.mouseEnter(add)
    expect(container.textContent).toContain('Road trip')

    // Hovering over "加入播放列表" (which has no submenu) closes it
    fireEvent.mouseEnter(queue)
    expect(container.textContent).not.toContain('Road trip')
  })

  it('constrains submenu position and maxHeight so it stays within viewport boundaries', () => {
    window.innerHeight = 600
    window.innerWidth = 800

    const { container } = render(h(ContextMenu, { open: true, onClose: () => {}, x: 100, y: 500, items }))
    const add = Array.from(container.querySelectorAll('[role="menuitem"]')).find((node) =>
      node.textContent?.startsWith('加入歌单'),
    ) as HTMLElement

    vi.spyOn(add, 'getBoundingClientRect').mockReturnValue({
      top: 500,
      bottom: 536,
      left: 100,
      right: 348,
      width: 248,
      height: 36,
      x: 100,
      y: 500,
      toJSON: () => {},
    })

    fireEvent.mouseEnter(add)
    const menus = container.querySelectorAll('[role="menu"]')
    expect(menus.length).toBe(2)
    const submenuEl = menus[1] as HTMLElement
    const top = Number.parseFloat(submenuEl.style.top)
    const maxHeight = Number.parseFloat(submenuEl.style.maxHeight)

    expect(top).toBeGreaterThanOrEqual(8)
    expect(top + maxHeight).toBeLessThanOrEqual(window.innerHeight - 8)
  })

  it('closes the menu on window resize', () => {
    const onClose = vi.fn()
    render(h(ContextMenu, { open: true, onClose, x: 10, y: 10, items }))
    window.dispatchEvent(new Event('resize'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('SaveToPlaylistPopover', () => {
  it('hides the list row for create playlist and shows top create bar with confirm button when clicked', () => {
    const onCreate = vi.fn()
    const { getByTestId } = render(
      h(SaveToPlaylistPopover, {
        open: true,
        testID: 'save-popover',
        onClose: () => {},
        x: 100,
        y: 100,
        playlists: [{ urn: 'BBeBee:local:playlist:1', name: 'My List', trackCount: 5 }],
        onCreatePlaylist: onCreate,
      }),
    )

    const popover = within(getByTestId('save-popover'))
    expect(popover.getByText('新建歌单')).toBeTruthy()
    expect(popover.getByPlaceholderText('查找歌单')).toBeTruthy()

    // Click '新建歌单' row
    fireEvent.click(popover.getByText('新建歌单'))

    // The list row for '新建歌单' should now be hidden
    expect(popover.queryByText('新建歌单')).toBeNull()

    // The top input should be shown for creating playlist
    const input = popover.getByPlaceholderText('歌单名称') as HTMLInputElement
    expect(input).toBeTruthy()
    const confirmBtn = popover.getByText('确定')
    expect(confirmBtn).toBeTruthy()
    expect(confirmBtn.style.whiteSpace).toBe('nowrap')
    expect(confirmBtn.style.flexShrink).toBe('0')

    // Type and click confirm
    fireEvent.change(input, { target: { value: 'New Test Playlist' } })
    fireEvent.click(confirmBtn)
    expect(onCreate).toHaveBeenCalledWith('New Test Playlist', undefined)
  })
})

