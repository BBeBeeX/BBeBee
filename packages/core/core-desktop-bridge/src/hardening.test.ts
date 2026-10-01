/**
 * Main-side hardening.
 *
 * The renderer is one security domain, so the per-plugin gate in
 * `FsBridge`/`DbBridge` constrains a *cooperating* plugin only — anything in
 * the renderer can call `window.BBeBeeBridge` directly. These pin the limits
 * that do not depend on knowing who is calling, and which therefore still hold
 * against a bypass.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHost, type IpcHost } from './main.js'
import { CH, unwrapBridgeResult } from './protocol.js'
import { tempDir } from '@BBeBee/kernel/testing'

let root: string
beforeAll(async () => {
  root = await tempDir('bbebee-hard')
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

interface Sender {
  id: number
  once(event: string, listener: () => void): void
  destroy(): void
}

function fakeIpc() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const host: IpcHost = {
    handle: (channel, listener) => void handlers.set(channel, listener as never),
    removeHandler: (channel) => void handlers.delete(channel),
  }
  /** A renderer session that can be "destroyed", as a reload would. */
  const makeSender = (id: number): Sender => {
    const listeners: (() => void)[] = []
    return {
      id,
      once: (_event, listener) => void listeners.push(listener),
      destroy: () => listeners.splice(0).forEach((l) => l()),
    }
  }
  const invoke = (sender: Sender | undefined, channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return handler({ sender }, ...args)
  }
  return { host, invoke, makeSender }
}

async function harness(overrides: Parameters<typeof createHost>[1] = {}) {
  const dir = await mkdtemp(join(root, 'h-'))
  const { host, invoke, makeSender } = fakeIpc()
  const layout: Record<string, string> = {
    userData: join(dir, 'data'),
    cache: join(dir, 'cache'),
    temp: join(dir, 'tmp'),
    logs: join(dir, 'data', 'logs'),
    downloads: join(dir, 'downloads'),
    music: join(dir, 'music'),
  }
  const hostHandle = await createHost(host, {
    appName: 'BBeBee',
    resolvePath: (kind) => layout[kind],
    ...overrides,
  })
  const call = async (method: string, args: unknown[], service = 'fs', token?: string) =>
    unwrapBridgeResult(await invoke(undefined, CH.call, service, method, args, token))
  return { dir, layout, call, invoke, makeSender, hostHandle }
}

describe('containment', () => {
  it('refuses a path outside every application directory', async () => {
    // The bridge is reachable from any renderer code, so this limit is what
    // actually stops `writeFile('/etc/...')` — not the renderer-side gate.
    const { call } = await harness()
    await expect(call('readFile', ['file:///etc/passwd'])).rejects.toThrow(/outside every/)
    await expect(call('writeFile', ['file:///tmp/pwned', 'x'])).rejects.toThrow(/outside every/)
  })

  it('allows paths inside the app directories', async () => {
    const { call, layout } = await harness()
    const uri = pathToFileURL(join(layout['cache']!, 'ok.txt')).href
    await call('mkdir', [pathToFileURL(layout['cache']!).href, { recursive: true }])
    await expect(call('writeFile', [uri, 'fine'])).resolves.toBeUndefined()
  })

  it('checks both operands of a move', async () => {
    const { call, layout } = await harness()
    const inside = pathToFileURL(join(layout['cache']!, 'a.txt')).href
    await call('mkdir', [pathToFileURL(layout['cache']!).href, { recursive: true }])
    await call('writeFile', [inside, 'x'])
    await expect(call('move', [inside, 'file:///tmp/escape'])).rejects.toThrow(/outside every/)
  })

  it('refuses a stream opened outside the app directories', async () => {
    const { invoke } = await harness()
    await expect(invoke(undefined, CH.streamOpen, 'file:///etc/passwd')).rejects.toThrow(
      /outside every/,
    )
  })

  it('logs audio call header names but never their values', async () => {
    // Source headers can carry credentials (a Subsonic `Cookie`, an
    // `Authorization`) and the audio log line embeds its args.
    const lines: string[] = []
    const { call } = await harness({
      logger: { info: (message: string) => void lines.push(message) },
    })
    await call('mpvLoad', [
      'https://cdn.example.com/song.m4s',
      { strategy: 'stream', headers: { Cookie: 'sid=super-secret', Referer: 'https://www.example.com' } },
    ], 'audio')
    const logged = lines.join('\n')
    expect(logged).toContain('mpvLoad')
    expect(logged).toContain('Cookie')
    expect(logged).toContain('Referer')
    expect(logged).not.toContain('super-secret')
  })
})

describe('method allowlist', () => {
  it('refuses inherited and non-business members', async () => {
    // Without an allowlist, `constructor` and every Object.prototype member
    // are reachable, and main's surface grows with any method a service gains.
    const { call } = await harness()
    for (const method of ['constructor', 'hasOwnProperty', 'toString', 'check', 'scopeOf']) {
      await expect(call(method, []), method).rejects.toThrow(/not callable over the bridge/)
    }
  })

  it('refuses an unknown service', async () => {
    const { call } = await harness()
    await expect(call('exists', ['file:///x'], 'secrets')).rejects.toThrow(/unknown service/)
  })
})

