// @vitest-environment jsdom
/**
 * The mobile share host, opened and driven.
 *
 * The same contracts the desktop twin asserts — the host registers on
 * `share.host`, a `share/open` target encodes to an envelope the importer can
 * round-trip, a pasted code plays — plus the medium that differs: the code
 * travels as text, not as a steganographic image.
 *
 * React Native is injected as DOM host components, the same seam
 * `apps/mobile` uses to hand over the real `react-native`. `TextInput`
 * renders a real `<input>` so the paste is a genuine change event.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createElement as h } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { tick } from '@BBeBee/kernel/testing'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import { decodeMetadata, encodeMetadata } from '@bbebee/plugin-share/metadata'
import pluginShareUiMobile, { ShareHost } from './index.js'
import shareCatalogue from '../../../feature/plugin-i18n/src/locales/share.json'

afterEach(cleanup)

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
        // A press belongs to the deepest Pressable it lands on — RN's
        // responder system never hands it to the ancestors. DOM clicks bubble,
        // so without this a button press inside a Sheet would also press the
        // backdrop behind it and close the sheet it lives in.
        onClick:
          typeof onPress === 'function'
            ? (e: { stopPropagation: () => void }) => {
                e.stopPropagation()
                ;(onPress as (ev: unknown) => void)(e)
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
  ActivityIndicator: hostComponent('ActivityIndicator'),
  // FlashList takes `data`/`renderItem`, not children, so it needs its own —
  // the same shape the other mobile view packages' tests stub.
  FlashList: function FlashList(props: {
    data?: readonly unknown[]
    renderItem?: (info: { item: unknown; index: number }) => ReactNode
    ListEmptyComponent?: ReactNode
  }) {
    const items = props.data ?? []
    return h(
      'div',
      { 'data-host': 'FlashList' },
      items.length === 0
        ? (props.ListEmptyComponent as ReactNode)
        : items.map((item, index) =>
            h('div', { key: index }, props.renderItem?.({ item, index })),
          ),
    )
  },
  // A real input element: the import flow is driven through an actual change
  // event, the way a paste arrives on the device.
  TextInput: function TextInput(props: Record<string, unknown>) {
    const { value, onChangeText, placeholder, testID, editable } = props
    return h('input', {
      'data-host': 'TextInput',
      value: typeof value === 'string' ? value : '',
      placeholder: typeof placeholder === 'string' ? placeholder : undefined,
      'data-testid': typeof testID === 'string' ? testID : undefined,
      readOnly: editable === false,
      onChange:
        typeof onChangeText === 'function'
          ? (e: { target: { value: string } }) => (onChangeText as (v: string) => void)(e.target.value)
          : undefined,
    })
  },
})

class UiStub extends Service {
  public views = new Map<string, unknown>()

  constructor(ctx: Context) {
    super(ctx, 'ui')
  }

  registerView(id: string, component: unknown) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }
}

/** The real codecs behind a service shell — round-trips must be genuine. */
class ShareStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'share')
  }

  encodeMetadata(type: Parameters<typeof encodeMetadata>[0], data: unknown): string {
    return encodeMetadata(type, data as never)
  }

  decodeMetadata(base64: string) {
    return decodeMetadata(base64)
  }
}

class PlayerStub extends Service {
  readonly playedNowUrns: string[][] = []
  readonly enqueuedUrns: string[][] = []

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  async playNow(urns: string[]): Promise<void> {
    this.playedNowUrns.push(urns)
  }

  enqueueLast(urns: string[]): void {
    this.enqueuedUrns.push(urns)
  }
}

