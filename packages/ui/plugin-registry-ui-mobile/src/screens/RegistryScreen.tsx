/**
 * The registry screen ("Discover"), React Native — the mobile twin of the
 * desktop package's `RegistryScreen`, scoped to what a phone needs:
 *
 * - the four kind tabs (music-source | lyric-source | theme | plugin) with
 *   catalog count badges — the plugin kind stays listed, and an install
 *   attempt surfaces the service's refusal error rather than being hidden;
 * - search, and sort by name / stars / downloads / contributors — the numeric
 *   sorts read `registryMetadata` through `useRepoMetadata`, which requests
 *   nothing until a numeric sort key is active, and degrade quietly when the
 *   service is absent;
 * - the entry list (FlashList-backed kit `List`) with update-available badges
 *   derived from the installed-content services, plus npm-latest overlays for
 *   the plugin kind (whose entries carry no index version);
 * - the install/update two-step contract the service documents —
 *   `fetchEntryDetails` first, then `install(entry, { confirmed: true })` —
 *   with the confirmation sheet (`InstallConfirmSheet`) in between, because
 *   a download host is a security red line the user must see before confirming;
 * - the task center (`RegistryTaskSheet`) fed by the service's
 *   `'registry/tasks-changed'` snapshots, and uninstall for every kind whose
 *   service exposes a remove API.
 *
 * All state lives in services; this component holds view state only. The
 * desktop-only surfaces (favorites, the installed tab, diagnostics, service
 * providers, local `.tgz` import, restart menu) have no mobile equivalent
 * here by design — see the package README note in the plugin entry.
 */

import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  LyricSourceDefinition,
  PluginInfo,
  RegistryEntry,
  RegistryEntryDetails,
  RegistryEntryKind,
  RegistryIndex,
  SourceRecord,
  ThemeDefinition,
} from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { compareVersions, normalizeVersion } from '@BBeBee/toolkit'
import {
  Button,
  EmptyState,
  List,
  nativePrimitives,
  Text,
  TextField,
  useI18n,
  usePalette,
} from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { RegistryEntryCard } from '../components/RegistryEntryCard.js'
import { InstallConfirmSheet } from '../components/InstallConfirmSheet.js'
import { RegistryTaskSheet } from '../components/RegistryTaskSheet.js'
import { useRegistryActionStates } from '../hooks/use-action-states.js'
import type { RegistryActionState } from '../hooks/use-action-states.js'
import { useRegistryTasks } from '../hooks/use-registry-tasks.js'
import { entryStatsKey, useRepoMetadata } from '../hooks/use-repo-metadata.js'
import { usePluginLatestVersions } from '../hooks/use-plugin-latest.js'
import { findInstalledMusicSource, minAppVersionBlock } from '../hooks/install-state.js'

/** The slice of `ctx.contentRegistry` the screen reads. Read structurally, never by import. */
interface RegistryServiceLike {
  getIndex(force?: boolean): Promise<RegistryIndex>
  fetchEntryDetails(entry: RegistryEntry): Promise<RegistryEntryDetails>
  install(
    entry: RegistryEntry,
    opts?: { confirmed?: boolean; overwrite?: boolean; plan?: RegistryEntryDetails['plan'] },
  ): Promise<void>
  removeLockRecord?(id: string): Promise<void>
}

/** Structural slices of the services that manage installed content. */
interface SourcesRemoveLike {
  readonly sources: readonly SourceRecord[]
  remove(id: string, opts?: { forgetCatalogue?: boolean }): Promise<void>
  setEnabled?(id: string, enabled: boolean): Promise<void>
}
interface LyricSourcesLike {
  getSources(): readonly LyricSourceDefinition[]
  removeSource(id: string): Promise<boolean>
  setEnabled(id: string, enabled: boolean): Promise<void>
}
interface ThemeServiceLike {
  getThemes(): readonly ThemeDefinition[]
  getCurrentTheme(): ThemeDefinition
  removeTheme(themeId: string): boolean
  setTheme(themeId: string): Promise<void>
}
interface PluginManagerLike {
  list(): readonly PluginInfo[]
  setEnabled(id: string, enabled: boolean): Promise<void>
  uninstall?(id: string): Promise<void>
}

const KIND_TABS: readonly RegistryEntryKind[] = ['music-source', 'lyric-source', 'theme', 'plugin']

