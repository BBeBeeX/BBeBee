// @vitest-environment jsdom
/**
 * Desktop Play History view tests.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { fireEvent, render, cleanup } from '@testing-library/react'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { Context, Service } from 'cordis'
import type { PlayHistoryHeatmapDay, PlayHistoryStats, PlayRecord, Track, TransportState } from '@BBeBee/protocol'
import { HistoryScreen } from './HistoryScreen.js'
import { PlayHeatmap, getHeatmapLevel, formatPlayDuration } from './PlayHeatmap.js'
import historyCatalogue from '../../../feature/plugin-i18n/src/locales/history.json'
import appCatalogueEn from '../../../feature/plugin-i18n/src/locales/en.json'
import appCatalogueZh from '../../../feature/plugin-i18n/src/locales/zh.json'

const CATALOGUES: Record<string, { en: unknown; zh: unknown }> = {
  app: { en: appCatalogueEn, zh: appCatalogueZh },
  history: { en: historyCatalogue.en, zh: historyCatalogue.zh },
}

/**
 * Default i18n service for tests: serves the real catalogue so components
 * under test render the same copy the app shows.
 */
class DefaultI18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  private listeners = new Set<(locale: string) => void>()
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  setLocale = (next: string): void => {
    this.locale = next
    for (const listener of [...this.listeners]) listener(next)
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0) return key
    const ns = key.slice(0, sep)
    const catalogue = CATALOGUES[ns]?.[this.locale === 'zh' ? 'zh' : 'en']
    if (!catalogue) return key
    let cur: unknown = catalogue
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
  }
  onLocaleChange = (cb: (locale: string) => void): (() => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
}

afterEach(() => {
  cleanup()
})

/**
 * English-only stub for the pure `formatPlayDuration` helper: serves the real
 * `history` catalogue verbatim so duration expectations are unaffected by
 * i18n wiring.
 */
function enT(key: string, params?: Record<string, string | number>): string {
  const path = key.startsWith('history:') ? key.slice('history:'.length) : key
  let cur: unknown = historyCatalogue.en
  for (const part of path.split('.')) {
    cur = (cur as Record<string, unknown> | undefined)?.[part]
  }
  if (typeof cur !== 'string') return key
  return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
}

const IDLE: TransportState = {
  status: 'idle',
  positionMs: 0,
  durationMs: 0,
  bufferedMs: 0,
  volume: 1,
  muted: false,
  repeat: 'off',
  shuffle: false,
  playMode: 'sequence',
}

describe('PlayHeatmap logic', () => {
  it('computes correct heatmap level', () => {
    expect(getHeatmapLevel(0)).toBe(0)
    expect(getHeatmapLevel(1)).toBe(1)
    expect(getHeatmapLevel(2)).toBe(1)
    expect(getHeatmapLevel(4)).toBe(2)
    expect(getHeatmapLevel(8)).toBe(3)
    expect(getHeatmapLevel(15)).toBe(4)
  })

  it('formats play duration correctly', () => {
    expect(formatPlayDuration(enT, 0)).toBe('0 min')
    expect(formatPlayDuration(enT, 30000)).toBe('< 1 min')
    expect(formatPlayDuration(enT, 180000)).toBe('3 min')
    expect(formatPlayDuration(enT, 3600000)).toBe('1 hr')
    expect(formatPlayDuration(enT, 5400000)).toBe('1 hr 30 min')
  })

  it('renders days and handles cell click', () => {
    const days: PlayHistoryHeatmapDay[] = [
      { date: '2026-09-14', count: 0, msPlayed: 0 },
      { date: '2026-09-15', count: 5, msPlayed: 1200000 },
      { date: '2026-09-16', count: 12, msPlayed: 3600000 },
    ]
    const onSelect = vi.fn()
    const { getByTestId } = render(
      h(PlayHeatmap, {
        heatmap: days,
        selectedDate: null,
        onSelectDate: onSelect,
      }),
    )

    const cell = getByTestId('heatmap-cell-2026-09-15')
    expect(cell).toBeTruthy()
    fireEvent.click(cell)
    expect(onSelect).toHaveBeenCalledWith('2026-09-15')
  })
})

async function harness(options: {
  records?: PlayRecord[]
  stats?: PlayHistoryStats
  heatmap?: PlayHistoryHeatmapDay[]
  tracks?: Record<string, Track>
} = {}) {
  const calls: string[] = []
  const records = options.records ?? []
  const stats = options.stats ?? {
    totalPlays: records.length,
    totalMsPlayed: records.reduce((sum, r) => sum + r.msPlayed, 0),
    todayPlays: records.length,
    completedPlays: records.filter((r) => r.completed).length,
  }
  const heatmap = options.heatmap ?? []
  const tracks = options.tracks ?? {}

  class PlayerStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'player')
    }
    get state() {
      return IDLE
    }
    getHistory = async (opts?: { limit?: number; date?: string }) => {
      calls.push(`getHistory:${opts?.date ?? 'all'}`)
      if (opts?.date) {
        return records.filter((r) => {
          const d = new Date(r.startedAt)
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          return iso === opts.date
        })
      }
      return records
    }
    getHistoryStats = async () => stats
    getHistoryHeatmap = async () => heatmap
    clearHistory = async () => {
      calls.push('clearHistory')
    }
    removeHistory = async (id: string) => {
      calls.push(`removeHistory:${id}`)
    }
    playNow = async (urns: string | string[]) => {
      calls.push(`playNow:${Array.isArray(urns) ? urns.join(',') : urns}`)
    }
  }

  class SourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sources')
    }
    getTracks = async (urns: readonly string[]) =>
      urns.map((urn) => tracks[urn]).filter((t): t is Track => t !== undefined)
  }

  const ctx = new Context()
  await ctx.plugin(DefaultI18nStub)
  await ctx.plugin(PlayerStub)
  await ctx.plugin(SourcesStub)

  return { ctx, calls }
}