describe('sql limits', () => {
  it('refuses ATTACH, which would be an arbitrary-file primitive', async () => {
    // ATTACH turns the database handle into read/write on any path, which
    // would make the containment checks above pointless.
    const { call, dir } = await harness()
    await expect(
      call('exec', [`ATTACH DATABASE '${join(dir, 'evil.db')}' AS evil`], 'db'),
    ).rejects.toThrow(/may not issue ATTACH/)
    await expect(call('exec', ['DETACH DATABASE evil'], 'db')).rejects.toThrow(/may not issue/)
  })

  it('refuses VACUUM INTO, which is the same primitive by another name', async () => {
    // The bridge kept its own list of forbidden SQL, and it had drifted: the
    // kernel's carried VACUUM INTO and the bridge's did not, so one call from
    // the renderer wrote a database file to any path the process could reach.
    // Both paths now share `assertSqlAllowed`.
    const { call, dir } = await harness()
    const target = join(dir, 'exfil.db')
    await expect(call('exec', [`VACUUM INTO '${target}'`], 'db')).rejects.toThrow(
      /may not issue VACUUM INTO/,
    )
    expect(existsSync(target), 'VACUUM INTO must not have written a file').toBe(false)
  })
})

describe('stream handles are bounded', () => {
  it('refuses to open more than the cap', async () => {
    // Each reader holds a file descriptor; an unbounded loop would exhaust
    // main's descriptors.
    const { invoke, layout } = await harness({ maxOpenStreams: 3 })
    const file = join(layout['cache']!, 'stream.txt')
    await writeFile(join(layout['cache']!, '.keep'), '', { flag: 'w' }).catch(async () => {
      await rm(layout['cache']!, { recursive: true, force: true })
    })
    await invoke(undefined, CH.call, 'fs', 'mkdir', [
      pathToFileURL(layout['cache']!).href,
      { recursive: true },
    ])
    await writeFile(file, 'hello')

    const uri = pathToFileURL(file).href
    for (let i = 0; i < 3; i++) await invoke(undefined, CH.streamOpen, uri)
    await expect(invoke(undefined, CH.streamOpen, uri)).rejects.toThrow(/too many open streams/)
  })
})

describe('transaction lifecycle', () => {
  it('rolls back when the renderer session is destroyed', async () => {
    // THE reload case: an Electron renderer reload destroys its WebContents
    // without ever sending txEnd. Without this, main's db queue would be
    // blocked behind the open transaction forever and the app is bricked
    // until restart.
    const { invoke, makeSender, call } = await harness()
    const sender = makeSender(1)

    await invoke(sender, CH.call, 'db', 'exec', ['CREATE TABLE t (a TEXT)'])
    const token = (await invoke(sender, CH.txBegin)) as string
    await invoke(sender, CH.call, 'db', 'exec', ['INSERT INTO t VALUES (?)', ['ghost']], token)

    sender.destroy() // renderer reload

    // The queue must be usable again, and the orphaned write rolled back.
    const rows = (await call('query', ['SELECT a FROM t'], 'db')) as { a: string }[]
    expect(rows).toEqual([])
  })

  it('rolls back an abandoned transaction after the idle timeout', async () => {
    const { invoke, call } = await harness({ transactionIdleMs: 80 })
    await call('exec', ['CREATE TABLE t (a TEXT)'], 'db')

    const token = (await invoke(undefined, CH.txBegin)) as string
    await invoke(undefined, CH.call, 'db', 'exec', ['INSERT INTO t VALUES (?)', ['x']], token)

    await new Promise((r) => setTimeout(r, 250))

    // Main recovered on its own — no txEnd ever arrived.
    const rows = (await call('query', ['SELECT a FROM t'], 'db')) as { a: string }[]
    expect(rows).toEqual([])
  })

  it('refuses a second concurrent transaction for one session', async () => {
    // The second would queue behind the first, so `started` would never
    // resolve and the renderer would await forever. Fail fast instead.
    const { invoke, makeSender } = await harness()
    const sender = makeSender(7)
    await invoke(sender, CH.txBegin)
    await expect(invoke(sender, CH.txBegin)).rejects.toThrow(/already open for this session/)
  })
})

describe('the system surface', () => {
  it('routes a call to the OS integration the app supplied', async () => {
    const held: { id: number; reason: string }[] = []
    const { call } = await harness({
      system: { acquireWakeLock: (id, reason) => void held.push({ id, reason }) },
    })

    await call('acquireWakeLock', [1, 'playing'], 'system')
    expect(held).toEqual([{ id: 1, reason: 'playing' }])
  })

  it('is a no-op where the app supplied no integration', async () => {
    // A Linux box with no MPRIS daemon, or a build without globalShortcut,
    // must cost the feature and not the call — the renderer has nothing
    // useful to do with an exception here.
    const { call } = await harness()
    await expect(call('publishNowPlaying', [{ title: 'x' }], 'system')).resolves.toBeUndefined()
    await expect(call('registerHotkey', ['MediaPlayPause'], 'system')).resolves.toBeUndefined()
  })

  it('refuses a system method that is not on the allowlist', async () => {
    // The allowlist is what stops the surface growing silently with every
    // method someone adds to the host object.
    const { call } = await harness({ system: {} })
    await expect(call('constructor', [], 'system')).rejects.toThrow(/not callable/)
    await expect(call('toString', [], 'system')).rejects.toThrow(/not callable/)
  })

  it('pushes an event to the renderer only through broadcast', async () => {
    const seen: unknown[] = []
    const { host, invoke } = fakeIpc()
    const hostHandle = await createHost(
      { ...host, broadcast: (_channel, payload) => void seen.push(payload) },
      { appName: 'BBeBee', resolvePath: () => join(root, 'ev') },
    )
    hostHandle.emit({ topic: 'will-suspend' })
    expect(seen).toEqual([{ topic: 'will-suspend' }])
    void invoke
    await hostHandle.dispose()
  })

  it('emitting without a broadcast channel is harmless', async () => {
    // A headless host — every test harness — has no renderer to push to.
    const { hostHandle } = await harness()
    expect(() => hostHandle.emit({ topic: 'media-key', key: 'next' })).not.toThrow()
  })
})
