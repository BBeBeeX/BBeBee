// @vitest-environment jsdom
/**
 * The mobile library screen, rendered.
 *
 * ⚠️ **This package had no tests, and that is how the device run went wrong.**
 * Its desktop twin was covered, and the two were assumed to behave the same
 * because they are written from the same hooks — but the shared assumption
 * they both broke was about the *context*, not about either screen.
 *
 * Two things are pinned here, and both are about the context a view is handed:
 *
 *  - It is **scoped**, not root. `new Context()` answers `undefined` for a
 *    service nobody registered; a plugin-scoped context *throws* for anything
 *    not injected. Every view test in this repo used the root kind, so
 *    `ctx.player?.playNow()` read as a safe optional in CI and threw on a
 *    phone the moment anyone tapped a track.
 *  - A context is not a React node. Handing one to React makes React read
 *    `$$typeof` on it, and on a scoped context that read throws too — which
 *    is what `[Error: cannot get property "$$typeof" without inject]` was.
 *
 * React Native is injected here as DOM host components, which is the same seam
 * `apps/mobile` uses to hand over the real `react-native`.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { DbNode } from '@BBeBee/core-db-desktop'
import sourcesPlugin from '@bbebee/plugin-sources'
import type {
  BrowseResult,
  Capabilities,
  HttpRequest,
  HttpResponse,
  MediaProvider,
  SearchQuery,
  SearchResult,
  SecretsService,
  Track,
} from '@BBeBee/protocol'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import httpPlugin from '@bbebee/core-http-desktop'
import sourceRuntime from '@bbebee/plugin-source-runtime'
import { RecommendAllScreen, RecommendScreen, SearchScreen, SourceConfigureModal, TestScreen, inject } from './index.js'
import sourcesCatalogue from '../../../feature/plugin-i18n/src/locales/sources.json'
import appCatalogue from '../../../feature/plugin-i18n/src/locales/en.json'

/**
 * i18n service for tests: serves the real `sources` + `app` catalogues so
 * components under test render the same copy the app shows.
 */
class DefaultI18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  private listeners = new Set<(locale: string) => void>()
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0) return key
    const ns = key.slice(0, sep)
    const catalogue = ns === 'sources' ? sourcesCatalogue.en : ns === 'app' ? appCatalogue : undefined
    if (!catalogue) return key
    let cur: unknown = catalogue
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
  }
  onLocaleChange = (cb: (locale: string) => void): (() => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }
}

afterEach(cleanup)

/** A fake native host: an element that keeps the RN props it was given. */
function hostComponent(name: string) {
  const tag = name === 'TextInput' ? 'input' : 'div'
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, onPress, testID, onChangeText } = props
    return h(
      tag,
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        value: typeof props.value === 'string' ? props.value : undefined,
        onClick:
          typeof onPress === 'function'
            ? (e: any) => {
                e?.stopPropagation?.()
                ;(onPress as () => void)()
              }
            : undefined,
        onChange:
          typeof onChangeText === 'function'
            ? (e: any) => {
                const val = e?.target?.value ?? String(e)
                ;(onChangeText as (v: string) => void)(val)
              }
            : undefined,
        onInput:
          typeof onChangeText === 'function'
            ? (e: any) => {
                const val = e?.target?.value ?? String(e)
                ;(onChangeText as (v: string) => void)(val)
              }
            : undefined,
      },
      tag === 'input' ? undefined : children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  // FlashList takes `data`/`renderItem`, not children, so it needs its own.
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

