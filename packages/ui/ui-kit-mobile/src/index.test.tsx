// @vitest-environment jsdom
/**
 * The mobile kit, off device.
 *
 * `react-native` is injected rather than imported precisely so this file can
 * exist: the components are inspected as React element trees, with fake
 * primitives standing in for the real ones. That covers the half that is
 * genuinely shared with desktop — which props reach which element, what is
 * announced to a screen reader, what the tap target measures — and leaves
 * only pixels to the device smoke matrix.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { tokens } from '@BBeBee/ui-tokens'
import { createElement as h, isValidElement } from 'react'
import type { ReactElement } from 'react'
import type { Track } from '@BBeBee/protocol'
import {
  Artwork,
  Button,
  EmptyState,
  IconButton,
  List,
  Sheet,
  Text,
  TextField,
  Toast,
  TrackRow,
  ContextMenu,
  configureNative,
  nativePrimitives,
} from './index.js'

afterEach(cleanup)

function domHost(name: string) {
  return function Host(props: Record<string, unknown> & { children?: unknown }) {
    const { children, accessibilityLabel, onPress, testID, onChangeText, value, placeholder } = props
    if (name === 'TextInput') {
      return h('input', {
        'data-testid': typeof testID === 'string' ? testID : undefined,
        value: value as string,
        placeholder: placeholder as string,
        onChange: (event: { target: { value: string } }) =>
          (onChangeText as ((v: string) => void) | undefined)?.(event.target.value),
      })
    }
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick: typeof onPress === 'function' ? (onPress as () => void) : undefined,
      },
      children as never,
    )
  }
}

const NATIVE_DOM = {
  View: domHost('View'),
  Text: domHost('Text'),
  Pressable: domHost('Pressable'),
  Image: domHost('Image'),
  Modal: domHost('Modal'),
  FlashList: domHost('FlashList'),
  ActivityIndicator: domHost('ActivityIndicator'),
  TextInput: domHost('TextInput'),
}

const NATIVE = {
  View: 'RNView',
  Text: 'RNText',
  Pressable: 'RNPressable',
  Image: 'RNImage',
  Modal: 'RNModal',
  FlashList: 'RNFlashList',
  ActivityIndicator: 'RNSpinner',
  TextInput: 'RNTextInput',
}
configureNative(NATIVE)

const track: Track = {
  urn: 'BBeBee:local:track:1',
  title: 'Jóga',
  artists: [{ urn: 'BBeBee:local:artist:1', name: 'Björk', role: 'main', ordinal: 0 }],
  albumTitle: 'Homogenic',
  available: true,
}

/** Every element in a tree, flattened, so a test can look for one. */
function walk(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return out
  }
  if (!isValidElement(node)) return out
  out.push(node)
  const props = node.props as { children?: unknown }
  if (props.children !== undefined) walk(props.children, out)
  return out
}

/** Render a function component one level, then flatten what it produced. */
function tree(element: ReactElement): ReactElement[] {
  const type = element.type as (p: unknown) => ReactElement | null
  const rendered = typeof type === 'function' ? type(element.props) : element
  return rendered ? walk(rendered) : []
}

const find = (element: ReactElement, type: string) =>
  tree(element).find((n) => n.type === type)

describe('native injection', () => {
  it('uses the primitives the shell configured', () => {
    expect(nativePrimitives()).toBe(NATIVE)
  })

  it('renders without them, so a tree is inspectable before boot', () => {
    // A shell that forgot to configure gets an obviously wrong screen rather
    // than a crash in a render pass nobody can read.
    expect(() => tree(h(Text, { children: 'x' }))).not.toThrow()
  })
})

describe('Button', () => {
  it('is a pressable with a button role', () => {
    const node = find(h(Button, { onPress: () => {}, children: 'Play' }), 'RNPressable')
    expect(node).toBeDefined()
    expect((node!.props as { accessibilityRole: string }).accessibilityRole).toBe('button')
  })

  it('disables and reports busy while loading', () => {
    const node = find(h(Button, { onPress: () => {}, loading: true, children: 'x' }), 'RNPressable')
    const props = node!.props as { disabled: boolean; accessibilityState: { busy: boolean } }
    expect(props.disabled).toBe(true)
    expect(props.accessibilityState.busy).toBe(true)
  })

  it('does not fire while disabled', () => {
    const onPress = vi.fn()
    const node = find(h(Button, { onPress, disabled: true, children: 'x' }), 'RNPressable')
    expect((node!.props as { onPress?: () => void }).onPress).toBeUndefined()
  })

  it('shows a spinner rather than the label while loading', () => {
    expect(find(h(Button, { onPress: () => {}, loading: true, children: 'x' }), 'RNSpinner'))
      .toBeDefined()
  })
})

