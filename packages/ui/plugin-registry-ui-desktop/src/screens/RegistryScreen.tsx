/**
 * The registry screen ("发现 / 注册表"): the community index, browsable by
 * kind and searchable, with install/update actions per entry.
 *
 * All state lives in services; this component holds view state only. The
 * install flow is the two-step contract the service documents —
 * `fetchEntryDetails` first, then `install(entry, { confirmed: true })` —
 * with the confirmation dialog (`InstallConfirmDialog`) in between, because
 * a download host is a security red line the user must see before confirming.
 */

import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  RegistryEntry,
  RegistryEntryDetails,
  RegistryEntryKind,
  RegistryIndex,
} from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useAppVersion, useRegistryActionStates } from '../hooks/use-registry.js'
import { minAppVersionBlock } from '../hooks/install-state.js'
import { InstallConfirmDialog } from '../components/InstallConfirmDialog.js'
import { RegistryEntryCard } from '../components/RegistryEntryCard.js'

/** The slice of `ctx.contentRegistry` the screen reads. Read structurally, never by import. */
interface RegistryServiceLike {
  getIndex(force?: boolean): Promise<RegistryIndex>
  fetchEntryDetails(entry: RegistryEntry): Promise<RegistryEntryDetails>
  install(entry: RegistryEntry, opts?: { confirmed?: boolean }): Promise<void>
}

const KIND_TABS: readonly { kind: RegistryEntryKind; label: string }[] = [
  { kind: 'music-source', label: '音乐源' },
  { kind: 'lyric-source', label: '歌词源' },
  { kind: 'theme', label: '界面主题' },
  { kind: 'plugin', label: '插件' },
]

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

const pillBase = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 16px',
  borderRadius: 999,
  fontSize: 13,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  border: '1px solid transparent',
} as const

