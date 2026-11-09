import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { admitDatagram, createLanHost, uriToPath, type DatagramGate, type LanHostOptions } from './host.js'

const GROUP = '239.255.42.98'

interface Started {
  host: ReturnType<typeof createLanHost>
  events: Array<{ topic?: string; [key: string]: unknown }>
  ports: { udpPort: number; httpPort: number }
}

function makeHost(overrides: Partial<LanHostOptions> = {}) {
  const events: Array<{ topic?: string; [key: string]: unknown }> = []
  const host = createLanHost({
    broadcast: (_channel, payload) => events.push(payload as { topic?: string }),
    replyTimeoutMs: 1_000,
    ...overrides,
  })
  return { host, events }
}

function datagramsOf(events: Array<{ topic?: string }>): Array<Record<string, unknown>> {
  return events.filter((e) => e.topic === 'lan-datagram') as Array<Record<string, unknown>>
}

function requestsOf(events: Array<{ topic?: string }>): Array<Record<string, unknown>> {
  return events.filter((e) => e.topic === 'lan-request') as Array<Record<string, unknown>>
}

/**
 * A renderer replacement that replies when the event actually arrives —
 * a fixed timer races the undici connection setup (~30 ms for the first
 * localhost request) and misses the reply window.
 */
function replyWhenRequestArrives(
  events: Array<{ topic?: string; [key: string]: unknown }>,
  host: ReturnType<typeof createLanHost>,
  reply: (req: Record<string, unknown>) => Promise<void>,
): void {
  void (async () => {
    const req = await vi.waitFor(
      () => {
        const found = requestsOf(events).at(-1)
        expect(found).toBeDefined()
        return found!
      },
      { timeout: 2_000 },
    )
    await reply(req)
  })()
}

