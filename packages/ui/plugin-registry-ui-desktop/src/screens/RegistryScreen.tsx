/**
 * The registry screen ("Discover / registry"): the community index, browsable by
 * kind, searchable, filterable (third-party toggle, plugin categories) and
 * sortable (name, stars, contributors), with install/update actions per entry
 * — plus two curated views beside the kind tabs: Favorites (the user's
 * favorited entries, persisted in localStorage) and Installed (everything the
 * installed content services report as installed or updateable, with
 * lock-file metadata and uninstall for the kinds whose services have a remove
 * API) — and a Diagnostics tab rendering the service's health report (lock
 * conflicts, audit risks, warnings, install summary) assembled from real
 * state.
 *
 * The header also hosts the Tasks (task center) button: a badge counts the
 * operations currently running, and the drawer lists every tracked
 * install/update — stage, progress, error, start time — straight from the
 * service's `'registry/tasks-changed'` snapshots. No task state machine lives
 * in the view.
 *
 * Beside it sit two page-level actions. Local import: the user picks a
 * plugin package file (`.tgz`), the view reads its bytes and hands them
 * to the plugin-manager's preview — which runs the whole install
 * checklist before anything is shown — and the confirm dialog
 * (`LocalImportConfirmDialog`) carries the trust decision, because a
 * local package's identity is self-declared. And a Restart dropdown:
 * "reload UI" is a plain WebView reload, "restart app" goes through the
 * preload bridge's `app.restart()` (the native relaunch command); where
 * the bridge has no app surface the item says so instead of pretending.
 *
 * All state lives in services; this component holds view state only — the
 * filter/sort choices included. The repo-stats sort reads `registryMetadata`
 * through `useRepoMetadata`, which requests nothing until a numeric sort key
 * is active. The install flow is the two-step contract the service documents —
 * `fetchEntryDetails` first, then `install(entry, { confirmed: true })` —
 * with the confirmation dialog (`InstallConfirmDialog`) in between, because
 * a download host is a security red line the user must see before confirming.
 *
 * Visual system: pills, chips, banners, the card grid and the hover/focus
 * feedback all come from the shared `styles.ts`; empty states use the ghost
 * icon treatment and the loading state is a card-shaped skeleton grid (the
 * shimmer keyframes ride in via the injected `BASELINE_CSS`).
 */

import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  LocalPluginPreview,
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
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useOptionalI18n } from '../utils/optional-i18n.js'
import { useAppVersion, useRegistryActionStates } from '../hooks/use-registry.js'
import { useFavorites } from '../hooks/use-favorites.js'
import { useRegistryLockRecords } from '../hooks/use-lock-records.js'
import { useRegistryTasks } from '../hooks/use-registry-tasks.js'
import { useRepoMetadata } from '../hooks/use-repo-metadata.js'
import { findInstalledMusicSource, isBuiltinEntry, minAppVersionBlock } from '../hooks/install-state.js'
import { InstallConfirmDialog } from '../components/InstallConfirmDialog.js'
import { LocalImportConfirmDialog } from '../components/LocalImportConfirmDialog.js'
import { RegistryEntryCard } from '../components/RegistryEntryCard.js'
import { RegistryTaskDrawer } from '../components/RegistryTaskDrawer.js'
import { RegistryEmptyState } from '../components/RegistryEmptyState.js'
import { RegistrySkeletonGrid } from '../components/RegistrySkeleton.js'
import { RegistryDiagnosticsScreen } from './RegistryDiagnosticsScreen.js'
import {
  DEFAULT_SORT_DIR,
  RegistryFilterBar,
  categoryLabel,
  type RegistrySortDir,
  type RegistrySortKey,
} from '../components/RegistryFilterBar.js'
import { BASELINE_CSS, CARD_GRID, ERROR_BANNER, PILL_BASE, TAB_DIVIDER, TONE, tabPill } from '../styles.js'
import { entryRepo, isOfficialEntry, repoKey } from '../utils/repo.js'