describe('IconButton', () => {
  it('carries its accessible name', () => {
    const node = find(
      h(IconButton, { icon: '⏭', accessibilityLabel: 'Next track', onPress: () => {} }),
      'RNPressable',
    )
    expect((node!.props as { accessibilityLabel: string }).accessibilityLabel).toBe('Next track')
  })

  it('meets the minimum tap target regardless of icon size', () => {
    const node = find(
      h(IconButton, { icon: '·', accessibilityLabel: 'More', onPress: () => {}, size: 8 }),
      'RNPressable',
    )
    expect((node!.props as { style: { width: number } }).style.width).toBe(44)
  })
})

describe('TrackRow', () => {
  it('binds the overflow to a long press and hands over the pointer anchor', () => {
    const onMore = vi.fn()
    const node = find(h(TrackRow, { track, onMore }), 'RNPressable')
    const onLongPress = (node!.props as { onLongPress: (e: unknown) => void }).onLongPress
    onLongPress({ nativeEvent: { pageX: 12, pageY: 34 } })
    expect(onMore).toHaveBeenCalledWith({ x: 12, y: 34 })
  })

  it('shows the album only when asked', () => {
    const withAlbum = tree(h(TrackRow, { track, showAlbum: true }))
    expect(JSON.stringify(withAlbum.map((n) => n.props))).toContain('Homogenic')
    const without = tree(h(TrackRow, { track }))
    expect(JSON.stringify(without.map((n) => n.props))).not.toContain('Homogenic')
  })

  it('offers a download control only where a downloads service is loaded, and omits for local tracks', () => {
    const remote = { ...track, urn: 'BBeBee:remote:track:1' }
    const offered = JSON.stringify(tree(h(TrackRow, { track: remote, onDownload: () => {} })))
    expect(offered).toContain('Download')
    const absent = JSON.stringify(tree(h(TrackRow, { track: remote })))
    expect(absent).not.toContain('Download')
    const localWithDownload = JSON.stringify(tree(h(TrackRow, { track, onDownload: () => {} })))
    expect(localWithDownload).not.toContain('Download')
  })
})

// `Slider` holds drag state, so it needs a renderer rather than a call.
// Its tests live in `slider.test.tsx`, which gives it one.

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    expect(tree(h(Sheet, { open: false, onClose: () => {}, children: 'x' }))).toEqual([])
  })

  it('closes on the Android back button', () => {
    // Without `onRequestClose` the sheet is a trap on Android.
    const onClose = vi.fn()
    const node = find(h(Sheet, { open: true, onClose, children: 'x' }), 'RNModal')
    expect((node!.props as { onRequestClose: () => void }).onRequestClose).toBe(onClose)
  })
})

describe('List', () => {
  it('renders through FlashList, not a plain FlatList', () => {
    // Recycling is the whole point: mounting one view per row is what makes a
    // large library unscrollable on a low-end phone (docs/11 §4.11).
    const node = tree(
      h(List<{ id: string }>, { items: [{ id: 'a' }], keyExtractor: (i) => i.id, renderItem: () => null }),
    )[0]!
    expect(node.type).toBe(NATIVE.FlashList)
  })

  it('hands the virtualiser its data and its keys', () => {
    const keyExtractor = (i: { id: string }) => i.id
    const items = [{ id: 'a' }, { id: 'b' }]
    const node = tree(
      h(List<{ id: string }>, { items, keyExtractor, renderItem: () => null }),
    )[0]!
    const props = node.props as { data: unknown; keyExtractor: unknown }
    expect(props.data).toBe(items)
    expect(props.keyExtractor, 'stable keys, or every scroll re-mounts rows').toBe(keyExtractor)
  })

  it('does not forward a size hint FlashList would ignore', () => {
    // v2 measures rows itself and dropped `estimatedItemSize`. Passing it
    // anyway would read as a hint and do nothing.
    const node = tree(
      h(List<{ id: string }>, {
        items: [{ id: 'a' }],
        keyExtractor: (i) => i.id,
        renderItem: () => null,
        estimatedItemSize: 56,
      }),
    )[0]!
    expect((node.props as { estimatedItemSize?: unknown }).estimatedItemSize).toBeUndefined()
  })

  it('shows the empty state instead of nothing', () => {
    const node = tree(
      h(List<{ id: string }>, {
        items: [],
        keyExtractor: (i) => i.id,
        renderItem: () => null,
        empty: 'No tracks yet',
      }),
    )[0]!
    expect((node.props as { ListEmptyComponent?: unknown }).ListEmptyComponent).toBe('No tracks yet')
  })
})

