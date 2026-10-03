// @vitest-environment jsdom
/**
 * The hooks the import and test screens are made of.
 *
 * Written once and consumed by both shells, so a bug here is a bug twice.
 * These are tested against a real `ctx.sources` rather than a mock: the
 * behaviours that matter — what a failed paste leaves on screen, whether a
 * trace stops appending when the user moves on — are about the *interaction*
 * with the service, which a mock would define away.
 */

import { act, render } from '@testing-library/react'
import { createElement as h, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import plugin from './index.js'
import {
  useSearchSourceSelection,
  resetSearchSourceSelection,
  SEARCH_SOURCES_EXCLUDED_STORAGE_KEY,
  useSourceImport,
  useSourceSearch,
  useTracks,
  type ImportState,
  type PagedState,
  type SearchSourceSelection,
  type SourceSearchState,
} from './hooks.js'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-hooks') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(plugin, {})
  await tick()
  return ctx
}

const DOC = {
  sourceUrl: 'https://music.example.org',
  sourceName: 'Example',
  ruleStream: { url: '={{source.url}}/s' },
}

/** Renders a hook and hands back its latest value. */
function harnessFor<T>(use: () => T): { current: () => T; rerender: () => void } {
  let latest: T
  const Probe = (): ReactElement => {
    latest = use()
    return h('div')
  }
  const view = render(h(Probe))
  return {
    current: () => latest,
    rerender: () => view.rerender(h(Probe)),
  }
}

describe('useSourceImport', () => {
  it('previews what a paste would add, before anything is written', async () => {
    /*
     * A user pasting a set from a forum has no way to know what is in it, and
     * an import that silently adds eleven sources is one they cannot undo
     * without knowing which eleven.
     */
    const ctx = await harness()
    let state!: ImportState
    const probe = harnessFor(() => (state = useSourceImport(ctx)))

    act(() => state.setText(JSON.stringify([DOC, { ...DOC, sourceUrl: 'https://b.example', sourceName: 'B' }])))
    probe.rerender()

    expect(state.preview).toEqual({ count: 2, names: ['Example', 'B'] })
    expect(ctx.sources.sources, 'nothing written yet').toHaveLength(0)
  })

  it('says nothing about a half-typed paste', async () => {
    // A partial document is not an error yet; problems are reported when the
    // user says they are finished.
    const ctx = await harness()
    let state!: ImportState
    const probe = harnessFor(() => (state = useSourceImport(ctx)))

    act(() => state.setText('{"sourceUrl": "https://'))
    probe.rerender()
    expect(state.preview).toBeUndefined()
    expect(state.issues).toEqual([])
  })

  it('imports, reports, and clears the box', async () => {
    const ctx = await harness()
    let state!: ImportState
    const probe = harnessFor(() => (state = useSourceImport(ctx)))

    act(() => state.setText(JSON.stringify(DOC)))
    probe.rerender()
    await act(async () => {
      state.submit()
      await tick()
      await tick()
    })
    probe.rerender()

    expect(state.report?.added.map((r) => r.name)).toEqual(['Example'])
    expect(state.text, 'cleared on success').toBe('')
  })

  it('keeps a failed paste on screen, with every issue', async () => {
    /*
     * Clearing the box on failure loses the thing the user was trying to fix.
     * And one issue at a time is the misery the multi-issue error exists to
     * avoid — the screen lists them all.
     */
    const ctx = await harness()
    let state!: ImportState
    const probe = harnessFor(() => (state = useSourceImport(ctx)))

    act(() => state.setText('{"sourceName": 42}'))
    probe.rerender()
    await act(async () => {
      state.submit()
      await tick()
      await tick()
    })
    probe.rerender()

    expect(state.text, 'still there to fix').toBe('{"sourceName": 42}')
    expect(state.issues.length).toBeGreaterThan(1)
    expect(state.issues.map((i) => i.path)).toContain('sourceUrl')
  })

  it('reset clears everything, including the last report', async () => {
    const ctx = await harness()
    let state!: ImportState
    const probe = harnessFor(() => (state = useSourceImport(ctx)))

    act(() => state.setText('nonsense'))
    await act(async () => {
      state.submit()
      await tick()
    })
    act(() => state.reset())
    probe.rerender()

    expect(state).toMatchObject({ text: '', issues: [], report: undefined })
  })
})

