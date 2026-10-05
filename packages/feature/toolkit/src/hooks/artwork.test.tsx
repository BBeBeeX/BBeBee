// @vitest-environment jsdom
/**
 * `useResolvedArtwork` — the hook that makes a cover render from a local file.
 *
 * The property worth pinning is not that it eventually returns the URI; it is
 * that the *remote* URL is never what the caller renders first. While the
 * cache is fetching, the hook answers with no `sourceUrl` and the component
 * paints its `dominantColor`/identicon fallback — an `<img>` pointed at the
 * CDN would be a second request for bytes the cache is already fetching.
 */

import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { render, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { ArtworkRef, Uri } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { useResolvedArtwork } from './artwork.js'

const REF: ArtworkRef = { id: 'https://img.test/cover.jpg', sourceUrl: 'https://img.test/cover.jpg' }

class CacheStub extends Service {
  readonly calls: ArtworkRef[] = []
  result: Uri | undefined
  blocked?: Promise<Uri | undefined>

  constructor(ctx: Context) {
    super(ctx, 'cache')
  }

  async artwork(ref: ArtworkRef): Promise<Uri | undefined> {
    this.calls.push(ref)
    if (this.blocked) return this.blocked
    return this.result
  }
}

function Cover({ ctx, artwork }: { ctx: Context; artwork?: ArtworkRef }): ReactElement {
  const resolved = useResolvedArtwork(ctx, artwork)
  return h('span', { 'data-uri': resolved?.sourceUrl ?? 'fallback' })
}

async function harness(): Promise<{ ctx: Context; cache: CacheStub }> {
  const ctx = new Context()
  await ctx.plugin(CacheStub)
  await tick()
  return { ctx, cache: ctx.cache as unknown as CacheStub }
}

describe('useResolvedArtwork', () => {
  it('renders the fallback until the cache answers, then the local file', async () => {
    const { ctx, cache } = await harness()
    let release: (uri: Uri | undefined) => void = () => {}
    cache.blocked = new Promise<Uri | undefined>((resolve) => (release = resolve))

    const view = render(h(Cover, { ctx, artwork: REF }))
    expect(
      view.container.firstElementChild?.getAttribute('data-uri'),
      'the remote URL is not rendered while the cache fetches',
    ).toBe('fallback')

    release('file:///cache/aw_1.jpg')
    await waitFor(() =>
      expect(view.container.firstElementChild?.getAttribute('data-uri')).toBe(
        'file:///cache/aw_1.jpg',
      ),
    )
    expect(cache.calls).toEqual([REF])
  })

  it('falls back to the remote URL when the cache could not help', async () => {
    const { ctx, cache } = await harness()
    cache.result = undefined
    const view = render(h(Cover, { ctx, artwork: REF }))
    await waitFor(() =>
      expect(view.container.firstElementChild?.getAttribute('data-uri')).toBe(REF.sourceUrl),
    )
  })

  it('is a no-op when the cache plugin is not loaded', async () => {
    const ctx = new Context()
    const view = render(h(Cover, { ctx, artwork: REF }))
    expect(view.container.firstElementChild?.getAttribute('data-uri')).toBe(REF.sourceUrl)
  })

  it('leaves an already-local cover alone', async () => {
    const { ctx } = await harness()
    const local: ArtworkRef = { id: 'aw_local', sourceUrl: 'file:///scanner/cover.jpg' }
    const view = render(h(Cover, { ctx, artwork: local }))
    expect(view.container.firstElementChild?.getAttribute('data-uri')).toBe(local.sourceUrl)
  })

  it('asks for nothing when there is no artwork', async () => {
    const { ctx, cache } = await harness()
    const view = render(h(Cover, { ctx }))
    expect(view.container.firstElementChild?.getAttribute('data-uri')).toBe('fallback')
    expect(cache.calls).toHaveLength(0)
  })
})