/**
 * English-only i18n stub — the same shape as `DefaultI18nStub` in
 * `apps/desktop/renderer/Shell.test.tsx`, serving the `share` catalogue.
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

const TRACK = {
  urn: 'source:test:track:shared_99',
  title: 'Shared Song',
  artist: 'Shared Artist',
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(EnglishI18nStub)
  await ctx.plugin(UiStub)
  await ctx.plugin(ShareStub)
  await ctx.plugin(PlayerStub)
  return ctx
}

describe('plugin-share-ui-mobile', () => {
  it('registers the share.host view in ctx.ui', async () => {
    const ctx = await harness()
    await ctx.plugin(pluginShareUiMobile)
    const ui = ctx.ui as unknown as UiStub
    expect(ui.views.get('share.host')).toBeDefined()
  })

  it('renders nothing until a share event opens the sheet', async () => {
    const ctx = await harness()
    const { container } = render(h(ShareHost, { ctx }))
    expect(container.textContent).toBe('')

    await act(async () => {
      ctx.emit('share/open', { type: 'track', track: TRACK })
      await tick()
    })

    expect(container.textContent).toContain('Share song')
    expect(container.textContent).toContain('Shared Song — Shared Artist')
  })

  it('exposes a share code that decodes back to the shared target', async () => {
    const ctx = await harness()
    const { container } = render(h(ShareHost, { ctx }))

    await act(async () => {
      ctx.emit('share/open', { type: 'track', track: TRACK })
      await tick()
    })

    const input = container.querySelector('input')
    expect(input).not.toBeNull()
    const envelope = decodeMetadata((input as HTMLInputElement).value)
    expect(envelope?.type).toBe('track')
    expect((envelope?.data as typeof TRACK).urn).toBe(TRACK.urn)
  })

  it('decodes a pasted code and plays it', async () => {
    const ctx = await harness()
    const player = ctx.player as unknown as PlayerStub
    const b64 = encodeMetadata('track', TRACK)

    const { getByPlaceholderText, getByTestId, getByText } = render(h(ShareHost, { ctx }))

    await act(async () => {
      ctx.emit('share/import')
      await tick()
    })

    const input = getByPlaceholderText('Paste Base64 share code')
    await act(async () => {
      fireEvent.change(input, { target: { value: b64 } })
      await tick()
    })
    await act(async () => {
      fireEvent.click(getByTestId('share-import-decode'))
      await tick()
    })

    expect(getByText('Recognized song: Shared Song — Shared Artist')).toBeDefined()

    await act(async () => {
      fireEvent.click(getByTestId('share-import-play'))
      await tick()
    })

    expect(player.playedNowUrns).toEqual([[TRACK.urn]])
  })

  it('reports an invalid pasted code instead of failing silently', async () => {
    const ctx = await harness()
    const { getByPlaceholderText, getByTestId, container } = render(h(ShareHost, { ctx }))

    await act(async () => {
      ctx.emit('share/import')
      await tick()
    })

    await act(async () => {
      fireEvent.change(getByPlaceholderText('Paste Base64 share code'), {
        target: { value: 'not-a-bbebee-payload' },
      })
      await tick()
    })
    await act(async () => {
      fireEvent.click(getByTestId('share-import-decode'))
      await tick()
    })

    expect(container.textContent).toContain("Can't parse the share code")
  })

  it('enqueues an album from a decoded code', async () => {
    const ctx = await harness()
    const player = ctx.player as unknown as PlayerStub
    const b64 = encodeMetadata('album', {
      urn: 'source:test:album:1',
      title: 'Fantasy',
      artist: 'Jay Chou',
      trackCount: 2,
      tracks: [
        { urn: 'source:test:track:a', title: 'A', artist: 'Jay Chou' },
        { urn: 'source:test:track:b', title: 'B', artist: 'Jay Chou' },
      ],
    })

    const { getByPlaceholderText, getByTestId } = render(h(ShareHost, { ctx }))

    await act(async () => {
      ctx.emit('share/import')
      await tick()
    })
    await act(async () => {
      fireEvent.change(getByPlaceholderText('Paste Base64 share code'), { target: { value: b64 } })
      fireEvent.click(getByTestId('share-import-decode'))
      await tick()
    })
    await act(async () => {
      fireEvent.click(getByTestId('share-import-enqueue'))
      await tick()
    })

    expect(player.enqueuedUrns).toEqual([
      ['source:test:track:a', 'source:test:track:b'],
    ])
  })
})
