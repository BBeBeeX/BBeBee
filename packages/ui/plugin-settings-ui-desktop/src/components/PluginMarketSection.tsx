import { Button, EmptyState, Sheet, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import type {
  InstallPlan,
  PluginInfo,
  PluginManagerService,
  PluginUpdateInfo,
  RegistryPluginEntry,
} from '@BBeBee/protocol'
import { PluginSearchBox } from './PluginSearchBox.js'
import { PluginMarketDetail } from './PluginMarketDetail.js'
import { PluginMarketInstallConfirm } from './PluginMarketInstallConfirm.js'
import { isOfficialEntry } from '../official.js'

type BusyKind = 'install' | 'update' | 'uninstall'

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const errCode = (err: unknown): string | undefined => {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

export interface PluginMarketSectionProps {
  ctx: Context
}

/**
 * Plugin Market — browse the community registry index, install from npm,
 * update and uninstall. Mounted at the top of the plugins settings tab.
 *
 * All registry/npm work goes through `ctx['plugin-manager']`; this component
 * only renders state and forwards user intent. Installed-plugin state is read
 * from `plugin-manager.list()` so installs/uninstalls refresh automatically.
 */
export function PluginMarketSection({ ctx }: PluginMarketSectionProps): ReactElement {
  const { t } = useI18n(ctx)
  const [expanded, setExpanded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [entries, setEntries] = useState<readonly RegistryPluginEntry[] | null>(null)
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [entriesError, setEntriesError] = useState<string | null>(null)
  const [updates, setUpdates] = useState<readonly PluginUpdateInfo[]>([])
  const [updatesChecking, setUpdatesChecking] = useState(false)
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState<Readonly<Record<string, BusyKind>>>({})
  const [opError, setOpError] = useState<string | null>(null)
  const [detailEntry, setDetailEntry] = useState<RegistryPluginEntry | null>(null)
  const [planState, setPlanState] = useState<{ entry: RegistryPluginEntry; plan: InstallPlan } | null>(null)
  const [planConfirming, setPlanConfirming] = useState(false)
  const [majorUpdate, setMajorUpdate] = useState<{ id: string; latest: string; installed: string } | null>(null)
  const [unreviewedUpdate, setUnreviewedUpdate] = useState<{ id: string; latest: string; installed: string } | null>(null)
  const [unreviewedAck, setUnreviewedAck] = useState(false)
  const [uninstallTarget, setUninstallTarget] = useState<RegistryPluginEntry | null>(null)

  const installedPlugins = useServiceState<readonly PluginInfo[]>(
    ctx,
    ['plugin-manager/changed', 'plugin/loaded', 'plugin/unloaded'],
    () => {
      const pm = serviceOf<PluginManagerService>(ctx, 'plugin-manager')
      return pm?.list() ?? []
    },
  )

  const installedById = useMemo(() => {
    const map = new Map<string, PluginInfo>()
    for (const p of installedPlugins) map.set(p.id, p)
    return map
  }, [installedPlugins])

  const updateById = useMemo(() => {
    const map = new Map<string, PluginUpdateInfo>()
    for (const u of updates) map.set(u.id, u)
    return map
  }, [updates])

  const pm = () => serviceOf<PluginManagerService>(ctx, 'plugin-manager')

  const loadEntries = useCallback(
    async (force = false) => {
      const manager = pm()
      if (!manager) return
      setEntriesLoading(true)
      setEntriesError(null)
      try {
        setEntries(await manager.browseRegistry(force || undefined))
      } catch (err) {
        setEntriesError(errMsg(err))
        setEntries(null)
      } finally {
        setEntriesLoading(false)
      }
    },
    [ctx],
  )

  const runCheckUpdates = async (force = false) => {
    const manager = pm()
    if (!manager) return
    setUpdatesChecking(true)
    try {
      setUpdates(await manager.checkUpdates(force || undefined))
      setLastCheckedAt(new Date().toLocaleString())
    } catch (err) {
      setOpError(t('settings:pluginMarket.updateFailed', { error: errMsg(err) }))
    } finally {
      setUpdatesChecking(false)
    }
  }

  // Load lazily on first expand so the settings page doesn't pay for a
  // network round-trip the user may never need. The update check also runs
  // once here so the header badge can actually show available updates.
  const didAutoCheck = useRef(false)
  useEffect(() => {
    if (!expanded) return
    if (entries === null && !entriesLoading && entriesError === null) {
      void loadEntries()
    }
    if (!didAutoCheck.current) {
      didAutoCheck.current = true
      void runCheckUpdates()
    }
  }, [expanded])

  const handleToggleExpanded = () => {
    setExpanded((prev) => !prev)
  }

  const filteredEntries = useMemo(() => {
    if (!entries) return []
    const q = searchQuery.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) =>
      [e.name, e.id, e.description, e.author].some((f) => f.toLowerCase().includes(q)),
    )
  }, [entries, searchQuery])

  const setBusyFor = (id: string, kind: BusyKind | null) => {
    setBusy((prev) => {
      if (kind === null) {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: kind }
    })
  }

  const handleInstall = async (entry: RegistryPluginEntry) => {
    const manager = pm()
    if (!manager || busy[entry.id]) return
    setOpError(null)
    setBusyFor(entry.id, 'install')
    try {
      const plan = await manager.resolveInstallPlan(entry.id)
      setPlanState({ entry, plan })
    } catch (err) {
      setOpError(t('settings:pluginMarket.installFailed', { error: errMsg(err) }))
    } finally {
      setBusyFor(entry.id, null)
    }
  }

  const handleConfirmInstall = async () => {
    if (!planState) return
    const manager = pm()
    if (!manager) return
    setPlanConfirming(true)
    try {
      // Execute against the very plan the user is looking at: if the
      // resolution moved since the confirm screen opened (a new version
      // was published in between), the manager refuses with PLAN_CHANGED
      // instead of installing an unconfirmed closure.
      await manager.installPlugin(planState.entry.id, undefined, planState.plan)
      setPlanState(null)
    } catch (err) {
      setOpError(t('settings:pluginMarket.installFailed', { error: errMsg(err) }))
    } finally {
      setPlanConfirming(false)
    }
  }

  const handleUpdate = async (id: string) => {
    const manager = pm()
    if (!manager || busy[id]) return
    setOpError(null)
    setBusyFor(id, 'update')
    try {
      await manager.updatePlugin(id)
    } catch (err) {
      if (errCode(err) === 'MAJOR_UPDATE_NEEDS_CONFIRM') {
        const info = updateById.get(id)
        setMajorUpdate({ id, latest: info?.latest ?? '', installed: info?.installed ?? '' })
      } else {
        setOpError(t('settings:pluginMarket.updateFailed', { error: errMsg(err) }))
      }
    } finally {
      setBusyFor(id, null)
    }
  }

  const handleUpdateUnreviewed = (id: string) => {
    const info = updateById.get(id)
    if (!info) return
    setUnreviewedAck(false)
    setUnreviewedUpdate({ id, latest: info.latest, installed: info.installed })
  }

  const handleConfirmUnreviewedUpdate = async () => {
    if (!unreviewedUpdate || !unreviewedAck) return
    const manager = pm()
    if (!manager) return
    setBusyFor(unreviewedUpdate.id, 'update')
    try {
      // The exact version IS the unreviewed build the user just
      // acknowledged; naming it is what lets resolution past the pin.
      await manager.updatePlugin(unreviewedUpdate.id, unreviewedUpdate.latest)
      setUnreviewedUpdate(null)
    } catch (err) {
      setOpError(t('settings:pluginMarket.updateFailed', { error: errMsg(err) }))
    } finally {
      setBusyFor(unreviewedUpdate.id, null)
    }
  }

  const handleConfirmMajorUpdate = async () => {
    if (!majorUpdate) return
    const manager = pm()
    if (!manager) return
    setBusyFor(majorUpdate.id, 'update')
    try {
      // Explicit version = the user's confirmation for the major bump.
      await manager.updatePlugin(majorUpdate.id, majorUpdate.latest || undefined)
      setMajorUpdate(null)
    } catch (err) {
      setOpError(t('settings:pluginMarket.updateFailed', { error: errMsg(err) }))
    } finally {
      setBusyFor(majorUpdate.id, null)
    }
  }

  const handleConfirmUninstall = async () => {
    if (!uninstallTarget) return
    const manager = pm()
    if (!manager?.uninstall) return
    const id = uninstallTarget.id
    setBusyFor(id, 'uninstall')
    try {
      await manager.uninstall(id)
      setUninstallTarget(null)
    } catch (err) {
      setOpError(t('settings:pluginMarket.uninstallFailed', { error: errMsg(err) }))
    } finally {
      setBusyFor(id, null)
    }
  }

  const uninstallInfo = uninstallTarget ? installedById.get(uninstallTarget.id) : undefined

  return h(
    'div',
    {
      id: 'section-plugin-market',
      'data-testid': 'plugin-market-section',
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        borderRadius: 10,
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
        background: 'rgba(255, 255, 255, 0.02)',
        marginBottom: 16,
        overflow: 'hidden',
      },
    },
    // Header (always visible)
    h(
      'div',
      {
        role: 'button',
        tabIndex: 0,
        'aria-expanded': expanded,
        'aria-label': t('settings:pluginMarket.title'),
        onClick: handleToggleExpanded,
        onKeyDown: (e: { key: string }) => {
          if (e.key === 'Enter' || e.key === ' ') handleToggleExpanded()
        },
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          cursor: 'pointer',
        },
      },
      tablerIcon('compass', { size: 18 }),
      h(
        'div',
        { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 } },
        h(
          'div',
          { style: { fontSize: 14, fontWeight: 600, color: 'var(--bb-text-primary, #F8FAFC)' } },
          t('settings:pluginMarket.title'),
        ),
        h(
          'div',
          { style: { fontSize: 12, color: 'var(--bb-text-secondary, #8E8E93)' } },
          t('settings:pluginMarket.description'),
        ),
      ),
      updates.length > 0
        ? h(
            'span',
            {
              'data-testid': 'market-updates-badge',
              style: {
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 10,
                background: 'var(--bb-state-warn, #F59E0B)',
                color: '#000000',
              },
            },
            t('settings:pluginMarket.updatesAvailable', { count: updates.length }),
          )
        : null,
      tablerIcon(expanded ? 'chevron-up' : 'chevron-down', { size: 16 }),
    ),

    expanded
      ? h(
          'div',
          { style: { padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 } },
          // Toolbar
          h(
            'div',
            { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h(
              'div',
              { style: { flex: 1 } },
              h(PluginSearchBox, {
                ctx,
                value: searchQuery,
                onChange: setSearchQuery,
              }),
            ),
            h(Button, {
              variant: 'secondary',
              disabled: entriesLoading,
              loading: entriesLoading,
              children: t('settings:pluginMarket.refresh'),
              onPress: () => void loadEntries(true),
            }),
            h(Button, {
              variant: 'secondary',
              disabled: updatesChecking,
              loading: updatesChecking,
              children: t('settings:pluginMarket.checkUpdates'),
              onPress: () => void runCheckUpdates(true),
            }),
          ),
          lastCheckedAt
            ? h(
                'div',
                { style: { fontSize: 11, color: 'var(--bb-text-tertiary, #6B7280)' } },
                t('settings:pluginMarket.lastChecked', { time: lastCheckedAt }),
              )
            : null,
          opError
            ? h(
                'div',
                {
                  role: 'alert',
                  style: {
                    fontSize: 12,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: 'rgba(239, 68, 68, 0.12)',
                    color: 'var(--state-error, #EF4444)',
                  },
                },
                opError,
              )
            : null,

          // Body
          entriesLoading
            ? h(
                'div',
                { style: { fontSize: 13, color: 'var(--bb-text-secondary, #8E8E93)', padding: '16px 0' } },
                t('settings:pluginMarket.loading'),
              )
            : entriesError
              ? h(EmptyState, {
                  icon: 'alert',
                  title: t('settings:pluginMarket.loadFailed', { error: entriesError }),
                  description: undefined,
                })
              : entries !== null && filteredEntries.length === 0
                ? h(EmptyState, {
                    icon: 'search',
                    title: t(
                      entries.length === 0
                        ? 'settings:pluginMarket.noEntries'
                        : 'settings:pluginMarket.noResults',
                    ),
                    description: undefined,
                  })
                : filteredEntries.map((entry) =>
                    h(MarketRow, {
                      key: entry.id,
                      ctx,
                      entry,
                      installed: installedById.get(entry.id),
                      update: updateById.get(entry.id),
                      busyKind: busy[entry.id] ?? null,
                      canUninstall: Boolean(pm()?.uninstall),
                      onShowDetails: () => setDetailEntry(entry),
                      onInstall: () => void handleInstall(entry),
                      onUpdate: () => void handleUpdate(entry.id),
                      onUpdateUnreviewed: () => handleUpdateUnreviewed(entry.id),
                      onUninstall: () => setUninstallTarget(entry),
                    }),
                  ),
        )
      : null,

    // Detail sheet
    h(PluginMarketDetail, {
      ctx,
      entry: detailEntry,
      installed: detailEntry ? installedById.get(detailEntry.id) : undefined,
      busyKind: detailEntry ? (busy[detailEntry.id] ?? null) : null,
      onClose: () => setDetailEntry(null),
      onInstall: detailEntry ? () => void handleInstall(detailEntry) : undefined,
    }),

    // Install plan confirm sheet
    planState
      ? h(PluginMarketInstallConfirm, {
          ctx,
          entry: planState.entry,
          plan: planState.plan,
          confirming: planConfirming,
          onClose: () => {
            if (!planConfirming) setPlanState(null)
          },
          onConfirm: () => void handleConfirmInstall(),
        })
      : null,

    // Unreviewed update confirm sheet (audit W5): the newest npm build
    // is beyond the registry's reviewed pin — installing it requires
    // this separate, explicit acknowledgement.
    h(
      Sheet,
      {
        open: unreviewedUpdate !== null,
        onClose: () => setUnreviewedUpdate(null),
        title: t('settings:pluginMarket.unreviewedUpdateTitle'),
        accessibilityLabel: t('settings:pluginMarket.unreviewedUpdateTitle'),
      },
      unreviewedUpdate
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            h(
              'p',
              { style: { margin: 0, fontSize: 13, color: 'var(--bb-text-primary, #F8FAFC)', lineHeight: 1.5 } },
              t('settings:pluginMarket.unreviewedUpdateDesc', {
                id: unreviewedUpdate.id,
                latest: unreviewedUpdate.latest,
                installed: unreviewedUpdate.installed,
              }),
            ),
            h(
              'label',
              {
                style: {
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--bb-text-primary, #F8FAFC)',
                  lineHeight: 1.5,
                },
              },
              h('input', {
                type: 'checkbox',
                'data-testid': 'market-unreviewed-ack',
                checked: unreviewedAck,
                onChange: (e: { target: { checked: boolean } }) => setUnreviewedAck(e.target.checked),
                style: { marginTop: 2 },
              }),
              h('span', null, t('settings:pluginMarket.unreviewedAck')),
            ),
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
              h(Button, {
                variant: 'secondary',
                children: t('app:common.cancel'),
                onPress: () => setUnreviewedUpdate(null),
              }),
              h(Button, {
                variant: 'primary',
                disabled: !unreviewedAck,
                loading: busy[unreviewedUpdate.id] === 'update',
                children: t('settings:pluginMarket.confirmUpdate'),
                onPress: () => void handleConfirmUnreviewedUpdate(),
              }),
            ),
          )
        : null,
    ),

    // Major update confirm sheet
    h(
      Sheet,
      {
        open: majorUpdate !== null,
        onClose: () => setMajorUpdate(null),
        title: t('settings:pluginMarket.majorUpdateTitle'),
        accessibilityLabel: t('settings:pluginMarket.majorUpdateTitle'),
      },
      majorUpdate
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            h(
              'p',
              { style: { margin: 0, fontSize: 13, color: 'var(--bb-text-primary, #F8FAFC)', lineHeight: 1.5 } },
              t('settings:pluginMarket.majorUpdateDesc', {
                id: majorUpdate.id,
                latest: majorUpdate.latest,
                installed: majorUpdate.installed,
              }),
            ),
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
              h(Button, {
                variant: 'secondary',
                children: t('app:common.cancel'),
                onPress: () => setMajorUpdate(null),
              }),
              h(Button, {
                variant: 'primary',
                loading: busy[majorUpdate.id] === 'update',
                children: t('settings:pluginMarket.confirmUpdate'),
                onPress: () => void handleConfirmMajorUpdate(),
              }),
            ),
          )
        : null,
    ),

    // Uninstall confirm sheet
    h(
      Sheet,
      {
        open: uninstallTarget !== null,
        onClose: () => setUninstallTarget(null),
        title: t('settings:pluginMarket.uninstallConfirmTitle'),
        accessibilityLabel: t('settings:pluginMarket.uninstallConfirmTitle'),
      },
      uninstallTarget
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            h(
              'p',
              { style: { margin: 0, fontSize: 13, color: 'var(--bb-text-primary, #F8FAFC)', lineHeight: 1.5 } },
              t('settings:pluginMarket.uninstallConfirmDesc', {
                displayName: uninstallTarget.name,
              }),
            ),
            uninstallInfo && uninstallInfo.dependents.length > 0
              ? h(
                  'p',
                  {
                    style: {
                      margin: 0,
                      fontSize: 12,
                      color: 'var(--bb-state-warn, var(--warning, #F59E0B))',
                      lineHeight: 1.4,
                    },
                  },
                  t('settings:pluginMarket.blockedByDependents', {
                    dependents: uninstallInfo.dependents.join(', '),
                  }),
                )
              : null,
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
              h(Button, {
                variant: 'secondary',
                children: t('app:common.cancel'),
                onPress: () => setUninstallTarget(null),
              }),
              h(Button, {
                variant: 'primary',
                loading: busy[uninstallTarget.id] === 'uninstall',
                children: t('settings:pluginMarket.confirmUninstall'),
                onPress: () => void handleConfirmUninstall(),
              }),
            ),
          )
        : null,
    ),
  )
}

