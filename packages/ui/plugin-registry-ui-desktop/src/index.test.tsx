// @vitest-environment jsdom
/**
 * Desktop registry UI tests — the "Discover" screen and the settings card,
 * rendered against stub services the way the shell would bind them.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from 'react'
import { act, fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { Context, Service } from 'cordis'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import type {
  AppSettings,
  I18nService,
  LyricSourceDefinition,
  PluginInfo,
  RegistryEntry,
  RegistryEntryDetails,
  RegistryIndex,
  RegistryLockRecord,
  RegistryMetadataService,
  RegistryTask,
  RegistryUpdate,
  SettingsService,
  SourceRecord,
  ThemeDefinition,
} from '@BBeBee/protocol'
import { RegistryScreen } from './screens/RegistryScreen.js'
import { RegistrySettingsCard } from './components/RegistrySettingsCard.js'
import { RegistryEntryCard } from './components/RegistryEntryCard.js'
import {
  deriveRegistryActionState,
  minAppVersionBlock,
  type InstalledContentSnapshot,
} from './hooks/install-state.js'
import { formatDateTime, formatDateMs } from './utils/format.js'
import { isOfficialEntry, parseRepoOwner } from './utils/repo.js'
import plugin from './index.js'
import { REGISTRY_VIEWS } from '@BBeBee/plugin-registry/views'

const memoryStorage = new Map<string, string>()
const mockLocalStorage = {
  getItem: (k: string) => memoryStorage.get(k) ?? null,
  setItem: (k: string, v: string) => void memoryStorage.set(k, String(v)),
  removeItem: (k: string) => void memoryStorage.delete(k),
  clear: () => void memoryStorage.clear(),
}

beforeEach(() => {
  if (!window.localStorage || typeof window.localStorage.clear !== 'function') {
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    })
  }
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage?.clear?.()
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
      // Official: published under the BBeBeeX organization.
      repo: 'https://github.com/BBeBeeX/alpha-source',
    },
    {
      id: 'music-current',
      kind: 'music-source',
      name: 'Beta Source',
      version: '1.0.0',
      sourceUrl: 'https://b.example',
      downloadUrl: 'https://cdn.example/b.json',
      // Third-party.
      repo: 'https://github.com/community/beta-source',
    },
    // No repo → third-party under the owner-only rule, builtin or not.
    { id: 'builtin-lrclib', kind: 'lyric-source', name: 'LRCLIB', version: '1.1.0', downloadUrl: 'https://cdn.example/lrclib.json' },
    // No repo → third-party.
    { id: 'theme-neon', kind: 'theme', name: 'Neon', version: '2.0.0', previewUrl: 'https://cdn.example/neon.png' },
    {
      id: 'plugin-gated',
      kind: 'plugin',
      name: 'Gated Plugin',
      minAppVersion: '99.0.0',
      repo: 'https://github.com/gated-author/gated-plugin',
      category: 'security-permissions',
      npm: '@bbebee/gated-plugin',
      services: ['http'],
      sha256: 'ab'.repeat(32),
    },
    {
      id: 'plugin-ok',
      kind: 'plugin',
      name: 'OK Plugin',
      minAppVersion: '0.0.1',
      repoUrl: 'https://github.com/example/plugin-ok',
      category: 'ui-enhancement',
      npm: '@bbebee/plugin-ok',
      services: ['audio'],
      sha256: 'cd'.repeat(32),
    },
    {
      id: 'plugin-remote',
      kind: 'plugin',
      name: 'Remote Plugin',
      // Official, via the owner/repo shorthand.
      repo: 'BBeBeeX/remote-plugin',
      category: 'remote-mobile',
      npm: '@bbebee/remote-plugin',
      services: ['http'],
      platforms: ['desktop', 'mobile'],
      sha256: 'ee'.repeat(32),
    },
    {
      id: 'plugin-unknown',
      kind: 'plugin',
      name: 'Mystery Plugin',
      repo: 'https://github.com/mystery-author/unknown-plugin',
      // A slug the label map does not know — it must render verbatim.
      category: 'mystery-slug',
      sha256: 'ff'.repeat(32),
    },
  ],
}

const INSTALLED: InstalledContentSnapshot = {
  musicSources: [makeSourceRecord('https://a.example', '1.0.0'), makeSourceRecord('https://b.example', '1.0.0')],
  lyricSources: [{ id: 'builtin-lrclib', name: 'LRCLIB', enabled: true, sortOrder: 0, script: '// noop', version: '1.0.0' }],
  themes: [],
  plugins: [],
}

/* ── task-center fixtures ────────────────────────────────────────────────── */

const TASK_STARTED_AT = Date.UTC(2026, 0, 17, 8, 24)

const RUNNING_TASK: RegistryTask = {
  id: 'task-running',
  entryId: 'music-new',
  entryName: 'Alpha Source',
  kind: 'music-source',
  operation: 'install',
  stage: 'download',
  status: 'running',
  startedAt: TASK_STARTED_AT,
}
const PENDING_TASK: RegistryTask = {
  id: 'task-pending',
  entryId: 'plugin-ok',
  entryName: 'OK Plugin',
  kind: 'plugin',
  operation: 'install',
  stage: 'verify',
  status: 'pending',
  startedAt: TASK_STARTED_AT - 60_000,
}
const SUCCESS_TASK: RegistryTask = {
  id: 'task-success',
  entryId: 'theme-neon',
  entryName: 'Neon',
  kind: 'theme',
  operation: 'install',
  stage: 'install',
  status: 'success',
  startedAt: TASK_STARTED_AT - 120_000,
  finishedAt: TASK_STARTED_AT - 119_000,
}
const FAILED_TASK: RegistryTask = {
  id: 'task-failed',
  entryId: 'music-current',
  entryName: 'Beta Source',
  kind: 'music-source',
  operation: 'install',
  stage: 'install',
  status: 'failed',
  error: 'registry: the document for "music-current" was not imported — Doc: missing ruleStream',
  startedAt: TASK_STARTED_AT - 180_000,
  finishedAt: TASK_STARTED_AT - 179_000,
}

/* ── harness ─────────────────────────────────────────────────────────────── */

interface RegistryStubOptions {
  index?: RegistryIndex
  offline?: boolean
  allowedHosts?: readonly string[]
  locallyModified?: boolean
  securityAudit?: any
  commit?: string
  commitDiff?: { previousCommit?: string; currentCommit: string }
  /** `'owner/repo'` (as parsed from the entry) → the stats the stub answers. */
  repoStats?: Record<string, { stars?: number; contributors?: number; downloads?: number }>
  /** False removes the registryMetadata service entirely (mobile-like). */
  metadataService?: boolean
  /** Entry id → lock record served by `getLockFile`; `false` removes the optional method. */
  lockRecords?: Record<string, RegistryLockRecord> | false
  /** Extra themes/plugins/lyric sources the installed-content stubs report as installed. */
  installedThemes?: ThemeDefinition[]
  installedPlugins?: PluginInfo[]
  installedLyricSources?: LyricSourceDefinition[]
  /** npm package name → latest version the plugin-manager stub answers. */
  pluginLatest?: Record<string, string>
  /** The task-center records `getTasks` serves (and the change event re-emits). */
  tasks?: readonly RegistryTask[]
  /** False removes the optional task-center methods entirely (quiet-degrade path). */
  taskMethods?: boolean
}

