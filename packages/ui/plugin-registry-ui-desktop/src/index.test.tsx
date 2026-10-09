// @vitest-environment jsdom
/**
 * Desktop registry UI tests — the "发现" screen and the settings card,
 * rendered against stub services the way the shell would bind them.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { Context, Service } from 'cordis'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import type {
  AppSettings,
  RegistryEntry,
  RegistryEntryDetails,
  RegistryIndex,
  RegistryUpdate,
  SettingsService,
  SourceRecord,
} from '@BBeBee/protocol'
import { RegistryScreen } from './screens/RegistryScreen.js'
import { RegistrySettingsCard } from './components/RegistrySettingsCard.js'
import {
  deriveRegistryActionState,
  minAppVersionBlock,
  type InstalledContentSnapshot,
} from './hooks/install-state.js'
import plugin from './index.js'
import { REGISTRY_VIEWS } from '@BBeBee/plugin-registry/views'

afterEach(() => {
  cleanup()
  delete (window as unknown as { BBeBee?: unknown }).BBeBee
})

/* ── fixtures ────────────────────────────────────────────────────────────── */

function makeSourceRecord(sourceUrl: string, version: string): SourceRecord {
  const doc = { sourceUrl, sourceName: 'Doc', version }
  return {
    id: `rec-${sourceUrl}`,
    sourceUrl,
    name: 'Doc',
    type: 'music',
    doc: doc as unknown as SourceRecord['doc'],
    docJson: JSON.stringify(doc),
    docHash: 'deadbeef',
    enabled: true,
    sortOrder: 0,
    allowedHosts: ['a.example'],
    locallyModified: false,
    importedAt: 0,
    updatedAt: 0,
    failCount: 0,
  }
}

const INDEX: RegistryIndex = {
  entries: [
    {
      id: 'music-new',
      kind: 'music-source',
      name: 'Alpha Source',
      version: '1.1.0',
      author: 'Ann',
      description: 'A music source',
      sourceUrl: 'https://a.example',
      downloadUrl: 'https://cdn.example/a.json',
      updatedAt: '2026-01-15T00:00:00Z',
    },
    {
      id: 'music-current',
      kind: 'music-source',
      name: 'Beta Source',
      version: '1.0.0',
      sourceUrl: 'https://b.example',
      downloadUrl: 'https://cdn.example/b.json',
    },
    { id: 'builtin-lrclib', kind: 'lyric-source', name: 'LRCLIB', version: '1.1.0', downloadUrl: 'https://cdn.example/lrclib.json' },
    { id: 'theme-neon', kind: 'theme', name: 'Neon', version: '2.0.0', previewUrl: 'https://cdn.example/neon.png' },
    {
      id: 'plugin-gated',
      kind: 'plugin',
      name: 'Gated Plugin',
      version: '1.0.0',
      minAppVersion: '99.0.0',
      capabilities: ['net:host/*'],
      sha256: 'ab'.repeat(32),
    },
    {
      id: 'plugin-ok',
      kind: 'plugin',
      name: 'OK Plugin',
      version: '1.0.0',
      minAppVersion: '0.0.1',
      repoUrl: 'https://github.com/example/plugin-ok',
      capabilities: ['audio:dsp'],
      sha256: 'cd'.repeat(32),
    },
  ],
}

const INSTALLED: InstalledContentSnapshot = {
  musicSources: [makeSourceRecord('https://a.example', '1.0.0'), makeSourceRecord('https://b.example', '1.0.0')],
  lyricSources: [{ id: 'builtin-lrclib', name: 'LRCLIB', enabled: true, sortOrder: 0, script: '// noop', version: '1.0.0' }],
  themes: [],
  plugins: [],
}

/* ── harness ─────────────────────────────────────────────────────────────── */

interface RegistryStubOptions {
  index?: RegistryIndex
  offline?: boolean
  allowedHosts?: readonly string[]
  locallyModified?: boolean
}

function makeRegistryStub(options: RegistryStubOptions = {}) {
  const calls: string[] = []
  const index = options.index ?? INDEX
  return {
    calls,
    getIndex: async () => {
      calls.push('getIndex')
      return index
    },
    checkUpdates: async (): Promise<readonly RegistryUpdate[]> => {
      calls.push('checkUpdates')
      return [
        {
          kind: 'theme',
          id: 'theme-neon',
          name: 'Neon',
          installedVersion: '1.0.0',
          availableVersion: '2.0.0',
        },
      ]
    },
    updates: () => [],
    fetchEntryDetails: async (entry: RegistryEntry): Promise<RegistryEntryDetails> => {
      calls.push(`details:${entry.id}`)
      return {
        entry,
        ...(entry.kind === 'music-source' || entry.kind === 'lyric-source'
          ? { allowedHosts: options.allowedHosts ?? ['cdn.example', 'music.example'] }
          : {}),
        ...(options.locallyModified ? { isLocallyModified: true } : {}),
      }
    },
    install: async (entry: RegistryEntry, opts?: { confirmed?: boolean; overwrite?: boolean }) => {
      calls.push(`install:${entry.id}:${String(opts?.confirmed ?? false)}${opts?.overwrite ? ':overwrite' : ''}`)
    },
    lastIndexFetchFailed: () => options.offline ?? false,
  }
}

