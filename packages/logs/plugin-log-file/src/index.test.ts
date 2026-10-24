/**
 * Log transports.
 *
 * The redaction tests matter most: a log file the user is about to attach to a
 * bug report must not carry their credentials.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { redact, redactString } from '@BBeBee/protocol'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import type { LogBuffer } from '@bbebee/plugin-log-buffer'
import logBuffer from '@bbebee/plugin-log-buffer'
import logFile from '../src/index.js'
import { tempDir } from '@BBeBee/kernel/testing'

let root: string

beforeAll(async () => {
  root = await tempDir('bbebee-log')
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function bootLogging(config: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(root, 'log-'))
  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: dir })
  await ctx.plugin(FsNode)
  const fiber = await ctx.plugin(logFile, { flushDelayMs: 0, ...config })
  return { ctx, fiber, dir }
}

/** Give the transport's queued write a chance to land. */
const settle = () => new Promise((r) => setTimeout(r, 60))

describe('redaction', () => {
  it('strips sensitive keys at any depth', () => {
    const out = redact({
      url: 'https://music.example.org',
      headers: { Authorization: 'Bearer abc123', 'X-Api-Key': 'k' },
      nested: { config: { password: 'hunter2' } },
    }) as Record<string, Record<string, unknown>>

    expect(out['headers']!['Authorization']).toBe('[redacted]')
    expect(out['headers']!['X-Api-Key']).toBe('[redacted]')
    expect((out['nested']!['config'] as Record<string, unknown>)['password']).toBe('[redacted]')
    // Non-sensitive values survive, or the logs become useless.
    expect(out['url']).toBe('https://music.example.org')
  })

  it('strips credentials embedded in strings', () => {
    expect(redactString('GET https://u:pw@host/x')).toContain('[redacted]@')
    expect(redactString('?token=abc123&q=hi')).toBe('?token=[redacted]&q=hi')
    expect(redactString('Authorization: Bearer abcdef123456')).toContain('Bearer [redacted]')
  })

  it('leaves ordinary text alone', () => {
    const message = 'scanned 1200 files in /music/Bjork'
    expect(redactString(message)).toBe(message)
  })

  it('does not recurse without bound', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(() => redact(cyclic)).not.toThrow()
  })

  it('keeps "author" — a substring match is not a credential', () => {
    // 'author' contains 'auth'. Redacting it would strip every track's
    // artist credit out of the logs.
    const out = redact({ author: 'Björk', authority: 'x' }) as Record<string, unknown>
    expect(out['author']).toBe('Björk')
    expect(out['authority']).toBe('x')
  })

  it('covers the credential keys that were missing', () => {
    const out = redact({
      pwd: 'a',
      passphrase: 'b',
      private_key: 'c',
      client_secret: 'd',
    }) as Record<string, unknown>
    for (const key of ['pwd', 'passphrase', 'private_key', 'client_secret']) {
      expect(out[key], key).toBe('[redacted]')
    }
  })

  it('redacts OAuth codes and passwordless userinfo in urls', () => {
    // An authorization code is a bearer credential for its short life, and
    // redirect URLs carrying one land in logs constantly.
    expect(redactString('?code=abc123&state=xyz')).toBe('?code=[redacted]&state=[redacted]')
    expect(redactString('https://gh_tokenvalue@api.example.org/x')).toContain('[redacted]@')
  })

  it('survives values JSON.stringify would reject', () => {
    // A BigInt reaching JSON.stringify throws, and an exception thrown inside
    // an exporter can take down logging — the one subsystem that must not
    // fail while you are diagnosing a failure.
    const out = redact({ n: 10n, fn: () => 1, sym: Symbol('s') }) as Record<string, unknown>
    expect(() => JSON.stringify(out)).not.toThrow()
    expect(out['n']).toBe('10n')
  })
})