interface MarketRowProps {
  ctx: Context
  entry: RegistryPluginEntry
  installed?: PluginInfo
  update?: PluginUpdateInfo
  busyKind: BusyKind | null
  canUninstall: boolean
  onShowDetails: () => void
  onInstall: () => void
  onUpdate: () => void
  onUpdateUnreviewed: () => void
  onUninstall: () => void
}

function MarketRow({
  ctx,
  entry,
  installed,
  update,
  busyKind,
  canUninstall,
  onShowDetails,
  onInstall,
  onUpdate,
  onUpdateUnreviewed,
  onUninstall,
}: MarketRowProps): ReactElement {
  const { t } = useI18n(ctx)
  const busy = busyKind !== null
  return h(
    'div',
    {
      'data-testid': `market-row-${entry.id}`,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
        background: 'rgba(255, 255, 255, 0.025)',
      },
    },
    h(
      'div',
      { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h(
          'span',
          { style: { fontSize: 13, fontWeight: 600, color: 'var(--bb-text-primary, #F8FAFC)' } },
          entry.name,
        ),
        h(
          'span',
          { style: { fontSize: 11, color: 'var(--bb-text-tertiary, #6B7280)' } },
          entry.author,
        ),
        // Official badge: derived ONLY from the repo owner being the
        // BBeBeeX GitHub account (see ../official.ts) — never from the
        // entry id prefix or the author string.
        isOfficialEntry(entry)
          ? h(
              'span',
              {
                'data-testid': `market-official-${entry.id}`,
                title: t('settings:pluginMarket.officialHint'),
                style: {
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 9,
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: '#3B82F6',
                },
              },
              t('settings:pluginMarket.official'),
            )
          : null,
        installed
          ? h(
              'span',
              {
                style: {
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 9,
                  background: 'rgba(34, 197, 94, 0.15)',
                  color: 'var(--state-success, #22C55E)',
                },
              },
              t('settings:pluginMarket.installedVersion', { version: installed.version }),
            )
          : null,
        installed?.delisted
          ? h(
              'span',
              {
                'data-testid': `market-delisted-${entry.id}`,
                title: t('settings:pluginMarket.delistedHint'),
                style: {
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 9,
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--state-error, #EF4444)',
                },
              },
              t('settings:pluginMarket.delisted'),
            )
          : null,
        installed?.blocked !== undefined
          ? h(
              'span',
              {
                'data-testid': `market-blocked-${entry.id}`,
                title: t('settings:pluginMarket.blockedHint', { reason: installed.blocked }),
                style: {
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 7px',
                  borderRadius: 9,
                  background: 'rgba(239, 68, 68, 0.3)',
                  color: '#FCA5A5',
                },
              },
              t('settings:pluginMarket.blocked'),
            )
          : null,
        // npm provenance (audit W6): the installed version's
        // attestation names this entry's repo as its source.
        installed?.provenanceVerified
          ? h(
              'span',
              {
                'data-testid': `market-provenance-${entry.id}`,
                title: t('settings:pluginMarket.provenanceVerifiedHint'),
                style: {
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 9,
                  background: 'rgba(34, 197, 94, 0.15)',
                  color: 'var(--state-success, #22C55E)',
                },
              },
              t('settings:pluginMarket.provenanceVerified'),
            )
          : null,
        update
          ? h(
              'span',
              {
                style: {
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 9,
                  background: 'rgba(245, 158, 11, 0.15)',
                  color: 'var(--bb-state-warn, #F59E0B)',
                },
              },
              // The default update lands on the REVIEWED version when
              // one applies (audit W5) — the badge names that target,
              // not npm's raw latest.
              `${update.installed} → ${update.reviewedUpdate ?? update.latest}`,
            )
          : null,
        update?.unreviewed
          ? h(
              'span',
              {
                'data-testid': `market-unreviewed-${entry.id}`,
                title: t('settings:pluginMarket.unreviewedHint'),
                style: {
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 9,
                  background: 'rgba(245, 158, 11, 0.3)',
                  color: '#FCD34D',
                },
              },
              t('settings:pluginMarket.unreviewedBadge'),
            )
          : null,
      ),
      h(
        'div',
        {
          style: {
            fontSize: 12,
            color: 'var(--bb-text-secondary, #8E8E93)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        },
        entry.description,
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 } },
      h(Button, {
        variant: 'secondary',
        children: t('settings:pluginMarket.details'),
        onPress: onShowDetails,
      }),
      !installed
        ? h(Button, {
            variant: 'primary',
            disabled: busy,
            loading: busyKind === 'install',
            children: t('settings:pluginMarket.install'),
            onPress: onInstall,
          })
        : null,
      installed && update
        ? h(Button, {
            variant: 'primary',
            disabled: busy,
            loading: busyKind === 'update',
            children: t('settings:pluginMarket.update'),
            // With a reviewed update available the button takes the
            // default path; an unreviewed-only update must go through
            // its own confirmation sheet instead.
            onPress: update.reviewedUpdate || !update.unreviewed ? onUpdate : onUpdateUnreviewed,
          })
        : null,
      installed && update?.unreviewed && update.reviewedUpdate
        ? h(Button, {
            variant: 'secondary',
            disabled: busy,
            children: t('settings:pluginMarket.updateUnreviewed', { version: update.latest }),
            onPress: onUpdateUnreviewed,
          })
        : null,
      installed && canUninstall
        ? h(Button, {
            variant: 'secondary',
            disabled: busy,
            loading: busyKind === 'uninstall',
            children: t('settings:pluginMarket.uninstall'),
            onPress: onUninstall,
          })
        : null,
    ),
  )
}
