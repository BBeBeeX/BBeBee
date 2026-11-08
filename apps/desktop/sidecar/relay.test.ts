import { describe, expect, it, vi } from 'vitest'
import { StreamRelay } from './relay.js'
import type { Dispatcher, fetch as undiciFetchType } from 'undici'

/**
 * The relay is exercised end-to-end over its real loopback listener with the
 * *upstream* fetch mocked at the seam: what needs proving is the routing
 * decision (which token, which proxy), the header policy (what reaches the
 * upstream, what reaches mpv), and the containment (unknown tokens,
 * non-http upstreams, the entry cap) — not undici's own piping.
 */

function mockFetch(recorder: { calls: Array<{ url: string; init: RequestInit }> }, answer: Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    recorder.calls.push({ url: String(input), init: (init ?? {}) as RequestInit })
    return answer
  }) as unknown as typeof undiciFetchType
}

function fetchAnswer(status = 200, headers: Record<string, string> = {}, body = 'upstream-bytes') {
  return new Response(body, { status, headers })
}

async function makeRelay(opts: {
  dispatcher?: Dispatcher | null
  answer?: Response
} = {}) {
  const recorder = { calls: [] as Array<{ url: string; init: RequestInit }> }
  const relay = new StreamRelay(
    () => opts.dispatcher ?? null,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockFetch(recorder, opts.answer ?? fetchAnswer()),
  )
  return { relay, recorder }
}

describe('StreamRelay — registration', () => {
  it('hands back a loopback URL with an unguessable token', async () => {
    const { relay } = await makeRelay()
    const local = await relay.register({ url: 'https://media.example/stream', useProxy: false })
    expect(local).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/s\/[0-9a-f]{32}$/)
    relay.dispose()
  })

  it('refuses non-http upstreams at registration', async () => {
    const { relay } = await makeRelay()
    await expect(relay.register({ url: 'file:///etc/passwd' })).rejects.toThrow(/only http\/https/)
    await expect(relay.register({ url: 'ftp://host/file' })).rejects.toThrow(/only http\/https/)
    relay.dispose()
  })

  it('evicts the oldest entry past the cap — a registration loop cannot grow the table', async () => {
    const { relay } = await makeRelay()
    for (let i = 0; i < 140; i++) {
      await relay.register({ url: `https://media.example/${i}`, useProxy: false })
    }
    expect(relay.size).toBeLessThanOrEqual(128)
    relay.dispose()
  })
})

describe('StreamRelay — serving a registered stream', () => {
  it('dials the registered upstream with the source headers plus mpv\u2019s Range, and answers 206', async () => {
    const { relay, recorder } = await makeRelay({
      answer: fetchAnswer(206, { 'content-range': 'bytes 0-13/100' }),
    })
    const local = await relay.register({
      url: 'https://media.example/stream',
      headers: { Referer: 'https://page.example/watch', Cookie: 'session=abc' },
      useProxy: false,
    })

    // The "engine": a seek-shaped request to the loopback URL.
    const response = await fetch(local, { headers: { range: 'bytes=0-13' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-13/100')
    expect(await response.text()).toBe('upstream-bytes')

    expect(recorder.calls).toHaveLength(1)
    expect(recorder.calls[0]!.url).toBe('https://media.example/stream')
    const headers = recorder.calls[0]!.init.headers as Record<string, string>
    expect(headers['referer']).toBe('https://page.example/watch')
    expect(headers['cookie']).toBe('session=abc')
    expect(headers['range']).toBe('bytes=0-13')
    relay.dispose()
  })

  it('routes a marked stream through the proxy dispatcher and an unmarked one direct', async () => {
    const dispatcher = { dispatch: vi.fn() } as unknown as Dispatcher
    const proxied = await makeRelay({ dispatcher })
    const direct = await makeRelay()

    const localProxied = await proxied.relay.register({
      url: 'https://media.example/proxied',
      useProxy: true,
    })
    const localDirect = await direct.relay.register({
      url: 'https://media.example/direct',
      useProxy: false,
    })

    await fetch(localProxied)
    await fetch(localDirect)

    expect(proxied.recorder.calls).toHaveLength(1)
    expect((proxied.recorder.calls[0]!.init as RequestInit & { dispatcher?: unknown }).dispatcher).toBe(dispatcher)
    expect(direct.recorder.calls).toHaveLength(1)
    expect((direct.recorder.calls[0]!.init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeUndefined()
    proxied.relay.dispose()
    direct.relay.dispose()
  })

  it('answers an unknown token with a flat 404 and never reaches the upstream', async () => {
    const { relay, recorder } = await makeRelay()
    await relay.register({ url: 'https://media.example/stream', useProxy: false })
    const port = /:(\d+)\//.exec(await relay.register({ url: 'https://media.example/again', useProxy: false }))![1]
    const response = await fetch(`http://127.0.0.1:${port}/s/${'0'.repeat(32)}`)
    expect(response.status).toBe(404)
    expect(recorder.calls).toHaveLength(0)
    relay.dispose()
  })

  it('drops hop-by-hop and session-shaped upstream headers, keeps what mpv needs', async () => {
    const { relay } = await makeRelay({
      answer: fetchAnswer(200, {
        'content-type': 'audio/mpeg',
        'accept-ranges': 'bytes',
        etag: '"v1"',
        'set-cookie': 'tracker=1',
        connection: 'keep-alive',
      }),
    })
    const local = await relay.register({ url: 'https://media.example/stream', useProxy: false })
    const response = await fetch(local)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('etag')).toBe('"v1"')
    expect(response.headers.get('set-cookie')).toBeNull()
    // (`connection` is Node's own transport header on the loopback response,
    // so it is asserted on the *upstream* side instead — see the drop list.)
    relay.dispose()
  })
})