export type RegistrySortKey = 'name' | 'stars' | 'downloads' | 'contributors'
export type RegistrySortDir = 'asc' | 'desc'

/** Each key starts in the direction that reads naturally for it. */
export const DEFAULT_SORT_DIR: Record<RegistrySortKey, RegistrySortDir> = {
  name: 'asc',
  stars: 'desc',
  downloads: 'desc',
  contributors: 'desc',
}

const SORT_LABEL_KEYS: Record<RegistrySortKey, string> = {
  name: 'registry:filter.sortByName',
  stars: 'registry:filter.sortByStars',
  downloads: 'registry:filter.sortByDownloads',
  contributors: 'registry:filter.sortByContributors',
}

/** The `t()` signature from `useI18n`, for the label helpers below. */
type Translate = (key: string, params?: Record<string, string | number>) => string

/** Kind tab labels map 1:1 onto fixed catalogue keys — no runtime key assembly. */
function kindTabLabel(t: Translate, kind: RegistryEntryKind): string {
  switch (kind) {
    case 'music-source':
      return t('registry:registry.musicSource')
    case 'lyric-source':
      return t('registry:registry.lyricSource')
    case 'theme':
      return t('registry:registry.theme')
    case 'plugin':
      return t('registry:registry.plugin')
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function RegistryScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const p = usePalette()
  // ⚠️ `serviceOf` returns a fresh proxy per call, so it must never sit in a
  // hook dependency array. Read it inside effects and handlers, keyed on
  // `ctx` — the same discipline the desktop twin follows.
  const getRegistry = useCallback(
    () => serviceOf<RegistryServiceLike>(ctx, 'contentRegistry'),
    [ctx],
  )

  const [view, setView] = useState<RegistryEntryKind>('music-source')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<RegistrySortKey>('name')
  const [sortDir, setSortDir] = useState<RegistrySortDir>('asc')
  const [index, setIndex] = useState<RegistryIndex | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // Bumped by the refresh button: the plugin-latest hook re-asks every
  // visible package with force, so refresh covers versions too — the
  // index alone carries no plugin version to refresh.
  const [latestSignal, setLatestSignal] = useState(0)
  const [offlineCache, setOfflineCache] = useState(false)
  const [serviceMissing, setServiceMissing] = useState(false)

  const [confirm, setConfirm] = useState<{ details: RegistryEntryDetails; action: 'install' | 'update' } | undefined>(
    undefined,
  )
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [busyEntryId, setBusyEntryId] = useState<string | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [uninstallingId, setUninstallingId] = useState<string | undefined>(undefined)
  const [uninstallError, setUninstallError] = useState<string | null>(null)
  // Bumped when this screen itself changed installed content: the owning
  // service has already changed, but its change event may not have landed
  // (lyric-sources removal emits none), and reshuffling the index object
  // cannot re-derive the states — the entries array inside it keeps its
  // identity. The bump forces one re-derivation against the live services.
  const [contentNonce, setContentNonce] = useState(0)

  useEffect(() => {
    const bump = () => setContentNonce((n) => n + 1)
    const offs = [
      ctx.on('plugin-manager/changed', bump),
      ctx.on('lyric-sources/changed', bump),
      ctx.on('theme/changed', bump),
      ctx.on('theme/registry-changed', bump),
      ctx.on('source/changed', bump),
      ctx.on('source/imported', bump),
      ctx.on('source/removed', bump),
    ]
    return () => {
      offs.forEach((off) => off())
    }
  }, [ctx])

  const pluginMap = useMemo(() => {
    const pm = serviceOf<PluginManagerLike>(ctx, 'plugin-manager')
    const list = pm?.list?.() ?? []
    const map = new Map<string, PluginInfo>()
    for (const plugin of list) {
      map.set(plugin.id, plugin)
      if (plugin.name) map.set(plugin.name, plugin)
      const unscopedId = plugin.id.replace(/^@[^/]+\//, '')
      map.set(unscopedId, plugin)
      if (plugin.name) {
        map.set(plugin.name.replace(/^@[^/]+\//, ''), plugin)
      }
    }
    return map
  }, [ctx, contentNonce])

  const lyricSourceMap = useMemo(() => {
    const ls = serviceOf<LyricSourcesLike>(ctx, 'lyricSources')
    const list = ls?.getSources?.() ?? []
    const map = new Map<string, LyricSourceDefinition>()
    for (const source of list) {
      map.set(source.id, source)
      if (source.id === 'builtin-lrclib') {
        map.set('bbebeex-lrclib', source)
      }
    }
    return map
  }, [ctx, contentNonce])

  const musicSources = useMemo(() => {
    const sources = serviceOf<SourcesRemoveLike>(ctx, 'sources')
    return sources?.sources ?? []
  }, [ctx, contentNonce])

  const themeState = useMemo(() => {
    const ts = serviceOf<ThemeServiceLike>(ctx, 'theme')
    const list = ts?.getThemes?.() ?? []
    const current = ts?.getCurrentTheme?.()
    const map = new Map<string, ThemeDefinition>()
    for (const theme of list) {
      map.set(theme.id, theme)
    }
    return { currentId: current?.id, map }
  }, [ctx, contentNonce])

  const entries = useMemo(() => index?.entries ?? [], [index])

  const actionStates = useRegistryActionStates(ctx, entries, contentNonce)

  const readIndex = useCallback(
    async (force: boolean) => {
      const registry = getRegistry()
      if (!registry) {
        setServiceMissing(true)
        setLoading(false)
        return
      }
      if (force) setRefreshing(true)
      else setLoading(true)
      try {
        const next = await registry.getIndex(force)
        setIndex(next)
        setServiceMissing(false)
        setLoadError(null)
        // The service swallows fetch failures and serves its cached copy; it
        // reports the fallback through this getter so the screen can say
        // "offline cache" instead of passing stale data off as live.
        const fetchFailed = (
          registry as RegistryServiceLike & { lastIndexFetchFailed?: () => boolean }
        ).lastIndexFetchFailed?.()
        setOfflineCache(fetchFailed === true)
      } catch (err) {
        setLoadError(errorMessage(err))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [getRegistry],
  )

  useEffect(() => {
    void readIndex(false)
  }, [readIndex])

  const beginInstall = useCallback(
    async (entry: RegistryEntry, action: 'install' | 'update') => {
      const registry = getRegistry()
      if (!registry) return
      setBusyEntryId(entry.id)
      setConfirmError(null)
      try {
        const details = await registry.fetchEntryDetails(entry)
        setConfirm({ details, action })
      } catch (err) {
        // No details, no dialog: a music source whose hosts could not be
        // fetched must not be confirmed blind — the error stays on screen.
        setConfirmError(errorMessage(err))
      } finally {
        setBusyEntryId(undefined)
      }
    },
    [getRegistry],
  )

  const confirmInstall = useCallback(async (opts?: { overwrite?: boolean }) => {
    const registry = getRegistry()
    if (!registry || !confirm) return
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      await registry.install(confirm.details.entry, {
        confirmed: true,
        overwrite: opts?.overwrite,
        plan: confirm.details.plan,
      })
      setConfirm(undefined)
      // The owning services fire their changed events, which re-derives the
      // action states; this bump is only a backstop for a kind whose event
      // has not landed yet.
      setContentNonce((n) => n + 1)
    } catch (err) {
      // A refusal (e.g. a plugin install on a platform with no installer
      // wired) surfaces here verbatim — it is never special-cased away.
      setConfirmError(errorMessage(err))
    } finally {
      setConfirmBusy(false)
    }
  }, [confirm, getRegistry])

  const handleUninstall = useCallback(
    async (entry: RegistryEntry) => {
      setUninstallingId(entry.id)
      setUninstallError(null)
      try {
        if (entry.kind === 'music-source') {
          // Match the same way the action state does, then remove by record id.
          // Purge catalogue and lock record on uninstall so nothing is left behind.
          const sources = serviceOf<SourcesRemoveLike>(ctx, 'sources')
          const record = sources ? findInstalledMusicSource(entry, sources.sources) : undefined
          // The error lands in the error banner below the list — user-facing
          // copy, so it carries catalogue keys, not dev-English.
          if (!sources || !record) throw new Error(t('registry:registry.musicSourceUninstallMatchNotFound'))
          await sources.remove(record.id, { forgetCatalogue: true })
          const registry = getRegistry()
          if (registry?.removeLockRecord) {
            await registry.removeLockRecord(entry.id)
          }
        } else if (entry.kind === 'lyric-source') {
          const removed = await serviceOf<LyricSourcesLike>(ctx, 'lyricSources')?.removeSource(entry.id)
          if (!removed) throw new Error(t('registry:registry.lyricSourceUninstallGone'))
        } else if (entry.kind === 'theme') {
          const removed = serviceOf<ThemeServiceLike>(ctx, 'theme')?.removeTheme(entry.id)
          if (!removed) throw new Error(t('registry:registry.themeUninstallProtected'))
        } else if (entry.kind === 'plugin') {
          const pm = serviceOf<PluginManagerLike>(ctx, 'plugin-manager')
          if (pm?.uninstall) {
            await pm.uninstall(entry.id)
          }
          const registry = getRegistry()
          if (registry?.removeLockRecord) {
            await registry.removeLockRecord(entry.id)
          }
        }
        // Same backstop as the install path: the owning service has already
        // changed, force the action-state memo to re-derive against it.
        setContentNonce((n) => n + 1)
      } catch (err) {
        setUninstallError(errorMessage(err))
      } finally {
        setUninstallingId(undefined)
      }
    },
    [ctx, getRegistry, t],
  )

  const handleTogglePluginEnabled = useCallback(
    async (pluginId: string, currentEnabled: boolean) => {
      const pm = serviceOf<PluginManagerLike>(ctx, 'plugin-manager')
      if (!pm) return
      try {
        await pm.setEnabled(pluginId, !currentEnabled)
        setContentNonce((n) => n + 1)
      } catch (err) {
        setUninstallError(errorMessage(err))
      }
    },
    [ctx],
  )

  const handleToggleLyricSourceEnabled = useCallback(
    async (sourceId: string, currentEnabled: boolean) => {
      const ls = serviceOf<LyricSourcesLike>(ctx, 'lyricSources')
      if (!ls) return
      try {
        await ls.setEnabled(sourceId, !currentEnabled)
        setContentNonce((n) => n + 1)
      } catch (err) {
        setUninstallError(errorMessage(err))
      }
    },
    [ctx],
  )

  const handleToggleMusicSourceEnabled = useCallback(
    async (recordId: string, currentEnabled: boolean) => {
      const sources = serviceOf<SourcesRemoveLike>(ctx, 'sources')
      if (!sources?.setEnabled) return
      try {
        await sources.setEnabled(recordId, !currentEnabled)
        setContentNonce((n) => n + 1)
      } catch (err) {
        setUninstallError(errorMessage(err))
      }
    },
    [ctx],
  )

  const handleApplyTheme = useCallback(
    async (themeId: string) => {
      const ts = serviceOf<ThemeServiceLike>(ctx, 'theme')
      if (!ts) return
      try {
        await ts.setTheme(themeId)
        setContentNonce((n) => n + 1)
      } catch (err) {
        setUninstallError(errorMessage(err))
      }
    },
    [ctx],
  )

  // Filtered first (the pre-sort set is what the stats hook walks), then
  // sorted.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (entry.kind !== view) return false
      if (!needle) return true
      return (
        entry.name.toLowerCase().includes(needle) ||
        (entry.author?.toLowerCase().includes(needle) ?? false) ||
        (entry.description?.toLowerCase().includes(needle) ?? false)
      )
    })
  }, [entries, view, query])

  // The stats hook only walks the filtered set once a numeric key is active —
  // the name sort (the default) never touches the network.
  const statsEnabled = sortBy !== 'name'
  const repoStats = useRepoMetadata(ctx, filtered, statsEnabled)

  const visible = useMemo(() => {
    const direction = sortDir === 'asc' ? 1 : -1
    if (sortBy === 'name') {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name) * direction)
    }
    const valueOf = (entry: RegistryEntry): number | undefined => {
      const key = entryStatsKey(entry)
      if (!key) return undefined
      const stats = repoStats.get(key)
      if (sortBy === 'stars') return stats?.stars
      if (sortBy === 'downloads') return stats?.downloads
      return stats?.contributors
    }
    return [...filtered].sort((a, b) => {
      const va = valueOf(a)
      const vb = valueOf(b)
      // Lookups that came back empty sort after everything with data, in
      // either direction, and render "—".
      if (va === undefined && vb === undefined) return 0
      if (va === undefined) return 1
      if (vb === undefined) return -1
      return (va - vb) * direction
    })
  }, [filtered, sortBy, sortDir, repoStats])

  // Plugin latest versions: the index carries no plugin version, so the
  // title chips and update badges of plugin cards resolve npm latest for
  // the visible plugin entries only.
  const visiblePluginEntries = useMemo(
    () => visible.filter((entry) => entry.kind === 'plugin'),
    [visible],
  )
  const pluginLatest = usePluginLatestVersions(ctx, visiblePluginEntries, latestSignal)

  // Display states: the derived states, with plugin updates overlaid from
  // npm latest — the derivation itself cannot see npm, because plugin
  // entries carry no index version at all. A plugin whose npm latest is
  // newer than its installed version reads as an update, same as the other
  // kinds read their index version.
  const displayStates: ReadonlyMap<string, RegistryActionState> = useMemo(() => {
    let overridden: Map<string, RegistryActionState> | undefined
    for (const entry of visiblePluginEntries) {
      const latest = entry.npm ? pluginLatest.get(entry.npm) : undefined
      if (!latest) continue
      const current = actionStates.get(entry.id)
      if (current?.state !== 'installed') continue
      if (compareVersions(latest, current.installedVersion) <= 0) continue
      overridden ??= new Map(actionStates)
      overridden.set(entry.id, { state: 'update', installedVersion: normalizeVersion(current.installedVersion) })
    }
    return overridden ?? actionStates
  }, [actionStates, pluginLatest, visiblePluginEntries])

  // Tab badges count the whole catalog per kind, independent of the view
  // filters — they answer "how much is there", not "what is on screen".
  const counts = useMemo(() => {
    const map = new Map<RegistryEntryKind, number>()
    for (const entry of entries) {
      map.set(entry.kind, (map.get(entry.kind) ?? 0) + 1)
    }
    return map
  }, [entries])

  const { tasks, runningCount, canClear, clearFinished } = useRegistryTasks(ctx)
  const [tasksOpen, setTasksOpen] = useState(false)

  const statsFor = useCallback(
    (entry: RegistryEntry): { stars?: number; contributors?: number; downloads?: number } | undefined => {
      const key = entryStatsKey(entry)
      if (!key) return undefined
      return repoStats.get(key)
    },
    [repoStats],
  )

  const handleSortByChange = useCallback((key: RegistrySortKey) => {
    setSortBy(key)
    // Each key starts in the direction that reads naturally for it.
    setSortDir(DEFAULT_SORT_DIR[key])
  }, [])

  /** One kind tab: a pill with a count badge. */
  const kindTab = (kind: RegistryEntryKind) => {
    const active = view === kind
    return h(
      native.Pressable as never,
      {
        key: kind,
        testID: `registry-tab-${kind}`,
        accessibilityRole: 'tab',
        accessibilityState: { selected: active },
        accessibilityLabel: kindTabLabel(t, kind),
        onPress: () => setView(kind),
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space[1],
          paddingHorizontal: tokens.space[3],
          paddingVertical: tokens.space[1],
          borderRadius: tokens.radius.pill,
          borderWidth: 1,
          borderColor: active ? p.accent.base : p.border.subtle,
          backgroundColor: active ? p.accent.muted : 'transparent',
        },
      },
      h(Text, { variant: 'xs', tone: active ? 'accent' : 'muted', children: kindTabLabel(t, kind) }),
      h(
        Text,
        { variant: 'xs', tone: active ? 'accent' : 'muted' },
        String(counts.get(kind) ?? 0),
      ),
    )
  }

  const sortChip = (key: RegistrySortKey) => {
    const active = sortBy === key
    return h(
      native.Pressable as never,
      {
        key: key,
        testID: `registry-sort-${key}`,
        accessibilityRole: 'button',
        accessibilityState: { selected: active },
        accessibilityLabel: t(SORT_LABEL_KEYS[key]),
        onPress: () => handleSortByChange(key),
        style: {
          paddingHorizontal: tokens.space[2],
          paddingVertical: tokens.space[1],
          borderRadius: tokens.radius.pill,
          borderWidth: 1,
          borderColor: active ? p.accent.base : p.border.subtle,
          backgroundColor: active ? p.accent.muted : 'transparent',
        },
      },
      h(Text, { variant: 'xs', tone: active ? 'accent' : 'muted', children: t(SORT_LABEL_KEYS[key]) }),
    )
  }

  const renderItem = (entry: RegistryEntry) => {
    const actionState = displayStates.get(entry.id) ?? { state: 'install' as const }
    const blocked = minAppVersionBlock(entry, undefined)
    const isInstalled = actionState.state === 'installed' || actionState.state === 'update'
    const isPlugin = entry.kind === 'plugin'
    const isLyric = entry.kind === 'lyric-source'
    const isMusic = entry.kind === 'music-source'
    const isTheme = entry.kind === 'theme'
    const pluginInfo = isPlugin
      ? pluginMap.get(entry.id) ?? pluginMap.get(entry.id.replace(/^@[^/]+\//, ''))
      : undefined
    const lyricInfo = isLyric ? lyricSourceMap.get(entry.id) : undefined
    const musicRecord = isMusic ? findInstalledMusicSource(entry, musicSources) : undefined

    // Latest available version: the index version for the kinds that carry
    // one, npm latest for plugins.
    const pluginLatestVersion = isPlugin && entry.npm ? pluginLatest.get(entry.npm) : undefined
    const latestVersion =
      actionState.state === 'update' ? (isPlugin ? pluginLatestVersion : entry.version) : undefined
    const titleVersion = isPlugin ? (pluginInfo?.version ?? pluginLatestVersion) : undefined

    return h(RegistryEntryCard, {
      ctx,
      entry,
      actionState,
      blockedReason: blocked,
      busy: busyEntryId === entry.id,
      stats: statsFor(entry),
      titleVersion,
      latestVersion,
      itemEnabled: isPlugin
        ? (pluginInfo?.enabled ?? true)
        : isLyric
          ? (lyricInfo?.enabled ?? true)
          : isMusic
            ? (musicRecord?.enabled ?? true)
            : undefined,
      onToggleEnabled: isPlugin
        ? () => void handleTogglePluginEnabled(pluginInfo?.id ?? entry.id, pluginInfo?.enabled ?? true)
        : isLyric
          ? () => void handleToggleLyricSourceEnabled(lyricInfo?.id ?? entry.id, lyricInfo?.enabled ?? true)
          : isMusic
            ? () => void handleToggleMusicSourceEnabled(musicRecord?.id ?? entry.id, musicRecord?.enabled ?? true)
            : undefined,
      themeActive: isTheme ? themeState.currentId === entry.id : undefined,
      onApplyTheme: isTheme ? () => void handleApplyTheme(entry.id) : undefined,
      uninstall: isInstalled
        ? {
            available: true,
            busy: uninstallingId === entry.id,
            onConfirm: () => void handleUninstall(entry),
          }
        : undefined,
      onAction: () =>
        void beginInstall(
          entry,
          actionState.state === 'update' ? 'update' : 'install',
        ),
    })
  }

  /** What the list shows when it has nothing to show. */
  const listEmpty = loading
    ? h(
        native.View as never,
        { key: 'loading', testID: 'registry-loading', style: { alignItems: 'center', padding: tokens.space[6] } },
        h(native.ActivityIndicator as never, { color: p.accent.base }),
      )
    : serviceMissing
      ? h(
          native.View as never,
          { key: 'service-missing', testID: 'registry-service-missing' },
          h(EmptyState, {
            icon: '⚠️',
            title: t('registry:registry.registryServiceNotLoaded'),
            description: t('registry:registry.cannotBrowseCommunityContentTry'),
          }),
        )
      : loadError
        ? h(
            native.View as never,
            { key: 'load-error', testID: 'registry-load-error', style: { padding: tokens.space[3] } },
            h(Text, { variant: 'sm', tone: 'error' }, t('registry:registry.failedToLoadTheRegistry', { loadError })),
          )
        : h(
            native.View as never,
            { key: 'empty', testID: 'registry-empty' },
            h(EmptyState, {
              icon: '🧭',
              title: query ? t('registry:registry.noMatchingContent') : t('registry:registry.nothingInThisCategoryYet'),
              description: query ? t('registry:registry.tryADifferentKeyword') : undefined,
            }),
          )

  return h(
    native.View as never,
    { testID: 'registry-screen', style: { flex: 1, backgroundColor: p.bg.base } },
    // Header: title, actions, tabs, search, sort.
    h(
      native.View as never,
      { style: { gap: tokens.space[2], paddingHorizontal: tokens.space[4], paddingTop: tokens.space[3] } },
      h(
        native.View as never,
        { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
        h(
          native.View as never,
          { style: { flex: 1 } },
          h(Text, { variant: 'lg', children: t('registry:route.discover') }),
          h(Text, { variant: 'xs', tone: 'muted', children: t('registry:registry.browseSubtitle') }),
        ),
        h(Button, {
          testID: 'registry-refresh',
          variant: 'secondary',
          disabled: refreshing || loading,
          loading: refreshing,
          onPress: () => {
            setLatestSignal((s) => s + 1)
            void readIndex(true)
          },
          children: refreshing ? t('registry:registry.refreshing') : t('registry:registry.refresh'),
        }),
        h(Button, {
          testID: 'registry-tasks-button',
          variant: 'secondary',
          onPress: () => setTasksOpen(true),
          accessibilityLabel:
            runningCount > 0
              ? t('registry:registryTask.tasksRunningCount', { count: runningCount })
              : t('registry:registryTask.tasks'),
          children: runningCount > 0
            ? `${t('registry:registryTask.tasks')} (${runningCount})`
            : t('registry:registryTask.tasks'),
        }),
      ),
      offlineCache
        ? h(
            native.View as never,
            { testID: 'registry-offline-hint', style: { alignSelf: 'flex-start', paddingHorizontal: tokens.space[2], paddingVertical: 2, borderRadius: tokens.radius.pill } },
            h(Text, { variant: 'xs', tone: 'warn', children: t('registry:registry.offlineCache') }),
          )
        : null,
      // Kind tabs.
      h(
        native.View as never,
        { style: { flexDirection: 'row', gap: tokens.space[1], flexWrap: 'wrap' } },
        KIND_TABS.map((kind) => kindTab(kind)),
      ),
      // Search.
      h(TextField, {
        testID: 'registry-search',
        value: query,
        onChange: setQuery,
        placeholder: t('registry:filter.searchPlaceholder'),
        accessibilityLabel: t('registry:filter.searchPlaceholder'),
      }),
      // Sort chips + direction toggle.
      h(
        native.View as never,
        { style: { flexDirection: 'row', gap: tokens.space[1], flexWrap: 'wrap', alignItems: 'center' } },
        (Object.keys(SORT_LABEL_KEYS) as RegistrySortKey[]).map((key) => sortChip(key)),
        h(
          native.Pressable as never,
          {
            testID: 'registry-sort-direction',
            accessibilityRole: 'button',
            accessibilityLabel: t('registry:filter.toggleSortDirection'),
            onPress: () => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc')),
            style: {
              paddingHorizontal: tokens.space[2],
              paddingVertical: tokens.space[1],
              borderRadius: tokens.radius.pill,
              borderWidth: 1,
              borderColor: p.border.strong,
            },
          },
          h(Text, { variant: 'xs', children: t(sortDir === 'asc' ? 'registry:filter.ascending' : 'registry:filter.descending') }),
        ),
      ),
      // Errors between the controls and the list, where a thumb can't hide them.
      // The confirm-sheet's own error renders inside the sheet; this banner
      // covers the path where the details fetch failed and no sheet opened.
      confirmError && !confirm
        ? h(
            native.View as never,
            { testID: 'registry-action-error', style: { padding: tokens.space[2], borderRadius: tokens.radius.sm, borderWidth: 1, borderColor: p.state.error } },
            h(Text, { variant: 'xs', tone: 'error', children: confirmError }),
          )
        : null,
      uninstallError
        ? h(
            native.View as never,
            { testID: 'registry-uninstall-error', style: { padding: tokens.space[2], borderRadius: tokens.radius.sm, borderWidth: 1, borderColor: p.state.error } },
            h(Text, { variant: 'xs', tone: 'error', children: uninstallError }),
          )
        : null,
    ),
    // The entry list.
    h(
      native.View as never,
      { style: { flex: 1, paddingHorizontal: tokens.space[4], paddingBottom: tokens.space[3] } },
      h(List<RegistryEntry>, {
        items: visible,
        accessibilityLabel: t('registry:route.discover'),
        keyExtractor: (entry) => entry.id,
        renderItem: (entry) => renderItem(entry),
        empty: listEmpty,
      }),
    ),
    confirm
      ? h(InstallConfirmSheet, {
          ctx,
          details: confirm.details,
          action: confirm.action,
          busy: confirmBusy,
          error: confirmError,
          onConfirm: (opts) => void confirmInstall(opts),
          onClose: () => {
            setConfirm(undefined)
            setConfirmError(null)
          },
        })
      : null,
    tasksOpen
      ? h(RegistryTaskSheet, {
          ctx,
          tasks,
          canClear,
          onClearFinished: clearFinished,
          onClose: () => setTasksOpen(false),
        })
      : null,
  )
}
