// @vitest-environment jsdom
/**
 * The mobile downloads screen, rendered and pressed.
 *
 * The desktop twin pins the state → controls map; this pins that the phone's
 * transcription of it reads the right service on a **scoped** context — the
 * device bug every view package here has been bitten by — and that its
 * buttons reach the queue.
 *
 * React Native is injected as DOM host components, the same seam `apps/mobile`
 * uses to hand over the real `react-native`.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import type { DownloadPolicy, DownloadTask } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import { DownloadsScreen, inject } from './index.js'
import downloadCatalogue from '../../../feature/plugin-i18n/src/locales/download.json'

afterEach(cleanup)

/** A fake native host: a `div` that keeps the RN props it was given. */
function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, onPress, testID } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick: typeof onPress === 'function' ? (onPress as () => void) : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  FlashList: function FlashList(props: {
    data?: readonly unknown[]
    renderItem?: (info: { item: unknown; index: number }) => ReactNode
    ListEmptyComponent?: ReactNode
    accessibilityLabel?: string
  }) {
    const items = props.data ?? []
    return h(
      'div',
      { 'data-host': 'FlashList', 'data-label': props.accessibilityLabel, role: 'list' },
      items.length === 0
        ? (props.ListEmptyComponent as ReactNode)
        : items.map((item, index) =>
            h('div', { key: index, role: 'listitem' }, props.renderItem?.({ item, index })),
          ),
    )
  },
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

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
async function harness(): Promise<{ ctx: Context; downloads: DownloadsStub }> {
  const root = new Context()
  await root.plugin(DownloadsStub)
  await root.plugin(DefaultI18nStub)
  await tick()

  // Scoped to this package's own `inject`, minus `ui`, plus `i18n`: the
  // screen reads it through `useI18n`, which degrades to raw keys without the
  // service, so the stub keeps the English-copy assertions below honest.
  const declared = [...inject.filter((name) => name !== 'ui'), 'i18n']
  let scoped: Context | undefined
  root.inject(declared, (s) => void (scoped = s))
  await tick()
  if (!scoped) throw new Error('downloads mobile harness: no scoped context')
  return { ctx: scoped, downloads: root.downloads as unknown as DownloadsStub }
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

describe('DownloadsScreen on mobile', () => {
  it('renders an empty queue as an empty state', async () => {
    const { ctx } = await harness()
    const { container } = render(h(DownloadsScreen, { ctx }))
    await act(async () => {
      await tick()
    })
    expect(container.textContent).toContain('No downloads')
  })

  it('transcribes the state → controls map', async () => {
    const { ctx, downloads } = await harness()
    downloads.set([
      task({ id: 'run', state: 'running', bytesDone: 500, bytesTotal: 1000 }),
      task({ id: 'paused', state: 'paused', bytesDone: 2, bytesTotal: 4 }),
      task({ id: 'done', state: 'done', bytesDone: 4, bytesTotal: 4 }),
      task({ id: 'bad', state: 'failed', error: 'connection reset' }),
    ])
    const { container } = render(h(DownloadsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(container.querySelector('[data-testid="download-pause-run"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="download-cancel-run"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="download-resume-paused"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="download-play-done"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="download-retry-bad"]')).toBeTruthy()
    expect(container.textContent).toContain('connection reset')
  })

  it('drives the queue from the buttons', async () => {
    const { ctx, downloads } = await harness()
    downloads.set([task({ id: 'run', state: 'running', bytesDone: 1, bytesTotal: 4 })])
    const { container } = render(h(DownloadsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      ;(container.querySelector('[data-testid="download-pause-run"]') as HTMLElement).click()
      ;(container.querySelector('[data-testid="download-cancel-run"]') as HTMLElement).click()
      await tick()
    })

    expect(downloads.calls).toEqual(['pause:run', 'cancel:run'])
  })
})