function makeMetadataStub(
  repoStats: RegistryStubOptions['repoStats'],
  calls: string[],
): Pick<RegistryMetadataService, 'getRepoStats' | 'peekRepoStats'> {
  const table = repoStats ?? {}
  return {
    getRepoStats: async (owner: string, repo: string) => {
      calls.push(`stats:${owner}/${repo}`)
      return { owner, repo, fetchedAt: 1, ...(table[`${owner}/${repo}`] ?? {}) }
    },
    peekRepoStats: () => undefined,
  }
}

function makeRegistryStub(options: RegistryStubOptions = {}) {
  const calls: string[] = []
  const index = options.index ?? INDEX
  // The task center's records, mutated by emitTasks/clearFinishedTasks the
  // way the real service mutates its own list.
  const taskList: RegistryTask[] = [...(options.tasks ?? [])]
  let notifyTasksChanged: (() => void) | undefined
  return {
    calls,
    taskList,
    /** The harness wires this to a `'registry/tasks-changed'` emit once the stub ctx exists. */
    setTaskNotifier: (fn: () => void) => {
      notifyTasksChanged = fn
    },
    /** Replace the whole task list and announce it, as the service's snapshots do. */
    emitTasks: (tasks: readonly RegistryTask[]) => {
      taskList.splice(0, taskList.length, ...tasks)
      notifyTasksChanged?.()
    },
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
        ...(options.securityAudit ? { securityAudit: options.securityAudit } : {}),
        ...(options.commit ? { commit: options.commit } : {}),
        ...(options.commitDiff ? { commitDiff: options.commitDiff } : {}),
      }
    },
    install: async (entry: RegistryEntry, opts?: { confirmed?: boolean; overwrite?: boolean }) => {
      calls.push(`install:${entry.id}:${String(opts?.confirmed ?? false)}${opts?.overwrite ? ':overwrite' : ''}`)
    },
    lastIndexFetchFailed: () => options.offline ?? false,
    // The optional lock-file read; `false` removes the method entirely so the
    // quiet-degrade path can be exercised.
    ...(options.lockRecords !== false
      ? {
          getLockFile: async () => {
            calls.push('getLockFile')
            return { version: 1 as const, records: options.lockRecords ?? {} }
          },
        }
      : {}),
    // The optional task-center read/clear; `false` removes both the same way.
    ...(options.taskMethods !== false
      ? {
          getTasks: (): readonly RegistryTask[] => [...taskList],
          clearFinishedTasks: () => {
            calls.push('clear-finished-tasks')
            for (let i = taskList.length - 1; i >= 0; i--) {
              const status = taskList[i]?.status
              if (status === 'success' || status === 'failed') taskList.splice(i, 1)
            }
            notifyTasksChanged?.()
          },
        }
      : {}),
  }
}