/** The scoped context a shell hands a view, plus the root for fixtures. */
async function harness(options?: {
  httpHandler?: (req: HttpRequest) => Promise<HttpResponse>
}): Promise<{ ctx: Context; admin: Context; secretsStore: Map<string, string> }> {
  const root = new Context()
  await root.plugin(PathsNode, { root: await tempDir('bbebee-mobile-screens') })
  await root.plugin(FsNode)
  await root.plugin(DbNode, { fileName: ':memory:' })

  const secretsStore = new Map<string, string>()
  const createSecrets = (prefix = ''): SecretsService => ({
    isHardwareBacked: true,
    maxValueBytes: 2048,
    async get(key: string) {
      return secretsStore.get(`${prefix}:${key}`)
    },
    async set(key: string, value: string) {
      secretsStore.set(`${prefix}:${key}`, value)
    },
    async delete(key: string) {
      secretsStore.delete(`${prefix}:${key}`)
    },
    async clear() {
      for (const k of secretsStore.keys()) {
        if (k.startsWith(`${prefix}:`)) secretsStore.delete(k)
      }
    },
    namespace(ns: string) {
      return createSecrets(`${prefix}:${ns}`)
    },
  })
  root.provide('secrets', createSecrets('test'))

  if (options?.httpHandler) {
    const handler = options.httpHandler
    root.provide('http', Object.assign(handler, {
      cookies: {
        jar: () => ({
          ready: Promise.resolve(),
          get: async () => [],
          set: async () => {},
          all: async () => [],
          destroy: async () => {},
        }),
      },
    }))
  }

  await root.plugin(sourcesPlugin, {})
  await root.plugin(DefaultI18nStub)
  await tick()

  /*
   * Scoped to **this package's own `inject`**, minus `ui`. Derived rather than
   * written out, so a screen that starts reading an undeclared service throws
   * here exactly as it would in the app.
   */
  const declared = inject.filter((name) => name !== 'ui')
  let scoped: Context | undefined
  root.inject(declared, (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('mobile screens harness: no scoped context')
  return { ctx: scoped, admin: root, secretsStore }
}

/**
 * The same, plus the source runtime — without it `ctx.sources.debug` reports
 * "no source" rather than running anything. This build has no sandbox, which
 * is exactly the mobile situation the test screen has to degrade on.
 */
async function harnessWithRuntime(): Promise<{ ctx: Context; admin: Context }> {
  const { ctx, admin } = await harness()
  await admin.plugin(httpPlugin, {})
  await admin.plugin(sourceRuntime, {})
  await tick()
  await tick()
  return { ctx, admin }
}

/* ── the source list and the test screen ────────────────────────────────── */

const EXAMPLE_DOC = {
  sourceUrl: 'https://music.example.org',
  sourceName: 'Example',
  ruleStream: { url: '={{source.url}}/stream' },
}

describe('SourceConfigureModal on mobile', () => {
  it('configures per-source parameters (host, secrets, vars), tests connection 3-state, and saves on mobile', async () => {
    let pingResponse: HttpResponse | null = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        'subsonic-response': {
          status: 'ok',
          version: '1.16.1',
        },
      }),
      ok: true,
      text: async () =>
        JSON.stringify({
          'subsonic-response': {
            status: 'ok',
            version: '1.16.1',
          },
        }),
      json: async () => ({
        'subsonic-response': {
          status: 'ok',
          version: '1.16.1',
        },
      }),
    } as unknown as HttpResponse

    const { ctx, admin, secretsStore } = await harness({
      httpHandler: async () => {
        if (!pingResponse) throw new Error('Network unreachable')
        return pingResponse
      },
    })

    const SUBSONIC_DOC = {
      sourceUrl: 'https://subsonic.example.com',
      sourceName: 'My Subsonic',
      sourceGroup: 'self-hosted,subsonic',
      params: ['sourceurl', 'user', 'password', 'clientApp'],
      loginUi: [
        { id: 'user', label: 'Username', type: 'text' },
        { id: 'password', label: 'Password', type: 'password' },
      ],
      ruleStream: { url: '={{source.url}}/rest/stream' },
    }

    const report = await admin.sources.import(JSON.stringify(SUBSONIC_DOC))
    const id = report.added[0]!.id
    await tick()

    let open = true
    const { container, rerender } = render(
      h(SourceConfigureModal, { ctx, sourceId: id, open, onClose: () => { open = false } }),
    )
    await act(async () => {
      await tick()
    })

    expect(container.querySelector('[data-testid="source-configure-modal"]')).toBeTruthy()

    const type = (testID: string, val: string) => {
      const field = container.querySelector(`[data-testid="${testID}"]`) as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(field, val)
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('change', { bubbles: true }))
    }

    // 1. Check & change host, user, password
    await act(async () => {
      type('source-configure-host', 'https://new-subsonic.server.org')
      type('source-configure-user', 'adminUser')
      type('source-configure-password', 'secretPass123')
      await tick()
    })

    // 2. Set declared custom var
    await act(async () => {
      type('source-configure-var-clientApp', 'BBeBeeTest')
      await tick()
    })

    // 3. Test Connection - State 1: OK
    await act(async () => {
      ;(container.querySelector('[data-testid="source-configure-test-btn"]') as HTMLElement).click()
      await tick()
      await tick()
    })
    expect(container.querySelector('[data-testid="source-configure-ping-result"]')?.textContent).toContain(
      'Connected',
    )
    expect(container.querySelector('[data-testid="source-configure-ping-result"]')?.textContent).toContain(
      '1.16.1',
    )

    // Test Connection - State 2: Auth Failed
    pingResponse = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        'subsonic-response': {
          status: 'failed',
          error: { code: 40, message: 'Wrong username or password' },
        },
      }),
      ok: true,
      text: async () =>
        JSON.stringify({
          'subsonic-response': {
            status: 'failed',
            error: { code: 40, message: 'Wrong username or password' },
          },
        }),
      json: async () => ({
        'subsonic-response': {
          status: 'failed',
          error: { code: 40, message: 'Wrong username or password' },
        },
      }),
    } as unknown as HttpResponse

    await act(async () => {
      ;(container.querySelector('[data-testid="source-configure-test-btn"]') as HTMLElement).click()
      await tick()
      await tick()
    })
    expect(container.querySelector('[data-testid="source-configure-ping-result"]')?.textContent).toContain(
      'Authentication Failed',
    )

    // Test Connection - State 3: Network Error
    pingResponse = null
    await act(async () => {
      ;(container.querySelector('[data-testid="source-configure-test-btn"]') as HTMLElement).click()
      await tick()
      await tick()
    })
    expect(container.querySelector('[data-testid="source-configure-ping-result"]')?.textContent).toContain(
      'Network Error',
    )

    // 4. Save
    await act(async () => {
      ;(container.querySelector('[data-testid="source-configure-save-btn"]') as HTMLElement).click()
      await tick()
      await tick()
    })

    // Verify onClose was called
    expect(open).toBe(false)
    rerender(h(SourceConfigureModal, { ctx, sourceId: id, open, onClose: () => { open = false } }))
    expect(container.querySelector('[data-testid="source-configure-modal"]')).toBeNull()

    // Verify source host updated
    expect(admin.sources.source(id)?.sourceUrl).toBe('https://new-subsonic.server.org')

    // Verify allowed hosts recalculated
    const allowed = admin.sources.source(id)?.allowedHosts ?? []
    expect(allowed).toContain('new-subsonic.server.org')

    // Verify secrets saved to secrets store (keychain)
    expect(secretsStore.get(`test:${id}:user`)).toBe('adminUser')
    expect(secretsStore.get(`test:${id}:password`)).toBe('secretPass123')

    // Verify vars saved to database
    const vars = await admin.sources.readVars(id)
    expect(vars['clientApp']).toBe('BBeBeeTest')
    // Secrets must NOT be in source_vars
    expect(vars['user']).toBeUndefined()
    expect(vars['password']).toBeUndefined()
  })
})