describe('Toast', () => {
  it('announces politely rather than stealing focus', () => {
    const node = tree(h(Toast, { message: 'Saved' }))[0]!
    expect((node.props as { accessibilityLiveRegion: string }).accessibilityLiveRegion).toBe(
      'polite',
    )
  })
})

describe('Artwork and EmptyState', () => {
  it('paints the dominant colour behind the image', () => {
    const node = tree(h(Artwork, { size: 48, artwork: { id: 'a', dominantColor: '#3a5f7d' } }))[0]!
    expect((node.props as { style: { backgroundColor: string } }).style.backgroundColor).toBe(
      '#3a5f7d',
    )
  })

  it('renders no image when there is nothing to show', () => {
    expect(find(h(Artwork, { size: 48 }), 'RNImage')).toBeUndefined()
  })

  it('generates an identicon from the seed when there is no artwork at all', () => {
    const nodes = tree(h(Artwork, { size: 48, seed: 'BBeBee:local:track:9f2c8a1e' }))
    expect((nodes[0]!.props as { style: { backgroundColor: string } }).style.backgroundColor).toBe(
      'hsl(65, 30%, 14%)',
    )
    // Five rows of five cells; the painted ones carry the foreground colour.
    const painted = nodes.filter(
      (n) =>
        n.type === 'RNView' &&
        (n.props as { style?: { backgroundColor?: string } }).style?.backgroundColor ===
          'hsl(65, 68%, 58%)',
    )
    expect(painted).toHaveLength(16)
  })

  it('renders the same square for the same seed, a different one otherwise', () => {
    const urn = 'BBeBee:local:track:9f2c8a1e'
    const json = (seed: string) =>
      JSON.stringify(tree(h(Artwork, { size: 48, seed })))
    expect(json(urn)).toBe(json(urn))
    expect(json(urn)).not.toBe(json('BBeBee:local:track:other'))
  })

  it('keeps the plain colour square when there is no identity at all', () => {
    const node = tree(h(Artwork, { size: 48 }))[0]!
    expect((node.props as { style: { backgroundColor: string } }).style.backgroundColor).toBe(
      '#282828',
    )
  })

  it('prefers a real image over the identicon', () => {
    const nodes = tree(
      h(Artwork, {
        size: 48,
        seed: 'BBeBee:local:track:9f2c8a1e',
        artwork: { id: 'a', sourceUrl: 'https://x/a.jpg' },
      }),
    )
    expect(nodes.some((n) => n.type === 'RNImage')).toBe(true)
    expect(nodes.some((n) => (n.props as { style?: { backgroundColor?: string } }).style?.backgroundColor?.startsWith('hsl('))).toBe(false)
  })

  it('gives an empty screen something to say', () => {
    const nodes = tree(h(EmptyState, { title: 'No tracks yet', description: 'Add a folder' }))
    expect(JSON.stringify(nodes.map((n) => n.props))).toContain('No tracks yet')
  })
})