describe('plugin-log-file', () => {
  it('writes NDJSON one record per line', async () => {
    const { ctx } = await bootLogging()
    ctx.logger('scanner').info('scan finished')
    await settle()

    const logs = await ctx.fs.dir('logs')
    const content = await ctx.fs.readFile(ctx.fs.join(logs!, 'app.log'))
    const lines = content.trim().split('\n')
    const record = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>

    expect(record['message']).toBe('scan finished')
    expect(record['scope']).toBe('scanner')
    expect(record['level']).toBe('info')
    expect(typeof record['time']).toBe('number')
  })

  it('formats %s, %d placeholders before writing to disk', async () => {
    const { ctx } = await bootLogging()
    ctx.logger('scanner').info('scanner: scanning specified dir %s (%s)', 'dir-1', 'file:///music')
    await settle()

    const logs = await ctx.fs.dir('logs')
    const content = await ctx.fs.readFile(ctx.fs.join(logs!, 'app.log'))
    const lines = content.trim().split('\n')
    const record = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>

    expect(record['message']).toBe('scanner: scanning specified dir dir-1 (file:///music)')
  })

  it('redacts credentials on the way to disk', async () => {
    const { ctx } = await bootLogging()
    ctx.logger('source').warn('auth failed for https://user:secret@music.example.org/?token=abc123')
    await settle()

    const logs = await ctx.fs.dir('logs')
    const content = await ctx.fs.readFile(ctx.fs.join(logs!, 'app.log'))

    expect(content).not.toContain('secret@')
    expect(content).not.toContain('abc123')
    expect(content).toContain('[redacted]')
  })

  it('respects the level threshold', async () => {
    const { ctx } = await bootLogging({ level: 1 }) // error + warn only
    ctx.logger('x').info('should not appear')
    ctx.logger('x').error('should appear')
    await settle()

    const logs = await ctx.fs.dir('logs')
    const content = await ctx.fs.readFile(ctx.fs.join(logs!, 'app.log'))
    expect(content).toContain('should appear')
    expect(content).not.toContain('should not appear')
  })

  it('rotates once the file exceeds maxBytes', async () => {
    const { ctx } = await bootLogging({ maxBytes: 200 })
    for (let i = 0; i < 40; i++) {
      ctx.logger('spam').error(`line ${i} ${'x'.repeat(40)}`)
      await settle()
    }

    const logs = await ctx.fs.dir('logs')
    const names = (await ctx.fs.list(logs!)).map((s) => s.name)
    expect(names).toContain('app.log')
    expect(names, 'expected a rotated file').toContain('app.log.1')
  })

  it('keeps at most maxFiles rotations', async () => {
    const { ctx } = await bootLogging({ maxBytes: 100, maxFiles: 2 })
    for (let i = 0; i < 40; i++) {
      ctx.logger('spam').error(`line ${i} ${'y'.repeat(40)}`)
      await settle()
    }
    const logs = await ctx.fs.dir('logs')
    const rotated = (await ctx.fs.list(logs!)).map((s) => s.name).filter((n) => /\.\d+$/.test(n))
    expect(rotated.length).toBeLessThanOrEqual(2)
  })

  it('flushes buffered records when the plugin unloads', async () => {
    const { ctx, fiber } = await bootLogging({ flushDelayMs: 10_000 })
    ctx.logger('x').error('written during shutdown')
    await fiber.dispose()
    await settle()

    const logs = await ctx.fs.dir('logs')
    const content = await ctx.fs.readFile(ctx.fs.join(logs!, 'app.log'))
    expect(content).toContain('written during shutdown')
  })

  it('stops writing once unloaded', async () => {
    const { ctx, fiber } = await bootLogging()
    await fiber.dispose()
    await settle()

    const logs = await ctx.fs.dir('logs')
    const before = (await ctx.fs.exists(ctx.fs.join(logs!, 'app.log')))
      ? await ctx.fs.readFile(ctx.fs.join(logs!, 'app.log'))
      : ''
    ctx.logger('x').error('after dispose')
    await settle()
    const after = (await ctx.fs.exists(ctx.fs.join(logs!, 'app.log')))
      ? await ctx.fs.readFile(ctx.fs.join(logs!, 'app.log'))
      : ''
    expect(after).toBe(before)
  })
})

describe('plugin-log-buffer', () => {
  it('retains, queries, and bounds', async () => {
    const ctx = new Context()
    await ctx.plugin(logBuffer, { size: 5 })

    for (let i = 0; i < 12; i++) ctx.logger('scope-a').info(`message ${i}`)
    ctx.logger('scope-b').error('a failure')

    const buffer = ctx.logBuffer as LogBuffer
    // Ring: a long session must not become a memory leak.
    expect(buffer.all.length).toBe(5)

    const errors = buffer.query({ level: 'error' })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toBe('a failure')

    expect(buffer.query({ scope: 'scope-a' }).every((r) => r.scope === 'scope-a')).toBe(true)
    expect(buffer.query({ contains: 'failure' })).toHaveLength(1)
    // Newest first, since that is what a log viewer opens on.
    expect(buffer.query({ limit: 1 })[0]!.message).toBe('a failure')
  })

  it('exports NDJSON for a crash report', async () => {
    const ctx = new Context()
    await ctx.plugin(logBuffer, {})
    ctx.logger('x').error('boom')

    const lines = (ctx.logBuffer as LogBuffer).toNdjson().trim().split('\n')
    expect(JSON.parse(lines[lines.length - 1]!)).toMatchObject({ message: 'boom', level: 'error' })
  })

  it('unregisters its exporter and service on unload', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(logBuffer, {})
    expect(ctx.logBuffer).toBeDefined()
    await fiber.dispose()
    expect(ctx.logBuffer).toBeUndefined()
    // Must not throw into a disposed buffer.
    expect(() => ctx.logger('x').error('after')).not.toThrow()
  })

  it('formats %s, %d placeholders in the buffer', async () => {
    const ctx = new Context()
    await ctx.plugin(logBuffer, {})

    ctx.logger('scanner').info('scanner: scanning specified dir %s (%s)', 'dir-1', 'file:///music')
    ctx.logger('scanner').info('scanner: starting scan on %d specified dir(s) (full=%s)', 1, false)
    ctx.logger('scanner').info(
      'scanner: scan completed (added=%d, updated=%d, removed=%d, errors=%d, cancelled=%s)',
      0,
      0,
      0,
      0,
      false,
    )

    const buffer = ctx.logBuffer as LogBuffer
    expect(buffer.all[0]!.message).toBe('scanner: scanning specified dir dir-1 (file:///music)')
    expect(buffer.all[1]!.message).toBe('scanner: starting scan on 1 specified dir(s) (full=false)')
    expect(buffer.all[2]!.message).toBe(
      'scanner: scan completed (added=0, updated=0, removed=0, errors=0, cancelled=false)',
    )
  })
})
