import { afterAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { CapabilityError, type Capability } from '@BBeBee/protocol'
import { scopeContext } from '@BBeBee/kernel'
import type { BridgeApi, BridgeEvent } from '@bbebee/core-desktop-bridge'
import { LanBridge } from './bridge.js'

const REAL_WINDOW = (globalThis as { window?: unknown }).window

function installBridge(overrides: Partial<BridgeApi> = {}): {
  calls: Array<{ service: string; method: string; args: unknown[] }>
  handlers: Array<(event: BridgeEvent) => void>
} {
  const calls: Array<{ service: string; method: string; args: unknown[] }> = []
  const handlers: Array<(event: BridgeEvent) => void> = []
  const bridge: BridgeApi = {
    call: async (service, method, args) => {
      calls.push({ service, method, args })
      if (method === 'start') {
        return { __bbebee_bridge__: true, ok: true, result: { udpPort: 53318, httpPort: 53318 } }
      }
      return { __bbebee_bridge__: true, ok: true, result: null }
    },
    streamOpen: async () => 0,
    streamPull: async () => null,
    streamClose: async () => undefined,
    txBegin: async () => 'tx',
    txEnd: async () => undefined,
    on: (handler: (event: BridgeEvent) => void) => {
      handlers.push(handler)
      return () => handlers.splice(handlers.indexOf(handler), 1)
    },
    ...overrides,
  }
  ;(globalThis as { window?: unknown }).window = { BBeBeeBridge: bridge }
  return { calls, handlers }
}

afterAll(() => {
  ;(globalThis as { window?: unknown }).window = REAL_WINDOW
})

async function pluggedLan(requested: Capability[] = ['lan']): Promise<{
  ctx: Context
  lan: LanBridge
  scoped: Context
}> {
  const ctx = new Context()
  await ctx.plugin(LanBridge)
  const scoped = scopeContext(ctx, { pluginId: '@bbebee/plugin-lan-share', requested })
  return { ctx, lan: ctx.lan as unknown as LanBridge, scoped: scoped as Context }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('LanBridge', () => {
  it('refuses an ungranted caller before any call crosses the bridge', async () => {
    const { calls } = installBridge()
    const { scoped } = await pluggedLan([])
    const lan = (scoped as never as { lan: LanBridge }).lan
    await expect(lan.start({ udpPort: 0, httpPort: 0, multicastGroup: '239.0.0.1' })).rejects.toThrow(
      CapabilityError,
    )
    expect(calls).toHaveLength(0)
  })

  it('forwards calls and unwraps the envelope', async () => {
    const { calls } = installBridge()
    const { scoped } = await pluggedLan()
    const lan = (scoped as never as { lan: LanBridge }).lan

    const ports = await lan.start({ udpPort: 53318, httpPort: 53318, multicastGroup: '239.255.42.98' })
    expect(ports).toEqual({ udpPort: 53318, httpPort: 53318 })
    expect(calls.at(-1)).toMatchObject({ service: 'lan', method: 'start' })
    expect(lan.running).toBe(true)

    await lan.sendDatagram({ host: '192.168.1.5', port: 53318 }, new TextEncoder().encode('x'))
    const datagram = calls.at(-1)!
    expect(datagram.method).toBe('sendDatagram')
    // Data crosses as base64, not as a JSON-mangled byte object.
    expect(datagram.args[1]).toBe(btoa('x'))
    expect(datagram.args[2]).toEqual({})
  })

  it('fans bridge events out to datagram and request subscribers', async () => {
    const installed = installBridge()
    const { calls } = installed
    const ctx = new Context()
    await ctx.plugin(LanBridge)
    const bridgeLan = ctx.lan as unknown as LanBridge

    const seen: Array<{ host: string; port: number; data: string }> = []
    bridgeLan.onDatagram((d) =>
      seen.push({ host: d.host, port: d.port, data: Buffer.from(d.data).toString('utf8') }),
    )

    const requests: Array<{ id: string; bodyText?: string }> = []
    bridgeLan.onRequest((req) => {
      requests.push({
        id: req.id,
        ...(req.bodyBytes ? { bodyText: Buffer.from(req.bodyBytes).toString('utf8') } : {}),
      })
      req.reply({ status: 202, body: new TextEncoder().encode('accepted') })
    })

    installed.handlers[0]!({
      topic: 'lan-datagram',
      host: '192.168.1.9',
      port: 40000,
      data: btoa('announce'),
    })
    installed.handlers[0]!({
      topic: 'lan-request',
      id: 'r1',
      method: 'POST',
      url: 'http://192.168.1.9:53318/api',
      headers: {},
      body: btoa('offer'),
    })
    await tick()

    expect(seen.at(-1)?.data).toBe('announce')
    expect(requests.at(-1)?.bodyText).toBe('offer')
    const replyCall = calls.find((c) => c.method === 'replyRequest')
    expect(replyCall).toBeDefined()
    expect(replyCall!.args[0]).toBe('r1')
    expect(replyCall!.args[1]).toMatchObject({ status: 202, body: btoa('accepted') })
  })

  it('subscribing twice shares one bridge subscription', async () => {
    const installed = installBridge()
    await pluggedLan()
    const ctx = new Context()
    await ctx.plugin(LanBridge)
    const bridgeLan = ctx.lan as unknown as LanBridge
    const off1 = bridgeLan.onDatagram(() => undefined)
    const off2 = bridgeLan.onDatagram(() => undefined)
    expect(installed.handlers).toHaveLength(1)
    off1()
    off2()
  })
})
