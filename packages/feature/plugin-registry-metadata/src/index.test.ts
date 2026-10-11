import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { HttpRequest, HttpService, HttpResponse } from '@BBeBee/protocol'
import { RegistryMetadataPlugin } from './index.js'

/* ── fixtures ────────────────────────────────────────────────────────────── */

const CACHE_KEY = 'registry-metadata.cache'
const TTL_MS = 24 * 60 * 60 * 1000

const repoUrl = (owner: string, repo: string): string => `https://api.github.com/repos/${owner}/${repo}`
const contributorsUrl = (owner: string, repo: string): string =>
  `${repoUrl(owner, repo)}/contributors?per_page=100`

interface HttpRoute {
  /** Response status override (4xx/5xx). */
  status?: number
  /** JSON body. */
  body?: unknown
}

interface HttpHandle {
  service: HttpService
  calls: Array<{ url: string; headers?: Record<string, string> }>
  urls: () => string[]
  /** Holds every in-flight request until the promise resolves. */
  hold: (gate: Promise<void>) => void
}

function makeHttp(routes: Record<string, HttpRoute> = {}): HttpHandle {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = []
  let gate: Promise<void> | undefined
  const service = (async (req: HttpRequest) => {
    calls.push({ url: req.url, headers: req.headers })
    if (gate) await gate
    const route = routes[req.url]
    const status = route?.status ?? 200
    const body = route?.body
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    return {
      status,
      headers: {},
      url: req.url,
      text: async () => text,
      json: async () => JSON.parse(text),
      bytes: async () => new TextEncoder().encode(text),
      stream: () => new ReadableStream<Uint8Array>(),
    } satisfies HttpResponse
  }) as HttpService
  return {
    service,
    calls,
    urls: () => calls.map((call) => call.url),
    hold: (held) => {
      gate = held
    },
  }
}

function makeStore() {
  const data = new Map<string, unknown>()
  const store = {
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key)
    }),
    keys: vi.fn(async (prefix?: string) =>
      [...data.keys()].filter((key) => !prefix || key.startsWith(prefix)),
    ),
    namespace: vi.fn(() => store),
  }
  return { store, data }
}

/** Drain microtasks and timers so the init-time `ctx.inject` callbacks have run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function setup(options: { routes?: Record<string, HttpRoute>; withStore?: boolean } = {}) {
  const ctx = new Context()
  const { store, data } = makeStore()
  if (options.withStore !== false) ctx.provide('store', store)
  const http = makeHttp(options.routes)
  ctx.provide('http', http.service)
  const plugin = new RegistryMetadataPlugin(ctx)
  return { ctx, plugin, data, http }
}

async function setupInitialized(
  options: { routes?: Record<string, HttpRoute>; withStore?: boolean } = {},
) {
  const harness = setup(options)
  await harness.plugin[RegistryMetadataPlugin.init]()
  await settle()
  return harness
}

/* ── the happy path ──────────────────────────────────────────────────────── */

