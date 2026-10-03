// @vitest-environment jsdom
/**
 * The import and test screens.
 *
 * Rendered against a real `ctx.sources`, because what is worth pinning is the
 * *interaction*: what a paste shows before it commits, and what a source's
 * test areas offer for a given document. A mocked service would define both
 * of those away.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import sourcesPlugin from '@BBeBee/plugin-sources'
import type {
  AlbumDetail,
  BrowseEntry,
  Capabilities,
  LibraryEntry,
  MediaProvider,
  PlayRecord,
  SavedKind,
  SearchQuery,
  SearchResult,
  Track,
} from '@BBeBee/protocol'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { resetSearchSourceSelection } from '@BBeBee/plugin-sources/hooks'
import {
  ImportScreen,
  RecommendAllScreen,
  RecommendScreen,
  RecommendShelfRow,
  SearchScreen,
  SourcesListScreen,
  TestScreen,
  inject,
} from './index.js'

// Testing Library auto-cleans only with vitest globals, which this repo does
// not enable. Without this every render stacks up in one document and
// `screen` queries find the previous test's screen.
afterEach(() => {
  cleanup()
  resetSearchSourceSelection(new Set())
})

/**
 * The context a view actually gets — scoped, not root.
 *
 * ⚠️ This distinction is the whole reason this helper exists. `new Context()`
 * answers `undefined` for a service nobody registered; a **plugin-scoped**
 * context throws `cannot get property "x" without inject` for anything not
 * declared, and a scoped context is the only kind a shell ever hands a view.
 *
 * Every view test in this repo used the root kind, so `ctx.player?.playNow()`
 * read as a safe optional everywhere in CI and threw on a device the moment
 * anyone tapped a track. Rendering against the real shape is what makes that
 * a failing test rather than a bug report.
 */
