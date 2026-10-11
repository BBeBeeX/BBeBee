/**
 * The registry screen ("发现 / 注册表"): the community index, browsable by
 * kind, searchable, filterable (third-party toggle, plugin categories) and
 * sortable (name, stars, contributors), with install/update actions per entry
 * — plus two curated views beside the kind tabs: 收藏 (the user's favorited
 * entries, persisted in localStorage) and 已安装 (everything the installed
 * content services report as installed or updateable, with lock-file
 * metadata and uninstall for the kinds whose services have a remove API) —
 * and a 诊断 tab rendering the service's health report (lock conflicts,
 * audit risks, warnings, install summary) assembled from real state.
 *
 * The header also hosts the 任务 (task center) button: a badge counts the
 * operations currently running, and the drawer lists every tracked
 * install/update — stage, progress, error, start time — straight from the
 * service's `'registry/tasks-changed'` snapshots. No task state machine lives
 * in the view.
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
  RegistryEntry,
  RegistryEntryDetails,
  RegistryEntryKind,
  RegistryIndex,
  SourceRecord,
} from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useAppVersion, useRegistryActionStates } from '../hooks/use-registry.js'
import { useFavorites } from '../hooks/use-favorites.js'
import { useRegistryLockRecords } from '../hooks/use-lock-records.js'
import { useRegistryTasks } from '../hooks/use-registry-tasks.js'
import { useRepoMetadata } from '../hooks/use-repo-metadata.js'
import { isBuiltinEntry, minAppVersionBlock } from '../hooks/install-state.js'
import { InstallConfirmDialog } from '../components/InstallConfirmDialog.js'
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
}

/** Structural slices of the services that can remove installed content. */
interface SourcesRemoveLike {
  readonly sources: readonly SourceRecord[]
  remove(id: string, opts?: { forgetCatalogue?: boolean }): Promise<void>
}
interface LyricSourcesRemoveLike {
  removeSource(id: string): Promise<boolean>
}
interface ThemeRemoveLike {
  removeTheme(themeId: string): boolean
}