describe('TestScreen on mobile', () => {
  it('shows both probes and streams the script step into the trace', async () => {
    const { ctx, admin } = await harnessWithRuntime()
    await admin.sources.import(JSON.stringify(EXAMPLE_DOC))
    await tick()
    const sourceId = admin.sources.sources[0]!.id

    const { container } = render(h(TestScreen, { ctx, sourceId }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('HTTP request')
    expect(container.textContent).toContain('Script')

    // This build has no sandbox — the honest mobile situation today — so
    // running the script reports that inline rather than failing silently.
    const run = container.querySelector('[data-testid="test-run-js"]') as HTMLElement
    expect(run, 'the run button is on screen').toBeTruthy()
    await act(async () => {
      run.click()
      await tick()
      await tick()
    })
    expect(container.textContent).toContain('no JavaScript sandbox')
  })
})

describe('SearchScreen on mobile', () => {
  const track = (sourceId: string, id: string, title: string): Track => ({
    urn: `BBeBee:${sourceId}:track:${id}`,
    title,
    artists: [
      { urn: `BBeBee:${sourceId}:artist:${id}`, name: 'Someone', role: 'main', ordinal: 0 },
    ],
  })

  function searchingProvider(
    sourceId: string,
    search: (query: SearchQuery) => Promise<SearchResult>,
  ): MediaProvider {
    const capabilities: Capabilities = {
      search: { tracks: true, albums: false, artists: false, playlists: false, fullText: false },
      browse: false,
      recommend: false,
      lyrics: false,
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
        return { kind: 'remote', target: 'https://a.example/s', seekable: true } as never
      },
      ping: async () => true,
      search,
    }
  }

  const DOCS = [
    { sourceUrl: 'https://alpha.example', sourceName: 'Alpha', ruleStream: { url: '={{source.url}}/s' } },
    { sourceUrl: 'https://beta.example', sourceName: 'Beta', ruleStream: { url: '={{source.url}}/s' } },
  ]

  it('shows the box and the source toggles before a search', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOCS))
    await tick()
    const { container } = render(h(SearchScreen, { ctx }))
    await act(async () => {
      await tick()
    })
    expect(container.querySelector('[data-testid="search-input"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="search-submit"]')).toBeTruthy()
    expect(
      container.querySelector(`[data-testid="search-source-${admin.sources.sources[0]!.id}-track"]`),
    ).toBeTruthy()
    // Nothing asked yet: no results section, not an empty one.
    expect(container.textContent).not.toContain('Nothing found')
  })

  it('lists each source’s hits under its own heading', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOCS))
    await tick()
    const [alpha, beta] = admin.sources.sources
    admin.sources.register(
      searchingProvider(alpha!.id, async () => ({
        tracks: { items: [track(alpha!.id, '1', 'Alpha Song')], hasMore: false },
      })),
    )
    admin.sources.register(
      searchingProvider(beta!.id, async () => ({
        tracks: { items: [track(beta!.id, '1', 'Beta Song')], hasMore: false },
      })),
    )
    await tick()

    const { container } = render(h(SearchScreen, { ctx, query: 'song' }))
    await act(async () => {
      ;(container.querySelector('[data-testid="search-submit"]') as HTMLElement).click()
      await tick()
      await tick()
    })

    expect(container.textContent).toContain('Alpha')
    expect(container.textContent).toContain('Beta')
    expect(container.textContent).toContain('Alpha Song')
    expect(container.textContent).toContain('Beta Song')
    expect(container.textContent).toContain('1 track')
  })

  it('reports a failing source instead of dropping it', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOCS))
    await tick()
    const [alpha, beta] = admin.sources.sources
    admin.sources.register(
      searchingProvider(alpha!.id, async () => {
        throw new Error('Alpha is down')
      }),
    )
    admin.sources.register(
      searchingProvider(beta!.id, async () => ({
        tracks: { items: [track(beta!.id, '1', 'Beta Song')], hasMore: false },
      })),
    )
    await tick()

    const { container } = render(h(SearchScreen, { ctx, query: 'song' }))
    await act(async () => {
      ;(container.querySelector('[data-testid="search-submit"]') as HTMLElement).click()
      await tick()
      await tick()
    })

    expect(container.textContent).toContain('Alpha is down')
    expect(container.textContent).toContain('Beta Song')
  })

  it('only asks the sources left toggled on', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(DOCS))
    await tick()
    const [alpha, beta] = admin.sources.sources
    admin.sources.register(
      searchingProvider(alpha!.id, async () => ({
        tracks: { items: [track(alpha!.id, '1', 'Alpha Song')], hasMore: false },
      })),
    )
    admin.sources.register(
      searchingProvider(beta!.id, async () => ({
        tracks: { items: [track(beta!.id, '1', 'Beta Song')], hasMore: false },
      })),
    )
    await tick()

    const { container } = render(h(SearchScreen, { ctx, query: 'song' }))
    await act(async () => {
      ;(container.querySelector(`[data-testid="search-source-${alpha!.id}-track"]`) as HTMLElement).click()
    })
    await act(async () => {
      ;(container.querySelector('[data-testid="search-submit"]') as HTMLElement).click()
      await tick()
      await tick()
    })

    expect(container.textContent).toContain('Beta Song')
    expect(container.textContent).not.toContain('Alpha Song')
  })
})

