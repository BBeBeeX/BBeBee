// @vitest-environment jsdom
/**
 * Registry diagnostics screen tests — rendered against a stub
 * `contentRegistry` the way the shell would bind it. Kept in a standalone
 * file (not `index.test.tsx`) so the two suites can evolve in parallel.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type {
  RegistryDiagnosticGroup,
  RegistryDiagnosticItem,
  RegistryDiagnosticsReport,
  RegistryEntryKind,
} from '@BBeBee/protocol'
import { RegistryDiagnosticsScreen } from './RegistryDiagnosticsScreen.js'

afterEach(cleanup)

/* ── fixtures ────────────────────────────────────────────────────────────── */

function item(
  id: string,
  group: RegistryDiagnosticGroup,
  title: string,
  message: string,
  extra?: { entryId?: string; kind?: RegistryEntryKind },
): RegistryDiagnosticItem {
  return { id, group, title, message, detectedAt: 0, ...extra }
}

const REPORT: RegistryDiagnosticsReport = {
  conflicts: [
    item(
      'lock-orphan:subsonic',
      'conflict',
      '锁记录指向的内容已不在本机：subsonic',
      'registry.lock.json 中仍保留 subsonic 的锁定记录，但对应内容已不再安装。',
      { entryId: 'subsonic', kind: 'music-source' },
    ),
  ],
  risks: [
    item('audit:bad-plugin', 'risk', '安全扫描风险：Bad Plugin', '共 1 个 block、0 个 warn，首条：eval 检测。', {
      entryId: 'bad-plugin',
      kind: 'plugin',
    }),
    item('audit:second', 'risk', '安全扫描风险：Second', '共 0 个 block、2 个 warn。', {
      entryId: 'second',
      kind: 'lyric-source',
    }),
  ],
  warnings: [item('index-fetch-failed', 'warning', '索引拉取失败', '索引最近一次拉取失败（离线）。')],
  info: [item('lock-summary', 'info', '锁记录摘要', '锁记录共 2 条（插件 1、界面主题 1）。')],
  generatedAt: 1_000,
}

const EMPTY_REPORT: RegistryDiagnosticsReport = {
  conflicts: [],
  risks: [],
  warnings: [],
  info: [],
  generatedAt: 1_000,
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/* ── harness ─────────────────────────────────────────────────────────────── */

interface HarnessOptions {
  report?: RegistryDiagnosticsReport
  /** getDiagnostics rejects with this error. */
  getError?: Error
  /** Don't register the contentRegistry service at all. */
  noService?: boolean
  /** Register the service but leave the optional getDiagnostics off. */
  noGetDiagnostics?: boolean
  /** Hold every getDiagnostics call until resolved. */
  getDeferred?: { promise: Promise<void>; resolve: () => void }
  /** Hold every rescanEntry call until resolved. */
  rescanDeferred?: { promise: Promise<void>; resolve: () => void }
}

async function harness(options: HarnessOptions = {}) {
  const calls: string[] = []
  const rescanCalls: string[] = []

  class RegistryStub extends Service {
    getDiagnostics?: () => Promise<RegistryDiagnosticsReport>
    rescanEntry = async (entryId: string): Promise<void> => {
      rescanCalls.push(entryId)
      if (options.rescanDeferred) await options.rescanDeferred.promise
    }

    constructor(ctx: Context) {
      super(ctx, 'contentRegistry')
      if (!options.noGetDiagnostics) {
        this.getDiagnostics = async () => {
          calls.push('getDiagnostics')
          if (options.getDeferred) await options.getDeferred.promise
          if (options.getError) throw options.getError
          return options.report ?? REPORT
        }
      }
    }
  }

  const root = new Context()
  if (!options.noService) await root.plugin(RegistryStub)

  let scoped: Context | undefined
  if (!options.noService) {
    root.inject(['contentRegistry'], (s) => void (scoped = s))
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!scoped) throw new Error('failed to scope')
    return { ctx: scoped, calls, rescanCalls }
  }
  return { ctx: root, calls, rescanCalls }
}

/* ── rendering ───────────────────────────────────────────────────────────── */