async function harness(options: RegistryStubOptions & { appVersion?: string } = {}) {
  const registry = makeRegistryStub(options)

  class RegistryStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'contentRegistry')
    }
    getIndex = registry.getIndex
    checkUpdates = registry.checkUpdates
    updates = registry.updates
    fetchEntryDetails = registry.fetchEntryDetails
    install = registry.install
    lastIndexFetchFailed = registry.lastIndexFetchFailed
  }

  const installed = INSTALLED
  class SourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sources')
    }
    sources = installed.musicSources
  }
  class LyricSourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'lyricSources')
    }
    getSources = () => installed.lyricSources
  }
  class ThemeStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'theme')
    }
    getThemes = () => installed.themes
  }
  class PluginManagerStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'plugin-manager')
    }
    list = () => installed.plugins
  }

  let currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS, registryAutoCheck: true }
  class SettingsStub extends Service implements Partial<SettingsService> {
    private appCtx: Context
    constructor(ctx: Context) {
      super(ctx, 'settings')
      this.appCtx = ctx
    }
    getSync = (): AppSettings => currentSettings
    update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
      registry.calls.push(`settings-update:${JSON.stringify(patch)}`)
      currentSettings = { ...currentSettings, ...patch }
      this.appCtx.emit('settings/changed', currentSettings)
      return currentSettings
    }
  }

  const navigateCalls: string[] = []
  class UiStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    registerView = () => () => {}
    contribute = () => () => {}
    navigate = (id: string) => {
      navigateCalls.push(id)
    }
    viewFor = () => undefined
  }

  const root = new Context()
  await root.plugin(UiStub)
  await root.plugin(RegistryStub)
  await root.plugin(SourcesStub)
  await root.plugin(LyricSourcesStub)
  await root.plugin(ThemeStub)
  await root.plugin(PluginManagerStub)
  await root.plugin(SettingsStub)

  let scoped: Context | undefined
  root.inject(['ui', 'contentRegistry', 'settings'], (s) => void (scoped = s))
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (!scoped) throw new Error('failed to scope')

  // The desktop bridge, as the preload would expose it.
  ;(window as unknown as { BBeBee?: unknown }).BBeBee = {
    getAppVersion: async () => options.appVersion ?? '0.1.0',
  }

  return { ctx: scoped, calls: registry.calls, navigateCalls, registry }
}

/* ── RegistryScreen ──────────────────────────────────────────────────────── */