async function harness(): Promise<{ ctx: Context; admin: Context }> {
  const root = new Context()
  await root.plugin(PathsNode, { root: await tempDir('bbebee-screens') })
  await root.plugin(FsNode)
  await root.plugin(DbNode, { fileName: ':memory:' })
  await root.plugin(sourcesPlugin, {})
  await tick()

  /*
   * Scoped to **this package's own `inject`**, minus `ui` (which the harness
   * does not load and no screen reads).
   *
   * Derived rather than written out, so the two cannot drift: if a screen
   * starts reading a service the package never declared, the read throws here
   * exactly as it would in the app. `admin` is the root, for arranging
   * fixtures the view itself would have no business reaching.
   */
  const declared = inject.filter((name) => name !== 'ui')
  let scoped: Context | undefined
  root.inject(declared, (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('screens harness: no scoped context')
  return { ctx: scoped, admin: root }
}

const DOC = {
  sourceUrl: 'https://music.example.org',
  sourceName: 'Example',
  ruleStream: { url: '={{source.url}}/s' },
}

/**
 * A provider with exactly the features the test asks for.
 *
 * The areas on the test screen follow the provider's shape — capability flags
 * for search/browse/library, method presence for album/artist/playlist/
 * lyrics — so a hand-built provider pins that mapping deterministically,
 * without loading the source runtime to get one.
 */
function providerWith(
  sourceId: string,
  features: { search?: boolean; album?: boolean; lyrics?: boolean; recommend?: boolean },
): MediaProvider {
  const capabilities: Capabilities = {
    search: {
      tracks: features.search ?? false,
      albums: false,
      artists: false,
      playlists: false,
      fullText: false,
    },
    browse: false,
    recommend: features.recommend ?? false,
    lyrics: features.lyrics ?? false,
    artwork: false,
    library: { read: false, save: false, playlistWrite: false, playlistReorder: false },
    streaming: { qualities: ['normal'], transcoding: false, seekable: true, urlExpiry: false },
    regional: false,
  }
  return {
    sourceId,
    displayName: sourceId,
    capabilities,
    auth: {
      flow: { kind: 'none' },
      status: { state: 'authenticated' },
      async signIn() {},
      async signOut() {},
      onStatusChange: () => () => {},
    },
    async getTrack() {
      throw new Error('not needed')
    },
    async resolveStream() {
      return { kind: 'remote', target: 'https://music.example.org/s', seekable: true } as never
    },
    ping: async () => true,
    ...(features.album
      ? {
          getAlbum: async (): Promise<AlbumDetail> => ({
            urn: '',
            id: '',
            title: '',
          }) as never,
        }
      : {}),
    ...(features.recommend
      ? {
          recommend: async (page?: { cursor?: string }) => {
            const n = Number(page?.cursor ?? 1)
            // Ten cards on the first page, two on the second: a short page is
            // how a curated feed says it has run out.
            const count = n === 1 ? 10 : 2
            return {
              items: Array.from({ length: count }, (_, i) =>
                n === 1 && i === 0
                  ? // The shape a dead recommendation arrives in: visible and
                    // named, but a folder with no urn — nothing to open.
                    {
                      id: sourceId + '-invalid-' + i,
                      title: '当前资源无效',
                      subtitle: '合集·失效示例 · sid 2933823',
                      kind: 'folder' as const,
                      leaf: true,
                    }
                  : {
                      id: sourceId + '-card-' + n + '-' + i,
                      title: '合集 ' + n + '-' + i,
                      subtitle: 'UP 主',
                      kind: 'album' as const,
                      leaf: false,
                      urn: 'BBeBee:' + sourceId + ':album:s' + n + '-' + i,
                    },
              ),
              hasMore: true,
              cursor: String(n + 1),
            }
          },
        }
      : {}),
  }
}

function type(testID: string, value: string): void {
  const field = screen.getByTestId(testID) as HTMLTextAreaElement
  // React tracks the last value it wrote, so assigning `.value` directly is
  // ignored on the next render. Going through the native setter is what makes
  // a controlled input see the change.
  const setter = Object.getOwnPropertyDescriptor(
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )!.set!
  setter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ImportScreen', () => {
  it('names what a paste would add, before writing anything', async () => {
    const { ctx } = await harness()
    render(h(ImportScreen, { ctx }))

    await act(async () => {
      type('source-import-input', JSON.stringify([DOC, { ...DOC, sourceUrl: 'https://b.example', sourceName: 'Second' }]))
      await tick()
    })

    expect(screen.getByLabelText('What will be imported')).toBeTruthy()
    expect(screen.getByText('Example')).toBeTruthy()
    expect(screen.getByText('Second')).toBeTruthy()
    expect(ctx.sources.sources, 'nothing written yet').toHaveLength(0)
  })

  it('will not import an empty box', async () => {
    // Disabled rather than erroring: there is nothing to say about a paste
    // that has not happened.
    await harness().then(({ ctx }) => render(h(ImportScreen, { ctx })))
    expect((screen.getByTestId('source-import-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('imports, and says what it did', async () => {
    const { ctx } = await harness()
    render(h(ImportScreen, { ctx }))

    await act(async () => {
      type('source-import-input', JSON.stringify(DOC))
      await tick()
    })
    await act(async () => {
      screen.getByTestId('source-import-submit').click()
      await tick()
      await tick()
    })

    expect(ctx.sources.sources).toHaveLength(1)
    expect(screen.getByText('1 added')).toBeTruthy()
  })

  it('shows every problem with a bad paste, and keeps the text', async () => {
    /*
     * Two things a screen gets wrong here: clearing the box on failure (losing
     * what the user was fixing), and showing one issue at a time (the misery
     * the multi-issue error exists to avoid).
     */
    const { ctx } = await harness()
    render(h(ImportScreen, { ctx }))

    await act(async () => {
      type('source-import-input', '{"sourceName": 42}')
      await tick()
    })
    await act(async () => {
      screen.getByTestId('source-import-submit').click()
      await tick()
      await tick()
    })

    const field = screen.getByTestId('source-import-input') as HTMLTextAreaElement
    expect(field.value, 'still there to fix').toBe('{"sourceName": 42}')
    const shown = document.body.textContent ?? ''
    expect(shown).toContain('sourceUrl')
    expect(shown).toContain('ruleStream')
  })
})

describe('TestScreen', () => {
  it('offers a test area per feature the source implements, and no more', async () => {
    // The areas on screen follow the provider's own shape — and the list of
    // areas *is* the list of features.
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()
    ctx.sources.register(providerWith(ctx.sources.sources[0]!.id, { search: true, album: true }))

    render(h(TestScreen, { ctx, sourceId: ctx.sources.sources[0]!.id }))
    await act(async () => {
      await tick()
    })

    expect(screen.getByLabelText('Source to test')).toBeTruthy()
    expect(screen.getByText('Search')).toBeTruthy()
    expect(screen.getByText('Album')).toBeTruthy()
    expect(screen.getByText('Stream')).toBeTruthy()
    expect(screen.getByText('HTTP request — through this source\'s own client')).toBeTruthy()
    expect(screen.getByText("Script — the document's functions are in scope")).toBeTruthy()
    expect(screen.queryByText('Lyrics')).toBeNull()
    expect(screen.queryByText('Artist')).toBeNull()
    expect(screen.queryByText('Playlist')).toBeNull()
    expect(screen.queryByText('Library list')).toBeNull()
  })

  it('defaults the selector to the first source and shows it', async () => {
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify([DOC, { ...DOC, sourceUrl: 'https://b.example', sourceName: 'Second' }]))
    await tick()

    render(h(TestScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    const select = screen.getByLabelText('Source to test') as HTMLSelectElement
    expect(select.value).toBe(ctx.sources.sources[0]!.id)
    expect(select.options).toHaveLength(2)
  })

  it('says there is no trace yet rather than showing an empty list', async () => {
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()

    render(h(TestScreen, { ctx, sourceId: ctx.sources.sources[0]!.id }))
    await act(async () => {
      await tick()
    })
    expect(screen.getByText('No trace yet')).toBeTruthy()
  })
})

describe('SearchScreen', () => {
  const track = (sourceId: string, id: string, title: string): Track => ({
    urn: `BBeBee:${sourceId}:track:${id}`,
    title,
    artists: [
      { urn: `BBeBee:${sourceId}:artist:${id}`, name: 'Someone', role: 'main', ordinal: 0 },
    ],
  })

  /** A provider whose only feature is search — the screen's one dependency. */
  function searchingProvider(
    sourceId: string,
    search: (query: SearchQuery) => Promise<SearchResult>,
  ): MediaProvider {
    const base = providerWith(sourceId, {})
    return {
      ...base,
      capabilities: {
        ...base.capabilities,
        search: { tracks: true, albums: false, artists: false, playlists: false, fullText: false },
      },
      search,
    }
  }

  const DOCS = [
    { sourceUrl: 'https://alpha.example', sourceName: 'Alpha', ruleStream: { url: '={{source.url}}/s' } },
    { sourceUrl: 'https://beta.example', sourceName: 'Beta', ruleStream: { url: '={{source.url}}/s' } },
  ]

  async function withTwoSources(admin: Context): Promise<void> {
    await admin.sources.import(JSON.stringify(DOCS))
    await tick()
  }

  function registerHits(
    admin: Context,
    id: string,
    title: string,
  ): void {
    admin.sources.register(
      searchingProvider(id, async () => ({ tracks: { items: [track(id, '1', title)], hasMore: false } })),
    )
  }

  it('shows the search box and the source toggles before anything is searched', async () => {
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const [alpha, beta] = admin.sources.sources.map((record) => record.id)

    render(h(SearchScreen, { ctx }))

    expect(screen.getByTestId('search-input')).toBeTruthy()
    expect(screen.getByTestId(`search-source-${alpha}-track`)).toBeTruthy()
    expect(screen.getByTestId(`search-source-${beta}-track`)).toBeTruthy()
    // Nothing asked, nothing shown — and no empty-results screen either.
    expect(screen.queryByLabelText('Search results')).toBeNull()
  })

  it('lists each selected source under its own heading', async () => {
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const [alpha, beta] = admin.sources.sources
    registerHits(admin, alpha!.id, 'Alpha Song')
    registerHits(admin, beta!.id, 'Beta Song')
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx }))
      await act(async () => {
        type('search-input', 'song')
      })
      await act(async () => {
        screen.getByTestId('search-submit').click()
        await tick()
        await tick()
      })

      const shown = document.body.textContent ?? ''
      expect(shown).toContain('Alpha')
      expect(shown).toContain('Beta')
      expect(shown).toContain('Alpha Song')
      expect(shown).toContain('Beta Song')
      expect(shown).toContain('1 track')
    })
  })

  it('reports a failing source instead of dropping it, and still shows the rest', async () => {
    /*
     * The reason `searchAll` returns per-source entries and never merges: a
     * backend that is down must be visible. A merged list would make "Alpha is
     * broken" and "Alpha has no match" the same screen.
     */
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const [alpha, beta] = admin.sources.sources
    admin.sources.register(
      searchingProvider(alpha!.id, async () => {
        throw new Error('Alpha is down')
      }),
    )
    registerHits(admin, beta!.id, 'Beta Song')
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx }))
      await act(async () => {
        type('search-input', 'song')
      })
      await act(async () => {
        screen.getByTestId('search-submit').click()
        await tick()
        await tick()
      })

      const shown = document.body.textContent ?? ''
      expect(shown).toContain('Alpha is down')
      expect(shown).toContain('Beta Song')
    })
  })

  it('only asks the sources the user left toggled on', async () => {
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const [alpha, beta] = admin.sources.sources
    registerHits(admin, alpha!.id, 'Alpha Song')
    registerHits(admin, beta!.id, 'Beta Song')
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx }))
      await act(async () => {
        screen.getByTestId(`search-source-${alpha!.id}-track`).click()
      })
      await act(async () => {
        type('search-input', 'song')
      })
      await act(async () => {
        screen.getByTestId('search-submit').click()
        await tick()
        await tick()
      })

      const shown = document.body.textContent ?? ''
      expect(shown).toContain('Beta Song')
      expect(shown, 'the toggled-off source was not asked').not.toContain('Alpha Song')
    })
  })

  it('gives songs and artists their own toggle, and passes the halves through', async () => {
    /*
     * A backend whose user search is a separate endpoint — Bilibili, for one —
     * has two searchable interfaces. Turning the artist half off must reach
     * the provider as `types: ['track']`, so it does not fetch the second
     * document; that per-source filter is what the interface toggles *mean*.
     */
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const alpha = admin.sources.sources[0]!

    const seen: SearchQuery[] = []
    const base = providerWith(alpha.id, {})
    admin.sources.register({
      ...base,
      capabilities: {
        ...base.capabilities,
        search: { tracks: true, albums: false, artists: true, playlists: false, fullText: false },
      },
      search: async (query) => {
        seen.push(query)
        return { tracks: { items: [track(alpha.id, '1', 'Alpha Song')], hasMore: false } }
      },
    })
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx }))
      expect(screen.getByTestId(`search-source-${alpha.id}-track`)).toBeTruthy()
      const artists = screen.getByTestId(`search-source-${alpha.id}-artist`)

      await act(async () => {
        artists.click()
      })
      await act(async () => {
        type('search-input', 'song')
      })
      await act(async () => {
        screen.getByTestId('search-submit').click()
        await tick()
        await tick()
      })

      expect(seen).toHaveLength(1)
      expect(seen[0]!.types, 'artist half turned off').toEqual(['track'])
    })
  })

  it('automatically searches and filters by query and sourceIds from external navigation', async () => {
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const [alpha, beta] = admin.sources.sources
    registerHits(admin, alpha!.id, 'Alpha Song')
    registerHits(admin, beta!.id, 'Beta Song')
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx, query: 'song', sourceIds: [beta!.id] }))
      await act(async () => {
        await tick()
        await tick()
      })

      const shown = document.body.textContent ?? ''
      expect(shown).toContain('Beta Song')
      expect(shown, 'only the specified source was asked').not.toContain('Alpha Song')
    })
  })

  it('allows each source panel to collapse and expand', async () => {
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const [alpha] = admin.sources.sources
    registerHits(admin, alpha!.id, 'Alpha Song')
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx }))
      await act(async () => {
        type('search-input', 'song')
      })
      await act(async () => {
        screen.getByTestId('search-submit').click()
        await tick()
        await tick()
      })

      expect(document.body.textContent).toContain('Alpha Song')

      const header = screen.getByTestId(`source-panel-header-${alpha!.id}`)
      expect(header.getAttribute('aria-expanded')).toBe('true')
      expect(header.style.position).toBe('sticky')
      expect(header.style.top).toBe('0px')

      const body = screen.getByTestId(`source-panel-body-${alpha!.id}`)
      expect(body.style.overflowY).toBe('auto')

      // Click the panel header to collapse
      await act(async () => {
        header.click()
        await tick()
      })
      expect(header.getAttribute('aria-expanded')).toBe('false')

      // Click again to expand
      await act(async () => {
        header.click()
        await tick()
      })
      expect(header.getAttribute('aria-expanded')).toBe('true')
      expect(document.body.textContent).toContain('Alpha Song')
    })
  })

  it('renders a load more button and fetches the next page for that source', async () => {
    const { ctx, admin } = await harness()
    await withTwoSources(admin)
    const [alpha] = admin.sources.sources

    let pageCalled = 0
    admin.sources.register({
      ...providerWith(alpha!.id, { search: true }),
      search: async (query, page) => {
        pageCalled++
        if (page?.cursor === '2') {
          return {
            tracks: {
              items: [track(alpha!.id, '2', 'Alpha More Song')],
              hasMore: false,
            },
          }
        }
        return {
          tracks: {
            items: [track(alpha!.id, '1', 'Alpha Initial Song')],
            hasMore: true,
            cursor: '2',
          },
        }
      },
    })
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx }))
      await act(async () => {
        type('search-input', 'song')
      })
      await act(async () => {
        screen.getByTestId('search-submit').click()
        await tick()
        await tick()
      })

      expect(document.body.textContent).toContain('Alpha Initial Song')
      expect(document.body.textContent).not.toContain('Alpha More Song')

      const loadMoreBtn = screen.getByTestId(`search-load-more-${alpha!.id}`)
      expect(loadMoreBtn).toBeTruthy()

      await act(async () => {
        loadMoreBtn.click()
        await tick()
        await tick()
      })

      expect(pageCalled).toBe(2)
      expect(document.body.textContent).toContain('Alpha Initial Song')
      expect(document.body.textContent).toContain('Alpha More Song')
      expect(document.body.textContent).toContain('已加载全部结果')
    })
  })

  it('plays only the single track in queue when a search track is clicked', async () => {
    const { ctx, admin } = await harness()
    const playerStub = new PlayerStub(admin)
    await withTwoSources(admin)
    const [alpha] = admin.sources.sources
    admin.sources.register({
      ...providerWith(alpha!.id, { search: true }),
      search: async () => ({
        tracks: {
          items: [
            track(alpha!.id, '1', 'Alpha Single Track 1'),
            track(alpha!.id, '2', 'Alpha Single Track 2'),
          ],
          hasMore: false,
        },
      }),
    })
    await tick()

    await withListLayout(async () => {
      render(h(SearchScreen, { ctx }))
      await act(async () => {
        type('search-input', 'song')
      })
      await act(async () => {
        screen.getByTestId('search-submit').click()
        await tick()
        await tick()
      })

      expect(document.body.textContent).toContain('Alpha Single Track 1')
      expect(document.body.textContent).toContain('Alpha Single Track 2')

      const trackRow = screen.getByText('Alpha Single Track 1')
      await act(async () => {
        trackRow.click()
        await tick()
      })

      expect(playerStub.playFromContextCalls).toHaveLength(1)
      const call = playerStub.playFromContextCalls[0]!
      expect(call.urn).toBe(track(alpha!.id, '1', 'Alpha Single Track 1').urn)
      expect(call.contextUrns).toEqual([track(alpha!.id, '1', 'Alpha Single Track 1').urn])
    })
  })
})