const KIND_TABS: readonly { kind: RegistryEntryKind; label: string }[] = [
  { kind: 'music-source', label: '音乐源' },
  { kind: 'lyric-source', label: '歌词源' },
  { kind: 'theme', label: '界面主题' },
  { kind: 'plugin', label: '插件' },
]

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
  // curated tabs (收藏 / 已安装) hide those controls and keep the search box.
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

  const [uninstallingId, setUninstallingId] = useState<string | undefined>(undefined)
  const [uninstallError, setUninstallError] = useState<string | null>(null)
  // Bumped when this screen itself changed installed content: the owning
  // service has already changed, but its change event may not have landed
  // (lyric-sources removal emits none), and reshuffling the index object
  // cannot re-derive the states — the entries array inside it keeps its
  // identity. The bump forces one re-derivation against the live services.
  const [contentNonce, setContentNonce] = useState(0)

  const indexRef = useRef<RegistryIndex | undefined>(undefined)
  indexRef.current = index

  const entries = useMemo(() => index?.entries ?? [], [index])
  const actionStates = useRegistryActionStates(ctx, entries, contentNonce)
  const { favorites, toggle: toggleFavorite, isFavorite } = useFavorites()
  const lockRecords = useRegistryLockRecords(ctx, view === 'installed')
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
        // "离线缓存" instead of passing stale data off as live.
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
          // Match the same way the action state does — by the document's
          // `sourceUrl` — then remove by the record's own id. The default
          // remove keeps the catalogue rows; this is uninstall, not a purge.
          const sources = serviceOf<SourcesRemoveLike>(ctx, 'sources')
          const record = entry.sourceUrl
            ? sources?.sources.find((r) => r.sourceUrl === entry.sourceUrl)
            : undefined
          if (!sources || !record) throw new Error('未找到对应的已安装音乐源')
          await sources.remove(record.id)
        } else if (entry.kind === 'lyric-source') {
          const removed = await serviceOf<LyricSourcesRemoveLike>(ctx, 'lyricSources')?.removeSource(entry.id)
          if (!removed) throw new Error('歌词源不存在或已被移除')
        } else if (entry.kind === 'theme') {
          const removed = serviceOf<ThemeRemoveLike>(ctx, 'theme')?.removeTheme(entry.id)
          if (!removed) throw new Error('该主题无法移除（内置主题受保护）')
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
    [ctx],
  )

  /**
   * The uninstall affordance of the installed tab, per entry.
   *
   * Kinds whose owning service exposes a remove API (music sources, lyric
   * sources, themes) get the two-step button; plugins have none (the manager
   * only enables or disables), so they get the "manage it in settings" note;
   * built-in content (today: the lrclib lyric source, re-added at boot) gets
   * no uninstall affordance at all.
   */
  const uninstallFor = useCallback(
    (entry: RegistryEntry): { available: boolean; onConfirm: () => void } | undefined => {
      if (isBuiltinEntry(entry)) return undefined
      return {
        available: entry.kind !== 'plugin',
        onConfirm: () => void handleUninstall(entry),
      }
    },
    [handleUninstall],
  )

  // Filtered first (the pre-sort set is what the stats hook walks), then
  // sorted. Stats are only requested when a numeric sort is active on a kind
  // tab — a plain name-sorted view never touches the network, and the curated
  // tabs (which hide the sort control) never do either.
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

  const statsEnabled = isKindView && sortBy !== 'name'
  const repoStats = useRepoMetadata(ctx, filtered, statsEnabled)

  const visible = useMemo(() => {
    // The curated tabs keep the index order — there is no sort control to
    // honor there.
    if (!isKindView) return filtered
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
      return sortBy === 'stars' ? stats?.stars : stats?.contributors
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
  }, [filtered, isKindView, sortBy, sortDir, repoStats])

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
    (entry: RegistryEntry): { stars?: number; contributors?: number } | undefined => {
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

  // Diagnostics "查看" jump: land on the entry's kind tab with the entry name
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
        h('h1', { style: { margin: 0, fontSize: 20, fontWeight: 700 } }, '发现'),
        h(
          'div',
          { style: { fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
          '浏览社区音乐源、歌词源、界面主题与插件，一键安装或更新',
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
              '离线缓存',
            )
          : null,
        // The task-center button sits between the offline hint and the refresh
        // button: the badge counts running tasks only, so an abandoned
        // "等待确认" record never keeps the number lit forever.
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'registry-tasks-button',
            onClick: () => setTasksOpen(true),
            'aria-label': runningCount > 0 ? `任务（${runningCount} 个进行中）` : '任务',
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
          refreshing ? '刷新中…' : '刷新',
        ),
      ),
    ),
    // Search + filters (one wrapping row; testids live on the controls). The
    // diagnostics view is a report, not a catalog — it gets no filter bar.
    view === 'diagnostics'
      ? null
      : h(RegistryFilterBar, {
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
      showBrowseControls: isKindView,
    }),
    // Tabs: the four kinds, then a hairline divider, then the curated views
    // and the diagnostics report.
    h(
      'div',
      { style: tabsRowStyle },
      KIND_TABS.map((tab) =>
        kindTabButton(
          tab.kind,
          tab.label,
          String(counts.get(tab.kind) ?? 0),
          view === tab.kind,
          () => setView(tab.kind),
        ),
      ),
      h('span', { key: 'tab-divider', 'data-testid': 'registry-tab-divider', style: TAB_DIVIDER }),
      // The curated tabs badge only when there is something to count — an
      // empty favorites list needs no "0" shouted at the user.
      kindTabButton(
        'favorites',
        '收藏',
        favorites.size > 0 ? String(favorites.size) : null,
        view === 'favorites',
        () => setView('favorites'),
      ),
      kindTabButton(
        'installed',
        '已安装',
        installedCount > 0 ? String(installedCount) : null,
        view === 'installed',
        () => setView('installed'),
      ),
      kindTabButton(
        'diagnostics',
        '诊断',
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
              title: '注册表服务未加载',
              description: '无法浏览社区内容，请稍后重试',
            }),
          )
        : loadError
          ? h(
              'div',
              { 'data-testid': 'registry-load-error', style: { ...ERROR_BANNER, display: 'flex', alignItems: 'center', gap: 8 } },
              tablerIcon('alert', { size: 14 }),
              `注册表加载失败：${loadError}`,
            )
          : visible.length === 0
            ? view === 'favorites' && !query
              ? h(
                  'div',
                  { 'data-testid': 'registry-favorites-empty' },
                  h(RegistryEmptyState, {
                    icon: 'heart',
                    title: '还没有收藏的条目',
                    description: '点击卡片上的收藏按钮把常用的内容留在这里',
                  }),
                )
              : view === 'installed' && !query
                ? h(
                    'div',
                    { 'data-testid': 'registry-installed-empty' },
                    h(RegistryEmptyState, {
                      icon: 'download',
                      title: '还没有已安装的内容',
                      description: '去各个分类页安装感兴趣的音乐源、歌词源、主题或插件吧',
                    }),
                  )
                : h(
                    'div',
                    { 'data-testid': 'registry-empty' },
                    h(RegistryEmptyState, {
                      icon: query ? 'search' : 'adjustments',
                      title: query ? '没有匹配的内容' : '该分类下暂无内容',
                      description: query ? '换个关键词，或清除筛选条件后再试试' : undefined,
                    }),
                  )
            : h(
                'div',
                { style: CARD_GRID },
                visible.map((entry) => {
                  const actionState = actionStates.get(entry.id) ?? { state: 'install' as const }
                  const blocked = minAppVersionBlock(entry, appVersion)
                  const lock = lockRecords.get(entry.id)
                  const onInstalledTab = view === 'installed' && actionState.state !== 'install'
                  const uninstallBase = uninstallFor(entry)
                  return h(RegistryEntryCard, {
                    key: entry.id,
                    entry,
                    actionState,
                    blockedReason: blocked,
                    busy: busyEntryId === entry.id,
                    stats: statsFor(entry),
                    favorite: isFavorite(entry.id),
                    onToggleFavorite: () => toggleFavorite(entry.id),
                    installedMeta: onInstalledTab
                      ? {
                          installedVersion: actionState.installedVersion,
                          commit: lock?.commit,
                          installedAt: lock?.installedAt,
                        }
                      : undefined,
                    uninstall:
                      onInstalledTab && uninstallBase
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
          tasks,
          canClear,
          onClearFinished: clearFinished,
          onClose: () => setTasksOpen(false),
        })
      : null,
  )
}
