// @vitest-environment jsdom
/**
 * The downloads screen, rendered.
 *
 * What is worth pinning is the **state → controls** map: a done task offers
 * Play and Delete, a failed one Retry and Delete, a running one Pause and
 * Cancel. A screen that draws the same buttons for every state is one where
 * "Resume" on a running download is a button that lies.
 */

import { act, cleanup, render, screen, within } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { DownloadPolicy, DownloadTask } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { DownloadsScreen, inject } from './index.js'
import downloadCatalogue from '../../../feature/plugin-i18n/src/locales/download.json'

afterEach(cleanup)

/** `ctx.downloads`, with the queue under the test's control. */
class DownloadsStub extends Service {
  tasks: DownloadTask[] = []
  readonly calls: string[] = []
  readonly policyCalls: Partial<DownloadPolicy>[] = []
  policy: DownloadPolicy = {
    id: 'dp_default',
    name: 'Default',
    enabled: true,
    wifiOnly: false,
    chargingOnly: false,
    quality: 'lossless',
  }

  constructor(ctx: Context) {
    super(ctx, 'downloads')
  }

  set(tasks: DownloadTask[]): void {
    this.tasks = tasks
    this.ctx.emit('download/changed')
  }

  async enqueue() {
    return []
  }
  async setPolicy(patch: Partial<DownloadPolicy>): Promise<void> {
    this.policyCalls.push(patch)
    this.policy = { ...this.policy, ...patch }
    this.ctx.emit('download/changed')
  }
  async pause(id: string) {
    this.calls.push(`pause:${id}`)
  }
  async resume(id: string) {
    this.calls.push(`resume:${id}`)
  }
  async retry(id: string) {
    this.calls.push(`retry:${id}`)
  }
  async cancel(id: string) {
    this.calls.push(`cancel:${id}`)
  }
  async remove(id: string) {
    this.calls.push(`remove:${id}`)
  }
  async clearFinished() {
    this.calls.push('clear')
  }
}

/** A player that records what the screen asked it to play. */
class PlayerStub extends Service {
  readonly played: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'player')
  }

  async playNow(urns: string[]): Promise<void> {
    this.played.push(...urns)
  }
}

/**
 * English i18n service for tests: serves the real `download` catalogue so the
 * screen renders the same copy the app shows in English. Mirrors the
 * `DefaultI18nStub` in `apps/desktop/renderer/Shell.test.tsx`.
 */
const DOWNLOAD_CATALOGUE: Record<string, { en: unknown }> = {
  download: { en: (downloadCatalogue as { en: unknown }).en },
}

