/**
 * The adapter's mapping and containment, against a scripted native surface —
 * the guard grammar is the part that must not drift.
 */

import { describe, expect, it } from 'vitest'
import type { LanDatagram, LanRequestContext } from '@BBeBee/protocol'
import {
  base64ToBytes,
  bytesToBase64,
  createLanService,
  isPrivateLanHost,
  type NativeLanHost,
} from './adapter.js'

class NativeFake implements NativeLanHost {
  readonly sent: Array<{ host: string; port: number; dataBase64: string; broadcast?: boolean }> = []
  readonly dialed: Array<Record<string, unknown>> = []
  readonly replied: Array<Record<string, unknown>> = []
  private readonly datagramCbs = new Set<(e: { host: string; port: number; dataBase64: string }) => void>()
  private readonly requestCbs = new Set<(e: Record<string, unknown>) => void>()
  requestReply: { status: number; headers: Record<string, string>; bodyBase64?: string } = { status: 200, headers: {} }

  async start(): Promise<{ udpPort: number; httpPort: number }> {
    return { udpPort: 53318, httpPort: 53318 }
  }
  async stop(): Promise<void> {}
  async sendDatagram(options: { host: string; port: number; dataBase64: string; broadcast?: boolean }): Promise<void> {
    this.sent.push(options)
  }
  async request(options: Record<string, unknown>): Promise<{ status: number; headers: Record<string, string>; bodyBase64?: string }> {
    this.dialed.push(options)
    return this.requestReply
  }
  async replyRequest(options: Record<string, unknown>): Promise<void> {
    this.replied.push(options)
  }
  addListener(eventName: 'onLanDatagram' | 'onLanRequest', listener: (e: never) => void): { remove(): void } {
    if (eventName === 'onLanDatagram') {
      this.datagramCbs.add(listener as (e: { host: string; port: number; dataBase64: string }) => void)
    } else {
      this.requestCbs.add(listener as (e: Record<string, unknown>) => void)
    }
    return { remove: () => undefined }
  }
  emitDatagram(host: string, port: number, dataBase64: string): void {
    for (const cb of this.datagramCbs) cb({ host, port, dataBase64 })
  }
  emitRequest(event: Record<string, unknown>): void {
    for (const cb of this.requestCbs) cb(event)
  }
}

describe('isPrivateLanHost', () => {
  it('allows loopback, RFC 1918, link-local, broadcast and the discovery multicast range', () => {
    for (const host of ['127.0.0.1', 'localhost', '10.1.2.3', '192.168.1.9', '172.16.0.1', '172.31.255.255', '169.254.1.1', '255.255.255.255', '239.255.42.98']) {
      expect(isPrivateLanHost(host), host).toBe(true)
    }
  })

  it('refuses the public internet and malformed hosts', () => {
    for (const host of ['example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1', '192.169.1.1', '', '[::1]x']) {
      expect(isPrivateLanHost(host), host).toBe(false)
    }
    expect(isPrivateLanHost('[::1]')).toBe(true)
  })
})

describe('base64', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})

describe('createLanService', () => {
  it('forwards datagrams and refuses targets outside the local network', async () => {
    const native = new NativeFake()
    const service = createLanService(native)
    const seen: LanDatagram[] = []
    service.onDatagram((d) => seen.push(d))
    native.emitDatagram('192.168.1.9', 53318, bytesToBase64(new Uint8Array([1, 2, 3])))
    expect(seen).toHaveLength(1)
    expect(seen[0]!.data).toEqual(new Uint8Array([1, 2, 3]))

    await expect(
      service.sendDatagram({ host: '8.8.8.8', port: 53318 }, new Uint8Array([1])),
    ).rejects.toThrow(/outside the local network/)
    await expect(
      service.request({ host: 'example.com', port: 80 }, { path: '/' }),
    ).rejects.toThrow(/outside the local network/)

    await service.sendDatagram({ host: '239.255.42.98', port: 53318 }, new Uint8Array([9]), { broadcast: true })
    expect(native.sent[0]).toMatchObject({ host: '239.255.42.98', port: 53318, broadcast: true })
  })

  it('delivers inbound requests and answers them on the native side', async () => {
    const native = new NativeFake()
    const service = createLanService(native)
    service.onRequest((req: LanRequestContext) => {
      req.reply({ status: 206, headers: { 'content-range': 'bytes 0-9/100' }, bodyFile: 'file:///data/x.flac', bodyFileStart: 0, bodyFileEnd: 9 })
    })
    native.emitRequest({ id: 'req-1', method: 'GET', url: 'http://192.168.1.9:53318/x', headers: {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(native.replied[0]).toMatchObject({ id: 'req-1', status: 206, bodyFile: 'file:///data/x.flac', bodyFileStart: 0, bodyFileEnd: 9 })
  })

  it('refuses a reply body file outside the allowed roots', async () => {
    const native = new NativeFake()
    const service = createLanService(native, {
      isAllowedFile: (uri) => uri.startsWith('file:///data/'),
    })
    service.onRequest((req) => {
      req.reply({ status: 200, bodyFile: 'file:///etc/passwd' })
    })
    native.emitRequest({ id: 'req-2', method: 'GET', url: 'http://h/x', headers: {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(native.replied).toHaveLength(0)

    service.onRequest((req) => {
      req.reply({ status: 200, bodyFile: 'file:///data/ok.flac' })
    })
    native.emitRequest({ id: 'req-3', method: 'GET', url: 'http://h/x', headers: {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(native.replied[0]).toMatchObject({ id: 'req-3', bodyFile: 'file:///data/ok.flac' })
  })

  it('decodes outbound responses from base64', async () => {
    const native = new NativeFake()
    native.requestReply = { status: 200, headers: { 'content-type': 'application/json' }, bodyBase64: bytesToBase64(new TextEncoder().encode('{"ok":true}')) }
    const service = createLanService(native)
    const response = await service.request({ host: '192.168.1.9', port: 53318 }, { method: 'GET', path: '/api/x' })
    expect(response.status).toBe(200)
    expect(new TextDecoder().decode(response.body)).toBe('{"ok":true}')
    expect(native.dialed[0]).toMatchObject({ host: '192.168.1.9', port: 53318, method: 'GET', path: '/api/x' })
  })

  it('tracks running state through start/stop', async () => {
    const native = new NativeFake()
    const service = createLanService(native)
    expect(service.running).toBe(false)
    const ports = await service.start({ udpPort: 53318, httpPort: 53318, multicastGroup: '239.255.42.98' })
    expect(ports).toEqual({ udpPort: 53318, httpPort: 53318 })
    expect(service.running).toBe(true)
    await service.stop()
    expect(service.running).toBe(false)
  })
})
