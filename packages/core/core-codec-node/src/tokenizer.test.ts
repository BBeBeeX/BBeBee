/**
 * `FsRangeTokenizer` against a real file through a stub `ctx.fs`.
 *
 * These pin the properties the codec's scan budget rests on: seeks cost
 * pages, not files; sequential reads are coalesced; the budget backstop
 * reports end-of-stream instead of reading on; abort actually aborts.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { EndOfStreamError } from 'strtok3'
import type { FsService, Uri } from '@BBeBee/protocol'
import { FsRangeTokenizer } from './tokenizer.js'

interface RangeCall {
  start: number
  end?: number
}

/** Minimal `ctx.fs`: only `createReadStream` is exercised, logging ranges. */
function fakeFs(path: string, log: RangeCall[]): FsService {
  return {
    createReadStream: (_uri: Uri, range?: { start: number; end?: number }) => {
      log.push({ start: range?.start ?? 0, end: range?.end })
      const node = createReadStream(path, range ? { start: range.start, end: range.end } : {})
      return Readable.toWeb(node) as ReadableStream<Uint8Array>
    },
  } as unknown as FsService
}

async function makeFile(size: number): Promise<{ path: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'bbebee-tokenizer-'))
  const path = join(dir, 'data.bin')
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = i % 251
  await writeFile(path, bytes)
  return { path, dir }
}

function totalFetched(log: RangeCall[]): number {
  return log.reduce((sum, c) => sum + (c.end === undefined ? 0 : c.end - c.start + 1), 0)
}

describe('FsRangeTokenizer', () => {
  it('reads across page boundaries', async () => {
    const { path, dir } = await makeFile(200 * 1024)
    try {
      const log: RangeCall[] = []
      const t = new FsRangeTokenizer(fakeFs(path, log), 'file://data.bin' as Uri, 200 * 1024)
      const buf = new Uint8Array(100 * 1024)
      const n = await t.readBuffer(buf, { position: 60 * 1024 })
      expect(n).toBe(buf.length)
      for (let i = 0; i < buf.length; i++) expect(buf[i]).toBe((60 * 1024 + i) % 251)
      expect(t.position).toBe(60 * 1024 + buf.length)
      await t.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('seeks to the tail without reading the middle', async () => {
    const size = 1024 * 1024
    const { path, dir } = await makeFile(size)
    try {
      const log: RangeCall[] = []
      const t = new FsRangeTokenizer(fakeFs(path, log), 'file://data.bin' as Uri, size)
      t.setPosition(size - 128)
      const buf = new Uint8Array(128)
      await t.readBuffer(buf)
      for (let i = 0; i < 128; i++) expect(buf[i]).toBe((size - 128 + i) % 251)
      // One page for the tail; the 960 KB in between were never fetched.
      expect(totalFetched(log)).toBeLessThan(128 * 1024)
      expect(log.every((c) => c.start >= size - 64 * 1024)).toBe(true)
      await t.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('peeks without advancing the position', async () => {
    const { path, dir } = await makeFile(200 * 1024)
    try {
      const log: RangeCall[] = []
      const t = new FsRangeTokenizer(fakeFs(path, log), 'file://data.bin' as Uri, 200 * 1024)
      const buf = new Uint8Array(16)
      await t.peekBuffer(buf, { position: 100 })
      expect(t.position).toBe(0)
      for (let i = 0; i < 16; i++) expect(buf[i]).toBe((100 + i) % 251)
      await t.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('coalesces sequential reads into runs', async () => {
    const { path, dir } = await makeFile(2 * 1024 * 1024)
    try {
      const log: RangeCall[] = []
      const t = new FsRangeTokenizer(fakeFs(path, log), 'file://data.bin' as Uri, 2 * 1024 * 1024)
      const buf = new Uint8Array(100)
      await t.readBuffer(buf, { position: 0 })
      // Page 16 continues the sequential run past the first 1 MB: one range
      // call covering the next 1 MB, not sixteen 64 KB drips.
      await t.readBuffer(buf, { position: 16 * 64 * 1024 })
      expect(log.length).toBe(2)
      expect(log[1]!.end! - log[1]!.start + 1).toBe(16 * 64 * 1024)
      await t.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports end-of-stream past the budget instead of reading on', async () => {
    const { path, dir } = await makeFile(1024 * 1024)
    try {
      const log: RangeCall[] = []
      const budget = 100 * 1024
      const t = new FsRangeTokenizer(
        fakeFs(path, log),
        'file://data.bin' as Uri,
        1024 * 1024,
        undefined,
        undefined,
        budget,
      )
      // Reads inside the budget work.
      const buf = new Uint8Array(1000)
      expect(await t.readBuffer(buf, { position: 0 })).toBe(1000)
      // A read that would cross the budget reports EOF like a short file.
      await expect(t.readBuffer(new Uint8Array(200 * 1024), { position: 0 })).rejects.toBeInstanceOf(
        EndOfStreamError,
      )
      // …and with mayBeLess it returns what the budget allowed.
      const partial = new Uint8Array(200 * 1024)
      const n = await t.peekBuffer(partial, { position: 0, mayBeLess: true })
      expect(n).toBeLessThanOrEqual(budget)
      expect(totalFetched(log)).toBeLessThanOrEqual(budget)
      await t.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('aborts in-flight reads', async () => {
    const { path, dir } = await makeFile(1024 * 1024)
    try {
      const log: RangeCall[] = []
      const controller = new AbortController()
      controller.abort()
      const t = new FsRangeTokenizer(
        fakeFs(path, log),
        'file://data.bin' as Uri,
        1024 * 1024,
        controller.signal,
      )
      await expect(t.readBuffer(new Uint8Array(16))).rejects.toThrow()
      await t.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
