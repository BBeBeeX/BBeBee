import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-desktop'
import { FsNode } from '@BBeBee/core-fs-desktop'
import { DbNode } from '@BBeBee/core-db-desktop'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { pathToFileURL } from 'node:url'
import codecPlugin from '@bbebee/core-codec-desktop'
import { Scanner } from './index.js'

function frame(id: string, value: string): Uint8Array {
  const body = new Uint8Array([0x03, ...new TextEncoder().encode(value)])
  const size = body.length
  return new Uint8Array([
    ...new TextEncoder().encode(id),
    (size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff,
    0x00, 0x00, ...body,
  ])
}

describe('timing flag', () => {
  it('logs per-batch timing when BBEBEE_SCAN_TIMING=1', async () => {
    if (process.env.BBEBEE_SCAN_TIMING !== '1') return // only meaningful with the flag
    const dir = await mkdtemp(join(tmpdir(), 'bbebee-timing-'))
    try {
      for (let i = 0; i < 4; i++) {
        const body = [frame('TIT2', `T${i}`)].reduce<number[]>((a, f) => [...a, ...f], [])
        const size = body.length
        const head = [...new TextEncoder().encode('ID3'), 0x03, 0x00, 0x00,
          (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]
        const audio = new Uint8Array(64 * 1024)
        audio.set([0xff, 0xfb, 0x90, 0x00], 0)
        await writeFile(join(dir, `t${i}.mp3`), new Uint8Array([...head, ...body, ...audio]))
      }
      const logs: string[] = []
      const ctx = new Context()
      await ctx.plugin(PathsNode, { root: await tempDir('bbebee-timing-app') })
      await ctx.plugin(FsNode)
      await ctx.plugin(DbNode, { fileName: ':memory:' })
      await ctx.plugin(codecPlugin, {})
      await ctx.plugin(Scanner, { batchSize: 2 })
      await tick()
      const scanner = ctx.scanner as Scanner
      // Each forked context has its own LoggerService: register on the
      // scanner's own context, not the root.
      const svc = (scanner as unknown as { ownCtx: { logger: { exporter?: (e: { export: (m: { args?: unknown[] }) => void }) => void } } }).ownCtx.logger
      svc.exporter?.({ export: (m) => logs.push(String(m.args?.[0] ?? '')) })

      await scanner.addSpecifiedDir(pathToFileURL(dir).href)
      await scanner.scan()

      const timingLines = logs.filter((l) => l.includes('batch timing'))
      expect(timingLines.length).toBeGreaterThan(0)
      // 4 files across two batches of 2; cordis passes the format string,
      // formatting happens in the exporter.
      expect(timingLines.every((l) => l.includes('files=%d tagRead=%dms artworkSave=%dms dbTxn=%dms'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60000)
})
