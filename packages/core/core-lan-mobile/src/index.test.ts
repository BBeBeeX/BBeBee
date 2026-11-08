import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type {
  Disposable,
  LanReply,
  LanRequest,
  LanRequestContext,
  LanService,
} from '@BBeBee/protocol'
import { LanMobile } from './index.js'

class TransportFake extends Service implements LanService {
  runningState = false
  private readonly handlers = new Set<(r: LanRequestContext) => void>()
  replySpy: LanReply | undefined

  constructor(ctx: Context) {
    super(ctx, 'lan')
  }

  async start(): Promise<{ udpPort: number; httpPort: number }> {
    this.runningState = true
    return { udpPort: 53318, httpPort: 53318 }
  }
  async stop(): Promise<void> {
    this.runningState = false
  }
  get running(): boolean {
    return this.runningState
  }
  async sendDatagram(): Promise<void> {}
  onDatagram(_cb: (d: never) => void): Disposable {
    return () => undefined
  }
  onRequest(cb: (r: LanRequestContext) => void): Disposable {
    this.handlers.add(cb)
    return () => this.handlers.delete(cb)
  }
  async request(target: { host: string; port: number }, req: LanRequest): Promise<{ status: number; headers: Record<string, string> }> {
    void target
    void req
    return { status: 200, headers: {} }
  }

  emitRequest(id: string): void {
    for (const cb of this.handlers) {
      cb({
        id,
        method: 'GET',
        url: 'http://192.168.1.9:53318/x',
        headers: {},
        reply: (reply) => {
          this.replySpy = reply
        },
      })
    }
  }

  resetHandlers(): void {
    this.handlers.clear()
  }
}

async function serviceWith(roots: string[], transport: LanService) {
  const ctx = new Context()
  await ctx.plugin(LanMobile, { transport, allowedFileRoots: roots })
  return ctx.lan as LanMobile
}

describe('LanMobile', () => {
  it('forwards start/stop to the transport', async () => {
    const transport = new TransportFake(new Context())
    const service = await serviceWith(['/data'], transport)
    expect(service.running).toBe(false)
    const ports = await service.start({ udpPort: 53318, httpPort: 53318, multicastGroup: '239.255.42.98' })
    expect(ports).toEqual({ udpPort: 53318, httpPort: 53318 })
    expect(service.running).toBe(true)
    await service.stop()
    expect(service.running).toBe(false)
  })

  it('refuses reply body files outside the allowed roots', async () => {
    const transport = new TransportFake(new Context())
    const service = await serviceWith(['file:///data/app'], transport)
    service.onRequest((req) => {
      req.reply({ status: 200, bodyFile: 'file:///data/app/media/song.flac' })
    })
    transport.emitRequest('req-1')
    expect(transport.replySpy?.status).toBe(200)
    expect(transport.replySpy?.bodyFile).toBe('file:///data/app/media/song.flac')

    // A reply naming a file outside every root is replaced with a refusal —
    // the file never reaches the socket.
    transport.replySpy = undefined as LanReply | undefined
    transport.resetHandlers()
    service.onRequest((req) => {
      req.reply({ status: 200, bodyFile: 'file:///etc/passwd' })
    })
    transport.emitRequest('req-2')
    expect(transport.replySpy?.status).toBe(500)
    expect(transport.replySpy?.bodyFile).toBeUndefined()
  })

  it('tolerates a missing transport by staying inert', async () => {
    const ctx = new Context()
    await ctx.plugin(LanMobile, {})
    const service = ctx.lan as LanMobile
    expect(service.running).toBe(false)
    await expect(service.start({ udpPort: 0, httpPort: 0, multicastGroup: 'g' })).rejects.toThrow(/missing/)
    expect(service.onDatagram(() => undefined)()).toBeUndefined()
    expect(service.onRequest(() => undefined)()).toBeUndefined()
  })
})
