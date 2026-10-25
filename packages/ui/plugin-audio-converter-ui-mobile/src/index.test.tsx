// @vitest-environment jsdom
/**
 * The mobile converter workbench: plugin registration, the settings link-row
 * contribution (the history pattern for a page with no tab), the picker
 * capability fallback, and the enqueue → queue-tab flow.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@BBeBee/kernel'
import type {
  AudioConverterConfig,
  ConvertTask,
  EncoderCapabilities,
} from '@BBeBee/protocol'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import pluginConverterUi, { inject, name } from './index.js'
import converterCatalogue from '../../../feature/plugin-i18n/src/locales/converter.json'

afterEach(cleanup)

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
  FlashList: hostComponent('FlashList'),
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

/**
 * English i18n stub serving the real `converter` catalogue (the dsp test's
 * pattern), so assertions read the copy the app shows.
 */
class I18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }
  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0 || key.slice(0, sep) !== 'converter') return key
    let cur: unknown = (converterCatalogue as { en: unknown }).en
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
  }
  onLocaleChange = (): (() => void) => () => {}
}

class UiStub extends Service {
  public views = new Map<string, unknown>()
  public contributions: unknown[] = []
  constructor(ctx: Context) {
    super(ctx, 'ui')
  }
  registerView(id: string, component: unknown) {
    this.views.set(id, component)
    return () => {
      this.views.delete(id)
    }
  }
  contribute(contribution: unknown) {
    this.contributions.push(contribution)
    return () => {}
  }
  viewFor(id: string) {
    return this.views.get(id)
  }
}

const CAPS: EncoderCapabilities = {
  supportedInputFormats: ['mp3', 'wav', 'flac'],
  supportedOutputFormats: ['mp3', 'wav', 'flac'],
  encoders: {
    libmp3lame: { name: 'MP3 (LAME)', description: 'MP3 audio encoder', available: true },
  },
}

/** One task in every state the queue card draws. */
function task(overrides: Partial<ConvertTask>): ConvertTask {
  return {
    id: 'task_1',
    inputUri: '/storage/music/a.mp3',
    outputUri: '/storage/music/a.m4a',
    fileName: 'a.mp3',
    sourceFormat: 'mp3',
    targetFormat: 'm4a',
    status: 'pending',
    progress: 0,
    stage: 'idle',
    sourceSize: 1000,
    options: { targetFormat: 'm4a' },
    createdAt: 1,
    logs: [],
    ...overrides,
  }
}

class ConverterStub extends Service {
  public calls: string[] = []
  public tasks: ConvertTask[] = []
  constructor(ctx: Context) {
    super(ctx, 'audioConverter')
  }
  getCapabilities = async () => CAPS
  estimateCompression = () => ({
    estimatedSize: 500,
    estimatedRatio: 50,
    isLossless: false,
    note: 'estimate',
  })
  enqueue = async (items: Array<{ uri: string }>) => {
    this.calls.push(`enqueue:${items.map((i) => i.uri).join('|')}`)
    return this.tasks
  }
  cancelTask = async (id: string) => {
    this.calls.push(`cancel:${id}`)
    return true
  }
  retryTask = async (id: string) => {
    this.calls.push(`retry:${id}`)
    return true
  }
  removeTask = async (id: string) => {
    this.calls.push(`remove:${id}`)
    return true
  }
  clearFinished = async () => {
    this.calls.push('clearFinished')
  }
  getTasks = () => this.tasks
  getConfig = (): AudioConverterConfig => ({
    defaultFormat: 'mp3',
    maxConcurrency: 2,
    taskTimeoutMs: 300_000,
    autoCleanTemp: true,
  })
  updateConfig = async () => {}
  onTasksChanged = (): (() => void) => () => {}
}

type PickFixture = { pickFiles?: (opts?: { multiple?: boolean }) => Promise<Array<{ uri: string }>> }

/** Swapped per test before the fs stub is registered. */
let pickImplementation: PickFixture['pickFiles'] | undefined

class FsStub extends Service {
  pickFiles = pickImplementation
  constructor(ctx: Context) {
    super(ctx, 'fs')
  }
}

async function harness(pick?: PickFixture['pickFiles']) {
  pickImplementation = pick
  const ctx = new Context()
  await ctx.plugin(I18nStub)
  await ctx.plugin(UiStub)
  await ctx.plugin(ConverterStub)
  if (pick) await ctx.plugin(FsStub)
  await ctx.plugin(pluginConverterUi)
  const converter = (ctx as unknown as { audioConverter: ConverterStub }).audioConverter
  return { ctx, converter }
}

