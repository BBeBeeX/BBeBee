// @vitest-environment jsdom
/**
 * Mobile registry UI tests — the Discover screen, the settings card and the
 * plugin entry, rendered against stub services the way the mobile shell would
 * bind them. The harness follows `plugin-queue-ui-mobile`'s: injected host
 * primitives, a cordis `Context`, and an English i18n stub serving the real
 * `registry` catalogue.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { Context, Service } from 'cordis'
import type {
  AppSettings,
  I18nService,
  InstallPlan,
  LyricSourceDefinition,
  PluginInfo,
  RegistryEntry,
  RegistryEntryDetails,
  RegistryIndex,
  RegistryTask,
  RegistryUpdate,
  SecurityAuditReport,
  SettingsService,
  SourceRecord,
  ThemeDefinition,
} from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS } from '@BBeBee/protocol'
import { REGISTRY_VIEWS } from '@bbebee/plugin-registry/views'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import registryCatalogue from '../../../feature/plugin-i18n/src/locales/registry.json'
import appCatalogue from '../../../feature/plugin-i18n/src/locales/en.json'
import plugin, { RegistryScreen, RegistrySettingsCard } from './index.js'

afterEach(cleanup)

/* ── the injected native primitives, as host components ──────────────────── */

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
        onClick: typeof onPress === 'function' ? (e: { stopPropagation: () => void }) => {
          e.stopPropagation()
          ;(onPress as () => void)()
        } : undefined,
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
  // A real input element, so the controlled TextField can be typed into the
  // way `fireEvent.change` does it.
  TextInput: function TextInput(props: Record<string, unknown>) {
    const { testID, accessibilityLabel, value, onChangeText, placeholder, editable } = props
    return h('input', {
      'data-host': 'TextInput',
      'data-testid': typeof testID === 'string' ? testID : undefined,
      'aria-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
      value: typeof value === 'string' ? value : '',
      placeholder: typeof placeholder === 'string' ? placeholder : undefined,
      disabled: editable === false,
      onChange: typeof onChangeText === 'function'
        ? (e: { target: { value: string } }) => (onChangeText as (v: string) => void)(e.target.value)
        : undefined,
    })
  },
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
    { id: 'theme-neon', kind: 'theme', name: 'Neon', version: '2.0.0' },
    {
      id: 'plugin-ok',
      kind: 'plugin',
      name: 'OK Plugin',
      repoUrl: 'https://github.com/example/plugin-ok',
      npm: '@bbebee/plugin-ok',
      services: ['audio'],
      platforms: ['desktop', 'mobile'],
      sha256: 'cd'.repeat(32),
    },
  ],
}

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
const FAILED_TASK: RegistryTask = {
  id: 'task-failed',
  entryId: 'music-current',
  entryName: 'Beta Source',
  kind: 'music-source',
  operation: 'install',
  stage: 'install',
  status: 'failed',
  error: 'registry: the document for "music-current" was not imported — Doc: missing ruleStream',
  startedAt: TASK_STARTED_AT - 60_000,
  finishedAt: TASK_STARTED_AT - 59_000,
}

/* ── harness ─────────────────────────────────────────────────────────────── */

interface RegistryStubOptions {
  index?: RegistryIndex
  offline?: boolean
  allowedHosts?: readonly string[]
  locallyModified?: boolean
  securityAudit?: SecurityAuditReport
  plan?: InstallPlan
  installedThemes?: ThemeDefinition[]
  installedPlugins?: PluginInfo[]
  installedLyricSources?: LyricSourceDefinition[]
  pluginLatest?: Record<string, string>
  tasks?: readonly RegistryTask[]
  /** When set, `install` rejects with this error (the mobile plugin refusal). */
  installError?: string
  /** When set, `fetchEntryDetails` rejects with this error (no dialog opens). */
  detailsError?: string
  /** `'owner/repo'` → the stats the metadata stub answers. */
  repoStats?: Record<string, { stars?: number; contributors?: number; downloads?: number }>
}

