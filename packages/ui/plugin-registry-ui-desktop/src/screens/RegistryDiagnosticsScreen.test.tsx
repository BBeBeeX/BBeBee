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
      'Lock record points to content no longer installed: subsonic',
      'registry.lock.json still carries a lock record for subsonic, but the content is no longer installed.',
      { entryId: 'subsonic', kind: 'music-source' },
    ),
  ],
  risks: [
    item('audit:bad-plugin', 'risk', 'Security scan risk: Bad Plugin', '1 block and 0 warn finding(s) in total; first: eval detection.', {
      entryId: 'bad-plugin',
      kind: 'plugin',
    }),
    item('audit:second', 'risk', 'Security scan risk: Second', '0 block and 2 warn finding(s) in total.', {
      entryId: 'second',
      kind: 'lyric-source',
    }),
  ],
  warnings: [item('index-fetch-failed', 'warning', 'Index fetch failed', 'The most recent index fetch failed (offline).')],
  info: [item('lock-summary', 'info', 'Lock record summary', 'Total 2 lock record(s) (Plugin 1, Theme 1).')],
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
    expect(conflict.textContent).toContain('Conflict')
    expect(conflict.textContent).toContain('1')
    const risk = getByTestId('registry-diagnostics-group-risk')
    expect(risk.textContent).toContain('Risk')
    expect(risk.textContent).toContain('2')
    expect(screen.textContent).toContain('subsonic')
  })

  it('shows the light copy for groups without items', async () => {
    const { ctx } = await harness({ report: EMPTY_REPORT })
    const { getByTestId, findByTestId } = render(h(RegistryDiagnosticsScreen, { ctx }))

    await findByTestId('registry-diagnostics-group-conflict')
    expect(getByTestId('registry-diagnostics-empty-conflict').textContent).toContain('No conflicts')
    expect(getByTestId('registry-diagnostics-empty-risk').textContent).toContain('No risks')
    expect(getByTestId('registry-diagnostics-empty-warning').textContent).toContain('No warnings')
    expect(getByTestId('registry-diagnostics-empty-info').textContent).toContain('No info')
  })

  it('shows a loading state while the report is being generated', async () => {
    const gate = deferred()
    const { ctx } = await harness({ getDeferred: gate })
    const { getByTestId, findByTestId } = render(h(RegistryDiagnosticsScreen, { ctx }))

    expect(getByTestId('registry-diagnostics-loading')).toBeTruthy()
    gate.resolve()
    await findByTestId('registry-diagnostics-item-lock-summary')
  })

  it('jumps to an entry via the View button and omits it for items without an entryId', async () => {
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
    expect(button.textContent).toContain('Rescan all')
    fireEvent.click(button)

    // First rescan holds: the button reads as busy and disables.
    await waitFor(() => expect(button.disabled).toBe(true))
    expect(button.textContent).toContain('Rescanning…')
    expect(rescanCalls).toEqual(['bad-plugin'])

    gate.resolve()
    await waitFor(() => expect(rescanCalls).toEqual(['bad-plugin', 'second']))
    await waitFor(() => expect(button.textContent).toContain('Rescan all'))
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
