/**
 * The codec over the bridge, end to end.
 *
 * Verifies that `CodecBridge` (renderer) forwards tag reads to the sidecar's
 * `CodecNode`, where the parse runs over direct fs. If this passes, the claim
 * "tag parsing happens in the sidecar" rests on the bridge actually routing
 * the calls — not on it having compiled.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { CodecBridge, DbBridge, FsBridge, PathsBridge, fetchPaths } from './index.js'
import { createHost, type IpcHost } from './main.js'
import type { BridgeApi, BridgeEvent } from './protocol.js'
import { unwrapBridgeResult } from './protocol.js'

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'bbebee-codec-bridge-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/* ── minimal MP3 fixture (ID3v2.3 tag + fake audio) ── */

function frame(id: string, body: Uint8Array): Uint8Array {
  const size = body.length
  return new Uint8Array([
    ...new TextEncoder().encode(id),
    (size >> 24) & 0xff,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    0x00,
    0x00,
    ...body,
  ])
}

function textFrame(id: string, value: string): Uint8Array {
  const body = new Uint8Array([0x03, ...new TextEncoder().encode(value)])
  return frame(id, body)
}

function taggedMp3(title: string): Uint8Array {
  const frames = [textFrame('TIT2', title), textFrame('TPE1', 'Test Artist')]
  const body = frames.reduce<number[]>((all, f) => [...all, ...f], [])
  const size = body.length
  const header = [
    ...new TextEncoder().encode('ID3'),
    0x03,
    0x00,
    0x00,
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]
  // Minimal MPEG frame header + padding — enough for the parser.
  const audio = new Uint8Array(1024).fill(0)
  audio[0] = 0xff
  audio[1] = 0xfb
  return new Uint8Array([...header, ...body, ...audio])
}

/* ── bridge harness (mirrors bridge.test.ts) ── */

function fakeIpc() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const host: IpcHost = {
    handle: (channel, listener) => void handlers.set(channel, listener as never),
    removeHandler: (channel) => void handlers.delete(channel),
  }
  const invoke = async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return handler({}, ...args)
  }
  return { host, invoke }
}

async function makeCodecBridge(dir: string) {
  const { host, invoke } = fakeIpc()
  const layout: Record<string, string> = {
    userData: join(dir, 'data'),
    cache: join(dir, 'cache'),
    temp: join(dir, 'tmp'),
    logs: join(dir, 'data', 'logs'),
    downloads: join(dir, 'downloads'),
    music: join(dir, 'music'),
  }
  const pushed = new Set<(e: BridgeEvent) => void>()
  await createHost(
    {
      ...host,
      broadcast: (_channel, payload) => {
        for (const handler of [...pushed]) handler(payload as BridgeEvent)
      },
    },
    { appName: 'BBeBee', resolvePath: (kind) => layout[kind] },
  )

  const api: BridgeApi = {
    call: async (service, method, args, token) => {
      const res = await invoke('BBeBee:call', service, method, args, token)
      return unwrapBridgeResult(res)
    },
    streamOpen: (u, range) => invoke('BBeBee:stream:open', u, range) as Promise<number>,
    streamPull: (handle) => invoke('BBeBee:stream:pull', handle) as Promise<Uint8Array | null>,
    streamClose: (handle) => invoke('BBeBee:stream:close', handle) as Promise<void>,
    txBegin: () => invoke('BBeBee:tx:begin') as Promise<string>,
    txEnd: (token, commit) => invoke('BBeBee:tx:end', token, commit) as Promise<void>,
    on: (handler) => {
      pushed.add(handler)
      return () => void pushed.delete(handler)
    },
  }
  ;(globalThis as { window?: unknown }).window = { BBeBeeBridge: api }

  const snapshot = await fetchPaths(api)
  const ctx = new Context()
  await ctx.plugin(PathsBridge, snapshot)
  await ctx.plugin(FsBridge)
  await ctx.plugin(DbBridge)
  await ctx.plugin(CodecBridge, { supportedFormats: ['mp3'] })
  return ctx
}

describe('codec over the bridge', () => {
  it('reads tags via the sidecar', async () => {
    const ctx = await makeCodecBridge(root)
    const musicDir = join(root, 'music')
    await mkdir(musicDir, { recursive: true })
    await writeFile(join(musicDir, 'test.mp3'), taggedMp3('Bridge Test Title'))
    const uri = pathToFileURL(join(musicDir, 'test.mp3')).href

    const meta = await ctx.codec.readMetadata(uri)
    expect(meta.title).toBe('Bridge Test Title')
    expect(meta.artist).toBe('Test Artist')
  })

  it('returns undefined artwork for a file without a cover', async () => {
    const ctx = await makeCodecBridge(root)
    const musicDir = join(root, 'music')
    await mkdir(musicDir, { recursive: true })
    await writeFile(join(musicDir, 'plain.mp3'), taggedMp3('No Cover'))
    const uri = pathToFileURL(join(musicDir, 'plain.mp3')).href

    const art = await ctx.codec.readArtwork(uri)
    expect(art).toBeUndefined()
  })

  it('rejects uris outside the app directories', async () => {
    const ctx = await makeCodecBridge(root)
    // /etc/hostname is outside every bridge root.
    await expect(ctx.codec.readMetadata('file:///etc/hostname')).rejects.toThrow(
      /outside every application directory/,
    )
  })
})