async function harness(options: RegistryStubOptions & { appVersion?: string } = {}) {
  const registry = makeRegistryStub(options)
  const metadata = makeMetadataStub(options.repoStats, registry.calls)

  let registryCtx: Context | undefined
  class RegistryStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'contentRegistry')
      registryCtx = ctx
    }
    getIndex = registry.getIndex
    checkUpdates = registry.checkUpdates
    updates = registry.updates
    fetchEntryDetails = registry.fetchEntryDetails
    install = registry.install
    lastIndexFetchFailed = registry.lastIndexFetchFailed
    getLockFile = registry.getLockFile
    // Present only when the stub options keep them — the quiet-degrade test
    // exercises the absent case, same as getLockFile above.
    getTasks = registry.getTasks
    clearFinishedTasks = registry.clearFinishedTasks
    removeLockRecord = async (id: string) => {
      registry.calls.push(`remove-lock:${id}`)
    }
  }

  class RegistryMetadataStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'registryMetadata')
    }
    getRepoStats = metadata.getRepoStats
    peekRepoStats = metadata.peekRepoStats
  }

  // A per-harness clone: uninstall tests mutate the installed content, and
  // the shared fixture must stay pristine for the other cases.
  const installed = {
    musicSources: [...INSTALLED.musicSources],
    lyricSources: [...INSTALLED.lyricSources, ...(options.installedLyricSources ?? [])],
    themes: [...(options.installedThemes ?? [])],
    plugins: [...(options.installedPlugins ?? [])],
  }
  class SourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sources')
    }
    get sources() {
      return installed.musicSources
    }
    remove = async (id: string) => {
      registry.calls.push(`remove-source:${id}`)
      installed.musicSources = installed.musicSources.filter((r) => r.id !== id)
    }
    setEnabled = async (id: string, enabled: boolean): Promise<void> => {
      registry.calls.push(`set-source-enabled:${id}:${enabled}`)
      installed.musicSources = installed.musicSources.map((r) => (r.id === id ? { ...r, enabled } : r))
    }
  }
  class LyricSourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'lyricSources')
    }
    getSources = () => installed.lyricSources
    removeSource = async (id: string): Promise<boolean> => {
      registry.calls.push(`remove-lyric-source:${id}`)
      const before = installed.lyricSources.length
      installed.lyricSources = installed.lyricSources.filter((s) => s.id !== id)
      return installed.lyricSources.length < before
    }
    setEnabled = async (id: string, enabled: boolean): Promise<void> => {
      registry.calls.push(`set-lyric-enabled:${id}:${enabled}`)
      const s = installed.lyricSources.find((item) => item.id === id)
      if (s) s.enabled = enabled
    }
  }
  class ThemeStub extends Service {
    private currentTheme = ({ id: 'default-dark', name: 'Default Dark', isDark: true, tokens: {} as any } as ThemeDefinition)
    constructor(ctx: Context) {
      super(ctx, 'theme')
    }
    getThemes = () => installed.themes
    getCurrentTheme = () => this.currentTheme
    setTheme = async (id: string): Promise<void> => {
      registry.calls.push(`set-theme:${id}`)
      const t = installed.themes.find((item) => item.id === id)
      if (t) this.currentTheme = t
    }
    removeTheme = (id: string): boolean => {
      registry.calls.push(`remove-theme:${id}`)
      const before = installed.themes.length
      installed.themes = installed.themes.filter((t) => t.id !== id)
      return installed.themes.length < before
    }
  }
  class PluginManagerStub extends Service {
    private appCtx: Context
    constructor(ctx: Context) {
      super(ctx, 'plugin-manager')
      this.appCtx = ctx
    }
    list = () => installed.plugins
    getNpmLatest = async (npm: string): Promise<string | undefined> => {
      registry.calls.push(`npm-latest:${npm}`)
      return options.pluginLatest?.[npm]
    }
    setEnabled = async (id: string, enabled: boolean) => {
      registry.calls.push(`set-plugin-enabled:${id}:${enabled}`)
      const p = installed.plugins.find((item) => item.id === id)
      if (p) p.enabled = enabled
      this.appCtx.emit('plugin-manager/changed')
    }
    uninstall = async (id: string) => {
      registry.calls.push(`uninstall-plugin:${id}`)
      installed.plugins = installed.plugins.filter((p) => p.id !== id)
      this.appCtx.emit('plugin-manager/changed')
    }
    previewLocalPlugin = async (packageBase64: string) => {
      registry.calls.push(`preview-local:${packageBase64.length}`)
      return {
        id: 'local-x',
        npm: '@t/local',
        displayName: 'Local X',
        description: 'a local test plugin',
        version: '1.0.0',
        author: 'test',
        capabilities: ['fs:read/**'],
        fileCount: 3,
        sha256: 'a'.repeat(64),
        warnings: ['本地导入：未经审核', 'manifest 依赖 "zzz" 不在已注册或已安装的插件中'],
      }
    }
    installLocalPlugin = async (_packageBase64: string, opts?: { confirmed?: boolean }) => {
      registry.calls.push(`install-local:${opts?.confirmed === true ? 'confirmed' : 'unconfirmed'}`)
      const preview = await this.previewLocalPlugin(_packageBase64)
      installed.plugins = [
        ...installed.plugins,
        {
          id: 'local-x',
          name: '@t/local',
          displayName: 'Local X',
          version: '1.0.0',
          enabled: true,
          state: 'ACTIVE',
          waitingFor: [],
          dependencies: [],
          dependents: [],
        } as unknown as PluginInfo,
      ]
      this.appCtx.emit('plugin-manager/changed')
      return preview
    }
  }

  let currentSettings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    language: 'en',
    registryAutoCheck: true,
  }
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
    onSettingsChange = (cb: (s: AppSettings) => void) => this.appCtx.on('settings/changed', cb)
  }

  const REGISTRY_STRINGS: Record<string, Record<string, string>> = {
    en: {
      'registry:filter.searchPlaceholder': 'Search names, authors or descriptions…',
      'registry:filter.showThirdParty': 'Show third-party content',
      'registry:filter.showThirdPartyHint':
        'When off, only official entries published by the BBeBeeX organization are shown',
      'registry:filter.sortBy': 'Sort by',
      'registry:filter.sortByName': 'By name',
      'registry:filter.sortByStars': 'By stars',
      'registry:filter.sortByDownloads': 'By downloads',
      'registry:filter.sortByContributors': 'By contributors',
      'registry:filter.toggleSortDirection': 'Toggle ascending / descending',
      'registry:filter.ascending': 'Ascending',
      'registry:filter.descending': 'Descending',
      'registry:filter.allCategories': 'All categories',
      'registry:filter.categoryFilter': 'Filter by category',
      'registry:registryEntry.downloads': 'Downloads',
      // Round-2 sweep keys for the settings card (verbatim catalogue copy —
      // the stub does not interpolate, so templates keep their placeholders).
      'registry:registrySettings.updatesAvailableCount': 'Updates available ({count})',
      'registry:registrySettings.everythingIsUpToDate':
        'Everything is up to date. You can also browse community music sources, lyric sources, themes and plugins on the Discover page.',
    },
    zh: {
      'registry:filter.searchPlaceholder': '搜索名称、作者或描述…',
      'registry:filter.showThirdParty': '显示第三方内容',
      'registry:filter.showThirdPartyHint': '关闭后仅显示 BBeBeeX 组织发布的官方条目',
      'registry:filter.sortBy': '排序方式',
      'registry:filter.sortByName': '按名称',
      'registry:filter.sortByStars': '按星标',
      'registry:filter.sortByDownloads': '按下载量',
      'registry:filter.sortByContributors': '按贡献者',
      'registry:filter.toggleSortDirection': '切换升序 / 降序',
      'registry:filter.ascending': '升序',
      'registry:filter.descending': '降序',
      'registry:filter.allCategories': '全部分类',
      'registry:filter.categoryFilter': '按分类筛选',
      'registry:registryEntry.downloads': '下载量',
      'registry:registrySettings.updatesAvailableCount': '有可用更新（{count}）',
      'registry:registrySettings.everythingIsUpToDate':
        '一切已是最新。你也可以在发现页浏览社区音乐源、歌词源、主题和插件。',
    },
  }

  class I18nStub extends Service implements I18nService {
    static override readonly name = 'i18n'
    locale = 'en'
    private listeners = new Set<(locale: string) => void>()
    constructor(ctx: Context) {
      super(ctx, 'i18n')
      ctx.on('settings/changed', (next: AppSettings) => {
        const nextLocale = next.language === 'zh' ? 'zh' : 'en'
        if (nextLocale !== this.locale) {
          this.locale = nextLocale
          for (const listener of [...this.listeners]) listener(this.locale)
        }
      })
    }
    t = (key: string): string =>
      REGISTRY_STRINGS[this.locale]?.[key] ?? REGISTRY_STRINGS['en']?.[key] ?? key
    register = () => () => {}
    onLocaleChange = (cb: (locale: string) => void) => {
      this.listeners.add(cb)
      return () => void this.listeners.delete(cb)
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
  if (options.metadataService !== false) await root.plugin(RegistryMetadataStub)
  await root.plugin(SourcesStub)
  await root.plugin(LyricSourcesStub)
  await root.plugin(ThemeStub)
  await root.plugin(PluginManagerStub)
  await root.plugin(SettingsStub)
  await root.plugin(I18nStub)

  let scoped: Context | undefined
  root.inject(['ui', 'contentRegistry', 'settings', 'i18n'], (s) => void (scoped = s))
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (!scoped) throw new Error('failed to scope')

  // The stub's task mutations become real event emissions on the service ctx.
  registry.setTaskNotifier(() => {
    registryCtx?.emit('registry/tasks-changed', [...registry.taskList])
  })

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

    fireEvent.change(getByTestId('registry-search'), { target: { value: 'nonexistent content' } })
    await waitFor(() => expect(getByTestId('registry-empty')).toBeTruthy())
  })

  it('shows install/update/installed action states from the installed-content services', async () => {
    const { ctx } = await harness()
    const { findByTestId, getByTestId } = render(h(RegistryScreen, { ctx }))

    // 1.1.0 in the registry vs 1.0.0 installed → update.
    const updateBtn = await findByTestId('registry-action-music-new')
    expect(updateBtn.getAttribute('data-state')).toBe('update')
    expect(updateBtn.textContent).toContain('Update')

    // 1.0.0 == 1.0.0 → installed: like lyric sources, an installed music
    // source renders the enablement toggle (in use → Disable), not a
    // disabled Installed button.
    const installedBtn = getByTestId('registry-action-music-current')
    expect(installedBtn.getAttribute('data-state')).toBe('in-use')
    expect((installedBtn as HTMLButtonElement).disabled).toBe(false)
    expect(installedBtn.textContent).toContain('Disable')

    // The builtin lrclib lyric source: built-in tag + update flow.
    fireEvent.click(getByTestId('registry-tab-lyric-source'))
    const lrclibEntry = await findByTestId('registry-entry-builtin-lrclib')
    expect(lrclibEntry.textContent).toContain('Built-in')
    expect(getByTestId('registry-action-builtin-lrclib').getAttribute('data-state')).toBe('update')
  })

  it('disables a plugin entry gated by minAppVersion and shows the reason', async () => {
    const { ctx } = await harness({ appVersion: '0.1.0' })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))

    fireEvent.click(getByTestId('registry-tab-plugin'))
    const gated = await findByTestId('registry-entry-plugin-gated')
    const gatedBtn = getByTestId('registry-action-plugin-gated')
    expect((gatedBtn as HTMLButtonElement).disabled).toBe(true)
    expect(gated.textContent).toContain('Requires BBeBee 99.0.0 or later')
    expect(gated.textContent).toContain('http')

    // Within range → actionable.
    await findByTestId('registry-entry-plugin-ok')
    expect((getByTestId('registry-action-plugin-ok') as HTMLButtonElement).disabled).toBe(false)
  })

  it('runs the confirm flow: details first, then install with confirmed: true', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))

    // A theme nobody has → install, on the theme tab.
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

  it('shows repoUrl, npm, services, and sha256 for a plugin install', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-tab-plugin')

    fireEvent.click(getByTestId('registry-tab-plugin'))
    fireEvent.click(getByTestId('registry-action-plugin-ok'))

    const dialog = await findByTestId('registry-confirm-dialog')
    expect(dialog).toBeTruthy()
    expect(getByTestId('registry-plugin-repo-url').textContent).toContain('https://github.com/example/plugin-ok')
    expect(getByTestId('registry-plugin-npm').textContent).toContain('@bbebee/plugin-ok')
    expect(getByTestId('registry-plugin-services').textContent).toContain('audio')
    expect(getByTestId('registry-plugin-sha256').textContent).toContain('cd'.repeat(32))
  })

  it('shows the offline-cache hint when the service reports a cache fallback', async () => {
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

  it('displays security audit report badge, findings and commit diff in confirm dialog', async () => {
    const { ctx } = await harness({
      securityAudit: {
        level: 'warn',
        findings: [
          {
            category: 'undeclared-egress',
            level: 'warn',
            message: 'Suspicious domain found',
            line: 42,
            snippet: 'fetch("http://example.org")',
          },
        ],
      },
      commitDiff: {
        previousCommit: '1234567890abcdef',
        currentCommit: 'abcdef1234567890',
      },
    })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-tab-plugin')

    fireEvent.click(getByTestId('registry-tab-plugin'))
    fireEvent.click(getByTestId('registry-action-plugin-ok'))

    await findByTestId('registry-confirm-dialog')
    expect(getByTestId('registry-security-audit-report')).toBeTruthy()
    expect(getByTestId('registry-security-badge').textContent).toContain('Warn')
    expect(getByTestId('registry-security-findings').textContent).toContain('undeclared-egress')
    expect(getByTestId('registry-commit-diff').textContent).toContain('1234567')
    expect(getByTestId('registry-commit-diff').textContent).toContain('abcdef1')
  })

  it('blocks confirm button when security audit level is block and requires override checkbox', async () => {
    const { ctx, calls } = await harness({
      securityAudit: {
        level: 'block',
        findings: [
          {
            category: 'dynamic-execution',
            level: 'block',
            message: 'Direct eval is strictly prohibited',
            line: 10,
          },
        ],
      },
    })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-tab-plugin')

    fireEvent.click(getByTestId('registry-tab-plugin'))
    fireEvent.click(getByTestId('registry-action-plugin-ok'))

    await findByTestId('registry-confirm-dialog')
    expect(getByTestId('registry-security-badge').textContent).toContain('Block')
    expect(getByTestId('registry-security-block-warning')).toBeTruthy()

    const acceptBtn = getByTestId('registry-confirm-accept') as HTMLButtonElement
    expect(acceptBtn.disabled).toBe(true)

    // Check override checkbox to unblock
    const checkbox = getByTestId('registry-block-override-checkbox')
    fireEvent.click(checkbox)
    expect(acceptBtn.disabled).toBe(false)

    fireEvent.click(acceptBtn)
    await waitFor(() => expect(calls).toContain('install:plugin-ok:true'))
  })
})