/** The slice of `ctx.contentRegistry` the screen reads. Read structurally, never by import. */
interface RegistryServiceLike {
  getIndex(force?: boolean): Promise<RegistryIndex>
  fetchEntryDetails(entry: RegistryEntry): Promise<RegistryEntryDetails>
  install(entry: RegistryEntry, opts?: { confirmed?: boolean; overwrite?: boolean }): Promise<void>
  removeLockRecord?(id: string): Promise<void>
}

/** Structural slices of the services that manage installed content. */
interface SourcesRemoveLike {
  readonly sources: readonly SourceRecord[]
  remove(id: string, opts?: { forgetCatalogue?: boolean }): Promise<void>
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
  previewLocalPlugin?(packageBase64: string): Promise<LocalPluginPreview>
  installLocalPlugin?(
    packageBase64: string,
    opts?: { confirmed?: boolean },
  ): Promise<LocalPluginPreview>
}

/** The preload bridge's app surface (desktop only; absent elsewhere). */
interface AppBridgeLike {
  BBeBee?: { app?: { restart?: () => Promise<void> } }
}

const LOCAL_PACKAGE_MAX_BYTES = 50 * 1024 * 1024

/** Base64-encodes file bytes in chunks (`btoa` needs a binary string; a single spread would blow the stack on multi-MB packages). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 32 * 1024
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

const KIND_TABS: readonly RegistryEntryKind[] = ['music-source', 'lyric-source', 'theme', 'plugin']

/** The `t()` signature from `useI18n`, for the render helpers below. */
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

/** What the tab row can show: the four kinds plus the curated and diagnostic views. */
type RegistryView = RegistryEntryKind | 'favorites' | 'installed' | 'diagnostics'

const screenStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  padding: '20px 24px 32px',
  height: '100%',
  width: '100%',
  boxSizing: 'border-box',
  overflowY: 'auto',
  color: 'var(--text-primary, #F5F7FF)',
} as const

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  flexWrap: 'wrap',
} as const

const headerTitleBlockStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flex: 1,
  minWidth: 200,
} as const

/** The header's right side: offline hint, task center, refresh — one group. */
const headerActionsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
} as const

const headerButtonStyle = {
  ...PILL_BASE,
  background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
  borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.12))',
  color: 'var(--text-primary, #F5F7FF)',
} as const

const offlineBadgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  border: `1px solid color-mix(in srgb, ${TONE.warning} 55%, transparent)`,
  background: `color-mix(in srgb, ${TONE.warning} 10%, transparent)`,
  color: TONE.warning,
} as const

const tabsRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
} as const

