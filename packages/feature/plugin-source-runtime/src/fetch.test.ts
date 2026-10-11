/**
 * The fetch half of the runtime: URL objects, charset, and retry.
 *
 * `charset` and `retry` are in the URL-object table in docs/06 §3.5 and were
 * being parsed and then ignored — the worst of the three possible states,
 * because a document that asked for them got no error and no effect.
 */

import { describe, expect, it, vi } from 'vitest'
import { AuthError, NetworkError, RateLimitError, RuleError } from '@BBeBee/protocol'
import type { HttpRequest, HttpResponse } from '@BBeBee/protocol'
import { fetchDocument, parseUrlObject } from './fetch.js'

const site = { sourceId: 's1', block: 'searchUrl' }

function respond(over: Partial<HttpResponse> & { body?: Uint8Array | string } = {}): HttpResponse {
  const body = over.body ?? '{"ok":true}'
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  return {
    status: over.status ?? 200,
    headers: over.headers ?? { 'content-type': 'application/json' },
    url: over.url ?? 'https://host/x',
    text: async () => new TextDecoder().decode(bytes),
    json: async () => JSON.parse(new TextDecoder().decode(bytes)) as never,
    bytes: async () => bytes,
    stream: () => new ReadableStream(),
  }
}

describe('url objects', () => {
  it('splits at the first comma that begins a JSON object', () => {
    const parsed = parseUrlObject('https://h/s?a=1,2,{"method":"POST"}')
    expect(parsed.url, 'the comma inside the query belongs to the URL').toBe('https://h/s?a=1,2')
    expect(parsed.options.method).toBe('POST')
  })

  it('reads charset and retry from the blob', () => {
    const { options } = parseUrlObject('https://h/s,{"charset":"gbk","retry":3}')
    expect(options).toMatchObject({ charset: 'gbk', retry: 3 })
  })

  it('caps retry rather than trusting the document', () => {
    expect(parseUrlObject('https://h/s,{"retry":999}').options.retry).toBe(5)
  })
})

describe('charset', () => {
  it('decodes a GBK body instead of returning replacement characters', async () => {
    /*
     * The failure this fixes is silent: `response.text()` decodes UTF-8
     * unconditionally, so a GBK page parsed, matched, and imported as mojibake
     * without one error on the way. These bytes are the GBK encoding of the
     * two characters '\u4e2d\u6587' ("Chinese").
     */
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])
    const http = vi.fn(async () => respond({ body: gbk, headers: { 'content-type': 'text/html' } }))

    const fetched = await fetchDocument(
      http as never,
      { url: 'https://h/x', options: { charset: 'gbk' } },
      undefined,
      site,
    )

    expect(fetched.text).toBe('\u4e2d\u6587')
    expect(fetched.text).not.toContain('�')
  })

  it('leaves a body alone when no charset is asked for', async () => {
    const http = vi.fn(async () => respond({ body: '{"a":1}' }))
    const fetched = await fetchDocument(http as never, { url: 'https://h/x', options: {} }, undefined, site)
    expect(fetched.value).toEqual({ a: 1 })
  })

  it('refuses a charset it cannot decode, naming the rule', async () => {
    // Falling back to UTF-8 would reproduce the exact mojibake this prevents,
    // for a document that said what to do.
    const http = vi.fn(async () => respond())
    const failure = fetchDocument(
      http as never,
      { url: 'https://h/x', options: { charset: 'not-a-charset' } },
      undefined,
      site,
    )
    await expect(failure).rejects.toThrow(RuleError)
    await expect(failure).rejects.toThrow(/not-a-charset/)
  })
})

describe('retry', () => {
  it('does not retry by default', async () => {
    const http = vi.fn(async () => {
      throw new NetworkError('down', 's1')
    })
    await expect(
      fetchDocument(http as never, { url: 'https://h/x', options: {} }, undefined, site),
    ).rejects.toThrow(NetworkError)
    expect(http).toHaveBeenCalledTimes(1)
  })

  it('retries a transport failure up to the attempts asked for', async () => {
    let calls = 0
    const http = vi.fn(async () => {
      calls++
      if (calls < 3) throw new NetworkError('down', 's1')
      return respond()
    })

    const fetched = await fetchDocument(
      http as never,
      { url: 'https://h/x', options: { retry: 3 } },
      undefined,
      site,
    )
    expect(fetched.value).toEqual({ ok: true })
    expect(calls).toBe(3)
  })

  it('gives up after the last attempt rather than looping', async () => {
    const http = vi.fn(async () => {
      throw new NetworkError('down', 's1')
    })
    await expect(
      fetchDocument(http as never, { url: 'https://h/x', options: { retry: 2 } }, undefined, site),
    ).rejects.toThrow(NetworkError)
    expect(http).toHaveBeenCalledTimes(2)
  })

  it('never retries a failure that cannot succeed', async () => {
    // Retrying a 401 is how a broken source becomes a slow broken source.
    const http = vi.fn(async () => respond({ status: 401 }))
    await expect(
      fetchDocument(http as never, { url: 'https://h/x', options: { retry: 5 } }, undefined, site),
    ).rejects.toThrow(AuthError)
    expect(http).toHaveBeenCalledTimes(1)
  })

  it('waits the interval a rate limit asked for', async () => {
    let calls = 0
    const http = vi.fn(async (_req: HttpRequest) => {
      calls++
      if (calls === 1) throw new RateLimitError('slow down', 150, 's1')
      return respond()
    })

    const started = Date.now()
    await fetchDocument(http as never, { url: 'https://h/x', options: { retry: 2 } }, undefined, site)
    expect(Date.now() - started, 'the backend named an interval; it is honoured').toBeGreaterThanOrEqual(140)
  })
})