/* ── RegistryScreen: filters and sorting ─────────────────────────────────── */

/** The rendered entry cards' testids, in visual order. */
function cardIds(screen: HTMLElement): Array<string | null> {
  return Array.from(screen.querySelectorAll('[data-testid^="registry-entry-"]')).map((el) =>
    el.getAttribute('data-testid'),
  )
}

describe('RegistryScreen filters and sorting', () => {
  it('hides third-party entries while the third-party toggle is off, and restores them', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')
    expect(getByTestId('registry-entry-music-current')).toBeTruthy()

    // music-new is BBeBeeX-published (official); music-current is community.
    fireEvent.click(getByTestId('registry-official-toggle'))
    await waitFor(() => expect(queryByTestId('registry-entry-music-current')).toBeNull())
    expect(getByTestId('registry-entry-music-new')).toBeTruthy()

    fireEvent.click(getByTestId('registry-official-toggle'))
    await waitFor(() => expect(getByTestId('registry-entry-music-current')).toBeTruthy())
  })

  it('judges officialness by repo owner only: builtin and repo-less entries are third-party', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    // The builtin lyric source publishes no repo — the organization owner is
    // the only trust anchor, so even a builtin entry reads as third-party.
    fireEvent.click(getByTestId('registry-tab-lyric-source'))
    await waitFor(() => expect(getByTestId('registry-entry-builtin-lrclib')).toBeTruthy())
    fireEvent.click(getByTestId('registry-official-toggle'))
    await waitFor(() => expect(queryByTestId('registry-entry-builtin-lrclib')).toBeNull())

    // A theme without any repository reads as third-party and disappears too.
    fireEvent.click(getByTestId('registry-tab-theme'))
    await waitFor(() => expect(queryByTestId('registry-entry-theme-neon')).toBeNull())
    expect(getByTestId('registry-empty')).toBeTruthy()
  })

  it('sorts by stars only once the key changes, keeps no-data last, and flips with the direction button', async () => {
    const { ctx, calls } = await harness({
      repoStats: {
        'BBeBeeX/alpha-source': { stars: 500, contributors: 12 },
        'community/beta-source': { stars: 900, contributors: 30 },
        'gated-author/gated-plugin': { stars: 77, contributors: 5 },
        'example/plugin-ok': { stars: 10, contributors: 2 },
      },
    })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    // The name sort (the default) must not request any stats.
    expect(calls.filter((call) => call.startsWith('stats:'))).toEqual([])

    fireEvent.change(getByTestId('registry-sort').querySelector('select') as HTMLSelectElement, {
      target: { value: 'stars' },
    })

    // Stars default to descending and start the lazy fetch.
    await waitFor(() => expect(calls.some((call) => call.startsWith('stats:'))).toBe(true))
    await waitFor(() =>
      expect(cardIds(getByTestId('registry-screen'))).toEqual([
        'registry-entry-music-current', // 900
        'registry-entry-music-new', // 500
      ]),
    )
    expect(getByTestId('registry-stats-music-current').textContent).toContain('900')
    expect(getByTestId('registry-stats-music-new').textContent).toContain('500')

    fireEvent.click(getByTestId('registry-sort-direction'))
    await waitFor(() =>
      expect(cardIds(getByTestId('registry-screen'))).toEqual([
        'registry-entry-music-new',
        'registry-entry-music-current',
      ]),
    )

    // On the plugin tab the entries without stats trail the sorted ones,
    // keeping their original relative order.
    fireEvent.click(getByTestId('registry-tab-plugin'))
    await waitFor(() =>
      expect(cardIds(getByTestId('registry-screen'))).toEqual([
        'registry-entry-plugin-gated', // 77
        'registry-entry-plugin-ok', // 10
        'registry-entry-plugin-remote', // no data
        'registry-entry-plugin-unknown', // no data
      ]),
    )
  })

  it('sorts by downloads descending and displays download count without contributor icon', async () => {
    const { ctx } = await harness({
      repoStats: {
        'BBeBeeX/alpha-source': { stars: 500, downloads: 1200 },
        'community/beta-source': { stars: 900, downloads: 3500 },
      },
    })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.change(getByTestId('registry-sort').querySelector('select') as HTMLSelectElement, {
      target: { value: 'downloads' },
    })

    await waitFor(() =>
      expect(cardIds(getByTestId('registry-screen'))).toEqual([
        'registry-entry-music-current', // 3500
        'registry-entry-music-new', // 1200
      ]),
    )
    const betaStats = getByTestId('registry-stats-music-current')
    expect(betaStats.textContent).toContain('900')
    expect(betaStats.textContent).toContain('3.5k')
    // Contributor user icon is removed per request
    expect(betaStats.querySelector('[data-icon="user"]')).toBeNull()
    expect(betaStats.querySelector('[data-icon="download"]')).toBeTruthy()
    expect(betaStats.querySelector('[data-icon="star-filled"]')).toBeTruthy()
  })

  it('shows status badge, toggle/use button, and uninstall on kind tabs for lyric source and theme', async () => {
    const extraLyric: RegistryEntry = {
      id: 'ext-lyric',
      kind: 'lyric-source',
      name: 'Ext Lyric',
      version: '1.0.0',
      downloadUrl: 'https://cdn.example/ext.json',
    }
    const { ctx, calls } = await harness({
      index: { entries: [...INDEX.entries, extraLyric] },
      installedLyricSources: [
        { id: 'ext-lyric', name: 'Ext Lyric', enabled: true, sortOrder: 1, script: '// noop', version: '1.0.0' },
      ],
      installedThemes: [
        { id: 'theme-neon', name: 'Neon', version: '2.0.0', isDark: true, tokens: {} as ThemeDefinition['tokens'] },
      ],
    })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))

    // 1. Lyric source tab: shows In use badge, Disable button, and Uninstall button
    fireEvent.click(getByTestId('registry-tab-lyric-source'))
    await findByTestId('registry-entry-ext-lyric')
    expect(getByTestId('registry-lyric-status-ext-lyric').textContent).toBe('In use')
    const lyricActionBtn = getByTestId('registry-action-ext-lyric')
    expect(lyricActionBtn.textContent).toContain('Disable')
    expect(getByTestId('registry-uninstall-ext-lyric')).toBeTruthy()

    // Toggle lyric source disable
    fireEvent.click(lyricActionBtn)
    await waitFor(() => expect(calls).toContain('set-lyric-enabled:ext-lyric:false'))

    // 2. Theme tab: theme is installed but not active -> shows "Enable", plus Uninstall button
    fireEvent.click(getByTestId('registry-tab-theme'))
    await findByTestId('registry-entry-theme-neon')
    const themeActionBtn = getByTestId('registry-action-theme-neon')
    expect(themeActionBtn.textContent).toContain('Enable')
    expect(getByTestId('registry-uninstall-theme-neon')).toBeTruthy()

    // Click enable theme -> calls setTheme
    fireEvent.click(themeActionBtn)
    await waitFor(() => expect(calls).toContain('set-theme:theme-neon'))
  })

  it('shows status badge, disable toggle, and uninstall on the kind tab for music sources', async () => {
    const { ctx, calls } = await harness({})
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))

    // music-current is installed (doc 1.0.0 == entry 1.0.0): In use badge,
    // Disable button, and Uninstall button on the music-source tab.
    fireEvent.click(getByTestId('registry-tab-music-source'))
    await findByTestId('registry-entry-music-current')
    expect(getByTestId('registry-music-status-music-current').textContent).toBe('In use')
    expect(getByTestId('registry-action-music-current').textContent).toContain('Disable')
    expect(getByTestId('registry-uninstall-music-current')).toBeTruthy()

    // Toggle disable through the sources service.
    fireEvent.click(getByTestId('registry-action-music-current'))
    await waitFor(() => expect(calls).toContain('set-source-enabled:rec-https://b.example:false'))
    await waitFor(() =>
      expect(getByTestId('registry-action-music-current').textContent).toContain('Enable'),
    )

    // Uninstall two-step on the kind tab.
    fireEvent.click(getByTestId('registry-uninstall-music-current'))
    expect(getByTestId('registry-uninstall-confirm-music-current')).toBeTruthy()
    fireEvent.click(getByTestId('registry-uninstall-confirm-music-current'))
    await waitFor(() => expect(calls).toContain('remove-source:rec-https://b.example'))
  })

  it('shows the latest version beside the favorite button for updates, on kind and installed tabs', async () => {
    const { ctx } = await harness({})
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))

    // music-new: entry 1.1.0 vs installed doc 1.0.0 → update.
    fireEvent.click(getByTestId('registry-tab-music-source'))
    await findByTestId('registry-entry-music-new')
    expect(getByTestId('registry-latest-version-music-new').textContent).toBe('v1.1.0')
    expect(getByTestId('registry-action-music-new').textContent).toContain('Update')

    // The installed tab shows the same latest chip.
    fireEvent.click(getByTestId('registry-tab-installed'))
    await findByTestId('registry-entry-music-new')
    expect(getByTestId('registry-latest-version-music-new').textContent).toBe('v1.1.0')
  })

  it('shows plugin title versions, registered services, and the npm latest badge for plugin updates', async () => {
    const pluginEntry: RegistryEntry = {
      id: 'plugin-provides',
      kind: 'plugin',
      name: 'Provides Plugin',
      repo: 'https://github.com/example/plugin-provides',
      category: 'ui-enhancement',
      npm: '@bbebee/plugin-provides',
      services: ['audio'],
      provides: ['visualizer'],
    }
    const { ctx } = await harness({
      index: { entries: [...INDEX.entries, pluginEntry] },
      installedPlugins: [
        {
          id: 'plugin-ok',
          name: 'plugin-ok',
          displayName: 'OK Plugin',
          version: '1.0.0',
          systemId: 'layer-5',
          enabled: true,
          state: 'ACTIVE',
          waitingFor: [],
          dependencies: [],
          dependents: [],
        },
      ],
      pluginLatest: { '@bbebee/plugin-ok': '1.2.0', '@bbebee/plugin-provides': '0.3.0' },
    })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    fireEvent.click(getByTestId('registry-tab-plugin'))
    await findByTestId('registry-entry-plugin-ok')

    // Installed plugin: title shows the installed version, the update badge
    // shows npm latest, and the action button offers the update.
    expect(getByTestId('registry-entry-plugin-ok').textContent).toContain('v1.0.0')
    await waitFor(() =>
      expect(getByTestId('registry-latest-version-plugin-ok').textContent).toBe('v1.2.0'),
    )
    expect(getByTestId('registry-action-plugin-ok').textContent).toContain('Update')

    // Uninstalled plugin: title shows npm latest, and both the registered
    // service (provides) and the required service render as chips.
    await findByTestId('registry-entry-plugin-provides')
    const providesCard = getByTestId('registry-entry-plugin-provides')
    expect(providesCard.textContent).toContain('v0.3.0')
    expect(providesCard.textContent).toContain('visualizer')
    expect(providesCard.textContent).toContain('audio')
  })

  it('filters plugins by category and copes with unknown slugs', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')
    // Only the plugin tab carries the category filter.
    expect(queryByTestId('registry-category-filter')).toBeNull()

    fireEvent.click(getByTestId('registry-tab-plugin'))
    const filter = await waitFor(() => getByTestId('registry-category-filter'))
    const select = filter.querySelector('select') as HTMLSelectElement
    // Known slugs map to their label; unknown ones render verbatim.
    expect(select.textContent).toContain('UI enhancement')
    expect(select.textContent).toContain('mystery-slug')

    fireEvent.change(select, { target: { value: 'ui-enhancement' } })
    await waitFor(() => expect(queryByTestId('registry-entry-plugin-gated')).toBeNull())
    expect(getByTestId('registry-entry-plugin-ok')).toBeTruthy()
    expect(queryByTestId('registry-entry-plugin-remote')).toBeNull()

    fireEvent.change(select, { target: { value: 'mystery-slug' } })
    await waitFor(() => expect(getByTestId('registry-entry-plugin-unknown')).toBeTruthy())
    expect(queryByTestId('registry-entry-plugin-ok')).toBeNull()
  })

  it('renders without stats and without crashing when the metadata service is absent', async () => {
    const { ctx } = await harness({ metadataService: false })
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.change(getByTestId('registry-sort').querySelector('select') as HTMLSelectElement, {
      target: { value: 'contributors' },
    })
    // No service, no requests, no crash — the cards just stay unadorned.
    await findByTestId('registry-entry-music-new')
    expect(queryByTestId('registry-stats-music-new')).toBeNull()
  })
})