async function makeHarness(options: RegistryStubOptions = {}) {
  const calls: string[] = []
  const index = options.index ?? INDEX
  const taskList: RegistryTask[] = [...(options.tasks ?? [])]
  const installed = {
    musicSources: [makeSourceRecord('https://a.example', '1.0.0'), makeSourceRecord('https://b.example', '1.0.0')],
    lyricSources: [
      { id: 'builtin-lrclib', name: 'LRCLIB', enabled: true, sortOrder: 0, script: '// noop', version: '1.0.0' },
      ...(options.installedLyricSources ?? []),
    ] as LyricSourceDefinition[],
    themes: [...(options.installedThemes ?? [])],
    plugins: [...(options.installedPlugins ?? [])],
  }
  let registryCtx: Context | undefined

  class RegistryStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'contentRegistry')
      registryCtx = ctx
    }
    getIndex = async () => {
      calls.push('getIndex')
      return index
    }
    checkUpdates = async (): Promise<readonly RegistryUpdate[]> => {
      calls.push('checkUpdates')
      return [
        { kind: 'theme', id: 'theme-neon', name: 'Neon', installedVersion: '1.0.0', availableVersion: '2.0.0' },
      ]
    }
    updates = (): readonly RegistryUpdate[] => []
    lastCheckedAt = (): number | undefined => undefined
    fetchEntryDetails = async (entry: RegistryEntry): Promise<RegistryEntryDetails> => {
      calls.push(`details:${entry.id}`)
      if (options.detailsError) throw new Error(options.detailsError)
      return {
        entry,
        ...(entry.kind === 'music-source' || entry.kind === 'lyric-source'
          ? { allowedHosts: options.allowedHosts ?? ['cdn.example', 'music.example'] }
          : {}),
        ...(options.locallyModified ? { isLocallyModified: true } : {}),
        ...(options.securityAudit ? { securityAudit: options.securityAudit } : {}),
        ...(options.plan ? { plan: options.plan } : {}),
      }
    }
    install = async (
      entry: RegistryEntry,
      opts?: { confirmed?: boolean; overwrite?: boolean; plan?: InstallPlan },
    ) => {
      calls.push(
        `install:${entry.id}:${String(opts?.confirmed ?? false)}${opts?.overwrite ? ':overwrite' : ''}${opts?.plan ? `:plan:${opts.plan.target.version}` : ''}`,
      )
      if (options.installError) throw new Error(options.installError)
    }
    lastIndexFetchFailed = () => options.offline ?? false
    removeLockRecord = async (id: string) => {
      calls.push(`remove-lock:${id}`)
    }
    getTasks = (): readonly RegistryTask[] => [...taskList]
    clearFinishedTasks = () => {
      calls.push('clear-finished-tasks')
      for (let i = taskList.length - 1; i >= 0; i--) {
        const status = taskList[i]?.status
        if (status === 'success' || status === 'failed') taskList.splice(i, 1)
      }
      registryCtx?.emit('registry/tasks-changed', [...taskList])
    }
  }

  class RegistryMetadataStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'registryMetadata')
    }
    getRepoStats = async (owner: string, repo: string) => {
      calls.push(`stats:${owner}/${repo}`)
      return { owner, repo, fetchedAt: 1, ...(options.repoStats?.[`${owner}/${repo}`] ?? {}) }
    }
    peekRepoStats = () => undefined
  }

  class SourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sources')
    }
    get sources() {
      return installed.musicSources
    }
    remove = async (id: string) => {
      calls.push(`remove-source:${id}`)
      installed.musicSources = installed.musicSources.filter((r) => r.id !== id)
    }
    setEnabled = async (id: string, enabled: boolean) => {
      calls.push(`set-source-enabled:${id}:${enabled}`)
      installed.musicSources = installed.musicSources.map((r) => (r.id === id ? { ...r, enabled } : r))
    }
  }

  class LyricSourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'lyricSources')
    }
    getSources = () => installed.lyricSources
    removeSource = async (id: string): Promise<boolean> => {
      calls.push(`remove-lyric-source:${id}`)
      const before = installed.lyricSources.length
      installed.lyricSources = installed.lyricSources.filter((s) => s.id !== id)
      return installed.lyricSources.length < before
    }
    setEnabled = async (id: string, enabled: boolean) => {
      calls.push(`set-lyric-enabled:${id}:${enabled}`)
      const s = installed.lyricSources.find((item) => item.id === id)
      if (s) s.enabled = enabled
    }
  }

  class ThemeStub extends Service {
    private currentTheme = { id: 'default-dark', name: 'Default Dark', isDark: true, tokens: {} } as unknown as ThemeDefinition
    constructor(ctx: Context) {
      super(ctx, 'theme')
    }
    getThemes = () => installed.themes
    getCurrentTheme = () => this.currentTheme
    setTheme = async (id: string) => {
      calls.push(`set-theme:${id}`)
      const theme = installed.themes.find((item) => item.id === id)
      if (theme) this.currentTheme = theme
    }
    removeTheme = (id: string): boolean => {
      calls.push(`remove-theme:${id}`)
      const before = installed.themes.length
      installed.themes = installed.themes.filter((t) => t.id !== id)
      return installed.themes.length < before
    }
  }

  class PluginManagerStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'plugin-manager')
    }
    list = () => installed.plugins
    getNpmLatest = async (npm: string, force?: boolean): Promise<string | undefined> => {
      calls.push(`npm-latest:${npm}${force ? ':force' : ''}`)
      return options.pluginLatest?.[npm]
    }
    setEnabled = async (id: string, enabled: boolean) => {
      calls.push(`set-plugin-enabled:${id}:${enabled}`)
    }
    uninstall = async (id: string) => {
      calls.push(`uninstall-plugin:${id}`)
      installed.plugins = installed.plugins.filter((p) => p.id !== id)
    }
  }

  let currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS, language: 'en', registryAutoCheck: true }
  class SettingsStub extends Service implements Partial<SettingsService> {
    private appCtx: Context
    constructor(ctx: Context) {
      super(ctx, 'settings')
      this.appCtx = ctx
    }
    getSync = (): AppSettings => currentSettings
    update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
      calls.push(`settings-update:${JSON.stringify(patch)}`)
      currentSettings = { ...currentSettings, ...patch }
      this.appCtx.emit('settings/changed', currentSettings)
      return currentSettings
    }
    onSettingsChange = (cb: (s: AppSettings) => void) => this.appCtx.on('settings/changed', cb)
  }

  /** English-only i18n stub over the real `registry` and `app` catalogues. */
  class EnglishI18nStub extends Service implements I18nService {
    static override readonly name = 'i18n'
    locale = 'en'
    constructor(ctx: Context) {
      super(ctx, 'i18n')
    }
    t = (key: string, params?: Record<string, string | number>): string => {
      const sep = key.indexOf(':')
      if (sep < 0) return key
      const catalogue = key.slice(0, sep) === 'registry'
        ? (registryCatalogue as { en: Record<string, unknown> }).en
        : (appCatalogue as Record<string, unknown>)
      let cur: unknown = catalogue
      for (const part of key.slice(sep + 1).split('.')) {
        cur = (cur as Record<string, unknown> | undefined)?.[part]
      }
      if (typeof cur !== 'string') return key
      return params ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : cur
    }
    register = () => () => {}
    onLocaleChange = (_cb: (locale: string) => void): (() => void) => () => {}
  }

  const views = new Map<string, unknown>()
  const contributions: Array<Record<string, unknown>> = []
  const navigateCalls: string[] = []
  class UiStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'ui')
    }
    registerView = (id: string, component: unknown) => {
      views.set(id, component)
      return () => views.delete(id)
    }
    contribute = (contribution: Record<string, unknown>) => {
      contributions.push(contribution)
      return () => {
        const at = contributions.indexOf(contribution)
        if (at >= 0) contributions.splice(at, 1)
      }
    }
    navigate = (id: string) => {
      navigateCalls.push(id)
    }
    viewFor = (id: string) => views.get(id)
  }

  const root = new Context()
  await root.plugin(UiStub)
  await root.plugin(RegistryStub)
  await root.plugin(RegistryMetadataStub)
  await root.plugin(SourcesStub)
  await root.plugin(LyricSourcesStub)
  await root.plugin(ThemeStub)
  await root.plugin(PluginManagerStub)
  await root.plugin(SettingsStub)
  await root.plugin(EnglishI18nStub)
  await new Promise((resolve) => setTimeout(resolve, 0))

  return { root, calls, views, contributions, navigateCalls, installed }
}