describe('plugin-audio-converter-ui-mobile', () => {
  it('declares the mobile plugin name and the services it drives', () => {
    expect(name).toBe('plugin-audio-converter-ui-mobile')
    expect(inject).toEqual(['ui', 'audioConverter'])
  })

  it('registers the workbench view and contributes the settings link row', async () => {
    const { ctx } = await harness()
    const ui = ctx.ui as unknown as UiStub
    expect(ui.viewFor('audio-converter.view')).toBeDefined()

    const linkRows = ui.contributions.filter(
      (c) => (c as { kind?: string }).kind === 'settings',
    )
    expect(linkRows).toHaveLength(1)
    expect(linkRows[0]).toMatchObject({
      kind: 'settings',
      id: 'audio-converter.view',
      section: 'general',
      title: 'converter:index.title',
    })
  })

  it('renders the workbench with a working pick button when the fs build can pick', async () => {
    const { ctx } = await harness(() => Promise.resolve([{ uri: '/storage/a.mp3', size: 10 }]))
    const Screen = (ctx.ui as unknown as UiStub).viewFor('audio-converter.view')
    const { container, getByTestId } = render(h(Screen as never, {}))

    expect(container.textContent).toContain('Audio Converter')
    expect(container.textContent).toContain('Convert')
    const pick = getByTestId('converter-pick-files')
    await act(async () => {
      pick.click()
      await Promise.resolve()
    })
    // The picked file lands as a staged row with its derived name.
    expect(container.textContent).toContain('a.mp3')
    expect(container.querySelector('[data-testid="converter-pick-unavailable"]')).toBeNull()
  })

  it('renders an explicit unavailable state when this build cannot pick files', async () => {
    const { ctx } = await harness(undefined)
    const Screen = (ctx.ui as unknown as UiStub).viewFor('audio-converter.view')
    const { container } = render(h(Screen as never, {}))
    expect(container.querySelector('[data-testid="converter-pick-unavailable"]')).toBeTruthy()
    expect(container.textContent).toContain('cannot pick files')
    expect(container.querySelector('[data-testid="converter-pick-files"]')).toBeNull()
  })

  it('enqueues staged files with the option set and switches to the queue tab', async () => {
    const { ctx, converter } = await harness(() =>
      Promise.resolve([{ uri: '/storage/a.mp3', size: 10 }]),
    )
    const Screen = (ctx.ui as unknown as UiStub).viewFor('audio-converter.view')
    const { container, getByTestId } = render(h(Screen as never, {}))

    await act(async () => {
      getByTestId('converter-pick-files').click()
      await Promise.resolve()
    })
    await act(async () => {
      getByTestId('converter-start-btn').click()
      await Promise.resolve()
    })

    expect(converter.calls).toEqual(['enqueue:/storage/a.mp3'])
    // The staged list drained and the workbench followed the queue.
    expect(container.textContent).toContain('Task Queue')
    expect(container.textContent).toContain('No conversion tasks yet.')
  })

  it('draws queue rows with progress and hands cancel to the service', async () => {
    const { ctx, converter } = await harness()
    converter.tasks = [
      task({ id: 't1', status: 'processing', progress: 42, stage: 'encoding' }),
      task({ id: 't2', status: 'failed', error: 'codec exploded' }),
    ]
    const Screen = (ctx.ui as unknown as UiStub).viewFor('audio-converter.view')
    const { container, getByTestId } = render(h(Screen as never, {}))

    await act(async () => {
      getByTestId('converter-tab-queue').click()
    })
    expect(container.textContent).toContain('a.mp3')
    expect(container.textContent).toContain('encoding · 42%')
    expect(container.textContent).toContain('codec exploded')

    await act(async () => {
      getByTestId('converter-task-cancel-t1').click()
    })
    expect(converter.calls).toContain('cancel:t1')

    await act(async () => {
      getByTestId('converter-task-retry-t2').click()
    })
    expect(converter.calls).toContain('retry:t2')
  })

  it('shows the output location and savings on the output tab', async () => {
    const { ctx, converter } = await harness()
    converter.tasks = [
      task({
        id: 't1',
        status: 'completed',
        progress: 100,
        stage: 'completed',
        sourceSize: 1000,
        outputSize: 400,
        outputUri: '/storage/Music/a.m4a',
      }),
    ]
    const Screen = (ctx.ui as unknown as UiStub).viewFor('audio-converter.view')
    const { container, getByTestId } = render(h(Screen as never, {}))

    await act(async () => {
      getByTestId('converter-tab-output').click()
    })
    expect(container.textContent).toContain('/storage/Music/a.m4a')
    expect(container.textContent).toContain('-60%')
    expect(container.textContent).toContain('Original size: 1.0 kB')

    await act(async () => {
      getByTestId('converter-output-remove-t1').click()
    })
    expect(converter.calls).toContain('remove:t1')
  })
})