/* ── RegistryScreen: favorites ───────────────────────────────────────────── */

describe('RegistryScreen favorites', () => {
  it('toggles the favorite heart, persists it to localStorage, and survives a remount', async () => {
    const { ctx } = await harness()
    const first = render(h(RegistryScreen, { ctx }))
    const heart = await first.findByTestId('registry-favorite-music-new')
    expect(heart.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(heart)
    expect(heart.getAttribute('aria-pressed')).toBe('true')
    expect(JSON.parse(window.localStorage.getItem('bbebee_registry_favorites') ?? '[]')).toEqual([
      'music-new',
    ])

    // A fresh mount (a new page load) reads the persisted set back.
    first.unmount()
    const second = render(h(RegistryScreen, { ctx }))
    expect(
      (await second.findByTestId('registry-favorite-music-new')).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('lists only the favorited entries across kinds on the favorites tab, with a count badge', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    // Nothing favorited yet: the dedicated empty state, no badge.
    fireEvent.click(getByTestId('registry-tab-favorites'))
    expect(await findByTestId('registry-favorites-empty')).toBeTruthy()
    expect(getByTestId('registry-tab-favorites').textContent).not.toContain('0')
    // The curated tabs keep the search box and sort controls, but drop the third-party toggle.
    expect(getByTestId('registry-search')).toBeTruthy()
    expect(getByTestId('registry-sort')).toBeTruthy()
    expect(queryByTestId('registry-official-toggle')).toBeNull()

    // Favorite one entry per kind, from their own kind tabs.
    fireEvent.click(getByTestId('registry-tab-music-source'))
    await findByTestId('registry-entry-music-new')
    fireEvent.click(getByTestId('registry-favorite-music-new'))

    fireEvent.click(getByTestId('registry-tab-theme'))
    await findByTestId('registry-entry-theme-neon')
    fireEvent.click(getByTestId('registry-favorite-theme-neon'))

    // Both show up on the favorites tab; the rest of the catalog does not.
    fireEvent.click(getByTestId('registry-tab-favorites'))
    await findByTestId('registry-entry-music-new')
    expect(getByTestId('registry-entry-theme-neon')).toBeTruthy()
    expect(queryByTestId('registry-entry-music-current')).toBeNull()
    expect(getByTestId('registry-tab-favorites').textContent).toContain('2')

    // The search box still filters the curated list.
    fireEvent.change(getByTestId('registry-search'), { target: { value: 'alpha' } })
    await waitFor(() => expect(queryByTestId('registry-entry-theme-neon')).toBeNull())
    expect(getByTestId('registry-entry-music-new')).toBeTruthy()
  })

  it('drops a card from the favorites tab when it is un-favorited, back to the empty state', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-favorite-music-new'))
    fireEvent.click(getByTestId('registry-tab-favorites'))
    await findByTestId('registry-entry-music-new')

    // The same heart un-favorites; the card leaves and the badge disappears.
    fireEvent.click(getByTestId('registry-favorite-music-new'))
    await waitFor(() => expect(queryByTestId('registry-entry-music-new')).toBeNull())
    expect(await findByTestId('registry-favorites-empty')).toBeTruthy()
    expect(getByTestId('registry-tab-favorites').textContent).not.toContain('1')
  })
})

/* ── RegistryScreen: installed tab ───────────────────────────────────────── */

const LOCK_RECORD: RegistryLockRecord = {
  id: 'music-new',
  kind: 'music-source',
  repo: 'BBeBeeX/alpha-source',
  commit: '1234567890abcdef',
  sha256: 'ab'.repeat(32),
  installedAt: Date.UTC(2026, 0, 17),
}

describe('RegistryScreen installed tab', () => {
  it('lists installed and update entries with versions and lock metadata, and reuses the update confirm flow', async () => {
    const { ctx, calls } = await harness({ lockRecords: { 'music-new': LOCK_RECORD } })
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-tab-installed'))
    // Installed or updateable only: the two music sources and the builtin
    // lyric source; nothing else in this harness is installed.
    await findByTestId('registry-entry-music-new')
    expect(getByTestId('registry-entry-music-current')).toBeTruthy()
    expect(getByTestId('registry-entry-builtin-lrclib')).toBeTruthy()
    expect(queryByTestId('registry-entry-theme-neon')).toBeNull()
    expect(getByTestId('registry-tab-installed').textContent).toContain('3')

    // Lock metadata: the short commit shows on the entry that has a record…
    await waitFor(() =>
      expect(getByTestId('registry-installed-meta-music-new').textContent).toContain('1234567'),
    )
    expect(getByTestId('registry-installed-meta-music-new').textContent).toContain('1.0.0')
    // …and an entry without a record still shows its version.
    expect(getByTestId('registry-installed-meta-music-current').textContent).toContain('1.0.0')

    // The update action is the same two-step contract as on the kind tabs.
    fireEvent.click(getByTestId('registry-action-music-new'))
    await waitFor(() => expect(calls).toContain('details:music-new'))
    expect(queryByTestId('registry-confirm-dialog')).toBeTruthy()
  })

  it('degrades quietly when the optional getLockFile method is absent', async () => {
    const { ctx } = await harness({ lockRecords: false })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-tab-installed'))
    await findByTestId('registry-entry-music-new')
    // Version from the action state, no commit chip, no crash.
    expect(getByTestId('registry-installed-meta-music-new').textContent).toContain('1.0.0')
  })

  it('uninstalls a music source through the two-step confirm and calls the sources service', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-tab-installed'))
    await findByTestId('registry-entry-music-current')

    // Arm, then cancel — the confirm step must be dismissible.
    fireEvent.click(getByTestId('registry-uninstall-music-current'))
    expect(getByTestId('registry-uninstall-confirm-music-current')).toBeTruthy()
    fireEvent.click(getByTestId('registry-uninstall-cancel-music-current'))
    expect(queryByTestId('registry-uninstall-confirm-music-current')).toBeNull()

    // Arm again and confirm: the sources service removes the matched record.
    fireEvent.click(getByTestId('registry-uninstall-music-current'))
    fireEvent.click(getByTestId('registry-uninstall-confirm-music-current'))
    await waitFor(() => expect(calls).toContain('remove-source:rec-https://b.example'))
    // The stub really lost the record, so the card leaves the installed list.
    await waitFor(() => expect(queryByTestId('registry-entry-music-current')).toBeNull())
  })

  it('uninstalls lyric sources and themes through their own services', async () => {
    const extraLyric: RegistryEntry = {
      id: 'ext-lyric',
      kind: 'lyric-source',
      name: 'Ext Lyric',
      version: '1.0.0',
      downloadUrl: 'https://cdn.example/ext.json',
    }
    const { ctx, calls } = await harness({
      index: { entries: [...INDEX.entries, extraLyric] },
      installedLyricSources: [
        { id: 'ext-lyric', name: 'Ext Lyric', enabled: true, sortOrder: 1, script: '// noop', version: '1.0.0' },
      ],
      installedThemes: [
        { id: 'theme-neon', name: 'Neon', version: '1.0.0', isDark: true, tokens: {} as ThemeDefinition['tokens'] },
      ],
    })
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-tab-installed'))
    await findByTestId('registry-entry-theme-neon')

    // Builtins get no uninstall affordance at all: no button, no note.
    expect(queryByTestId('registry-uninstall-builtin-lrclib')).toBeNull()
    expect(queryByTestId('registry-uninstall-note-builtin-lrclib')).toBeNull()

    fireEvent.click(getByTestId('registry-uninstall-theme-neon'))
    fireEvent.click(getByTestId('registry-uninstall-confirm-theme-neon'))
    await waitFor(() => expect(calls).toContain('remove-theme:theme-neon'))
    await waitFor(() => expect(queryByTestId('registry-entry-theme-neon')).toBeNull())

    fireEvent.click(getByTestId('registry-uninstall-ext-lyric'))
    fireEvent.click(getByTestId('registry-uninstall-confirm-ext-lyric'))
    await waitFor(() => expect(calls).toContain('remove-lyric-source:ext-lyric'))
    await waitFor(() => expect(queryByTestId('registry-entry-ext-lyric')).toBeNull())
  })

  it('shows status badge, toggle button, and uninstalls for installed plugin entries', async () => {
    const { ctx, calls } = await harness({
      installedPlugins: [
        {
          id: 'plugin-ok',
          name: 'plugin-ok',
          displayName: 'OK Plugin',
          version: '1.0.0',
          systemId: 'layer-5',
          enabled: true,
          state: 'ACTIVE',
          waitingFor: [],
          dependencies: [],
          dependents: [],
        },
      ],
    })
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-tab-installed'))
    await findByTestId('registry-entry-plugin-ok')

    // Status badge shows "In use"
    const statusBadge = getByTestId('registry-plugin-status-plugin-ok')
    expect(statusBadge.textContent).toBe('In use')

    // Bookmark button is present at bottom left
    const bookmarkBtn = getByTestId('registry-favorite-plugin-ok')
    expect(bookmarkBtn).toBeDefined()

    // Action button shows disable
    const toggleBtn = getByTestId('registry-action-plugin-ok')
    expect(toggleBtn.textContent).toContain('Disable')

    // Toggle disable
    fireEvent.click(toggleBtn)
    await waitFor(() => expect(calls).toContain('set-plugin-enabled:plugin-ok:false'))

    // Uninstall button is present
    fireEvent.click(getByTestId('registry-uninstall-plugin-ok'))
    fireEvent.click(getByTestId('registry-uninstall-confirm-plugin-ok'))
    await waitFor(() => expect(calls).toContain('uninstall-plugin:plugin-ok'))
    await waitFor(() => expect(queryByTestId('registry-entry-plugin-ok')).toBeNull())
  })
})

/* ── RegistryScreen: task center ─────────────────────────────────────────── */

/** The rendered task rows' testids, in the order the drawer lists them. */
function taskIds(screen: HTMLElement): Array<string | null> {
  return Array.from(screen.querySelectorAll('[data-testid^="registry-task-item-"]')).map((el) =>
    el.getAttribute('data-testid'),
  )
}

describe('RegistryScreen task center', () => {
  it('badges the number of running tasks and clears the badge when none run', async () => {
    const { ctx, registry } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    // Nothing tracked: the button is there, no number is shouted.
    expect(getByTestId('registry-tasks-button')).toBeTruthy()
    expect(queryByTestId('registry-tasks-badge')).toBeNull()

    // One running task among finished ones → badge counts the running only.
    registry.emitTasks([FAILED_TASK, RUNNING_TASK, SUCCESS_TASK])
    await waitFor(() => expect(getByTestId('registry-tasks-badge').textContent).toBe('1'))

    // The next snapshot without a running task removes the badge entirely.
    registry.emitTasks([FAILED_TASK, SUCCESS_TASK])
    await waitFor(() => expect(queryByTestId('registry-tasks-badge')).toBeNull())
  })

  it('opens the drawer listing each task with status, error and start time', async () => {
    const { ctx } = await harness({ tasks: [RUNNING_TASK, PENDING_TASK, SUCCESS_TASK, FAILED_TASK] })
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-tasks-button'))
    const drawer = await findByTestId('registry-task-drawer')
    // The Tasks title lives on the kit Sheet's card, outside the content testid.
    expect(drawer.closest('[role="dialog"]')?.textContent).toContain('Tasks')

    // Newest → oldest, exactly the service snapshot's order.
    expect(taskIds(getByTestId('registry-screen'))).toEqual([
      'registry-task-item-task-running',
      'registry-task-item-task-pending',
      'registry-task-item-task-success',
      'registry-task-item-task-failed',
    ])

    // Kind chip + entry name + status label per record.
    const running = getByTestId('registry-task-item-task-running')
    expect(running.textContent).toContain('Music source')
    expect(running.textContent).toContain('Alpha Source')
    expect(getByTestId('registry-task-status-task-running').textContent).toBe('Downloading')
    expect(getByTestId('registry-task-status-task-pending').textContent).toBe('Awaiting confirmation')
    expect(getByTestId('registry-task-status-task-pending').textContent).toBeTruthy()
    expect(getByTestId('registry-task-status-task-success').textContent).toBe('Success')
    expect(getByTestId('registry-task-status-task-failed').textContent).toBe('Failed')

    // A failure keeps its complete error text; the start time is formatted.
    const failed = getByTestId('registry-task-item-task-failed')
    expect(failed.textContent).toContain(FAILED_TASK.error ?? '')
    expect(failed.textContent).toContain(formatDateTime(FAILED_TASK.startedAt))

    // Escape closes the drawer (the kit Sheet's own contract).
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(queryByTestId('registry-task-drawer')).toBeNull())
  })

  it('clears only the finished tasks through the service, keeping pending ones', async () => {
    const { ctx, calls } = await harness({ tasks: [FAILED_TASK, SUCCESS_TASK, PENDING_TASK] })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-tasks-button'))
    await findByTestId('registry-task-drawer')

    const clear = getByTestId('registry-tasks-clear') as HTMLButtonElement
    expect(clear.disabled).toBe(false)
    fireEvent.click(clear)
    await waitFor(() => expect(calls).toContain('clear-finished-tasks'))

    // The stub really removed the finished records and emitted the snapshot;
    // only the pending row survives.
    await waitFor(() => expect(taskIds(getByTestId('registry-screen'))).toEqual(['registry-task-item-task-pending']))
  })

  it('degrades quietly when the optional task methods are absent', async () => {
    const { ctx, calls } = await harness({ taskMethods: false })
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    // No badge, and the drawer still opens — empty and crash-free.
    fireEvent.click(getByTestId('registry-tasks-button'))
    expect(await findByTestId('registry-task-drawer')).toBeTruthy()
    expect(await findByTestId('registry-tasks-empty')).toBeTruthy()
    expect((getByTestId('registry-tasks-clear') as HTMLButtonElement).disabled).toBe(true)
    expect(calls).not.toContain('clear-finished-tasks')
  })
})