type Harness = Awaited<ReturnType<typeof makeHarness>>

/**
 * Renders one of the screens on a scoped context, exactly the way the shell
 * resolves a contributed view, and hands back the render queries.
 */
async function renderOnHarness<Ctx>(parts: Harness, tag: (props: { ctx: Ctx }) => ReactNode) {
  let scoped: Context | undefined
  parts.root.inject(['ui', 'contentRegistry', 'settings', 'i18n'], (s) => void (scoped = s))
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (!scoped) throw new Error('failed to scope')
  return render(h(tag as (props: { ctx: Context }) => ReactNode, { ctx: scoped as Context }))
}

/** The Discover screen with its full stub environment. */
async function screenHarness(options: RegistryStubOptions = {}) {
  const parts = await makeHarness(options)
  const rendered = await renderOnHarness(parts, RegistryScreen)
  return { ...parts, ...rendered }
}

/** The settings card with its full stub environment. */
async function cardHarness(options: RegistryStubOptions = {}) {
  const parts = await makeHarness(options)
  const rendered = await renderOnHarness(parts, RegistrySettingsCard)
  return { ...parts, ...rendered }
}

/* ── the plugin entry ────────────────────────────────────────────────────── */

describe('plugin-registry-ui-mobile', () => {
  it('registers both views under the contributed descriptor ids and adds the mobile settings link-row', async () => {
    const views = new Map<string, unknown>()
    const contributions: Array<Record<string, unknown>> = []
    class UiStub extends Service {
      constructor(ctx: Context) {
        super(ctx, 'ui')
      }
      registerView = (id: string, component: unknown) => {
        views.set(id, component)
        return () => views.delete(id)
      }
      contribute = (contribution: Record<string, unknown>) => {
        contributions.push(contribution)
        return () => {}
      }
      navigate = () => {}
      viewFor = (id: string) => views.get(id)
    }
    class RegistryStub extends Service {
      constructor(ctx: Context) {
        super(ctx, 'contentRegistry')
      }
      getIndex = async () => ({ entries: [] })
      fetchEntryDetails = async (entry: RegistryEntry) => ({ entry })
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

    // The mobile entrance: a settings link-row that hands `registry.screen`
    // to `ui.navigate` — the history-UI pattern, in the sources section next
    // to the headless plugin's card (order 15 → 16).
    const linkRow = contributions.find((c) => c['id'] === REGISTRY_VIEWS.screen)
    expect(linkRow).toBeTruthy()
    expect(linkRow?.['kind']).toBe('settings')
    expect(linkRow?.['section']).toBe('sources')
    expect(linkRow?.['title']).toBe('registry:route.discover')
    expect(linkRow?.['order']).toBe(16)
  })
})

/* ── RegistryScreen ──────────────────────────────────────────────────────── */

describe('RegistryScreen on mobile', () => {
  it('renders the four kind tabs with counts and the entries of the active one', async () => {
    const { getByTestId, findByTestId, queryByTestId } = await screenHarness()
    await findByTestId('registry-entry-music-new')
    // Counts come from the whole catalog, independent of the active kind.
    expect(getByTestId('registry-tab-music-source').textContent).toContain('Music source')
    expect(getByTestId('registry-tab-music-source').textContent).toContain('2')
    expect(getByTestId('registry-tab-plugin').textContent).toContain('1')

    expect(getByTestId('registry-entry-music-current')).toBeTruthy()
    expect(queryByTestId('registry-entry-theme-neon')).toBeNull()

    fireEvent.click(getByTestId('registry-tab-theme'))
    await waitFor(() => expect(getByTestId('registry-entry-theme-neon')).toBeTruthy())
    expect(queryByTestId('registry-entry-music-new')).toBeNull()
  })

  it('filters entries by name, author and description, and empties cleanly', async () => {
    const { getByTestId, findByTestId, queryByTestId } = await screenHarness()
    await findByTestId('registry-entry-music-new')

    fireEvent.change(getByTestId('registry-search'), { target: { value: 'alpha' } })
    await waitFor(() => expect(queryByTestId('registry-entry-music-current')).toBeNull())
    expect(getByTestId('registry-entry-music-new')).toBeTruthy()

    fireEvent.change(getByTestId('registry-search'), { target: { value: 'ann' } })
    await waitFor(() => expect(getByTestId('registry-entry-music-new')).toBeTruthy())

    fireEvent.change(getByTestId('registry-search'), { target: { value: 'no such content' } })
    await waitFor(() => expect(getByTestId('registry-empty')).toBeTruthy())
  })

  it('shows install/update/installed action states from the installed-content services', async () => {
    const { getByTestId, findByTestId } = await screenHarness()
    // 1.1.0 in the registry vs 1.0.0 installed → update, with the badge.
    await findByTestId('registry-entry-music-new')
    expect(getByTestId('registry-action-music-new').textContent).toContain('Update')
    expect(getByTestId('registry-latest-version-music-new').textContent).toContain('v1.1.0')

    // 1.0.0 == 1.0.0 → installed: an in-use badge and the enable toggle.
    expect(getByTestId('registry-music-status-music-current').textContent).toContain('In use')
    expect(getByTestId('registry-action-music-current').textContent).toContain('Disable')
  })

  it('runs the two-step contract: details first, then install with confirmed: true', async () => {
    const { getByTestId, findByTestId, queryByTestId, calls } = await screenHarness()

    fireEvent.click(getByTestId('registry-tab-theme'))
    await findByTestId('registry-entry-theme-neon')
    fireEvent.click(getByTestId('registry-action-theme-neon'))

    await waitFor(() => expect(calls).toContain('details:theme-neon'))
    expect(queryByTestId('registry-confirm-dialog')).toBeTruthy()

    fireEvent.click(getByTestId('registry-confirm-accept'))
    await waitFor(() => expect(calls).toContain('install:theme-neon:true'))
    expect(queryByTestId('registry-confirm-dialog')).toBeNull()
  })

  it('shows the allowed hosts prominently for a music source install', async () => {
    const { getByTestId, findByTestId } = await screenHarness()
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-action-music-new'))
    await findByTestId('registry-confirm-dialog')

    const hosts = getByTestId('registry-hosts-list')
    expect(hosts.textContent).toContain('cdn.example')
    expect(hosts.textContent).toContain('music.example')
  })

  it('binds the confirmed install plan through the plugin confirm flow', async () => {
    const plan = {
      target: { id: 'plugin-ok', npm: '@bbebee/plugin-ok', version: '1.2.0', tarball: 'https://x/x.tgz', unreviewed: true },
      closure: [],
      missingServices: [],
      warnings: [],
    }
    const { getByTestId, findByTestId, calls, queryByTestId } = await screenHarness({ plan })

    fireEvent.click(getByTestId('registry-tab-plugin'))
    await findByTestId('registry-entry-plugin-ok')
    fireEvent.click(getByTestId('registry-action-plugin-ok'))

    await findByTestId('registry-confirm-dialog')
    expect(getByTestId('registry-plugin-plan-version').textContent).toContain('v1.2.0')
    expect(getByTestId('registry-plugin-unreviewed-warning')).toBeTruthy()
    expect(getByTestId('registry-plugin-npm').textContent).toContain('@bbebee/plugin-ok')

    fireEvent.click(getByTestId('registry-confirm-accept'))
    await waitFor(() => expect(calls).toContain('install:plugin-ok:true:plan:1.2.0'))
    expect(queryByTestId('registry-confirm-dialog')).toBeNull()
  })

  it('surfaces the service refusal when a plugin install is not supported', async () => {
    const refusal = 'npm 插件安装需要 composition root 接线 PluginLifecycleBridge.installPlugin（mobile 等平台不支持动态安装）'
    const { getByTestId, findByTestId } = await screenHarness({ installError: refusal })

    fireEvent.click(getByTestId('registry-tab-plugin'))
    await findByTestId('registry-entry-plugin-ok')
    fireEvent.click(getByTestId('registry-action-plugin-ok'))
    await findByTestId('registry-confirm-dialog')

    fireEvent.click(getByTestId('registry-confirm-accept'))
    // The refusal is shown verbatim in the sheet — never hidden, never
    // special-cased into a friendlier lie.
    await waitFor(() => expect(getByTestId('registry-confirm-error').textContent).toContain(refusal))
    expect(getByTestId('registry-confirm-dialog')).toBeTruthy()
  })

  it('requires an explicit overwrite confirmation when a music source was locally modified', async () => {
    const { getByTestId, findByTestId, calls } = await screenHarness({ locallyModified: true })
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-action-music-new'))
    await findByTestId('registry-confirm-dialog')
    expect(getByTestId('registry-locally-modified-warning')).toBeTruthy()

    fireEvent.click(getByTestId('registry-confirm-accept'))
    // Not confirmed yet: no install call went out.
    expect(calls.some((c) => c.startsWith('install:'))).toBe(false)

    fireEvent.click(getByTestId('registry-overwrite-checkbox'))
    fireEvent.click(getByTestId('registry-confirm-accept'))
    await waitFor(() => expect(calls).toContain('install:music-new:true:overwrite'))
  })

  it('blocks the confirm button on a block-level audit until the override is acknowledged', async () => {
    const { getByTestId, findByTestId, calls } = await screenHarness({
      securityAudit: {
        level: 'block',
        findings: [
          { ruleId: 'no-dynamic-execution', category: 'dynamic-execution', level: 'block', message: 'Direct eval is strictly prohibited', line: 10 },
        ],
      },
    })
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-action-music-new'))
    await findByTestId('registry-confirm-dialog')
    expect(getByTestId('registry-security-badge').textContent).toContain('Block')

    fireEvent.click(getByTestId('registry-confirm-accept'))
    expect(calls.some((c) => c.startsWith('install:'))).toBe(false)

    fireEvent.click(getByTestId('registry-block-override-checkbox'))
    fireEvent.click(getByTestId('registry-confirm-accept'))
    await waitFor(() => expect(calls).toContain('install:music-new:true'))
  })

  it('uninstalls a music source through the two-tap confirm and purges the lock record', async () => {
    const { getByTestId, findByTestId, calls } = await screenHarness()
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-uninstall-music-current'))
    fireEvent.click(getByTestId('registry-uninstall-confirm-music-current'))

    await waitFor(() => expect(calls).toContain('remove-source:rec-https://b.example'))
    await waitFor(() => expect(calls).toContain('remove-lock:music-current'))
  })

  it('shows the offline-cache hint when the service reports a cache fallback', async () => {
    const { findByTestId } = await screenHarness({ offline: true })
    expect(await findByTestId('registry-offline-hint')).toBeTruthy()
  })

  it('keeps the details-fetch error on screen instead of confirming blind', async () => {
    const { getByTestId, findByTestId, queryByTestId } = await screenHarness({
      detailsError: 'registry: author repository "a/b" is unreachable',
    })
    await findByTestId('registry-entry-music-new')

    fireEvent.click(getByTestId('registry-action-music-new'))
    await waitFor(() => expect(getByTestId('registry-action-error').textContent).toContain('unreachable'))
    // No details, no dialog.
    expect(queryByTestId('registry-confirm-dialog')).toBeNull()
  })

  it('sorts by stars only once the key changes, lazily fetching stats', async () => {
    const { getByTestId, findByTestId, calls } = await screenHarness({
      repoStats: {
        'BBeBeeX/alpha-source': { stars: 500 },
        'community/beta-source': { stars: 900 },
        'example/plugin-ok': { stars: 10 },
      },
    })
    await findByTestId('registry-entry-music-new')

    // The name sort (the default) must not request any stats.
    expect(calls.filter((call) => call.startsWith('stats:'))).toEqual([])

    fireEvent.click(getByTestId('registry-sort-stars'))
    await waitFor(() => expect(calls.some((call) => call.startsWith('stats:'))).toBe(true))
    // Both music entries render their stat line once the lookups answer.
    await waitFor(() => {
      expect(getByTestId('registry-stats-music-new').textContent).toContain('500')
      expect(getByTestId('registry-stats-music-current').textContent).toContain('900')
    })
  })
})

/* ── the task center ─────────────────────────────────────────────────────── */

describe('RegistryScreen task center', () => {
  it('badges running tasks, opens the sheet, and clears only finished records', async () => {
    const { getByTestId, findByTestId, calls } = await screenHarness({
      tasks: [RUNNING_TASK, FAILED_TASK],
    })
    await findByTestId('registry-entry-music-new')

    // One running among one finished → the header shows the running count.
    expect(getByTestId('registry-tasks-button').textContent).toContain('(1)')

    fireEvent.click(getByTestId('registry-tasks-button'))
    await findByTestId('registry-task-drawer')

    const failed = getByTestId('registry-task-item-task-failed')
    expect(failed.textContent).toContain('Beta Source')
    expect(failed.textContent).toContain(FAILED_TASK.error ?? '')
    expect(getByTestId('registry-task-status-task-running').textContent).toBe('Downloading')
    expect(getByTestId('registry-task-status-task-failed').textContent).toBe('Failed')

    fireEvent.click(getByTestId('registry-tasks-clear'))
    await waitFor(() => expect(calls).toContain('clear-finished-tasks'))
  })

  it('shows the empty task sheet when nothing is tracked', async () => {
    const { getByTestId, findByTestId } = await screenHarness()
    await findByTestId('registry-entry-music-new')

    expect(getByTestId('registry-tasks-button').textContent).not.toContain('(1)')
    fireEvent.click(getByTestId('registry-tasks-button'))
    await findByTestId('registry-task-drawer')
    expect(getByTestId('registry-tasks-empty')).toBeTruthy()
  })
})

/* ── RegistrySettingsCard ────────────────────────────────────────────────── */

describe('RegistrySettingsCard on mobile', () => {
  it('writes registryAutoCheck through the settings service', async () => {
    const { getByTestId, calls } = await cardHarness()
    // The injected Pressable host maps `accessibilityRole` to `data-role`.
    const toggle = getByTestId('registry-settings-card').querySelector('[data-role="switch"]') as HTMLElement
    fireEvent.click(toggle)
    await waitFor(() => expect(calls).toContain('settings-update:{"registryAutoCheck":false}'))
  })

  it('runs a manual check, lists the updates, and navigates to the Discover screen', async () => {
    const { getByTestId, findByTestId, calls, navigateCalls } = await cardHarness()

    expect(getByTestId('registry-last-checked').textContent).toBe('Never')
    fireEvent.click(getByTestId('registry-check-updates'))

    await waitFor(() => expect(calls).toContain('checkUpdates'))
    const item = await findByTestId('registry-update-item-theme-neon')
    expect(item.textContent).toContain('1.0.0')
    expect(item.textContent).toContain('2.0.0')

    fireEvent.click(item)
    expect(navigateCalls).toEqual([REGISTRY_VIEWS.screen])
  })
})