describe('HistoryScreen', () => {
  it('shows empty state when no history exists', async () => {
    const { ctx } = await harness({ records: [] })
    const { findByText } = withListLayout(() => render(h(HistoryScreen, { ctx })))
    expect(await findByText('No play records yet')).toBeTruthy()
  })

  it('renders stats cards and track records', async () => {
    const now = Date.now()
    const records: PlayRecord[] = [
      {
        id: '1',
        trackUrn: 'BBeBee:local:track:1',
        startedAt: now,
        msPlayed: 180000,
        completed: true,
        skipped: false,
      },
    ]
    const tracks: Record<string, Track> = {
      'BBeBee:local:track:1': {
        urn: 'BBeBee:local:track:1',
        title: 'Song One',
        artists: [{ name: 'Artist A', urn: 'BBeBee:local:artist:1', role: 'main', ordinal: 0 }],
      },
    }

    const { ctx, calls } = await harness({ records, tracks })
    const { findByText } = withListLayout(() => render(h(HistoryScreen, { ctx })))

    expect(await findByText('Play history')).toBeTruthy()
    expect(await findByText('Total plays')).toBeTruthy()
    expect(await findByText('Song One')).toBeTruthy()
    expect(await findByText('Completed')).toBeTruthy()

    // Test clicking track to play
    const trackTitle = await findByText('Song One')
    fireEvent.click(trackTitle)
    expect(calls).toContain('playNow:BBeBee:local:track:1')
  })

  it('handles clear history with confirmation', async () => {
    const records: PlayRecord[] = [
      {
        id: '1',
        trackUrn: 'BBeBee:local:track:1',
        startedAt: Date.now(),
        msPlayed: 1000,
        completed: false,
        skipped: true,
      },
    ]
    const { ctx, calls } = await harness({ records })
    const { findByText } = withListLayout(() => render(h(HistoryScreen, { ctx })))

    const clearBtn = await findByText('Clear history')
    fireEvent.click(clearBtn)

    const confirmBtn = await findByText('OK')
    fireEvent.click(confirmBtn)
    expect(calls).toContain('clearHistory')
  })

  it('de-duplicates records and displays play count per track', async () => {
    const now = Date.now()
    const records: PlayRecord[] = [
      {
        id: '1',
        trackUrn: 'BBeBee:local:track:dup',
        startedAt: now,
        msPlayed: 180000,
        completed: true,
        skipped: false,
      },
      {
        id: '2',
        trackUrn: 'BBeBee:local:track:dup',
        startedAt: now - 60000,
        msPlayed: 180000,
        completed: true,
        skipped: false,
      },
      {
        id: '3',
        trackUrn: 'BBeBee:local:track:dup',
        startedAt: now - 120000,
        msPlayed: 60000,
        completed: false,
        skipped: true,
      },
      {
        id: '4',
        trackUrn: 'BBeBee:local:track:single',
        startedAt: now - 180000,
        msPlayed: 200000,
        completed: true,
        skipped: false,
      },
    ]
    const tracks: Record<string, Track> = {
      'BBeBee:local:track:dup': {
        urn: 'BBeBee:local:track:dup',
        title: 'Song Repeated',
        artists: [{ name: 'Artist A', urn: 'BBeBee:local:artist:1', role: 'main', ordinal: 0 }],
      },
      'BBeBee:local:track:single': {
        urn: 'BBeBee:local:track:single',
        title: 'Song Once',
        artists: [{ name: 'Artist B', urn: 'BBeBee:local:artist:2', role: 'main', ordinal: 0 }],
      },
    }

    const { ctx } = await harness({ records, tracks })
    const { findByText, findAllByText } = withListLayout(() => render(h(HistoryScreen, { ctx })))

    // De-duplicated count in header: (2 tracks)
    expect(await findByText('Recent play records (2 tracks)')).toBeTruthy()

    // Each unique track rendered once
    const dupTitles = await findAllByText('Song Repeated')
    expect(dupTitles).toHaveLength(1)
    const singleTitles = await findAllByText('Song Once')
    expect(singleTitles).toHaveLength(1)

    // Play count badge
    expect(await findByText('3 plays')).toBeTruthy()
    expect(await findByText('1 play')).toBeTruthy()
  })

  it('offers "Remove from history" in context menu and calls removeHistory', async () => {
    const records: PlayRecord[] = [
      {
        id: 'rec-1',
        trackUrn: 'BBeBee:local:track:1',
        startedAt: Date.now(),
        msPlayed: 180000,
        completed: true,
        skipped: false,
      },
    ]
    const tracks: Record<string, Track> = {
      'BBeBee:local:track:1': {
        urn: 'BBeBee:local:track:1',
        title: 'Song One',
        artists: [],
      },
    }

    const { ctx, calls } = await harness({ records, tracks })
    const { container, findByText } = withListLayout(() => render(h(HistoryScreen, { ctx })))

    await findByText('Song One')
    const row = container.querySelector('[role="row"]') as HTMLElement
    expect(row).toBeTruthy()
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 })

    const removeOption = await findByText('Remove from history')
    expect(removeOption).toBeTruthy()
    fireEvent.click(removeOption)
    expect(calls).toContain('removeHistory:rec-1')
  })
})
