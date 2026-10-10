import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import type { HttpRequest, HttpResponse, SecretsService } from '@BBeBee/protocol'
import plugin, { type Sources } from './index.js'

function inMemorySecrets(): SecretsService {
  const store = new Map<string, string>()
  const createService = (prefix = ''): SecretsService => ({
    isHardwareBacked: true,
    maxValueBytes: 2048,
    async get(key: string) {
      return store.get(`${prefix}:${key}`)
    },
    async set(key: string, value: string) {
      store.set(`${prefix}:${key}`, value)
    },
    async delete(key: string) {
      store.delete(`${prefix}:${key}`)
    },
    async clear() {
      for (const k of store.keys()) {
        if (k.startsWith(`${prefix}:`)) store.delete(k)
      }
    },
    namespace(ns: string) {
      return createService(`${prefix}:${ns}`)
    },
  })
  return createService('test')
}

async function harness(httpHandler?: (req: HttpRequest) => Promise<HttpResponse>) {
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-sources-params') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })

  const secrets = inMemorySecrets()
  ctx.provide('secrets', secrets)

  if (httpHandler) {
    ctx.provide('http', Object.assign(httpHandler, {
      cookies: {
        jar: () => ({
          ready: Promise.resolve(),
          get: async () => [],
          set: async () => {},
          all: async () => [],
          destroy: async () => {},
        }),
      },
    }))
  }

  await ctx.plugin(plugin, {})
  await tick()
  return { ctx, sources: ctx.sources as Sources, secrets }
}

const SUBSONIC_DOC = JSON.stringify({
  sourceUrl: 'https://music.example.org',
  sourceName: 'My Subsonic',
  sourceGroup: 'self-hosted,subsonic',
  loginUi: [
    { id: 'user', label: 'Username', type: 'text' },
    { id: 'password', label: 'Password', type: 'password' },
  ],
  ruleStream: { url: '=https://music.example.org/stream' },
})

describe('Source parameters storage & security boundary', () => {
  it('writes secrets to ctx.secrets and non-credentials to SQLite source_vars', async () => {
    const { sources, secrets } = await harness()
    const report = await sources.import(SUBSONIC_DOC)
    const sourceId = report.added[0]!.id

    await sources.updateSourceParams(sourceId, {
      vars: {
        custom_bitrate: '320k',
        theme_preference: 'dark',
      },
      secrets: {
        user: 'alice',
        password: 'super_secret_password',
      },
    })

    // Check non-credentials in SQLite source_vars
    const dbVars = await sources.readVars(sourceId)
    expect(dbVars.custom_bitrate).toBe('320k')
    expect(dbVars.theme_preference).toBe('dark')
    // Credentials MUST NOT leak into SQLite source_vars!
    expect(dbVars.user).toBeUndefined()
    expect(dbVars.password).toBeUndefined()

    // Check credentials in ctx.secrets
    const ns = secrets.namespace(sourceId)
    expect(await ns.get('user')).toBe('alice')
    expect(await ns.get('password')).toBe('super_secret_password')

    // Check getSourceParams: non-credentials returned, secrets masked/status reported
    const params = await sources.getSourceParams(sourceId)
    expect(params.sourceUrl).toBe('https://music.example.org')
    expect(params.vars.custom_bitrate).toBe('320k')
    expect(params.hasSecrets.user).toBe(true)
    expect(params.hasSecrets.password).toBe(true)
  })

  it('updates host and recomputes allowedHosts', async () => {
    const { sources } = await harness()
    const report = await sources.import(SUBSONIC_DOC)
    const sourceId = report.added[0]!.id

    expect(sources.source(sourceId)!.allowedHosts).toEqual(['music.example.org'])

    await sources.updateSourceUrl(sourceId, 'https://home-nas.internal:4533')

    const updated = sources.source(sourceId)!
    expect(updated.sourceUrl).toBe('https://home-nas.internal:4533')
    expect(updated.doc.sourceUrl).toBe('https://home-nas.internal:4533')
    expect(updated.allowedHosts).toEqual(['home-nas.internal'])
  })
})

describe('Subsonic connectivity test (3-state verification)', () => {
  it('returns ok on successful Subsonic ping', async () => {
    const { sources } = await harness(async (req) => {
      expect(req.url).toContain('/rest/ping.view')
      expect(req.url).toContain('u=alice')
      expect(req.url).toContain('p=secret')
      return {
        status: 200,
        headers: {},
        text: async () => JSON.stringify({
          'subsonic-response': {
            status: 'ok',
            version: '1.16.1',
          },
        }),
        json: async () => ({
          'subsonic-response': { status: 'ok', version: '1.16.1' },
        }),
        blob: async () => new Blob([]),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as HttpResponse
    })

    const report = await sources.import(SUBSONIC_DOC)
    const sourceId = report.added[0]!.id

    const result = await sources.testConnection(sourceId, {
      host: 'https://music.example.org',
      user: 'alice',
      password: 'secret',
    })

    expect(result.status).toBe('ok')
    expect(result.message).toContain('连接成功')
    expect(result.message).toContain('v1.16.1')
    expect(typeof result.latencyMs).toBe('number')
  })

  it('returns auth_failed on wrong password or code 40', async () => {
    const { sources } = await harness(async () => {
      return {
        status: 200,
        headers: {},
        text: async () => JSON.stringify({
          'subsonic-response': {
            status: 'failed',
            error: {
              code: 40,
              message: 'Wrong username or password',
            },
          },
        }),
        json: async () => ({}),
        blob: async () => new Blob([]),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as HttpResponse
    })

    const report = await sources.import(SUBSONIC_DOC)
    const sourceId = report.added[0]!.id

    const result = await sources.testConnection(sourceId, {
      host: 'https://music.example.org',
      user: 'alice',
      password: 'wrong_password',
    })

    expect(result.status).toBe('auth_failed')
    expect(result.message).toContain('Wrong username or password')
  })

  it('returns auth_failed on HTTP 401 response', async () => {
    const { sources } = await harness(async () => {
      return {
        status: 401,
        headers: {},
        text: async () => 'Unauthorized',
        json: async () => ({}),
        blob: async () => new Blob([]),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as HttpResponse
    })

    const report = await sources.import(SUBSONIC_DOC)
    const sourceId = report.added[0]!.id

    const result = await sources.testConnection(sourceId, {
      host: 'https://music.example.org',
      user: 'alice',
      password: 'wrong_password',
    })

    expect(result.status).toBe('auth_failed')
    expect(result.message).toContain('401')
  })

  it('returns network_error on connection refusal or timeout', async () => {
    const { sources } = await harness(async () => {
      throw new Error('connect ECONNREFUSED 192.168.1.100:4533')
    })

    const report = await sources.import(SUBSONIC_DOC)
    const sourceId = report.added[0]!.id

    const result = await sources.testConnection(sourceId, {
      host: 'https://unreachable.local:4533',
      user: 'alice',
      password: 'any',
    })

    expect(result.status).toBe('network_error')
    expect(result.message).toContain('ECONNREFUSED')
  })
})