describe('SourcesListScreen', () => {
  it('toggles a source off and on, and the row follows', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOC))
    await tick()
    const id = admin.sources.sources[0]!.id

    render(h(SourcesListScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      screen.getByTestId(`sources-list-toggle-${id}`).click()
      await tick()
    })
    expect(ctx.sources.source(id)?.enabled).toBe(false)

    await act(async () => {
      screen.getByTestId(`sources-list-toggle-${id}`).click()
      await tick()
    })
    expect(ctx.sources.source(id)?.enabled).toBe(true)
  })

  it('deletes a source only after the confirmation is pressed', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOC))
    await tick()
    const id = admin.sources.sources[0]!.id

    render(h(SourcesListScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    // The first press asks; it must not take the cached library with it.
    await act(async () => {
      screen.getByTestId(`sources-list-delete-${id}`).click()
      await tick()
    })
    expect(ctx.sources.source(id), 'the trash can only opens the question').toBeTruthy()

    await act(async () => {
      screen.getByTestId(`sources-list-delete-confirm-${id}`).click()
      await tick()
      await tick()
    })
    expect(ctx.sources.source(id)).toBeUndefined()
  })

  it('shows the local source its folders, with folder controls', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOC))
    await admin.db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES ('local', 'bbebee://local/local', 'This device', '{}', 'h', 0, 0)`,
    )
    // Refreshes the service's mirror of the table.
    await admin.sources.setEnabled('local', true)

    const calls: string[] = []
    class ScannerStub extends Service {
      constructor(c: Context) {
        super(c, 'scanner')
      }
      specifiedDirs = [
        { id: 'dir-1', uri: 'file:///music', recursive: true, enabled: true },
      ] as never
      addSpecifiedDir = async () => {
        throw new Error('not needed')
      }
      removeSpecifiedDir = async (dirId: string) => void calls.push(`remove:${dirId}`)
      setEnabled = async (dirId: string, on: boolean) => void calls.push(`enable:${dirId}:${on}`)
      scan = async () => ({ added: 0, updated: 0, removed: 0, errors: 0 })
      cancel = () => {}
      progress = undefined
    }
    await admin.plugin(ScannerStub)
    await tick()

    render(h(SourcesListScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(screen.getByText('file:///music')).toBeTruthy()
    // The local row has no whole-source switch — its folders are the elements.
    expect(screen.queryByTestId('sources-list-toggle-local')).toBeNull()

    await act(async () => {
      screen.getByTestId('source-folder-toggle-dir-1').click()
      await tick()
    })
    await act(async () => {
      screen.getByTestId('source-folder-remove-dir-1').click()
      await tick()
    })
    expect(calls).toEqual(['enable:dir-1:false', 'remove:dir-1'])
  })
})

describe('RecommendScreen', () => {
  it('shows one shelf per recommend-capable source, and only its first page', async () => {
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify([DOC, { ...DOC, sourceUrl: 'https://b.example', sourceName: 'Second' }]))
    await tick()
    const [first, second] = ctx.sources.sources.map((r) => r.id)
    ctx.sources.register(providerWith(first!, { recommend: true }))
    ctx.sources.register(providerWith(second!, { search: true }))

    render(h(RecommendScreen, { ctx }))
    await act(async () => {
      await tick()
      await tick()
    })

    // A source with the capability gets a shelf; one without gets nothing —
    // no shelf and no "show all" to a page that would say "cannot recommend".
    expect(screen.getByTestId('recommend-shelf-' + first!)).toBeTruthy()
    expect(screen.queryByTestId('recommend-shelf-' + second!)).toBeNull()
    expect(screen.getAllByTestId('recommend-card')).toHaveLength(10)
    expect(screen.getByTestId('recommend-show-all')).toBeTruthy()
  })

  it('renders an invalid-resource placeholder as inert, without a detail hop', async () => {
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()
    ctx.sources.register(providerWith(ctx.sources.sources[0]!.id, { recommend: true }))

    render(h(RecommendScreen, { ctx }))
    await act(async () => {
      await tick()
      await tick()
    })

    // The last card of the fake feed is a folder-kind placeholder: visible,
    // named, and a click that goes nowhere — the album page is for albums.
    const cards = screen.getAllByTestId('recommend-card')
    expect(cards).toHaveLength(10)
    expect(screen.getByText('当前资源无效')).toBeTruthy()
    expect(screen.getByText(/sid 2933823/)).toBeTruthy()
  })

  it('says when nothing recommends', async () => {
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()
    ctx.sources.register(providerWith(ctx.sources.sources[0]!.id, { search: true }))

    render(h(RecommendScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(screen.getByText('暂无推荐')).toBeTruthy()
  })

  it('shows recent played tracks albums row before sources when history exists', async () => {
    const { ctx, admin } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()
    const sourceId = ctx.sources.sources[0]!.id

    const playerStub = new PlayerStub(admin)
    playerStub.history = [
      {
        id: 'h1',
        trackUrn: `BBeBee:${sourceId}:track:t1`,
        startedAt: 1,
        completed: true,
        skipped: false,
        msPlayed: 1000,
      },
    ]

    await admin.db.exec(
      `INSERT INTO albums (urn, source_id, remote_id, title, sort_title, year, artwork_id, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [`BBeBee:${sourceId}:album:a1`, sourceId, 'a1', 'Recent Album 1', 'Recent Album 1', 2024, null, Date.now()],
    )
    await admin.db.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, sort_title, album_urn, track_no, duration_ms, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`BBeBee:${sourceId}:track:t1`, sourceId, 't1', 'Track 1', 'Track 1', `BBeBee:${sourceId}:album:a1`, 1, 180000, Date.now()],
    )

    render(h(RecommendScreen, { ctx }))
    await act(async () => {
      await tick()
      await tick()
      await tick()
    })

    expect(screen.getByTestId('recommend-shelf-recent-albums')).toBeTruthy()
    expect(screen.getByText('最近播放 · 专辑')).toBeTruthy()
    expect(screen.getByText('Recent Album 1')).toBeTruthy()
  })

  it('shows random favorite tracks albums row before sources when saved tracks exist', async () => {
    const { ctx, admin } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()
    const sourceId = ctx.sources.sources[0]!.id

    const libraryStub = new LibraryStub(admin)
    libraryStub.saved = [
      {
        urn: `BBeBee:${sourceId}:track:fav1`,
        kind: 'track',
        sourceId,
        addedAt: Date.now(),
      },
    ]

    await admin.db.exec(
      `INSERT INTO albums (urn, source_id, remote_id, title, sort_title, year, artwork_id, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [`BBeBee:${sourceId}:album:fav_a1`, sourceId, 'fav_a1', 'Favorite Album 1', 'Favorite Album 1', 2023, null, Date.now()],
    )
    await admin.db.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, sort_title, album_urn, track_no, duration_ms, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`BBeBee:${sourceId}:track:fav1`, sourceId, 'fav1', 'Fav Track 1', 'Fav Track 1', `BBeBee:${sourceId}:album:fav_a1`, 1, 200000, Date.now()],
    )

    render(h(RecommendScreen, { ctx }))
    await act(async () => {
      await tick()
      await tick()
      await tick()
    })

    expect(screen.getByTestId('recommend-shelf-favorite-albums')).toBeTruthy()
    expect(screen.getByText('收藏随选 · 专辑')).toBeTruthy()
    expect(screen.getByText('Favorite Album 1')).toBeTruthy()
  })
})

describe('RecommendShelfRow', () => {
  it('shows edge peek panels always when overflow exists; arrows fade in on hover', async () => {
    const { ctx } = await harness()
    const entries: BrowseEntry[] = Array.from({ length: 15 }, (_, i) => ({
      id: `entry-${i}`,
      title: `Album ${i}`,
      kind: 'album',
      leaf: false,
      urn: `BBeBee:Example:album:${i}`,
    }))

    render(
      h(RecommendShelfRow, {
        ctx,
        title: '测试推荐行',
        testID: 'test-shelf',
        entries,
        onOpenCard: () => {},
      }),
    )

    const scrollEl = screen.getByTestId('test-shelf-scroll')
    Object.defineProperty(scrollEl, 'scrollWidth', { configurable: true, value: 2000 })
    Object.defineProperty(scrollEl, 'clientWidth', { configurable: true, value: 500 })
    Object.defineProperty(scrollEl, 'scrollLeft', { configurable: true, writable: true, value: 0 })
    const scrollBySpy = vi.fn()
    scrollEl.scrollBy = scrollBySpy

    // Trigger a scroll event so updateScrollState re-reads the new dimensions.
    fireEvent.scroll(scrollEl)

    const shelfEl = screen.getByTestId('test-shelf')

    // scrollLeft == 0: canScrollLeft is false, canScrollRight is true.
    // Right panel visible immediately (no hover needed); left panel absent.
    expect(screen.queryByTestId('recommend-fold-left')).toBeNull()
    expect(screen.getByTestId('recommend-fold-right')).toBeTruthy()

    // Arrow button exists in DOM; its layer has opacity:0 before hover
    const rightArrowLayer = screen.getByTestId('recommend-arrow-layer-right')
    expect(rightArrowLayer.style.opacity).toBe('0')
    expect(screen.getByTestId('recommend-scroll-right')).toBeTruthy()

    // Hover on shelf — arrow layer becomes opaque
    fireEvent.mouseEnter(shelfEl)
    expect(rightArrowLayer.style.opacity).toBe('1')

    // Clicking right scroll arrow calls scrollBy
    fireEvent.click(screen.getByTestId('recommend-scroll-right'))
    expect(scrollBySpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))

    // Simulate scrolled to middle (canScrollLeft and canScrollRight both true)
    Object.defineProperty(scrollEl, 'scrollLeft', { configurable: true, writable: true, value: 600 })
    fireEvent.scroll(scrollEl)

    // Both edge panels visible regardless of hover state
    expect(screen.getByTestId('recommend-fold-left')).toBeTruthy()
    expect(screen.getByTestId('recommend-scroll-left')).toBeTruthy()
    expect(screen.getByTestId('recommend-fold-right')).toBeTruthy()
    expect(screen.getByTestId('recommend-scroll-right')).toBeTruthy()

    // Clicking left scroll arrow calls scrollBy with negative distance
    fireEvent.click(screen.getByTestId('recommend-scroll-left'))
    expect(scrollBySpy).toHaveBeenCalledTimes(2)

    // Mouse leave: edge panels stay in DOM; arrow layers fade back to opacity 0
    fireEvent.mouseLeave(shelfEl)
    expect(screen.getByTestId('recommend-fold-left')).toBeTruthy()
    expect(screen.getByTestId('recommend-fold-right')).toBeTruthy()
    const leftArrowLayer = screen.getByTestId('recommend-arrow-layer-left')
    expect(leftArrowLayer.style.opacity).toBe('0')
    expect(rightArrowLayer.style.opacity).toBe('0')
  })
})

class PlayerStub extends Service {
  history: PlayRecord[] = []
  playFromContextCalls: { urn: string; contextUrns?: readonly string[]; opts?: unknown }[] = []
  constructor(ctx: Context) {
    super(ctx, 'player')
  }
  async getHistory() {
    return this.history
  }
  async playFromContext(urn: string, contextUrns?: readonly string[], opts?: unknown) {
    this.playFromContextCalls.push({ urn, contextUrns, opts })
  }
}

class LibraryStub extends Service {
  saved: LibraryEntry[] = []
  constructor(ctx: Context) {
    super(ctx, 'library')
  }
  async listSaved(kind?: SavedKind) {
    const items = kind ? this.saved.filter((s) => s.kind === kind) : this.saved
    return { items, total: items.length, hasMore: false }
  }
}

describe('RecommendAllScreen', () => {
  it('piles the feed into a grid and stands show-more down on a short page', async () => {
    const { ctx } = await harness()
    await ctx.sources.import(JSON.stringify(DOC))
    await tick()
    ctx.sources.register(providerWith(ctx.sources.sources[0]!.id, { recommend: true }))

    render(h(RecommendAllScreen, { ctx, sourceId: ctx.sources.sources[0]!.id, name: 'Example' }))
    await act(async () => {
      await tick()
      await tick()
      await tick()
    })

    // One step = two feed pages: ten cards, then the short page that says
    // the list is over — twelve cards, and no control left to press.
    expect(screen.getAllByTestId('recommend-card')).toHaveLength(12)
    expect(screen.queryByTestId('recommend-show-more')).toBeNull()
  })
})