describe('paging, when two reads overlap', () => {
  it('lets only the newest read write', async () => {
    /*
     * ⚠️ `loadMore` fires again before the previous page lands — a fast scroll,
     * or a `library/changed` reload racing one — and both responses appended.
     * The list grew a duplicate page *and* the cursor went backwards to
     * whichever arrived last, so the next `loadMore` re-fetched a page the user
     * had already seen.
     */
    const ctx = await harness()

    // A catalogue whose first read is slow and whose second is instant, so the
    // two land out of order.
    const pages = [
      { items: [{ urn: 'a' }], cursor: '2', hasMore: true, delay: 40 },
      { items: [{ urn: 'b' }], cursor: '3', hasMore: true, delay: 0 },
    ]
    let call = 0
    const slowCatalog = async () => {
      const page = pages[Math.min(call++, pages.length - 1)]!
      await new Promise((resolve) => setTimeout(resolve, page.delay))
      return { items: page.items, cursor: page.cursor, hasMore: page.hasMore }
    }
    ;(ctx.sources as unknown as { listTracks: unknown }).listTracks = slowCatalog

    let state!: PagedState<{ urn: string }>
    const probe = harnessFor(
      () => (state = useTracks(ctx, {}) as unknown as PagedState<{ urn: string }>),
    )

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
    })
    probe.rerender()

    // Two overlapping loads; only the last may write.
    await act(async () => {
      state.loadMore()
      state.loadMore()
      await new Promise((resolve) => setTimeout(resolve, 80))
    })
    probe.rerender()

    const urns = state.items.map((t) => t.urn)
    expect(new Set(urns).size, 'no page appended twice').toBe(urns.length)
  })
})

describe('useSearchSourceSelection', () => {
  const store = new Map<string, string>()
  const mockStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
  }

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    })
    store.clear()
    resetSearchSourceSelection(new Set())
  })

  afterEach(() => {
    store.clear()
    resetSearchSourceSelection(new Set())
  })

  it('syncs exclusions across multiple instances and persists to localStorage', async () => {
    const ctx = await harness()
    await ctx.sources.import(
      JSON.stringify([
        {
          sourceUrl: 'https://alpha.example',
          sourceName: 'Alpha',
          ruleStream: { url: '={{source.url}}/s' },
        },
        {
          sourceUrl: 'https://beta.example',
          sourceName: 'Beta',
          ruleStream: { url: '={{source.url}}/s' },
        },
      ]),
    )
    const [alpha, beta] = ctx.sources.sources
    const fakeSearchProvider = (sourceId: string): any => ({
      sourceId,
      displayName: sourceId,
      capabilities: {
        search: { tracks: true, albums: false, artists: false, playlists: false, fullText: false },
        browse: false,
        recommend: false,
        lyrics: false,
        artwork: false,
        library: { read: false, save: false, playlistWrite: false, playlistReorder: false },
        streaming: { qualities: ['normal'], transcoding: false, seekable: true, urlExpiry: false },
        regional: false,
      },
      auth: {
        flow: { kind: 'none' },
        status: { state: 'authenticated' },
        async signIn() {},
        async signOut() {},
        onStatusChange: () => () => {},
      },
      search: async () => ({ tracks: { items: [], hasMore: false } }),
      getTrack: async (id: string) => ({ urn: `BBeBee:${sourceId}:track:${id}` }),
      resolveStream: async () => ({ kind: 'remote', target: '', seekable: true }),
      ping: async () => true,
    })
    ctx.sources.register(fakeSearchProvider(alpha!.id))
    ctx.sources.register(fakeSearchProvider(beta!.id))
    await tick()

    let sel1!: SearchSourceSelection
    let sel2!: SearchSourceSelection
    const probe1 = harnessFor(() => (sel1 = useSearchSourceSelection(ctx)))
    const probe2 = harnessFor(() => (sel2 = useSearchSourceSelection(ctx)))

    expect(sel1.options.length).toBe(2)
    expect(sel1.allSelected).toBe(true)
    expect(sel2.allSelected).toBe(true)

    const alphaTrackId = sel1.interfaces[0]!.id

    await act(async () => {
      sel1.toggleInterface(alphaTrackId)
    })
    probe1.rerender()
    probe2.rerender()

    // Both instances are synchronized immediately
    expect(sel1.isInterfaceSelected(alphaTrackId)).toBe(false)
    expect(sel2.isInterfaceSelected(alphaTrackId)).toBe(false)
    expect(sel1.allSelected).toBe(false)
    expect(sel2.allSelected).toBe(false)

    // Saved to localStorage
    const saved = JSON.parse(window.localStorage.getItem(SEARCH_SOURCES_EXCLUDED_STORAGE_KEY) ?? '[]')
    expect(saved).toContain(alphaTrackId)

    // Toggle again re-enables
    await act(async () => {
      sel2.toggleInterface(alphaTrackId)
    })
    probe1.rerender()
    probe2.rerender()

    expect(sel1.isInterfaceSelected(alphaTrackId)).toBe(true)
    expect(sel2.isInterfaceSelected(alphaTrackId)).toBe(true)
    expect(sel1.allSelected).toBe(true)
  })
})