/* ── the recommend page ─────────────────────────────────────────────────── */

describe('RecommendScreen on mobile', () => {
  function recommendingProvider(
    sourceId: string,
    displayName: string,
    recommend: () => Promise<BrowseResult>,
  ): MediaProvider {
    const capabilities: Capabilities = {
      search: { tracks: false, albums: false, artists: false, playlists: false, fullText: false },
      browse: false,
      recommend: true,
      lyrics: false,
      artwork: false,
      library: { read: false, save: false, playlistWrite: false, playlistReorder: false },
      streaming: { qualities: ['normal'], transcoding: false, seekable: true, urlExpiry: false },
      regional: false,
    }
    return {
      sourceId,
      displayName,
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
        return { kind: 'remote', target: 'https://a.example/s', seekable: true } as never
      },
      ping: async () => true,
      recommend,
    }
  }

  it('cold start — no sources, no history — degrades to an explicit empty state, not a crash', async () => {
    const { ctx } = await harness()
    const { container } = render(h(RecommendScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(container.querySelector('[data-testid="recommend-screen"]')).toBeTruthy()
    expect(container.textContent).toContain('No music sources yet')
  })

  it('renders one shelf per recommend-capable source and opens a card through onOpenAlbum', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(EXAMPLE_DOC))
    await tick()
    const source = admin.sources.sources[0]!
    admin.sources.register(
      recommendingProvider(source.id, 'Example', async () => ({
        items: [
          {
            id: 'r1',
            urn: `BBeBee:${source.id}:album:1`,
            title: 'Album One',
            subtitle: 'Someone',
            kind: 'album',
            leaf: false,
          },
          {
            id: 'r2',
            urn: `BBeBee:${source.id}:album:2`,
            title: 'Album Two',
            kind: 'album',
            leaf: false,
          },
        ],
        hasMore: false,
      })),
    )
    await tick()

    const opened: string[] = []
    const { container } = render(h(RecommendScreen, { ctx, onOpenAlbum: (urn) => void opened.push(urn) }))
    await act(async () => {
      await tick()
      await tick()
    })

    // The shelf header names the source, and both cards made it to the strip.
    expect(container.textContent).toContain('Example · Recommended playlists')
    expect(container.textContent).toContain('Album One')
    expect(container.textContent).toContain('Album Two')

    // Card body opens the album: the outer Pressable wrapping a card title.
    const card = Array.from(container.querySelectorAll('[data-host="Pressable"]')).find((el) =>
      el.textContent?.includes('Album One'),
    ) as HTMLElement
    expect(card).toBeTruthy()
    await act(async () => {
      card.click()
    })
    expect(opened).toEqual([`BBeBee:${source.id}:album:1`])
  })
})