describe('RegistryDiagnosticsScreen', () => {
  it('renders the four severity groups with their items and count badges', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId } = render(
      h(RegistryDiagnosticsScreen, { ctx, onNavigateToEntry: () => {} }),
    )

    await findByTestId('registry-diagnostics-item-lock-orphan:subsonic')
    const screen = getByTestId('registry-diagnostics-screen')

    for (const group of ['conflict', 'risk', 'warning', 'info']) {
      expect(getByTestId(`registry-diagnostics-group-${group}`)).toBeTruthy()
    }
    expect(getByTestId('registry-diagnostics-item-audit:bad-plugin')).toBeTruthy()
    expect(getByTestId('registry-diagnostics-item-audit:second')).toBeTruthy()
    expect(getByTestId('registry-diagnostics-item-index-fetch-failed')).toBeTruthy()
    expect(getByTestId('registry-diagnostics-item-lock-summary')).toBeTruthy()

    // Count badges answer "how many", the header answers "what is this".
    const conflict = getByTestId('registry-diagnostics-group-conflict')
    expect(conflict.textContent).toContain('冲突')
    expect(conflict.textContent).toContain('1')
    const risk = getByTestId('registry-diagnostics-group-risk')
    expect(risk.textContent).toContain('风险')
    expect(risk.textContent).toContain('2')
    expect(screen.textContent).toContain('subsonic')
  })

  it('shows the 轻文案 for groups without items', async () => {
    const { ctx } = await harness({ report: EMPTY_REPORT })
    const { getByTestId, findByTestId } = render(h(RegistryDiagnosticsScreen, { ctx }))

    await findByTestId('registry-diagnostics-group-conflict')
    expect(getByTestId('registry-diagnostics-empty-conflict').textContent).toContain('暂无冲突')
    expect(getByTestId('registry-diagnostics-empty-risk').textContent).toContain('暂无风险')
    expect(getByTestId('registry-diagnostics-empty-warning').textContent).toContain('暂无警告')
    expect(getByTestId('registry-diagnostics-empty-info').textContent).toContain('暂无信息')
  })

  it('shows a loading state while the report is being generated', async () => {
    const gate = deferred()
    const { ctx } = await harness({ getDeferred: gate })
    const { getByTestId, findByTestId } = render(h(RegistryDiagnosticsScreen, { ctx }))

    expect(getByTestId('registry-diagnostics-loading')).toBeTruthy()
    gate.resolve()
    await findByTestId('registry-diagnostics-item-lock-summary')
  })

  it('jumps to an entry via the 查看 button and omits it for items without an entryId', async () => {
    const { ctx } = await harness()
    const navigated: Array<{ entryId: string; kind: RegistryEntryKind }> = []
    const { getByTestId, findByTestId, queryByTestId } = render(
      h(RegistryDiagnosticsScreen, {
        ctx,
        onNavigateToEntry: (entryId, kind) => navigated.push({ entryId, kind }),
      }),
    )
    await findByTestId('registry-diagnostics-item-lock-orphan:subsonic')

    fireEvent.click(getByTestId('registry-diagnostics-view-lock-orphan:subsonic'))
    expect(navigated).toEqual([{ entryId: 'subsonic', kind: 'music-source' }])

    // The warning carries no entryId, so it renders no jump.
    expect(queryByTestId('registry-diagnostics-view-index-fetch-failed')).toBeNull()
  })

  it('rescans every risk entry sequentially, showing the in-progress state, then refreshes', async () => {
    const gate = deferred()
    const { ctx, calls, rescanCalls } = await harness({ rescanDeferred: gate })
    const { getByTestId, findByTestId } = render(h(RegistryDiagnosticsScreen, { ctx }))
    await findByTestId('registry-diagnostics-item-audit:bad-plugin')
    expect(calls).toEqual(['getDiagnostics'])

    const button = getByTestId('registry-diagnostics-rescan') as HTMLButtonElement
    expect(button.textContent).toContain('一键重新扫描')
    fireEvent.click(button)

    // First rescan holds: the button reads as busy and disables.
    await waitFor(() => expect(button.disabled).toBe(true))
    expect(button.textContent).toContain('重扫中…')
    expect(rescanCalls).toEqual(['bad-plugin'])

    gate.resolve()
    await waitFor(() => expect(rescanCalls).toEqual(['bad-plugin', 'second']))
    await waitFor(() => expect(button.textContent).toContain('一键重新扫描'))
    // The hook refreshed the report after the rescans.
    expect(calls.filter((call) => call === 'getDiagnostics')).toHaveLength(3)
  })

  it('hides the rescan button when there are no risks', async () => {
    const { ctx } = await harness({ report: EMPTY_REPORT })
    const { queryByTestId, findByTestId } = render(h(RegistryDiagnosticsScreen, { ctx }))
    await findByTestId('registry-diagnostics-empty-risk')
    expect(queryByTestId('registry-diagnostics-rescan')).toBeNull()
  })

  it('re-generates the report through the header refresh button', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId, findByTestId } = render(h(RegistryDiagnosticsScreen, { ctx }))
    await findByTestId('registry-diagnostics-item-lock-summary')
    expect(calls).toEqual(['getDiagnostics'])

    fireEvent.click(getByTestId('registry-diagnostics-refresh'))
    await waitFor(() => expect(calls).toEqual(['getDiagnostics', 'getDiagnostics']))
    await findByTestId('registry-diagnostics-item-lock-summary')
  })

  it('shows an error state with a working retry when generation fails', async () => {
    const { ctx } = await harness({ getError: new Error('store unavailable') })
    const { getByTestId, findByTestId } = render(h(RegistryDiagnosticsScreen, { ctx }))

    const errorBox = await findByTestId('registry-diagnostics-error')
    expect(errorBox.textContent).toContain('store unavailable')

    // Retry re-runs generation; the stub keeps failing, so the error persists —
    // the button must still be there for the user.
    fireEvent.click(getByTestId('registry-diagnostics-retry'))
    await findByTestId('registry-diagnostics-retry')
  })

  it('degrades when the contentRegistry service is missing entirely', async () => {
    const { ctx } = await harness({ noService: true })
    const { getByTestId } = render(h(RegistryDiagnosticsScreen, { ctx }))
    expect(getByTestId('registry-diagnostics-service-missing')).toBeTruthy()
  })

  it('degrades when the service does not implement the optional diagnostics methods', async () => {
    const { ctx } = await harness({ noGetDiagnostics: true })
    const { getByTestId } = render(h(RegistryDiagnosticsScreen, { ctx }))
    expect(getByTestId('registry-diagnostics-service-missing')).toBeTruthy()
  })
})