/** The count chip inside a tab: filled brand when active, quiet surface otherwise. */
const tabBadgeStyle = (active: boolean) =>
  ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 18,
    padding: '0 6px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    background: active ? 'var(--color-primary, #5F87FF)' : 'var(--surface-3, rgba(255, 255, 255, 0.10))',
    color: active ? 'var(--bb-accent-on, #FFFFFF)' : 'var(--text-tertiary, #8B95B0)',
  }) as const

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function RegistryScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useOptionalI18n(ctx)
  // ⚠️ `serviceOf` returns a fresh proxy per call, so it must never sit in a
  // hook dependency array. Read it inside effects and handlers, keyed on
  // `ctx` — the same discipline ThemeManagementCard follows.
  const getRegistry = useCallback(
    () => serviceOf<RegistryServiceLike>(ctx, 'contentRegistry'),
    [ctx],
  )

  const [view, setView] = useState<RegistryView>('music-source')
  const isKindView = view !== 'favorites' && view !== 'installed' && view !== 'diagnostics'
  const [query, setQuery] = useState('')
  // Filter/sort view state — nothing here is domain state, so none of it is
  // persisted: the page always opens showing everything, names A→Z. The sort
  // and the third-party toggle only mean something on a kind tab; the
  // curated tabs (Favorites / Installed) hide those controls and keep the
  // search box.
  const [officialOnly, setOfficialOnly] = useState(false)
  const [sortBy, setSortBy] = useState<RegistrySortKey>('name')
  const [sortDir, setSortDir] = useState<RegistrySortDir>('asc')
  const [category, setCategory] = useState<string>('all')
  const [index, setIndex] = useState<RegistryIndex | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [offlineCache, setOfflineCache] = useState(false)
  const [serviceMissing, setServiceMissing] = useState(false)

  const [confirm, setConfirm] = useState<{ details: RegistryEntryDetails; action: 'install' | 'update' } | undefined>(
    undefined,
  )
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [busyEntryId, setBusyEntryId] = useState<string | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)

  // The task center: state lives in the service, this is a subscription. The
  // drawer is plain view state — open while the user reads, closed otherwise.
  const { tasks, runningCount, canClear, clearFinished } = useRegistryTasks(ctx)
  const [tasksOpen, setTasksOpen] = useState(false)

  // Local import + restart: header-level actions. The picked package's
  // bytes are held only as the base64 string the manager consumes; the
  // preview is the manager's verdict, this view keeps no copy of the
  // parsed package.
  const [restartMenuOpen, setRestartMenuOpen] = useState(false)
  const [localPreview, setLocalPreview] = useState<LocalPluginPreview | undefined>(undefined)
  const [localPackageBase64, setLocalPackageBase64] = useState<string | undefined>(undefined)
  const [localBusy, setLocalBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const localFileInputRef = useRef<HTMLInputElement | null>(null)

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

  const indexRef = useRef<RegistryIndex | undefined>(undefined)
  indexRef.current = index

  const pluginMap = useMemo(() => {
    const pm = serviceOf<PluginManagerLike>(ctx, 'plugin-manager')
    const list = pm?.list?.() ?? []
    const map = new Map<string, PluginInfo>()
    for (const p of list) {
      map.set(p.id, p)
      if (p.name) map.set(p.name, p)
      const unscopedId = p.id.replace(/^@[^/]+\//, '')
      map.set(unscopedId, p)
      if (p.name) {
        map.set(p.name.replace(/^@[^/]+\//, ''), p)
      }
    }
    return map
  }, [ctx, contentNonce])

  const lyricSourceMap = useMemo(() => {
    const ls = serviceOf<LyricSourcesLike>(ctx, 'lyricSources')
    const list = ls?.getSources?.() ?? []
    const map = new Map<string, LyricSourceDefinition>()
    for (const s of list) {
      map.set(s.id, s)
      if (s.id === 'builtin-lrclib') {
        map.set('bbebeex-lrclib', s)
      }
    }
    return map
  }, [ctx, contentNonce])

  const themeState = useMemo(() => {
    const ts = serviceOf<ThemeServiceLike>(ctx, 'theme')
    const list = ts?.getThemes?.() ?? []
    const current = ts?.getCurrentTheme?.()
    const map = new Map<string, ThemeDefinition>()
    for (const t of list) {
      map.set(t.id, t)
    }
    return { currentId: current?.id, map }
  }, [ctx, contentNonce])

  const lockRecords = useRegistryLockRecords(ctx, true)

  const entries = useMemo(() => {
    const list = [...(index?.entries ?? [])]
    const existingIds = new Set(list.map((e) => e.id))
    for (const [id, record] of lockRecords) {
      if (record.kind === 'plugin' && !existingIds.has(id)) {
        const info = pluginMap.get(id)
        list.push({
          id,
          name: info?.displayName || info?.name || id,
          version: info?.version || '1.0.0',
          description: info?.description,
          author: info?.author,
          kind: 'plugin',
          repo: record.repo,
          downloadUrl: '',
        })
        existingIds.add(id)
      }
    }
    return list
  }, [index, lockRecords, pluginMap])

  const actionStates = useRegistryActionStates(ctx, entries, contentNonce)
  const { favorites, toggle: toggleFavorite, isFavorite } = useFavorites()
  const appVersion = useAppVersion()

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
      await registry.install(confirm.details.entry, { confirmed: true, overwrite: opts?.overwrite })
      setConfirm(undefined)
      // The owning services fire their changed events, which re-derives the
      // action states; this bump is only a backstop for a kind whose event
      // has not landed yet.
      setContentNonce((n) => n + 1)
    } catch (err) {
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
          // The error lands in the error banner below the grid — user-facing
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

  /**
   * The uninstall affordance, per entry.
   */
  const uninstallFor = useCallback(
    (entry: RegistryEntry): { available: boolean; onConfirm: () => void } | undefined => {
      if (isBuiltinEntry(entry)) return undefined
      return {
        available: true,
        onConfirm: () => void handleUninstall(entry),
      }
    },
    [handleUninstall],
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

  const handleLocalFile = useCallback(
    async (file: File) => {
      setActionError(null)
      setActionNotice(null)
      setLocalError(null)
      if (file.size > LOCAL_PACKAGE_MAX_BYTES) {
        setActionError(t('registry:localImport.fileTooLarge'))
        return
      }
      const pm = serviceOf<PluginManagerLike>(ctx, 'plugin-manager')
      if (!pm?.previewLocalPlugin) {
        setActionError(t('registry:localImport.managerUnavailable'))
        return
      }
      setLocalBusy(true)
      try {
        const base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
        const preview = await pm.previewLocalPlugin(base64)
        setLocalPackageBase64(base64)
        setLocalPreview(preview)
      } catch (err) {
        setActionError(errorMessage(err))
      } finally {
        setLocalBusy(false)
      }
    },
    [ctx, t],
  )

  const confirmLocalImport = useCallback(async () => {
    const pm = serviceOf<PluginManagerLike>(ctx, 'plugin-manager')
    if (!pm?.installLocalPlugin || !localPackageBase64 || !localPreview) return
    setLocalBusy(true)
    setLocalError(null)
    try {
      const done = await pm.installLocalPlugin(localPackageBase64, { confirmed: true })
      setLocalPreview(undefined)
      setLocalPackageBase64(undefined)
      setActionNotice(
        t('registry:localImport.success', {
          name: done.displayName ?? done.id,
          version: done.version,
        }),
      )
      setContentNonce((n) => n + 1)
    } catch (err) {
      setLocalError(errorMessage(err))
    } finally {
      setLocalBusy(false)
    }
  }, [ctx, localPackageBase64, localPreview, t])

  const handleReloadUi = useCallback(() => {
    setRestartMenuOpen(false)
    window.location.reload()
  }, [])

  const handleRestartApp = useCallback(() => {
    setRestartMenuOpen(false)
    const restart = (window as unknown as AppBridgeLike).BBeBee?.app?.restart
    if (typeof restart !== 'function') {
      setActionError(t('registry:registry.restartUnavailable'))
      return
    }
    void restart().catch((err: unknown) => setActionError(errorMessage(err)))
  }, [t])

  // Filtered first (the pre-sort set is what the stats hook walks), then
  // sorted.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (view === 'favorites') {
        if (!favorites.has(entry.id)) return false
      } else if (view === 'installed') {
        const state = actionStates.get(entry.id)?.state
        if (state !== 'installed' && state !== 'update') return false
      } else {
        if (entry.kind !== view) return false
        if (officialOnly && !isOfficialEntry(entry)) return false
        if (view === 'plugin' && category !== 'all' && entry.category !== category) return false
      }
      if (!needle) return true
      return (
        entry.name.toLowerCase().includes(needle) ||
        (entry.author?.toLowerCase().includes(needle) ?? false) ||
        (entry.description?.toLowerCase().includes(needle) ?? false)
      )
    })
  }, [entries, view, favorites, actionStates, query, officialOnly, category])

  const statsEnabled = isKindView && (view === 'plugin' || sortBy !== 'name')
  const repoStats = useRepoMetadata(ctx, filtered, statsEnabled)

  const visible = useMemo(() => {
    if (view === 'diagnostics') return filtered
    // Stable sort: entries with equal keys (and the no-data group) keep the
    // filtered order.
    const direction = sortDir === 'asc' ? 1 : -1
    if (sortBy === 'name') {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name) * direction)
    }
    const valueOf = (entry: RegistryEntry): number | undefined => {
      const ref = entryRepo(entry)
      if (!ref) return undefined
      const stats = repoStats.get(repoKey(ref))
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
  }, [filtered, view, sortBy, sortDir, repoStats])

  // Category options come from the plugin entries themselves; unknown slugs
  // pass through `categoryLabel` verbatim, so a new slug can never crash.
  const categories = useMemo(() => {
    const slugs = new Set<string>()
    for (const entry of entries) {
      if (entry.kind === 'plugin' && entry.category) slugs.add(entry.category)
    }
    return [...slugs].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), 'zh'))
  }, [entries])

  const counts = useMemo(() => {
    // Tab badges count the whole catalog per kind, independent of the view
    // filters — they answer "how much is there", not "what is on screen".
    const map = new Map<RegistryEntryKind, number>()
    for (const entry of entries) {
      map.set(entry.kind, (map.get(entry.kind) ?? 0) + 1)
    }
    return map
  }, [entries])

  const installedCount = useMemo(() => {
    let total = 0
    for (const entry of entries) {
      const state = actionStates.get(entry.id)?.state
      if (state === 'installed' || state === 'update') total += 1
    }
    return total
  }, [entries, actionStates])

  const statsFor = useCallback(
    (entry: RegistryEntry): { stars?: number; contributors?: number; downloads?: number } | undefined => {
      const ref = entryRepo(entry)
      if (!ref) return undefined
      return repoStats.get(repoKey(ref))
    },
    [repoStats],
  )

  const handleSortByChange = useCallback((key: RegistrySortKey) => {
    setSortBy(key)
    // Each key starts in the direction that reads naturally for it.
    setSortDir(DEFAULT_SORT_DIR[key])
  }, [])

  // Diagnostics "View" jump: land on the entry's kind tab with the entry name
  // pre-filled in the search box, so the card is the one thing on screen. An
  // entry missing from the index (removed between report and click) still
  // switches tabs rather than doing nothing.
  const handleNavigateToEntry = useCallback((entryId: string, kind: RegistryEntryKind) => {
    const entry = indexRef.current?.entries.find((candidate) => candidate.id === entryId)
    setQuery(entry?.name ?? '')
    setView(kind)
  }, [])

  const kindTabButton = (key: string, label: string, badge: string | null, active: boolean, onClick: () => void) =>
    h(
      'button',
      {
        key,
        type: 'button',
        'data-testid': `registry-tab-${key}`,
        onClick,
        className: 'bbreg-btn bbreg-btn-ghost',
        style: tabPill(active),
      },
      label,
      badge ? h('span', { style: tabBadgeStyle(active) }, badge) : null,
    )

  return h(
    'div',
    { style: screenStyle, 'data-testid': 'registry-screen' },
    // The package's shared hover/focus/shimmer CSS (see styles.ts).
    h('style', { key: 'bbreg-baseline' }, BASELINE_CSS),
    // Header: title block on the left, the offline hint and the two actions
    // grouped on the right.
    h(
      'div',
      { style: headerStyle },
      h(
        'div',
        { style: headerTitleBlockStyle },
        h('h1', { style: { margin: 0, fontSize: 20, fontWeight: 700 } }, t('registry:registry.discover')),
        h(
          'div',
          { style: { fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
          t('registry:registry.browseSubtitle'),
        ),
      ),
      h(
        'div',
        { style: headerActionsStyle },
        offlineCache
          ? h(
              'span',
              {
                'data-testid': 'registry-offline-hint',
                style: offlineBadgeStyle,
              },
              tablerIcon('history', { size: 12 }),
              t('registry:registry.offlineCache'),
            )
          : null,
        // The task-center button sits between the offline hint and the refresh
        // button: the badge counts running tasks only, so an abandoned
        // "awaiting confirmation" record never keeps the number lit forever.
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'registry-tasks-button',
            onClick: () => setTasksOpen(true),
            'aria-label':
              runningCount > 0
                ? t('registry:registryTask.tasksRunningCount', { count: runningCount })
                : t('registry:registryTask.tasks'),
            className: 'bbreg-btn bbreg-btn-ghost',
            style: headerButtonStyle,
          },
          tablerIcon('list-check', { size: 14 }),
          runningCount > 0
            ? h(
                'span',
                {
                  'data-testid': 'registry-tasks-badge',
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 16,
                    height: 16,
                    padding: '0 4px',
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    background: 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
                    color: 'var(--bb-accent-on, #FFFFFF)',
                  },
                },
                String(runningCount),
              )
            : null,
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'registry-refresh',
            onClick: () => void readIndex(true),
            disabled: refreshing || loading,
            className: 'bbreg-btn bbreg-btn-ghost',
            style: { ...headerButtonStyle, opacity: refreshing || loading ? 0.6 : 1 },
          },
          refreshing ? t('registry:registry.refreshing') : t('registry:registry.refresh'),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'registry-local-import',
            onClick: () => localFileInputRef.current?.click(),
            disabled: localBusy,
            className: 'bbreg-btn bbreg-btn-ghost',
            style: { ...headerButtonStyle, opacity: localBusy ? 0.6 : 1 },
          },
          tablerIcon('download', { size: 14 }),
          t('registry:registry.localImport'),
        ),
        h('input', {
          key: 'registry-local-import-input',
          ref: localFileInputRef,
          type: 'file',
          accept: '.tgz,application/gzip,application/x-gzip',
          'data-testid': 'registry-local-import-input',
          style: { display: 'none' },
          onChange: (e: { target: { files?: ArrayLike<File> | null; value: string } }) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void handleLocalFile(file)
          },
        }),
        // Restart dropdown: a button plus a small menu panel (with a
        // click-catcher behind it). Reload is renderer-only; restart
        // goes through the preload bridge.
        h(
          'div',
          { key: 'registry-restart', style: { position: 'relative' } },
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'registry-restart-button',
              onClick: () => setRestartMenuOpen((open) => !open),
              'aria-haspopup': 'menu',
              'aria-expanded': restartMenuOpen,
              className: 'bbreg-btn bbreg-btn-ghost',
              style: headerButtonStyle,
            },
            tablerIcon('power', { size: 14 }),
            t('registry:registry.restart'),
            tablerIcon('chevron-down', { size: 12 }),
          ),
          restartMenuOpen
            ? h(
                'div',
                { key: 'registry-restart-menu-wrap' },
                h('div', {
                  key: 'registry-restart-catcher',
                  'data-testid': 'registry-restart-catcher',
                  onClick: () => setRestartMenuOpen(false),
                  style: { position: 'fixed', inset: 0, zIndex: 40 },
                }),
                h(
                  'div',
                  {
                    key: 'registry-restart-menu',
                    role: 'menu',
                    'data-testid': 'registry-restart-menu',
                    style: {
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      right: 0,
                      zIndex: 41,
                      minWidth: 180,
                      display: 'flex',
                      flexDirection: 'column',
                      padding: 4,
                      borderRadius: 10,
                      background: 'var(--surface-1, #0D101A)',
                      border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
                      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
                    },
                  },
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'menuitem',
                      'data-testid': 'registry-restart-reload',
                      onClick: handleReloadUi,
                      className: 'bbreg-btn bbreg-btn-ghost',
                      style: { ...headerButtonStyle, justifyContent: 'flex-start', border: 'none' },
                    },
                    t('registry:registry.reloadUi'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'menuitem',
                      'data-testid': 'registry-restart-app',
                      onClick: handleRestartApp,
                      className: 'bbreg-btn bbreg-btn-ghost',
                      style: { ...headerButtonStyle, justifyContent: 'flex-start', border: 'none' },
                    },
                    t('registry:registry.restartApp'),
                  ),
                ),
              )
            : null,
        ),
      ),
    ),
    actionError
      ? h(
          'div',
          { 'data-testid': 'registry-action-banner-error', style: ERROR_BANNER },
          actionError,
        )
      : null,
    actionNotice
      ? h(
          'div',
          {
            'data-testid': 'registry-action-banner-notice',
            style: {
              ...ERROR_BANNER,
              border: `1px solid ${TONE.success}`,
              color: TONE.success,
            },
          },
          actionNotice,
        )
      : null,
    // Search + filters (one wrapping row; testids live on the controls). The
    // diagnostics view is a report, not a catalog — it gets no filter bar.
    view === 'diagnostics'
      ? null
      : h(RegistryFilterBar, {
      ctx,
      query,
      onQueryChange: setQuery,
      showThirdParty: !officialOnly,
      onShowThirdPartyChange: (show) => setOfficialOnly(!show),
      sortBy,
      onSortByChange: handleSortByChange,
      sortDir,
      onSortDirChange: setSortDir,
      category,
      onCategoryChange: setCategory,
      categories,
      showCategoryFilter: view === 'plugin',
      showBrowseControls: true,
      showThirdPartyFilter: isKindView,
    }),
    // Tabs: the four kinds, then a hairline divider, then the curated views
    // and the diagnostics report.
    h(
      'div',
      { style: tabsRowStyle },
      KIND_TABS.map((kind) =>
        kindTabButton(
          kind,
          kindTabLabel(t, kind),
          String(counts.get(kind) ?? 0),
          view === kind,
          () => setView(kind),
        ),
      ),
      h('span', { key: 'tab-divider', 'data-testid': 'registry-tab-divider', style: TAB_DIVIDER }),
      // The curated tabs badge only when there is something to count — an
      // empty favorites list needs no "0" shouted at the user.
      kindTabButton(
        'favorites',
        t('registry:registry.favorites'),
        favorites.size > 0 ? String(favorites.size) : null,
        view === 'favorites',
        () => setView('favorites'),
      ),
      kindTabButton(
        'installed',
        t('registry:registry.installed'),
        installedCount > 0 ? String(installedCount) : null,
        view === 'installed',
        () => setView('installed'),
      ),
      kindTabButton(
        'diagnostics',
        t('registry:registryDiagnostics.diagnostics'),
        null,
        view === 'diagnostics',
        () => setView('diagnostics'),
      ),
    ),
    // Body
    view === 'diagnostics'
      ? h(RegistryDiagnosticsScreen, { ctx, onNavigateToEntry: handleNavigateToEntry })
      : loading
      ? // Card-shaped skeleton grid in the real cards' own grid.
        h('div', { 'data-testid': 'registry-loading' }, h(RegistrySkeletonGrid, { count: 6 }))
      : serviceMissing
        ? h(
            'div',
            { 'data-testid': 'registry-service-missing' },
            h(RegistryEmptyState, {
              icon: 'alert',
              title: t('registry:registry.registryServiceNotLoaded'),
              description: t('registry:registry.cannotBrowseCommunityContentTry'),
            }),
          )
        : loadError
          ? h(
              'div',
              { 'data-testid': 'registry-load-error', style: { ...ERROR_BANNER, display: 'flex', alignItems: 'center', gap: 8 } },
              tablerIcon('alert', { size: 14 }),
              t('registry:registry.failedToLoadTheRegistry', { loadError }),
            )
          : visible.length === 0
            ? view === 'favorites' && !query
              ? h(
                  'div',
                  { 'data-testid': 'registry-favorites-empty' },
                  h(RegistryEmptyState, {
                    icon: 'heart',
                    title: t('registry:registry.noFavoritesYet'),
                    description: t('registry:registry.useTheHeartButtonOn'),
                  }),
                )
              : view === 'installed' && !query
                ? h(
                    'div',
                    { 'data-testid': 'registry-installed-empty' },
                    h(RegistryEmptyState, {
                      icon: 'download',
                      title: t('registry:registry.nothingInstalledYet'),
                      description: t('registry:registry.installMusicSourcesLyricSources'),
                    }),
                  )
                : h(
                    'div',
                    { 'data-testid': 'registry-empty' },
                    h(RegistryEmptyState, {
                      icon: query ? 'search' : 'adjustments',
                      title: query ? t('registry:registry.noMatchingContent') : t('registry:registry.nothingInThisCategoryYet'),
                      description: query ? t('registry:registry.tryADifferentKeyword') : undefined,
                    }),
                  )
            : h(
                'div',
                { style: CARD_GRID },
                visible.map((entry) => {
                  const actionState = actionStates.get(entry.id) ?? { state: 'install' as const }
                  const blocked = minAppVersionBlock(entry, appVersion)
                  const lock = lockRecords.get(entry.id)
                  const isInstalled = actionState.state === 'installed' || actionState.state === 'update'
                  const onInstalledTab = view === 'installed' && isInstalled
                  const uninstallBase = uninstallFor(entry)
                  const pluginInfo =
                    entry.kind === 'plugin'
                      ? pluginMap.get(entry.id) ?? pluginMap.get(entry.id.replace(/^@[^/]+\//, ''))
                      : undefined
                  const lyricInfo = entry.kind === 'lyric-source' ? lyricSourceMap.get(entry.id) : undefined
                  const isTheme = entry.kind === 'theme'
                  const isPlugin = entry.kind === 'plugin'
                  const isLyric = entry.kind === 'lyric-source'
                  const isExtension = isPlugin || isLyric || isTheme

                  const canUninstall = uninstallBase && (onInstalledTab || (isInstalled && isExtension))

                  return h(RegistryEntryCard, {
                    key: entry.id,
                    ctx,
                    entry,
                    actionState,
                    blockedReason: blocked,
                    busy: busyEntryId === entry.id,
                    stats: statsFor(entry),
                    favorite: isFavorite(entry.id),
                    onToggleFavorite: () => toggleFavorite(entry.id),
                    itemEnabled: isPlugin
                      ? (pluginInfo?.enabled ?? true)
                      : isLyric
                        ? (lyricInfo?.enabled ?? true)
                        : undefined,
                    onToggleEnabled: isPlugin
                      ? () => void handleTogglePluginEnabled(pluginInfo?.id ?? entry.id, pluginInfo?.enabled ?? true)
                      : isLyric
                        ? () => void handleToggleLyricSourceEnabled(lyricInfo?.id ?? entry.id, lyricInfo?.enabled ?? true)
                        : undefined,
                    themeActive: isTheme ? themeState.currentId === entry.id : undefined,
                    onApplyTheme: isTheme ? () => void handleApplyTheme(entry.id) : undefined,
                    pluginEnabled: pluginInfo?.enabled ?? true,
                    onTogglePluginEnabled: () =>
                      void handleTogglePluginEnabled(pluginInfo?.id ?? entry.id, pluginInfo?.enabled ?? true),
                    installedMeta: onInstalledTab
                      ? {
                          installedVersion: actionState.installedVersion,
                          commit: lock?.commit,
                          installedAt: lock?.installedAt,
                        }
                      : undefined,
                    uninstall: canUninstall
                      ? {
                          ...uninstallBase,
                          busy: uninstallingId === entry.id,
                        }
                      : undefined,
                    onAction: () =>
                      void beginInstall(
                        entry,
                        actionState.state === 'update' ? 'update' : 'install',
                      ),
                  })
                }),
              ),
    uninstallError
      ? h('div', { 'data-testid': 'registry-uninstall-error', style: ERROR_BANNER }, uninstallError)
      : null,
    confirmError && !confirm
      ? h('div', { 'data-testid': 'registry-action-error', style: ERROR_BANNER }, confirmError)
      : null,
    confirm
      ? h(InstallConfirmDialog, {
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
      ? h(RegistryTaskDrawer, {
          ctx,
          tasks,
          canClear,
          onClearFinished: clearFinished,
          onClose: () => setTasksOpen(false),
        })
      : null,
    localPreview
      ? h(LocalImportConfirmDialog, {
          ctx,
          preview: localPreview,
          busy: localBusy,
          error: localError,
          onConfirm: () => void confirmLocalImport(),
          onClose: () => {
            setLocalPreview(undefined)
            setLocalPackageBase64(undefined)
            setLocalError(null)
          },
        })
      : null,
  )
}