/* ── RegistryEntryCard regressions ───────────────────────────────────────── */

describe('RegistryScreen local import + restart', () => {
  it('renders the local import button and the restart dropdown items', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    expect(getByTestId('registry-local-import')).toBeTruthy()
    expect(queryByTestId('registry-restart-menu')).toBeNull()
    fireEvent.click(getByTestId('registry-restart-button'))
    expect(getByTestId('registry-restart-menu')).toBeTruthy()
    expect(getByTestId('registry-restart-reload')).toBeTruthy()
    expect(getByTestId('registry-restart-app')).toBeTruthy()
  })

  it('restarts the app through the preload bridge', async () => {
    const { ctx } = await harness()
    const restart = vi.fn(async () => {})
    ;(window as unknown as { BBeBee?: unknown }).BBeBee = { app: { restart } }
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-restart-button'))
    fireEvent.click(getByTestId('registry-restart-app'))
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('says so when the bridge has no restart surface', async () => {
    const { ctx } = await harness()
    ;(window as unknown as { BBeBee?: unknown }).BBeBee = {}
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-restart-button'))
    fireEvent.click(getByTestId('registry-restart-app'))
    const banner = await findByTestId('registry-action-banner-error')
    expect(banner.textContent).toContain('Restarting the app is not available')
  })

  it('previews a picked package and installs it on confirm', async () => {
    const { ctx, calls } = await harness()
    const { getByTestId, findByTestId, queryByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    const input = getByTestId('registry-local-import-input') as HTMLInputElement
    const file = new File([new Uint8Array([31, 139, 8, 0, 1, 2, 3])], 'local-x.tgz', {
      type: 'application/gzip',
    })
    fireEvent.change(input, { target: { files: [file] } })

    const dialog = await findByTestId('local-import-confirm-dialog')
    expect(calls.some((c) => c.startsWith('preview-local:'))).toBe(true)
    expect(dialog.textContent).toContain('@t/local')
    expect(dialog.textContent).toContain('fs:read/**')
    // The manager's unreviewed-origin warning leads the dialog; its
    // duplicate inside the preview's warning list is not repeated.
    expect(getByTestId('local-import-capabilities')).toBeTruthy()

    fireEvent.click(getByTestId('local-import-confirm-accept'))
    await waitFor(() => expect(queryByTestId('local-import-confirm-dialog')).toBeNull())
    expect(calls).toContain('install-local:confirmed')
    expect(await findByTestId('registry-action-banner-notice')).toBeTruthy()
  })
})

describe('RegistryEntryCard regressions', () => {
  const entry: RegistryEntry = { id: 'card-x', kind: 'theme', name: 'X', version: '1.0.0' }

  it('renders without favorite, installed-meta or uninstall affordances when the props are absent', () => {
    const { getByTestId, queryByTestId } = render(
      h(RegistryEntryCard, { entry, actionState: { state: 'install' }, onAction: () => {} }),
    )
    expect(getByTestId('registry-entry-card-x')).toBeTruthy()
    expect(queryByTestId('registry-favorite-card-x')).toBeNull()
    expect(queryByTestId('registry-installed-meta-card-x')).toBeNull()
    expect(queryByTestId('registry-uninstall-card-x')).toBeNull()
    expect(queryByTestId('registry-uninstall-note-card-x')).toBeNull()
  })
})

/* ── parseRepoOwner / isOfficialEntry ────────────────────────────────────── */

describe('parseRepoOwner / isOfficialEntry', () => {
  const base = { kind: 'plugin', name: 'X' } as unknown as RegistryEntry

  it('parses full URLs and shorthands, and judges officialness', () => {
    expect(parseRepoOwner('https://github.com/BBeBeeX/repo.git')).toEqual({
      owner: 'BBeBeeX',
      repo: 'repo',
    })
    expect(parseRepoOwner('BBeBeeX/repo')).toEqual({ owner: 'BBeBeeX', repo: 'repo' })
    expect(parseRepoOwner('https://cdn.example/a.json')).toBeUndefined()
    expect(parseRepoOwner(undefined)).toBeUndefined()

    expect(isOfficialEntry({ ...base, id: 'builtin-lrclib' })).toBe(false)
    expect(isOfficialEntry({ ...base, id: 'builtin-lrclib', repo: 'BBeBeeX/lrclib' })).toBe(true)
    expect(isOfficialEntry({ ...base, id: 'ext', repo: 'bbebeex/anything' })).toBe(true)
    expect(isOfficialEntry({ ...base, id: 'ext', repo: 'BBeBeeX/anything' })).toBe(true)
    expect(isOfficialEntry({ ...base, id: 'ext', repo: 'someone/else' })).toBe(false)
    expect(isOfficialEntry({ ...base, id: 'ext' })).toBe(false)
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

    expect(getByTestId('registry-last-checked').textContent).toBe('Never')
    fireEvent.click(getByTestId('registry-check-updates'))

    await waitFor(() => expect(calls).toContain('checkUpdates'))
    const item = await findByTestId('registry-update-item-theme-neon')
    expect(item.textContent).toContain('1.0.0')
    expect(item.textContent).toContain('2.0.0')

    fireEvent.click(item)
    expect(navigateCalls).toEqual([REGISTRY_VIEWS.screen])
    expect(getByText(/Updates available/)).toBeTruthy()
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

  it('skips strict entry.sourceUrl comparison when params declares customizable sourceurl', () => {
    const subsonicEntry: RegistryEntry = {
      id: 'bbebeex-subsonic',
      kind: 'music-source',
      name: 'Subsonic',
      version: '1.0.0',
      author: 'BBeBee',
      description: 'Subsonic server',
      repo: 'https://github.com/BBeBeeX/B_Be_Bee-subsonic',
      params: ['sourceurl', 'username', 'password'],
    }
    const customRecord: SourceRecord = {
      ...makeSourceRecord('https://my-nas.internal:4533', '1.0.0'),
      name: 'Subsonic',
      originUri: 'https://raw.githubusercontent.com/BBeBeeX/B_Be_Bee-subsonic/main/index.json',
    }
    const snapshot: InstalledContentSnapshot = {
      ...INSTALLED,
      musicSources: [customRecord],
    }
    expect(deriveRegistryActionState(subsonicEntry, snapshot)).toEqual({
      state: 'installed',
      installedVersion: '1.0.0',
    })

    expect(deriveRegistryActionState({ ...subsonicEntry, version: '1.1.0' }, snapshot)).toEqual({
      state: 'update',
      installedVersion: '1.0.0',
    })
  })
})

/* ── formatDateMs ────────────────────────────────────────────────────────── */

describe('formatDateMs', () => {
  it('formats a wall-clock timestamp as a locale date and degrades to —', () => {
    expect(formatDateMs(undefined)).toBe('—')
    expect(formatDateMs(Number.NaN)).toBe('—')
    expect(formatDateMs(Date.UTC(2026, 0, 17))).not.toBe('—')
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

describe('RegistryFilterBar i18n pilot', () => {
  it('switches filter bar labels live when settings.language changes between en and zh', async () => {
    const { ctx } = await harness()
    const { getByTestId, findByTestId } = render(h(RegistryScreen, { ctx }))
    await findByTestId('registry-entry-music-new')

    expect(getByTestId('registry-official-toggle').textContent).toContain('Show third-party content')
    expect((getByTestId('registry-search') as HTMLInputElement).placeholder).toBe(
      'Search names, authors or descriptions…',
    )
    expect(getByTestId('registry-sort-direction').textContent).toContain('Ascending')

    await act(async () => {
      await ctx.settings.update({ language: 'zh' })
    })
    expect(getByTestId('registry-official-toggle').textContent).toContain('显示第三方内容')
    expect((getByTestId('registry-search') as HTMLInputElement).placeholder).toBe(
      '搜索名称、作者或描述…',
    )
    expect(getByTestId('registry-sort-direction').textContent).toContain('升序')

    await act(async () => {
      await ctx.settings.update({ language: 'en' })
    })
    expect(getByTestId('registry-official-toggle').textContent).toContain('Show third-party content')
    expect((getByTestId('registry-search') as HTMLInputElement).placeholder).toBe(
      'Search names, authors or descriptions…',
    )
    expect(getByTestId('registry-sort-direction').textContent).toContain('Ascending')
  })
})

