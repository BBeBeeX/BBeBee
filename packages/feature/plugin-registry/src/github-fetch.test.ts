import { describe, expect, it, vi } from 'vitest'
import type { HttpService, HttpResponse } from '@BBeBee/protocol'
import {
  createGitHubFetch,
  githubCandidates,
  normalizeAccelerationPrefix,
  parseRawGitHubUrl,
  toJsDelivrUrl,
} from './github-fetch.js'

/* ── harness ─────────────────────────────────────────────────────────────── */

interface RouteSpec {
  /** URL → response status (default 200). */
  status?: Record<string, number>
  /** URL → JSON body. */
  json?: Record<string, unknown>
  /** URL → transport failure. */
  fail?: Record<string, Error>
}

function makeRecordingHttp(spec: RouteSpec = {}): { service: HttpService; calls: string[] } {
  const calls: string[] = []
  const service = (async (req: { url: string }) => {
    const url = req.url
    calls.push(url)
    const failure = spec.fail?.[url]
    if (failure) throw failure
    const status = spec.status?.[url] ?? 200
    const body = spec.json?.[url]
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
    return {
      status,
      headers: {},
      url,
      text: async () => text,
      json: async () => JSON.parse(text),
      bytes: async () => new TextEncoder().encode(text),
      stream: () => new ReadableStream<Uint8Array>(),
    } satisfies HttpResponse
  }) as unknown as HttpService
  return { service, calls }
}

function makeFetch(
  spec: RouteSpec = {},
  prefixes: readonly string[] = [],
  region: 'global' | 'mainland-china' = 'global',
) {
  const { service, calls } = makeRecordingHttp(spec)
  const logger = { info: vi.fn(), warn: vi.fn() }
  const layer = createGitHubFetch({
    http: service,
    logger,
    getSettings: () => ({ downloadRegion: region, githubAccelerationPrefixes: prefixes }),
  })
  return { layer, calls, logger }
}

const RAW_PINNED = 'https://raw.githubusercontent.com/alice/my-source/abc123/index.json'
const RAW_JSDELIVR = 'https://cdn.jsdelivr.net/gh/alice/my-source@abc123/index.json'
const API_URL = 'https://api.github.com/repos/alice/my-source/commits/HEAD'

/* ── candidate chain (pure) ──────────────────────────────────────────────── */

describe('githubCandidates', () => {
  it('puts the official URL first and adds jsDelivr only for pinned raw URLs', () => {
    const chain = githubCandidates(RAW_PINNED, [])
    expect(chain).toEqual([
      { url: RAW_PINNED, kind: 'official' },
      { url: RAW_JSDELIVR, kind: 'jsdelivr' },
    ])
  })

  it('never generates a jsDelivr candidate for api.github.com URLs, but applies prefixes', () => {
    const chain = githubCandidates(API_URL, [])
    expect(chain.map((candidate) => candidate.kind)).toEqual(['official'])

    const prefixed = githubCandidates(API_URL, ['https://ghproxy.example.com'])
    expect(prefixed.map((candidate) => candidate.kind)).toEqual(['official', 'prefix'])
    expect(prefixed[1]?.url).toBe(`https://ghproxy.example.com/${API_URL}`)
  })

  it('keeps non-GitHub URLs at a single official candidate, never rewriting them', () => {
    const own = 'https://cdn.example/author-download.json'
    const chain = githubCandidates(own, ['https://ghproxy.example.com/', 'https://mirror.example/'])
    expect(chain).toEqual([{ url: own, kind: 'official' }])
  })

  it('keeps prefix order and normalizes a missing trailing slash', () => {
    const chain = githubCandidates(API_URL, [
      'https://a.example.com',
      'https://b.example.com/',
      'https://c.example.com',
    ])
    expect(chain.map((candidate) => candidate.url)).toEqual([
      API_URL,
      `https://a.example.com/${API_URL}`,
      `https://b.example.com/${API_URL}`,
      `https://c.example.com/${API_URL}`,
    ])
  })

  it('skips empty or non-string prefixes defensively', () => {
    const chain = githubCandidates(API_URL, ['', '   ', 'https://p.example.com'] as unknown as readonly string[])
    expect(chain.map((candidate) => candidate.kind)).toEqual(['official', 'prefix'])
  })

  it('treats malformed or non-https URLs as single-candidate', () => {
    expect(githubCandidates('not a url', ['https://p.example.com/'])).toEqual([
      { url: 'not a url', kind: 'official' },
    ])
    expect(githubCandidates('http://raw.githubusercontent.com/a/b/c/d', [])).toHaveLength(1)
  })
})

describe('parseRawGitHubUrl / toJsDelivrUrl', () => {
  it('splits owner/repo/ref/path and builds the @ref jsDelivr form', () => {
    const raw = parseRawGitHubUrl(RAW_PINNED)
    expect(raw).toEqual({ owner: 'alice', repo: 'my-source', ref: 'abc123', path: 'index.json' })
    expect(toJsDelivrUrl(raw!)).toBe(RAW_JSDELIVR)
  })

  it('keeps nested paths and rejects URLs without a ref or path', () => {
    expect(parseRawGitHubUrl('https://raw.githubusercontent.com/a/b/abc/x/y.json')).toEqual({
      owner: 'a',
      repo: 'b',
      ref: 'abc',
      path: 'x/y.json',
    })
    expect(parseRawGitHubUrl('https://raw.githubusercontent.com/a/b/abc')).toBeUndefined()
    expect(parseRawGitHubUrl('https://example.com/a/b/c/d')).toBeUndefined()
  })

  it('normalizes prefixes with a trailing slash', () => {
    expect(normalizeAccelerationPrefix('https://p.example.com')).toBe('https://p.example.com/')
    expect(normalizeAccelerationPrefix('https://p.example.com/')).toBe('https://p.example.com/')
  })
})