describe('RegistryScreen', () => {
  it('renders the four tabs and the entries of the active one', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))

    expect(getByTestId('registry-tab-music-source')).toBeTruthy()
    expect(getByTestId('registry-tab-lyric-source')).toBeTruthy()
    expect(getByTestId('registry-tab-theme')).toBeTruthy()
    expect(getByTestId('registry-tab-plugin')).toBeTruthy()

    await findByTestId('registry-entry-music-new')
    expect(getByTestId('registry-entry-music-current')).toBeTruthy()
    expect(queryByTestId('registry-entry-theme-neon')).toBeNull()

    fireEvent.click(getByTestId('registry-tab-theme'))
    await waitFor(() => expect(getByTestId('registry-entry-theme-neon')).toBeTruthy())
    const preview = getByTestId('registry-entry-theme-neon').querySelector('img')
    expect(preview?.getAttribute('src')).toBe('https://cdn.example/neon.png')
  })

  it('filters entries by name, author and description', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.change(getByTestId('registry-search'), { target: { value: 'alpha' } })
    await waitFor(() => expect(queryByTestId('registry-entry-music-current')).toBeNull())
    expect(getByTestId('registry-entry-music-new')).toBeTruthy()

    fireEvent.change(getByTestId('registry-search'), { target: { value: 'ann' } })
    await waitFor(() => expect(getByTestId('registry-entry-music-new')).toBeTruthy())

    fireEvent.change(getByTestId('registry-search'), { target: { value: '不存在的内容' } })
    await waitFor(() => expect(getByTestId('registry-empty')).toBeTruthy())
  })

  it('shows install/update/installed action states from the installed-content services', async () => {
    const { ctx } = await harness()
    const { findByTestId, getByTestId } = render(h(RegistryScreen, { ctx }))

    // 1.1.0 in the registry vs 1.0.0 installed → 更新.
    const updateBtn = await findByTestId('registry-action-music-new')
    expect(updateBtn.getAttribute('data-state')).toBe('update')
    expect(updateBtn.textContent).toContain('更新')

    // 1.0.0 == 1.0.0 → 已安装, disabled.
    const installedBtn = getByTestId('registry-action-music-current')
    expect(installedBtn.getAttribute('data-state')).toBe('installed')
    expect((installedBtn as HTMLButtonElement).disabled).toBe(true)
    expect(installedBtn.textContent).toContain('已安装')

    // The builtin lrclib lyric source: 内置 tag + update flow.
    fireEvent.click(getByTestId('registry-tab-lyric-source'))
    const lrclibEntry = await findByTestId('registry-entry-builtin-lrclib')
    expect(lrclibEntry.textContent).toContain('内置')
    expect(getByTestId('registry-action-builtin-lrclib').getAttribute('data-state')).toBe('update')
  })

  it('disables a plugin entry gated by minAppVersion and shows the reason', async () => {
    const { ctx } = await harness({ appVersion: '0.1.0' })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))

    fireEvent.click(getByTestId('registry-tab-plugin'))
    const gated = await findByTestId('registry-entry-plugin-gated')
    const gatedBtn = getByTestId('registry-action-plugin-gated')
    expect((gatedBtn as HTMLButtonElement).disabled).toBe(true)
    expect(gated.textContent).toContain('需要 BBeBee 99.0.0 或更高版本')
    expect(gated.textContent).toContain('net:host/*')

    // Within range → actionable.
    await findByTestId('registry-entry-plugin-ok')
    expect((getByTestId('registry-action-plugin-ok') as HTMLButtonElement).disabled).toBe(false)
  })

  it('runs the confirm flow: details first, then install with confirmed: true', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))

    // A theme nobody has → 安装, on the theme tab.
    fireEvent.click(getByTestId('registry-tab-theme'))
    const fresh = await findByTestId('registry-entry-theme-neon')
    expect(fresh).toBeTruthy()

    const installBtn = getByTestId('registry-action-theme-neon')
    expect(installBtn.getAttribute('data-state')).toBe('install')
    fireEvent.click(installBtn)

    await waitFor(() => expect(calls).toContain('details:theme-neon'))
    expect(queryByTestId('registry-confirm-dialog')).toBeTruthy()

    fireEvent.click(getByTestId('registry-confirm-accept'))
    await waitFor(() => expect(calls).toContain('install:theme-neon:true'))
    expect(queryByTestId('registry-confirm-dialog')).toBeNull()
  })

  it('shows the allowed hosts prominently for a music source install', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-tab-music-source'))
    fireEvent.click(getByTestId('registry-action-music-new'))

    const dialog = await findByTestId('registry-confirm-dialog')
    expect(dialog).toBeTruthy()
    const hosts = getByTestId('registry-hosts-list')
    expect(hosts.textContent).toContain('cdn.example')
    expect(hosts.textContent).toContain('music.example')
  })

  it('shows repoUrl, capabilities, and sha256 for a plugin install', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-tab-plugin')

    fireEvent.click(getByTestId('registry-tab-plugin'))
    fireEvent.click(getByTestId('registry-action-plugin-ok'))

    const dialog = await findByTestId('registry-confirm-dialog')
    expect(dialog).toBeTruthy()
    expect(getByTestId('registry-plugin-repo-url').textContent).toContain('https://github.com/example/plugin-ok')
    expect(getByTestId('registry-plugin-capabilities').textContent).toContain('audio:dsp')
    expect(getByTestId('registry-plugin-sha256').textContent).toContain('cd'.repeat(32))
  })

  it('shows the 离线缓存 hint when the service reports a cache fallback', async () => {
    const { ctx } = await harness({ offline: true })
    const { findByTestId } = render(h(RegistryScreen, { ctx }))
    expect(await findByTestId('registry-offline-hint')).toBeTruthy()
  })

  it('requires explicit overwrite confirmation when a music source was locally modified', async () => {
    const { ctx, calls } = await harness({ locallyModified: true })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-tab-music-source'))
    fireEvent.click(getByTestId('registry-action-music-new'))

    await findByTestId('registry-confirm-dialog')
    expect(getByTestId('registry-locally-modified-warning')).toBeTruthy()

    const acceptBtn = getByTestId('registry-confirm-accept') as HTMLButtonElement
    expect(acceptBtn.disabled).toBe(true)

    const checkbox = getByTestId('registry-overwrite-checkbox')
    fireEvent.click(checkbox)
    expect(acceptBtn.disabled).toBe(false)

    fireEvent.click(acceptBtn)
    await waitFor(() => expect(calls).toContain('install:music-new:true:overwrite'))
  })
})