describe('getRepoStats', () => {
  it('fetches stars and contributors with the GitHub Accept header, and caches them', async () => {
    const harness = await setupInitialized({
      routes: {
        [repoUrl('alice', 'widget')]: { body: { stargazers_count: 1200 } },
        [contributorsUrl('alice', 'widget')]: { body: [{}, {}, {}] },
      },
    })

    const stats = await harness.plugin.getRepoStats('alice', 'widget')
    expect(stats).toMatchObject({ owner: 'alice', repo: 'widget', stars: 1200, contributors: 3 })
    expect(stats.stale).toBeUndefined()
    expect(stats.error).toBeUndefined()
    expect(harness.http.calls.length).toBe(2)
    expect(harness.http.calls.every((call) => call.headers?.['Accept'] === 'application/vnd.github+json')).toBe(true)

    const cached = harness.data.get(CACHE_KEY) as Record<string, { stars?: number; contributors?: number; fetchedAt: number }>
    expect(cached['alice/widget']).toMatchObject({ stars: 1200, contributors: 3 })
    expect(cached['alice/widget']!.fetchedAt).toBeGreaterThan(0)
  })

  it('serves the cache within the TTL without touching the network', async () => {
    const harness = await setupInitialized({
      routes: {
        [repoUrl('alice', 'widget')]: { body: { stargazers_count: 10 } },
        [contributorsUrl('alice', 'widget')]: { body: [{}] },
      },
    })

    await harness.plugin.getRepoStats('alice', 'widget')
    expect(harness.http.calls.length).toBe(2)

    const second = await harness.plugin.getRepoStats('alice', 'widget')
    expect(second.stars).toBe(10)
    expect(harness.http.calls.length).toBe(2)
  })

  it('keys the cache case-insensitively', async () => {
    const harness = await setupInitialized({
      routes: {
        [repoUrl('alice', 'widget')]: { body: { stargazers_count: 10 } },
        [contributorsUrl('alice', 'widget')]: { body: [{}] },
      },
    })

    await harness.plugin.getRepoStats('Alice', 'Widget')
    expect(harness.http.calls.length).toBe(2)

    // Same repo, different casing: served from the shared cache entry.
    const again = await harness.plugin.getRepoStats('ALICE', 'WIDGET')
    expect(again.stars).toBe(10)
    expect(harness.http.calls.length).toBe(2)
  })

  it('refetches once the cached copy is past its TTL', async () => {
    const harness = setup({
      routes: {
        [repoUrl('old', 'repo')]: { body: { stargazers_count: 42 } },
        [contributorsUrl('old', 'repo')]: { body: [{}, {}] },
      },
    })
    harness.data.set(CACHE_KEY, {
      'old/repo': { stars: 7, contributors: 2, fetchedAt: Date.now() - TTL_MS - 1_000 },
    })
    await harness.plugin[RegistryMetadataPlugin.init]()
    await settle()

    const stats = await harness.plugin.getRepoStats('old', 'repo')
    expect(stats).toMatchObject({ stars: 42, contributors: 2 })
    expect(stats.stale).toBeUndefined()
    expect(harness.http.urls()).toContain(repoUrl('old', 'repo'))

    const cached = harness.data.get(CACHE_KEY) as Record<string, { stars?: number }>
    expect(cached['old/repo']!.stars).toBe(42)
  })

  it('treats a malformed stored cache as empty rather than trusting it', async () => {
    const harness = setup({
      routes: {
        [repoUrl('odd', 'repo')]: { body: { stargazers_count: 5 } },
        [contributorsUrl('odd', 'repo')]: { body: [] },
      },
    })
    harness.data.set(CACHE_KEY, {
      'odd/repo': { stars: 'many', fetchedAt: 'recently' },
      'also/broken': 'not even an object',
    })
    await harness.plugin[RegistryMetadataPlugin.init]()
    await settle()

    expect(harness.plugin.peekRepoStats('odd', 'repo')).toBeUndefined()
    const stats = await harness.plugin.getRepoStats('odd', 'repo')
    expect(stats.stars).toBe(5)
  })
})

/* ── merging and concurrency ─────────────────────────────────────────────── */

describe('concurrency', () => {
  it('merges concurrent requests for the same repo into one fetch', async () => {
    const harness = await setupInitialized({
      routes: {
        [repoUrl('alice', 'widget')]: { body: { stargazers_count: 3 } },
        [contributorsUrl('alice', 'widget')]: { body: [{}] },
      },
    })

    const [a, b] = await Promise.all([
      harness.plugin.getRepoStats('alice', 'widget'),
      harness.plugin.getRepoStats('alice', 'widget'),
    ])
    expect(a).toEqual(b)
    expect(harness.http.calls.length).toBe(2)
  })

  it('caps concurrent fetches at three, queueing the rest', async () => {
    const repos = [
      ['one', 'a'],
      ['two', 'b'],
      ['three', 'c'],
      ['four', 'd'],
    ] as const
    const routes: Record<string, HttpRoute> = {}
    for (const [owner, repo] of repos) {
      routes[repoUrl(owner, repo)] = { body: { stargazers_count: 1 } }
      routes[contributorsUrl(owner, repo)] = { body: [] }
    }
    const harness = await setupInitialized({ routes })

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    harness.http.hold(gate)

    const pending = repos.map(([owner, repo]) => harness.plugin.getRepoStats(owner, repo))
    await settle()

    // Three repos mid-fetch (each holding its stars call); the fourth queued.
    expect(harness.http.calls.length).toBe(3)

    release()
    await Promise.all(pending)
    expect(harness.http.calls.length).toBe(8)
  })
})

/* ── degraded paths ──────────────────────────────────────────────────────── */