describe('RecommendAllScreen on mobile', () => {
  it('shows the feed as card rows and stands the control down when the list runs out', async () => {
    const { ctx, admin } = await harness()
    await admin.sources.import(JSON.stringify(EXAMPLE_DOC))
    await tick()
    const source = admin.sources.sources[0]!
    let page = 0
    admin.sources.register(
      {
        sourceId: source.id,
        displayName: 'Example',
        capabilities: {
          search: { tracks: false, albums: false, artists: false, playlists: false, fullText: false },
          browse: false,
          recommend: true,
          lyrics: false,
          artwork: false,
          library: { read: false, save: false, playlistWrite: false, playlistReorder: false },
          streaming: { qualities: ['normal'], transcoding: false, seekable: true, urlExpiry: false },
          regional: false,
        } satisfies Capabilities,
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
          return { kind: 'remote', target: 'https://a.example/s', seekable: true } as never
        },
        ping: async () => true,
        // Page 1 is full (the feed's ten), page 2 is short — the one end
        // marker a curated list can give, so the control must stand down.
        async recommend() {
          page += 1
          const count = page === 1 ? 10 : 4
          return {
            items: Array.from({ length: count }, (_, i) => ({
              id: `p${page}-${i}`,
              urn: `BBeBee:${source.id}:album:${page}-${i}`,
              title: `Feed Album ${page}-${i}`,
              kind: 'album',
              leaf: false,
            })),
            hasMore: false,
          }
        },
      } satisfies MediaProvider,
    )
    await tick()

    const { container } = render(h(RecommendAllScreen, { ctx, sourceId: source.id, name: 'Example' }))
    await act(async () => {
      await tick()
      await tick()
      await tick()
    })

    expect(container.querySelector('[data-testid="recommend-all-screen"]')).toBeTruthy()
    expect(container.textContent).toContain('Example · All recommended playlists')
    expect(container.textContent).toContain('Feed Album 1-0')
    expect(container.textContent).toContain('Feed Album 2-3')
    // A short page ended the feed: no show-more affordance left standing.
    expect(container.querySelector('[data-testid="recommend-show-more"]')).toBeNull()
  })
})