class DefaultI18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  private listeners = new Set<(locale: string) => void>()

  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }

  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0) return key
    const catalogue = DOWNLOAD_CATALOGUE[key.slice(0, sep)]?.en
    if (!catalogue) return key
    let cur: unknown = catalogue
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params
      ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`))
      : cur
  }

  onLocaleChange = (cb: (locale: string) => void): (() => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
}

/** The scoped context a shell hands a view, plus the root for fixtures. */
async function harness(): Promise<{
  ctx: Context
  downloads: DownloadsStub
  player: PlayerStub
}> {
  const root = new Context()
  await root.plugin(DownloadsStub)
  await root.plugin(PlayerStub)
  await root.plugin(DefaultI18nStub)
  await tick()

  /*
   * Scoped to this package's own `inject`, minus `ui`, plus `i18n`: the
   * screens read it through `useI18n`, which degrades to raw keys without the
   * service, so the stub keeps the English-copy assertions below honest.
   * Derived rather than written out, so a screen that reads an undeclared
   * service throws here exactly as it would in the app.
   */
  const declared = [...inject.filter((name) => name !== 'ui'), 'i18n']
  let scoped: Context | undefined
  root.inject(declared, (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('downloads screens harness: no scoped context')
  return {
    ctx: scoped,
    downloads: root.downloads as unknown as DownloadsStub,
    player: root.player as unknown as PlayerStub,
  }
}

function task(over: Partial<DownloadTask> & { id: string }): DownloadTask {
  return {
    trackUrn: `BBeBee:demo:track:${over.id}`,
    title: `Track ${over.id}`,
    state: 'running',
    bytesDone: 0,
    kept: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('DownloadsScreen', () => {
  it('renders an empty queue as an empty state, not a blank screen', async () => {
    const { ctx } = await harness()
    render(h(DownloadsScreen, { ctx }))
    await act(async () => {
      await tick()
    })
    expect(screen.getByText('No downloads')).toBeTruthy()
  })

  it('offers the controls the state allows, and no others', async () => {
    const { ctx, downloads } = await harness()
    downloads.set([
      task({ id: 'run', state: 'running', bytesDone: 500, bytesTotal: 1000 }),
      task({ id: 'done', state: 'done', bytesDone: 4, bytesTotal: 4 }),
      task({ id: 'bad', state: 'failed', error: 'connection reset' }),
    ])
    render(h(DownloadsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(screen.getByTestId('download-pause-run')).toBeTruthy()
    expect(screen.getByTestId('download-cancel-run')).toBeTruthy()
    expect(screen.queryByTestId('download-resume-run')).toBeNull()

    expect(screen.getByTestId('download-play-done')).toBeTruthy()
    expect(screen.getByTestId('download-remove-done')).toBeTruthy()
    expect(screen.queryByTestId('download-pause-done')).toBeNull()

    expect(screen.getByTestId('download-retry-bad')).toBeTruthy()
    expect(screen.getByTestId('download-remove-bad')).toBeTruthy()
    expect(screen.getByText('connection reset')).toBeTruthy()
  })

  it('drives the service from the buttons', async () => {
    const { ctx, downloads } = await harness()
    downloads.set([
      task({ id: 'run', state: 'running', bytesDone: 1, bytesTotal: 4 }),
      task({ id: 'paused', state: 'paused', bytesDone: 2, bytesTotal: 4 }),
      task({ id: 'done', state: 'done', bytesDone: 4, bytesTotal: 4 }),
    ])
    render(h(DownloadsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      screen.getByTestId('download-pause-run').click()
      screen.getByTestId('download-resume-paused').click()
      screen.getByTestId('download-remove-done').click()
      screen.getByTestId('downloads-clear').click()
      await tick()
    })

    expect(downloads.calls).toEqual(['pause:run', 'resume:paused', 'remove:done', 'clear'])
  })

  it('plays a finished download through ctx.player', async () => {
    const { ctx, downloads, player } = await harness()
    downloads.set([task({ id: 'done', state: 'done', bytesDone: 4, bytesTotal: 4 })])
    render(h(DownloadsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      screen.getByTestId('download-play-done').click()
      await tick()
    })

    // The player is optional — `serviceOf` finds it without an `inject`, which
    // is what keeps the page loadable while `plugin-player` is still starting.
    expect(player.played).toEqual(['BBeBee:demo:track:done'])
  })

  it('flips the network policy from the toggles', async () => {
    const { ctx, downloads } = await harness()
    render(h(DownloadsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      screen.getByTestId('downloads-wifi-only').click()
      await tick()
      screen.getByTestId('downloads-charging-only').click()
      await tick()
    })

    expect(downloads.policyCalls).toEqual([{ wifiOnly: true }, { chargingOnly: true }])
    expect(screen.getByTestId('downloads-wifi-only').getAttribute('aria-pressed')).toBe('true')
  })

  it('says what a held task waits for, and whether a download is kept', async () => {
    const { ctx, downloads } = await harness()
    downloads.set([
      task({ id: 'held', state: 'queued', blocked: 'wifi' }),
      task({ id: 'kept', state: 'done', kept: true, bytesDone: 4, bytesTotal: 4 }),
      task({ id: 'cached', state: 'done', bytesDone: 4, bytesTotal: 4 }),
    ])
    render(h(DownloadsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(screen.getByText('Waiting for Wi-Fi')).toBeTruthy()
    // Scoped to the rows: `Downloaded` is also the section heading.
    expect(within(screen.getByTestId('download-kept')).getByText('Downloaded')).toBeTruthy()
    expect(within(screen.getByTestId('download-cached')).getByText('Cached')).toBeTruthy()
  })
})
