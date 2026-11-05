// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { DownloadPolicy, DownloadTask } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { formatDownloadSummary, useDownloadsView } from './hooks.js'

afterEach(cleanup)

class DownloadsStub extends Service {
  tasks: DownloadTask[] = [
    {
      id: 'task-1',
      trackUrn: 'bbebee:local:track:1',
      title: 'Downloading Song',
      state: 'running',
      bytesDone: 500,
      bytesTotal: 1000,
      kept: false,
      createdAt: 100,
      updatedAt: 100,
    },
    {
      id: 'task-2',
      trackUrn: 'bbebee:local:track:2',
      title: 'Completed Cache Song',
      state: 'done',
      bytesDone: 2048,
      bytesTotal: 2048,
      kept: false,
      createdAt: 50,
      updatedAt: 50,
    },
    {
      id: 'task-3',
      trackUrn: 'bbebee:local:track:3',
      title: 'Kept User Song',
      state: 'done',
      bytesDone: 4096,
      bytesTotal: 4096,
      kept: true,
      createdAt: 20,
      updatedAt: 20,
    },
    {
      id: 'task-4',
      trackUrn: 'bbebee:local:track:4',
      title: 'Canceled Song',
      state: 'canceled',
      bytesDone: 0,
      bytesTotal: 1000,
      kept: false,
      createdAt: 10,
      updatedAt: 10,
    },
  ]

  policy: DownloadPolicy = {
    id: 'default',
    name: 'Default',
    enabled: true,
    wifiOnly: true,
    chargingOnly: false,
    quality: 'high',
  }

  cleared = false

  constructor(ctx: Context) {
    super(ctx, 'downloads')
  }

  async clearFinished(): Promise<void> {
    this.cleared = true
    this.tasks = this.tasks.filter((t) => t.kept || t.state === 'running')
  }

  async setPolicy(p: Partial<DownloadPolicy>): Promise<void> {
    this.policy = { ...this.policy, ...p }
  }
}

describe('useDownloadsView', () => {
  it('partitions tasks correctly into active, finished, and clearable', async () => {
    const ctx = new Context()
    await ctx.plugin(DownloadsStub)
    await tick()

    const { result } = renderHook(() => useDownloadsView(ctx))

    expect(result.current.tasks.length).toBe(4)
    expect(result.current.activeTasks.map((t) => t.id)).toEqual(['task-1'])
    expect(result.current.finishedTasks.map((t) => t.id)).toEqual(['task-2', 'task-3', 'task-4'])
    // task-2 (not kept) and task-4 (canceled) are clearable; task-3 is kept so it is NOT clearable
    expect(result.current.clearableTasks.map((t) => t.id)).toEqual(['task-2', 'task-4'])

    // Policy toggle
    expect(result.current.policy.wifiOnly).toBe(true)
    act(() => {
      result.current.toggleWifiOnly()
    })
    expect((ctx.downloads as unknown as DownloadsStub).policy.wifiOnly).toBe(false)

    // Clear finished
    act(() => {
      result.current.clearFinished()
    })
    expect((ctx.downloads as unknown as DownloadsStub).cleared).toBe(true)
  })

  it('formats download summary correctly with compact and full format', () => {
    const t = (k: string, p?: Record<string, string | number>) => `${k}:${p?.done ?? p?.active ?? ''}`
    const summary = { active: 1, done: 2, failed: 0, bytes: 1024 }

    const full = formatDownloadSummary(t, summary)
    expect(full).toContain('download:index.inProgress2:1')
    expect(full).toContain('download:index.summaryDownloaded:2')

    const compact = formatDownloadSummary(t, summary, { compact: true })
    expect(compact).toContain('download:index.summaryDownloadedCompact:2')
  })
})