/* ── failover ────────────────────────────────────────────────────────────── */

describe('github-fetch failover', () => {
  it('does not request any acceleration candidate while the official URL works', async () => {
    const { layer, calls } = makeFetch({ json: { [RAW_PINNED]: { ok: true } } })
    await expect(layer.getJson(RAW_PINNED)).resolves.toEqual({ ok: true })
    expect(calls).toEqual([RAW_PINNED])
  })

  it('falls back to jsDelivr when the official raw URL fails with a status', async () => {
    const { layer, calls, logger } = makeFetch({
      status: { [RAW_PINNED]: 403 },
      json: { [RAW_JSDELIVR]: { ok: 'jsdelivr' } },
    })
    await expect(layer.getJson(RAW_PINNED)).resolves.toEqual({ ok: 'jsdelivr' })
    expect(calls).toEqual([RAW_PINNED, RAW_JSDELIVR])
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0]?.[0]).toContain('[github-fetch] official failed (403)')
    expect(logger.warn.mock.calls[0]?.[0]).toContain('falling back to jsdelivr')
  })

  it('falls back to jsDelivr on a transport error and logs the region preference', async () => {
    const { layer, calls, logger } = makeFetch(
      { fail: { [RAW_PINNED]: new Error('offline') }, json: { [RAW_JSDELIVR]: { ok: 1 } } },
      [],
      'mainland-china',
    )
    await expect(layer.getJson(RAW_PINNED)).resolves.toEqual({ ok: 1 })
    expect(calls).toEqual([RAW_PINNED, RAW_JSDELIVR])
    expect(logger.warn.mock.calls[0]?.[0]).toContain('[github-fetch] official failed (offline)')
    expect(logger.warn.mock.calls[0]?.[0]).toContain('region=mainland-china')
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info.mock.calls[0]?.[0]).toContain('jsdelivr succeeded')
  })

  it('walks custom prefixes in order after jsDelivr', async () => {
    const p1 = 'https://p1.example.com'
    const p2 = 'https://p2.example.com'
    const { layer, calls } = makeFetch(
      {
        status: { [RAW_PINNED]: 500, [RAW_JSDELIVR]: 500, [`${p1}/${RAW_PINNED}`]: 502 },
        json: { [`${p2}/${RAW_PINNED}`]: { via: 'p2' } },
      },
      [p1, p2],
    )
    await expect(layer.getJson(RAW_PINNED)).resolves.toEqual({ via: 'p2' })
    expect(calls).toEqual([
      RAW_PINNED,
      RAW_JSDELIVR,
      `${p1}/${RAW_PINNED}`,
      `${p2}/${RAW_PINNED}`,
    ])
  })

  it('applies prefixes to api.github.com URLs with no jsDelivr in between', async () => {
    const p1 = 'https://p1.example.com'
    const { layer, calls } = makeFetch(
      { status: { [API_URL]: 404 }, json: { [`${p1}/${API_URL}`]: { sha: 'abc' } } },
      [p1],
    )
    await expect(layer.getJson(API_URL)).resolves.toEqual({ sha: 'abc' })
    expect(calls).toEqual([API_URL, `${p1}/${API_URL}`])
  })

  it('throws the last candidate error when every candidate fails', async () => {
    const p1 = 'https://p1.example.com'
    const { layer, calls } = makeFetch(
      {
        status: { [RAW_PINNED]: 403, [RAW_JSDELIVR]: 404, [`${p1}/${RAW_PINNED}`]: 502 },
      },
      [p1],
    )
    await expect(layer.getJson(RAW_PINNED)).rejects.toThrow(/status 502/)
    expect(calls).toEqual([RAW_PINNED, RAW_JSDELIVR, `${p1}/${RAW_PINNED}`])
  })

  it('never rewrites a non-GitHub URL, even when it fails', async () => {
    const own = 'https://cdn.example/author-download.json'
    const { layer, calls } = makeFetch({ status: { [own]: 500 } }, ['https://p.example.com'])
    await expect(layer.fetchDocument(own)).rejects.toThrow(/status 500 for https:\/\/cdn\.example/)
    expect(calls).toEqual([own])
  })

  it('honours onlyOfficial for endpoint overrides (single candidate, no acceleration)', async () => {
    const mirror = 'https://mirror.example/registry.json'
    const { layer, calls } = makeFetch({ json: { [mirror]: { entries: [] } } }, [
      'https://p.example.com',
    ])
    await expect(layer.getJson(mirror, { onlyOfficial: true })).resolves.toEqual({ entries: [] })
    expect(calls).toEqual([mirror])

    const { layer: failing, calls: failingCalls } = makeFetch(
      { status: { [mirror]: 404 } },
      ['https://p.example.com'],
    )
    await expect(failing.getJson(mirror, { onlyOfficial: true })).rejects.toThrow(/status 404/)
    expect(failingCalls).toEqual([mirror])
  })

  it('fetchDocument returns the raw response body kinds', async () => {
    const { layer } = makeFetch({ json: { [RAW_PINNED]: { hello: 'world' } } })
    const response = await layer.fetchDocument(RAW_PINNED)
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe(JSON.stringify({ hello: 'world' }))
    await expect(response.bytes()).resolves.toBeInstanceOf(Uint8Array)
  })
})