describe('createLanHost', () => {
  const dirs: string[] = []
  const hosts: Array<Started['host']> = []

  async function start(overrides: Partial<LanHostOptions> = {}): Promise<Started> {
    const made = makeHost(overrides)
    hosts.push(made.host)
    const ports = await made.host.start({ udpPort: 0, httpPort: 0, multicastGroup: GROUP })
    return { ...made, ports }
  }

  beforeAll(async () => {
    dirs.push(await mkdtemp(join(tmpdir(), 'bbebee-lan-test-')))
  })

  afterAll(async () => {
    await Promise.all(hosts.map((h) => h.dispose()))
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
  })

  it('carries a datagram from one host to another', async () => {
    const a = await start()
    const b = await start()

    await b.host.sendDatagram(
      { host: '127.0.0.1', port: a.ports.udpPort },
      new TextEncoder().encode('hello peer'),
    )

    const seen = await vi.waitFor(() => {
      const list = datagramsOf(a.events)
      expect(list.length).toBeGreaterThan(0)
      return list
    })
    const payload = seen.at(-1) as { host: string; port: number; data: string }
    expect(payload.host).toBe('127.0.0.1')
    expect(new TextDecoder().decode(Buffer.from(payload.data, 'base64'))).toBe('hello peer')
  })

  it('answers a request the handler replies to', async () => {
    const a = await start()

    // Simulate the renderer: reply when the request event actually arrives.
    replyWhenRequestArrives(a.events, a.host, async (req) => {
      await a.host.replyRequest(req.id as string, {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ ok: true })),
      })
    })

    const response = await a.host.request(
      { host: '127.0.0.1', port: a.ports.httpPort },
      { method: 'POST', path: '/api/test', body: new TextEncoder().encode('ping') },
    )
    expect(response.status).toBe(200)
    expect(JSON.parse(Buffer.from(response.body ?? new Uint8Array()).toString('utf8'))).toEqual({ ok: true })
  })

  it('times out an unanswered request with a 504', async () => {
    const a = await start({ replyTimeoutMs: 150 })

    const response = await a.host.request(
      { host: '127.0.0.1', port: a.ports.httpPort },
      { method: 'GET', path: '/never-replied' },
    )
    expect(response.status).toBe(504)
  })

  it('spills a large upload body to a file, byte-faithful', async () => {
    const a = await start({ bodySpillBytes: 1024 })

    const payload = Buffer.alloc(64 * 1024)
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251
    const uploadPath = join(dirs[0]!, 'upload.bin')
    await writeFile(uploadPath, payload)

    let receivedFile: string | undefined
    replyWhenRequestArrives(a.events, a.host, async (req) => {
      const bodyFile = req.bodyFile as string | undefined
      expect(bodyFile).toBeDefined()
      receivedFile = uriToPath(bodyFile!)
      await a.host.replyRequest(req.id as string, { status: 200, body: Buffer.from('ack') })
    })

    const response = await a.host.request(
      { host: '127.0.0.1', port: a.ports.httpPort },
      { method: 'POST', path: '/upload', bodyFile: pathToFileURL(uploadPath).href },
    )
    expect(response.status).toBe(200)
    expect(receivedFile).toBeDefined()
    const received = await readFile(receivedFile!)
    expect(received.length).toBe(payload.length)
    expect(Buffer.compare(received, payload)).toBe(0)
  })

  it('streams a file reply the client can read', async () => {
    const a = await start()

    const content = Buffer.alloc(200 * 1024)
    for (let i = 0; i < content.length; i++) content[i] = (i * 7) % 256
    const replyPath = join(dirs[0]!, 'reply.bin')
    await writeFile(replyPath, content)

    replyWhenRequestArrives(a.events, a.host, async (req) => {
      await a.host.replyRequest(req.id as string, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        bodyFile: pathToFileURL(replyPath).href,
      })
    })

    const response = await a.host.request(
      { host: '127.0.0.1', port: a.ports.httpPort },
      { method: 'GET', path: '/file' },
    )
    expect(response.status).toBe(200)
    expect(response.headers['content-length']).toBe(String(content.length))
    expect(Buffer.compare(Buffer.from(response.body!), content)).toBe(0)
  })

  it('streams a clamped file slice for a Range/206 reply', async () => {
    const a = await start()

    const content = Buffer.alloc(1000)
    for (let i = 0; i < content.length; i++) content[i] = i % 251
    const replyPath = join(dirs[0]!, 'ranged.bin')
    await writeFile(replyPath, content)

    replyWhenRequestArrives(a.events, a.host, async (req) => {
      // A slice past the file's end clamps to the last byte; a negative
      // start clamps to 0 — the values crossed the bridge as peer data.
      await a.host.replyRequest(req.id as string, {
        status: 206,
        headers: { 'content-range': 'bytes 100-299/1000', 'accept-ranges': 'bytes' },
        bodyFile: pathToFileURL(replyPath).href,
        bodyFileStart: 100,
        bodyFileEnd: 299,
      })
    })

    const response = await a.host.request(
      { host: '127.0.0.1', port: a.ports.httpPort },
      { method: 'GET', path: '/file', headers: { range: 'bytes=100-299' } },
    )
    expect(response.status).toBe(206)
    expect(response.headers['content-length']).toBe('200')
    expect(Buffer.compare(Buffer.from(response.body!), content.subarray(100, 300))).toBe(0)
  })

  it('answers an empty-file reply without a read stream', async () => {
    const a = await start()

    const replyPath = join(dirs[0]!, 'empty.bin')
    await writeFile(replyPath, Buffer.alloc(0))

    replyWhenRequestArrives(a.events, a.host, async (req) => {
      await a.host.replyRequest(req.id as string, {
        status: 200,
        bodyFile: pathToFileURL(replyPath).href,
      })
    })

    const response = await a.host.request(
      { host: '127.0.0.1', port: a.ports.httpPort },
      { method: 'GET', path: '/empty' },
    )
    expect(response.status).toBe(200)
    expect(response.headers['content-length']).toBe('0')
    expect(response.body).toBeUndefined()
  })

  it('refuses to dial or broadcast outside the local network', async () => {
    const a = await start()
    await expect(a.host.request({ host: 'example.com', port: 80 }, { path: '/' })).rejects.toThrow(
      /outside the local network/,
    )
    await expect(
      a.host.sendDatagram({ host: '8.8.8.8', port: 53318 }, new Uint8Array([1])),
    ).rejects.toThrow(/outside the local network/)
  })

  it('the datagram gate sheds a flood but keeps steady announce traffic', () => {
    const gate: DatagramGate = { tokens: 0, lastMs: 0, droppedTotal: 0 }
    // Steady announce cadence: 20/s across 5 s must all pass.
    for (let ms = 0; ms <= 5_000; ms += 50) {
      expect(admitDatagram(gate, 200, ms, 40, 80, 8 * 1024)).toBe(true)
    }
    expect(gate.droppedTotal).toBe(0)
    // A burst above the bucket is shed.
    let shed = 0
    for (let i = 0; i < 200; i++) {
      if (!admitDatagram(gate, 200, 5_000, 40, 80, 8 * 1024)) shed++
    }
    expect(shed).toBeGreaterThan(0)
    expect(gate.droppedTotal).toBe(shed)
  })

  it('oversized datagrams are dropped unread regardless of budget', () => {
    const gate: DatagramGate = { tokens: 0, lastMs: 0, droppedTotal: 0 }
    expect(admitDatagram(gate, 8 * 1024 + 1, 0, 40, 80, 8 * 1024)).toBe(false)
    // The rejection must not consume rate budget.
    expect(admitDatagram(gate, 10, 0, 40, 80, 8 * 1024)).toBe(true)
  })

  it('round-trips a file uri through uriToPath', () => {
    const p = join(dirs[0]!, 'a b & c.bin')
    expect(uriToPath(pathToFileURL(p).href)).toBe(p)
  })
})