describe('TextField', () => {
  it('is controlled, like its desktop twin', () => {
    /*
     * React Native's `TextInput` is happy to be uncontrolled, and a kit where
     * one platform keeps its own state and the other does not diverges the
     * moment anything resets the field — which the import screen does on every
     * successful paste.
     */
    const input = find(
      h(TextField, { value: 'abc', onChange: () => {}, accessibilityLabel: 'Rule' }),
      'RNTextInput',
    )
    expect(input?.props).toMatchObject({ value: 'abc' })
    expect(typeof (input?.props as { onChangeText?: unknown }).onChangeText).toBe('function')
  })

  it('turns autocorrect and capitalisation off', () => {
    // A rule and a URL are both case- and spelling-sensitive, and a phone
    // keyboard rewriting one produces a source that fails for a reason nothing
    // on screen explains.
    const input = find(
      h(TextField, { value: '', onChange: () => {}, accessibilityLabel: 'Rule' }),
      'RNTextInput',
    )
    expect(input?.props).toMatchObject({ autoCorrect: false, autoCapitalize: 'none' })
  })

  it('grows for a pasted document and stays tappable for a rule', () => {
    const many = find(
      h(TextField, { value: '', onChange: () => {}, multiline: true, rows: 6, accessibilityLabel: 'Doc' }),
      'RNTextInput',
    )
    const single = find(
      h(TextField, { value: '', onChange: () => {}, accessibilityLabel: 'Rule' }),
      'RNTextInput',
    )
    const heightOf = (n: ReactElement | undefined) =>
      (n?.props as { style?: { minHeight?: number } }).style?.minHeight ?? 0
    expect(heightOf(many)).toBeGreaterThan(heightOf(single))
    expect(heightOf(single)).toBeGreaterThanOrEqual(tokens.size.touchTarget)
  })

  it('hides a secure value', () => {
    const input = find(
      h(TextField, { value: 'hunter2', onChange: () => {}, secure: true, accessibilityLabel: 'Password' }),
      'RNTextInput',
    )
    expect(input?.props).toMatchObject({ secureTextEntry: true })
  })

  it('renders an error rather than hiding it', () => {
    const nodes = tree(
      h(TextField, {
        value: '{',
        onChange: () => {},
        error: 'sourceUrl: must be a string',
        accessibilityLabel: 'Doc',
      }),
    )
    expect(JSON.stringify(nodes.map((n) => n.props))).toContain('sourceUrl: must be a string')
  })
})



describe('ContextMenu on mobile', () => {
  // DOM hosts: a submenu is a state change, and an element tree is static.

  const items = [
    {
      id: 'add',
      label: 'Add to playlist',
      submenu: {
        title: 'Add to playlist',
        searchPlaceholder: 'Find playlist',
        create: { label: 'New playlist', placeholder: 'Playlist name', onSelect: vi.fn() },
        items: [{ id: 'p1', label: 'Road trip', onSelect: vi.fn() }],
        emptyLabel: 'No matching playlists',
      },
    },
    { id: 'queue', label: 'Add to play queue', onSelect: vi.fn() },
    { id: 'remove', label: 'Remove from Favorites', tone: 'danger' as const, onSelect: vi.fn() },
  ]

  it('renders rows and reports a press, then closes', () => {
    configureNative({ ...NATIVE_DOM })
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      h(ContextMenu, {
        open: true,
        onClose,
        x: 0,
        y: 0,
        title: 'Jóga',
        items: [{ id: 'queue', label: 'Add to play queue', onSelect }],
      }),
    )
    const row = container.querySelector('[data-label="Add to play queue"]') as HTMLElement | null
    expect(row, 'the row is rendered').toBeTruthy()
    row!.click()
    expect(onSelect).toHaveBeenCalledOnce()
    // The DOM host bubbles the press to the backdrop, which closes too; React
    // Native's responder system does not, so "once" is not the assertion here.
    expect(onClose).toHaveBeenCalled()
  })

  it('replaces its contents for a submenu, with a filter and a create row', () => {
    configureNative({ ...NATIVE_DOM })
    const { container } = render(h(ContextMenu, { open: true, onClose: vi.fn(), x: 0, y: 0, items }))
    fireEvent.click(container.querySelector('[data-label="Add to playlist"]') as HTMLElement)

    expect(container.textContent).toContain('\u2039 Add to playlist')
    expect(container.querySelector('[data-testid="context-menu-filter"]')).toBeTruthy()
    expect(container.textContent).toContain('New playlist')
    expect(container.textContent).toContain('Road trip')
  })
})