describe('degradation', () => {
  it('serves an expired cached copy as stale when the fresh fetch fails', async () => {
    const harness = setup({
      routes: {
        [repoUrl('old', 'repo')]: { status: 500 },
        [contributorsUrl('old', 'repo')]: { status: 500 },
      },
    })
    harness.data.set(CACHE_KEY, {
      'old/repo': { stars: 7, contributors: 2, fetchedAt: Date.now() - TTL_MS - 1_000 },
    })
    await harness.plugin[RegistryMetadataPlugin.init]()
    await settle()

    const stats = await harness.plugin.getRepoStats('old', 'repo')
    expect(stats).toMatchObject({ owner: 'old', repo: 'repo', stars: 7, contributors: 2, stale: true })
    expect(stats.error).toBeUndefined()
  })

  it('reports an error result — never a rejection — when there is no cache', async () => {
    const harness = await setupInitialized({
      routes: {
        [repoUrl('ghost', 'repo')]: { status: 404 },
        [contributorsUrl('ghost', 'repo')]: { status: 404 },
      },
    })

    const stats = await harness.plugin.getRepoStats('ghost', 'repo')
    expect(stats.stars).toBeUndefined()
    expect(stats.contributors).toBeUndefined()
    expect(stats.error).toContain('HTTP 404')
  })

  it('degrades transport failures the same way', async () => {
    const failing = new Context()
    failing.provide('http', (() => {
      throw new Error('offline')
    }) as unknown as HttpService)
    const plugin = new RegistryMetadataPlugin(failing)
    await plugin[RegistryMetadataPlugin.init]()
    await settle()

    const stats = await plugin.getRepoStats('ghost', 'repo')
    expect(stats.error).toContain('offline')
  })

  it('backs off locally after a 403 rate limit and recovers when the window passes', async () => {
    const routes: Record<string, HttpRoute> = {
      [repoUrl('limited', 'repo')]: { status: 403 },
      [contributorsUrl('limited', 'repo')]: { status: 403 },
    }
    const harness = await setupInitialized({ routes })

    const limited = await harness.plugin.getRepoStats('limited', 'repo')
    expect(limited.error).toContain('rate limited')
    expect(harness.http.calls.length).toBe(1)

    // The API recovers, but the local backoff window keeps the network quiet.
    routes[repoUrl('limited', 'repo')] = { body: { stargazers_count: 99 } }
    routes[contributorsUrl('limited', 'repo')] = { body: [{}] }
    const stillBackoff = await harness.plugin.getRepoStats('limited', 'repo')
    expect(stillBackoff.error).toContain('backoff')
    expect(harness.http.calls.length).toBe(1)

    // Once the window passes, the fetch goes through.
    ;(harness.plugin as unknown as { backoffUntil: number }).backoffUntil = 0
    const recovered = await harness.plugin.getRepoStats('limited', 'repo')
    expect(recovered).toMatchObject({ stars: 99, contributors: 1 })
  })

  it('also treats 429 as a rate limit', async () => {
    const harness = await setupInitialized({
      routes: {
        [repoUrl('busy', 'repo')]: { status: 429 },
        [contributorsUrl('busy', 'repo')]: { status: 429 },
      },
    })

    const stats = await harness.plugin.getRepoStats('busy', 'repo')
    expect(stats.error).toContain('HTTP 429')
    const internals = harness.plugin as unknown as { backoffUntil: number }
    expect(internals.backoffUntil).toBeGreaterThan(Date.now())
  })
})

/* ── peek ────────────────────────────────────────────────────────────────── */

describe('peekRepoStats', () => {
  it('answers from the cache only and marks past-TTL entries stale', async () => {
    const harness = await setupInitialized({
      routes: {
        [repoUrl('alice', 'widget')]: { body: { stargazers_count: 10 } },
        [contributorsUrl('alice', 'widget')]: { body: [{}] },
      },
    })

    expect(harness.plugin.peekRepoStats('alice', 'widget')).toBeUndefined()
    expect(harness.http.calls.length).toBe(0)

    await harness.plugin.getRepoStats('alice', 'widget')
    expect(harness.plugin.peekRepoStats('alice', 'widget')).toMatchObject({ stars: 10, contributors: 1 })
    expect(harness.plugin.peekRepoStats('alice', 'widget')?.stale).toBeUndefined()

    const internals = harness.plugin as unknown as { cache: Record<string, { fetchedAt: number }> }
    internals.cache['alice/widget']!.fetchedAt = Date.now() - TTL_MS - 1
    const stale = harness.plugin.peekRepoStats('alice', 'widget')
    expect(stale).toMatchObject({ stars: 10, stale: true })
    expect(harness.http.calls.length).toBe(2)
  })
})

/* ── robustness ──────────────────────────────────────────────────────────── */

describe('apply', () => {
  it('registers the metadata service on ctx, store or no store', async () => {
    const harness = await setupInitialized({
      withStore: false,
      routes: {
        [repoUrl('bare', 'repo')]: { body: { stargazers_count: 1 } },
        [contributorsUrl('bare', 'repo')]: { body: [{}] },
      },
    })
    expect(harness.ctx.reflect.get('registryMetadata', false)).toBeInstanceOf(RegistryMetadataPlugin)

    // No store to persist into: the fetch still works, memory-only.
    const stats = await harness.plugin.getRepoStats('bare', 'repo')
    expect(stats).toMatchObject({ stars: 1, contributors: 1 })
    expect(harness.plugin.peekRepoStats('bare', 'repo')).toMatchObject({ stars: 1 })
  })
})