describe('useSourceSearch', () => {
  it('manages per-source pagination and appends items on loadMore', async () => {
    const ctx = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()
    const sourceId = ctx.sources.sources[0]!.id

    ctx.sources.register({
      sourceId,
      displayName: 'Test Source',
      capabilities: {
        search: { tracks: true, albums: false, artists: false, playlists: false, fullText: false },
        browse: false,
        recommend: false,
        lyrics: false,
        artwork: false,
        library: { read: false, save: false, playlistWrite: false, playlistReorder: false },
        streaming: { qualities: ['normal'], transcoding: false, seekable: true, urlExpiry: false },
        regional: false,
      },
      auth: {
        flow: { kind: 'none' },
        status: { state: 'authenticated' },
        async signIn() {},
        async signOut() {},
        onStatusChange: () => () => {},
      },
      search: async (_query, page) => {
        if (page?.cursor === '2') {
          return {
            tracks: {
              items: [
                {
                  urn: `BBeBee:${sourceId}:track:t2`,
                  title: 'Track 2',
                  artists: [{ urn: `BBeBee:${sourceId}:artist:a1`, name: 'Artist 1', role: 'main', ordinal: 0 }],
                },
              ],
              hasMore: false,
            },
          }
        }
        return {
          tracks: {
            items: [
              {
                urn: `BBeBee:${sourceId}:track:t1`,
                title: 'Track 1',
                artists: [{ urn: `BBeBee:${sourceId}:artist:a1`, name: 'Artist 1', role: 'main', ordinal: 0 }],
              },
            ],
            hasMore: true,
            cursor: '2',
          },
        }
      },
      getTrack: async (id: string) => ({
        urn: `BBeBee:${sourceId}:track:${id}`,
        title: `Track ${id}`,
        artists: [],
      }),
      resolveStream: async () => ({ kind: 'remote', target: '', seekable: true }),
      ping: async () => true,
    })
    await tick()

    let state!: SourceSearchState
    const probe = harnessFor(() => (state = useSourceSearch(ctx)))

    await act(async () => {
      state.run('test')
      await tick()
      await tick()
    })
    probe.rerender()

    expect(state.status).toBe('ready')
    expect(state.pagination[sourceId]?.hasMore).toBe(true)
    expect(state.pagination[sourceId]?.cursor).toBe('2')
    expect(state.data?.bySource[0]?.result?.tracks?.items).toHaveLength(1)

    // Load more for this source
    await act(async () => {
      await state.loadMore(sourceId)
      await tick()
      await tick()
    })
    probe.rerender()

    expect(state.pagination[sourceId]?.hasMore).toBe(false)
    expect(state.data?.bySource[0]?.result?.tracks?.items).toHaveLength(2)
    expect(state.data?.bySource[0]?.result?.tracks?.items[1]?.title).toBe('Track 2')
  })
})