/* ── RegistrySettingsCard ────────────────────────────────────────────────── */

describe('RegistrySettingsCard', () => {
  it('writes registryAutoCheck through the settings service', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId } = render(h(RegistrySettingsCard, { ctx }))

    const toggle = getByTestId('registry-settings-card').querySelector('[role="switch"]') as HTMLElement
    fireEvent.click(toggle)
    await waitFor(() => expect(calls).toContain('settings-update:{"registryAutoCheck":false}'))
  })

  it('runs a manual check, lists the updates, and navigates to the screen on click', async () => {
    const { ctx, calls, navigateCalls } = await harness()
    const { getByTestId, findByTestId, getByText } = render(h(RegistrySettingsCard, { ctx }))

    expect(getByTestId('registry-last-checked').textContent).toBe('从未')
    fireEvent.click(getByTestId('registry-check-updates'))

    await waitFor(() => expect(calls).toContain('checkUpdates'))
    const item = await findByTestId('registry-update-item-theme-neon')
    expect(item.textContent).toContain('1.0.0')
    expect(item.textContent).toContain('2.0.0')

    fireEvent.click(item)
    expect(navigateCalls).toEqual([REGISTRY_VIEWS.screen])
    expect(getByText(/可用更新/)).toBeTruthy()
  })
})

/* ── pure derivation ─────────────────────────────────────────────────────── */

describe('deriveRegistryActionState / minAppVersionBlock', () => {
  it('derives the three states for each kind', () => {
    const entry = INDEX.entries[0]!
    expect(deriveRegistryActionState(entry, INSTALLED)).toEqual({
      state: 'update',
      installedVersion: '1.0.0',
    })
    expect(deriveRegistryActionState(INDEX.entries[1]!, INSTALLED)).toEqual({
      state: 'installed',
      installedVersion: '1.0.0',
    })
    expect(deriveRegistryActionState(INDEX.entries[2]!, undefined)).toEqual({ state: 'install' })
    // An installed document without a version field is '0.0.0' → update.
    const unversioned = {
      ...INSTALLED,
      musicSources: [makeSourceRecord('https://a.example', undefined as unknown as string)],
    }
    expect(deriveRegistryActionState(entry, unversioned).state).toBe('update')
  })

  it('treats an unparseable stored document as unversioned, and an unknown app version as unblocked', () => {
    const broken = {
      ...INSTALLED,
      musicSources: [{ ...makeSourceRecord('https://a.example', '1.0.0'), docJson: '{ broken' }],
    }
    expect(deriveRegistryActionState(INDEX.entries[0]!, broken).state).toBe('update')

    const gated = INDEX.entries[4]!
    expect(minAppVersionBlock(gated, '0.1.0')).toBeTruthy()
    expect(minAppVersionBlock(gated, '99.0.0')).toBeUndefined()
    expect(minAppVersionBlock(gated, undefined)).toBeUndefined()
    expect(minAppVersionBlock(INDEX.entries[0]!, '0.1.0')).toBeUndefined()
  })
})

/* ── the plugin entry point ──────────────────────────────────────────────── */

describe('plugin-registry-ui-desktop', () => {
  it('registers both views under the contributed descriptor ids', async () => {
    const views = new Map<string, unknown>()
    class UiStub extends Service {
      constructor(ctx: Context) {
        super(ctx, 'ui')
      }
      registerView = (id: string, component: unknown) => {
        views.set(id, component)
        return () => views.delete(id)
      }
      contribute = () => () => {}
      navigate = () => {}
      viewFor = (id: string) => views.get(id)
    }
    // `inject = ['ui', 'contentRegistry', 'settings']` — the plugin stays
    // PENDING until all three exist, so stub the other two minimally.
    class RegistryStub extends Service {
      constructor(ctx: Context) {
        super(ctx, 'contentRegistry')
      }
      getIndex = async () => ({ entries: [] })
      fetchEntryDetails = async (e: unknown) => ({ entry: e as RegistryEntryDetails })
      install = async () => {}
    }
    class SettingsStub extends Service {
      constructor(ctx: Context) {
        super(ctx, 'settings')
      }
      getSync = () => ({ ...DEFAULT_APP_SETTINGS })
    }

    const root = new Context()
    await root.plugin(UiStub)
    await root.plugin(RegistryStub)
    await root.plugin(SettingsStub)
    await root.plugin(plugin)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(views.has(REGISTRY_VIEWS.screen)).toBe(true)
    expect(views.has(REGISTRY_VIEWS.settingsCard)).toBe(true)
  })
})