const searchInputStyle = {
  flex: 1,
  minWidth: 160,
  maxWidth: 420,
  padding: '7px 14px',
  borderRadius: 999,
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
  background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
  color: 'var(--text-primary, #F5F7FF)',
  fontSize: 13,
  outline: 'none',
} as const

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

  const [kind, setKind] = useState<RegistryEntryKind>('music-source')
  const [query, setQuery] = useState('')
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

  const indexRef = useRef<RegistryIndex | undefined>(undefined)
  indexRef.current = index

  const entries = useMemo(() => index?.entries ?? [], [index])
  const actionStates = useRegistryActionStates(ctx, entries)
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

  const confirmInstall = useCallback(async () => {
    const registry = getRegistry()
    if (!registry || !confirm) return
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      await registry.install(confirm.details.entry, { confirmed: true })
      setConfirm(undefined)
      // The owning services fire their changed events, which re-derives the
      // action states; this nonce is only a backstop for a kind whose event
      // has not landed yet.
      setIndex((prev) => (prev ? { ...prev } : prev))
    } catch (err) {
      setConfirmError(errorMessage(err))
    } finally {
      setConfirmBusy(false)
    }
  }, [confirm, getRegistry])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (entry.kind !== kind) return false
      if (!needle) return true
      return (
        entry.name.toLowerCase().includes(needle) ||
        (entry.author?.toLowerCase().includes(needle) ?? false) ||
        (entry.description?.toLowerCase().includes(needle) ?? false)
      )
    })
  }, [entries, kind, query])

  const counts = useMemo(() => {
    const map = new Map<RegistryEntryKind, number>()
    for (const entry of entries) {
      map.set(entry.kind, (map.get(entry.kind) ?? 0) + 1)
    }
    return map
  }, [entries])

  return h(
    'div',
    { style: screenStyle, 'data-testid': 'registry-screen' },
    // Header
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 200 } },
        h('h1', { style: { margin: 0, fontSize: 20, fontWeight: 700 } }, '发现'),
        h(
          'div',
          { style: { fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
          '浏览社区音乐源、歌词源、界面主题与插件，一键安装或更新',
        ),
      ),
      offlineCache
        ? h(
            'span',
            {
              'data-testid': 'registry-offline-hint',
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                border: '1px solid var(--color-warning, #F59E0B)',
                color: 'var(--color-warning, #F59E0B)',
              },
            },
            tablerIcon('history', { size: 12 }),
            '离线缓存',
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'registry-refresh',
          onClick: () => void readIndex(true),
          disabled: refreshing || loading,
          style: {
            ...pillBase,
            background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
            borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.12))',
            color: 'var(--text-primary, #F5F7FF)',
            opacity: refreshing || loading ? 0.6 : 1,
          },
        },
        refreshing ? '刷新中…' : '刷新',
      ),
    ),
    // Search
    h('input', {
      type: 'text',
      'data-testid': 'registry-search',
      placeholder: '搜索名称、作者或描述…',
      value: query,
      onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
      style: searchInputStyle,
    }),
    // Tabs
    h(
      'div',
      { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
      KIND_TABS.map((tab) => {
        const active = kind === tab.kind
        return h(
          'button',
          {
            key: tab.kind,
            type: 'button',
            'data-testid': `registry-tab-${tab.kind}`,
            onClick: () => setKind(tab.kind),
            style: {
              ...pillBase,
              background: active
                ? 'var(--surface-selected, rgba(95, 135, 255, 0.15))'
                : 'var(--surface-1, rgba(255, 255, 255, 0.04))',
              borderColor: active
                ? 'var(--color-primary, #5F87FF)'
                : 'var(--border-subtle, rgba(255, 255, 255, 0.08))',
              color: active ? 'var(--text-primary, #F5F7FF)' : 'var(--text-secondary, #C5CAD8)',
              fontWeight: active ? 600 : 400,
            },
          },
          tab.label,
          h('span', { style: { fontSize: 11, opacity: 0.8 } }, String(counts.get(tab.kind) ?? 0)),
        )
      }),
    ),
    // Body
    loading
      ? h(
          'div',
          { 'data-testid': 'registry-loading', style: { padding: '48px 0', textAlign: 'center', color: 'var(--text-tertiary, #8B95B0)', fontSize: 13 } },
          '正在加载注册表…',
        )
      : serviceMissing
        ? h(
            'div',
            { 'data-testid': 'registry-service-missing', style: { padding: '48px 0', textAlign: 'center', color: 'var(--text-tertiary, #8B95B0)', fontSize: 13 } },
            '注册表服务未加载，无法浏览社区内容。',
          )
        : loadError
          ? h(
              'div',
              { 'data-testid': 'registry-load-error', style: { padding: '48px 0', textAlign: 'center', color: 'var(--color-error, #F43F5E)', fontSize: 13 } },
              `注册表加载失败：${loadError}`,
            )
          : visible.length === 0
            ? h(
                'div',
                { 'data-testid': 'registry-empty', style: { padding: '48px 0', textAlign: 'center', color: 'var(--text-tertiary, #8B95B0)', fontSize: 13 } },
                query ? '没有匹配的内容' : '该分类下暂无内容',
              )
            : h(
                'div',
                {
                  style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 12,
                    alignItems: 'stretch',
                  },
                },
                visible.map((entry) => {
                  const actionState = actionStates.get(entry.id) ?? { state: 'install' as const }
                  const blocked = minAppVersionBlock(entry, appVersion)
                  return h(RegistryEntryCard, {
                    key: entry.id,
                    entry,
                    actionState,
                    blockedReason: blocked,
                    busy: busyEntryId === entry.id,
                    onAction: () =>
                      void beginInstall(
                        entry,
                        actionState.state === 'update' ? 'update' : 'install',
                      ),
                  })
                }),
              ),
    confirmError && !confirm
      ? h(
          'div',
          {
            'data-testid': 'registry-action-error',
            style: {
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--color-error, #F43F5E)',
              color: 'var(--color-error, #F43F5E)',
              fontSize: 13,
            },
          },
          confirmError,
        )
      : null,
    confirm
      ? h(InstallConfirmDialog, {
          details: confirm.details,
          action: confirm.action,
          busy: confirmBusy,
          error: confirmError,
          onConfirm: () => void confirmInstall(),
          onClose: () => {
            setConfirm(undefined)
            setConfirmError(null)
          },
        })
      : null,
  )
}
