import { Button, IconButton, Sheet, Text, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { FsService, I18nService, ScannerService, SettingsContribution, SourcesService, Uri } from '@BBeBee/protocol'
import {
  isLocalSource,
  useAudioSourcesStatus,
  type AudioSourceStatusItem,
} from '@BBeBee/plugin-sources/hooks'
import { summarise, useScanSpecifiedDirs, useScanState } from '@BBeBee/plugin-local-scanner/hooks'
import { serviceOf } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'
import { SourceConfigureModal } from '../SourceConfigureModal.js'

export interface SourcesSectionProps {
  ctx: Context
  contributions?: readonly SettingsContribution[]
  onNavigate: (route: string) => void
}

interface SourceGroup {
  name: string
  items: readonly AudioSourceStatusItem[]
  isMultiple: boolean
  isLocal: boolean
}

function getLocalizedTitle(
  t: I18nService['t'],
  item: SettingsContribution,
): string {
  if (item.title?.includes(':')) return t(item.title)
  if (item.id === 'sources.settings' || item.id === 'sources.list' || item.title === 'Music Sources') {
    return t('settings:sources.musicSourceConfigurationMusicSources')
  }
  if (item.id === 'sources.import' || item.title === 'Import Sources') {
    return t('settings:sources.importSourcesImportSources')
  }
  return item.title
}

function getLocalizedDescription(
  t: I18nService['t'],
  item: SettingsContribution,
): string | undefined {
  if (item.description?.includes(':')) return t(item.description)
  if (item.id === 'sources.settings' || item.id === 'sources.list' || item.description?.startsWith('View enabled')) {
    return t('settings:sources.viewEnabledOnlineSourcesRun')
  }
  if (item.id === 'sources.import' || item.description?.startsWith('Import third-party')) {
    return t('settings:sources.importThirdPartySourceScripts')
  }
  return item.description
}

function getLocalizedActionText(
  t: I18nService['t'],
  item: SettingsContribution,
): string {
  if (item.actionText?.includes(':')) return t(item.actionText)
  if (item.id === 'sources.settings' || item.id === 'sources.list' || item.actionText === 'Manage music sources') {
    return t('settings:sources.manageMusicSources')
  }
  if (item.id === 'sources.import' || item.actionText === 'Import sources') {
    return t('settings:sources.importSources')
  }
  return item.actionText ?? t('settings:sources.manage')
}

function AudioSourceRow({
  item,
  t,
  onTest,
  onConfigure,
  onToggle,
  onDelete,
  confirmingDeleteId,
  onSetConfirmingDeleteId,
  isNestedInstance = false,
  onOpenLocalFolders,
  onAddLocalFolder,
  onScanLocal,
  isScanning = false,
  isExpanded = false,
  onNavigate,
}: {
  item: AudioSourceStatusItem
  t: I18nService['t']
  onTest: (id: string) => void
  onConfigure: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  confirmingDeleteId: string | undefined
  onSetConfirmingDeleteId: (id: string | undefined) => void
  isNestedInstance?: boolean
  onOpenLocalFolders?: () => void
  onAddLocalFolder?: () => void
  onScanLocal?: () => void
  isScanning?: boolean
  isExpanded?: boolean
  onNavigate?: (route: string) => void
}): ReactElement {
  const local = isLocalSource(item.record)
  const isAuth = item.authStatus.state === 'authenticated'
  const isExpired = item.authStatus.state === 'expired'
  const isAuthError = item.authStatus.state === 'error'
  const pingStatus = item.ping?.status

  let dotColor = '#94A3B8'
  let probeText = t('settings:sources.offline')
  let probeBg = 'rgba(255, 255, 255, 0.05)'
  let probeColor = 'var(--text-secondary, #C5CAD8)'

  if (local) {
    dotColor = item.enabled ? '#22C55E' : '#64748B'
    probeText = t('settings:sources.ready')
    probeBg = 'rgba(34, 197, 94, 0.15)'
    probeColor = '#4ADE80'
  } else if (!item.enabled) {
    dotColor = '#64748B'
    probeText = t('settings:sources.offline')
    probeBg = 'rgba(255, 255, 255, 0.04)'
    probeColor = '#64748B'
  } else if (pingStatus === 'ok' || (isAuth && !pingStatus)) {
    dotColor = '#22C55E'
    probeText = item.ping?.latencyMs
      ? `${item.ping.latencyMs}ms`
      : item.ping?.serverVersion
        ? `v${item.ping.serverVersion}`
        : t('settings:sources.connected')
    probeBg = 'rgba(34, 197, 94, 0.15)'
    probeColor = '#4ADE80'
  } else if (pingStatus === 'auth_failed' || isExpired || isAuthError) {
    dotColor = '#F59E0B'
    probeText = t('settings:sources.authFailed')
    probeBg = 'rgba(245, 158, 11, 0.15)'
    probeColor = '#FBBF24'
  } else if (pingStatus === 'network_error') {
    dotColor = '#EF4444'
    probeText = t('settings:sources.networkError')
    probeBg = 'rgba(239, 68, 68, 0.15)'
    probeColor = '#F87171'
  }

  let authText = t('settings:sources.anonymous')
  let authBg = 'rgba(255, 255, 255, 0.06)'
  let authColor = 'var(--text-secondary, #C5CAD8)'

  if (local) {
    authText = t('settings:sources.localFiles')
    authBg = 'rgba(255, 255, 255, 0.06)'
    authColor = 'var(--text-secondary, #C5CAD8)'
  } else if (item.authStatus.state === 'authenticated') {
    authText = t('settings:sources.authenticated')
    authBg = 'rgba(34, 197, 94, 0.12)'
    authColor = '#4ADE80'
  } else if (isExpired) {
    authText = t('settings:sources.expired')
    authBg = 'rgba(245, 158, 11, 0.15)'
    authColor = '#FBBF24'
  } else if (isAuthError) {
    authText = t('settings:sources.authFailed')
    authBg = 'rgba(239, 68, 68, 0.15)'
    authColor = '#F87171'
  }

  const itemKey = local ? 'local' : item.id
  const isConfirmingDelete = confirmingDeleteId === item.id

  return h(
    'div',
    {
      key: item.id,
      'data-testid': `settings-source-item-${itemKey}`,
      onClick: local ? onOpenLocalFolders : undefined,
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        rowGap: 8,
        padding: isNestedInstance ? '10px 12px' : '12px 14px',
        margin: '6px 0',
        borderRadius: 8,
        background: isNestedInstance ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        gap: 12,
        opacity: item.enabled ? 1 : 0.6,
        cursor: local ? 'pointer' : 'default',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
          flex: '1 1 200px',
        },
      },
      h('span', {
        'data-testid': `settings-source-dot-${itemKey}`,
        style: {
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: dotColor,
          flexShrink: 0,
        },
      }),
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
          },
        },
        h(
          'span',
          {
            style: {
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--bb-text-primary, #FFFFFF)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          },
          item.name,
        ),
        h(
          'span',
          {
            style: {
              fontSize: 11,
              color: 'var(--text-secondary, #8E8E93)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginTop: 2,
            },
          },
          item.sourceUrl,
        ),
      ),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
          flexWrap: 'wrap',
        },
      },
      h(
        'span',
        {
          'data-testid': `settings-source-auth-${itemKey}`,
          style: {
            fontSize: 11,
            fontWeight: 600,
            color: authColor,
            background: authBg,
            padding: '2px 8px',
            borderRadius: 6,
            whiteSpace: 'nowrap',
          },
        },
        authText,
      ),
      h(
        'span',
        {
          'data-testid': `settings-source-probe-${itemKey}`,
          style: {
            fontSize: 11,
            fontWeight: 600,
            color: probeColor,
            background: probeBg,
            padding: '2px 8px',
            borderRadius: 6,
            whiteSpace: 'nowrap',
          },
        },
        probeText,
      ),
    ),
    local
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              marginLeft: 'auto',
            },
            onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
          },
          // 1. 添加文件夹
          h(Button, {
            variant: 'secondary',
            testID: 'settings-source-add-folder-local',
            onPress: () => onAddLocalFolder?.(),
            children: t('localScanner:index.addFolder'),
          }),
          // 2. 立即扫描 / 扫描中
          // While running, the button is not disabled — it becomes a shortcut
          // to the scan page, so the user can watch progress and cancel.
          h(Button, {
            variant: 'secondary',
            testID: 'settings-source-scan-local',
            onPress: () => {
              if (isScanning) onNavigate?.('scanner.settings')
              else onScanLocal?.()
            },
            children: isScanning ? t('localScanner:index.scanning') : t('localScanner:index.scanNow'),
          }),
          tablerIcon(isExpanded ? 'chevron-down' : 'chevron-right', { size: 16, color: 'var(--text-tertiary, #8E8E93)' }),
        )
      : h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              marginLeft: 'auto',
            },
          },
          // 1. 测试按钮 (本地不需要测试)
          h(Button, {
            variant: 'secondary',
            testID: `settings-source-test-${item.id}`,
            disabled: item.isPinging || !item.enabled,
            onPress: () => onTest(item.id),
            children: item.isPinging ? '…' : t('settings:sources.test'),
          }),
          // 2. 配置按钮 (将已配置音源的管理 变成 音乐源页的配置)
          h(Button, {
            variant: 'secondary',
            testID: `settings-source-configure-${item.id}`,
            onPress: () => onConfigure(item.id),
            children: t('sources:sourcesList.configure'),
          }),
          // 3. 最右边：禁用/启用 icon
          h(IconButton, {
            icon: item.enabled ? 'ban' : 'check',
            accessibilityLabel: item.enabled
              ? t('sources:sourcesList.disable')
              : t('sources:sourcesList.enable'),
            testID: `settings-source-toggle-${item.id}`,
            onPress: () => onToggle(item.id, !item.enabled),
          }),
          // 5. 最右边：垃圾桶 icon (含确认提示)
          isConfirmingDelete
            ? h(
                'div',
                { style: { display: 'flex', gap: tokens.space[2], alignItems: 'center' } },
                h(Text, { variant: 'sm', tone: 'warn' }, t('sources:sourcesList.deleteSourceConfirm')),
                h(Button, {
                  onPress: () => onDelete(item.id),
                  testID: `settings-source-delete-confirm-${item.id}`,
                  children: t('app:common.delete'),
                }),
                h(Button, {
                  variant: 'ghost',
                  onPress: () => onSetConfirmingDeleteId(undefined),
                  children: t('app:common.cancel'),
                }),
              )
            : h(IconButton, {
                icon: 'trash',
                accessibilityLabel: t('sources:sourcesList.deleteSource', { name: item.name }),
                testID: `settings-source-delete-${item.id}`,
                onPress: () => onSetConfirmingDeleteId(item.id),
              }),
        ),
  )
}

function AudioSourceGroupCard({
  group,
  t,
  onClick,
  onToggleGroup,
  onDeleteGroup,
  confirmingGroupId,
  onSetConfirmingGroupId,
}: {
  group: SourceGroup
  t: I18nService['t']
  onClick: () => void
  onToggleGroup: (group: SourceGroup) => void
  onDeleteGroup: (group: SourceGroup) => void
  confirmingGroupId: string | undefined
  onSetConfirmingGroupId: (name: string | undefined) => void
}): ReactElement {
  const isConfirmingDelete = confirmingGroupId === group.name
  const anyEnabled = group.items.some((i) => i.enabled)
  const allConnected = group.items.every(
    (i) => i.enabled && (i.authStatus.state === 'authenticated' || i.ping?.status === 'ok'),
  )
  const anyConnected = group.items.some(
    (i) => i.enabled && (i.authStatus.state === 'authenticated' || i.ping?.status === 'ok'),
  )

  const dotColor = !anyEnabled
    ? '#64748B'
    : allConnected || anyConnected
      ? '#22C55E'
      : '#EF4444'

  return h(
    'div',
    {
      key: group.name,
      'data-testid': `settings-source-group-card-${group.name}`,
      onClick,
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 14px',
        margin: '6px 0',
        borderRadius: 8,
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        gap: 12,
        cursor: 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
          flex: 1,
        },
      },
      h('span', {
        'data-testid': `settings-source-group-dot-${group.name}`,
        style: {
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: dotColor,
          flexShrink: 0,
        },
      }),
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
          },
        },
        h(
          'span',
          {
            style: {
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--bb-text-primary, #FFFFFF)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          },
          group.name,
        ),
        h(
          'span',
          {
            'data-testid': `settings-source-group-count-${group.name}`,
            style: {
              fontSize: 11,
              color: 'var(--text-secondary, #8E8E93)',
              marginTop: 2,
            },
          },
          `${group.items.length} ${t('settings:sources.instancesCount', { count: group.items.length })} · ${t('settings:sources.clickToViewInstances')}`,
        ),
      ),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        },
        onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
      },
      tablerIcon('chevron-right', { size: 16, color: 'var(--text-tertiary, #8E8E93)' }),
      // 最右边：禁用/启用 icon
      h(IconButton, {
        icon: anyEnabled ? 'ban' : 'check',
        accessibilityLabel: anyEnabled
          ? t('sources:sourcesList.disable')
          : t('sources:sourcesList.enable'),
        testID: `settings-source-group-toggle-${group.name}`,
        onPress: () => onToggleGroup(group),
      }),
      // 最右边：垃圾桶 icon
      isConfirmingDelete
        ? h(
            'div',
            { style: { display: 'flex', gap: tokens.space[2], alignItems: 'center' } },
            h(Text, { variant: 'sm', tone: 'warn' }, t('sources:sourcesList.deleteSourceConfirm')),
            h(Button, {
              onPress: () => onDeleteGroup(group),
              testID: `settings-source-group-delete-confirm-${group.name}`,
              children: t('app:common.delete'),
            }),
            h(Button, {
              variant: 'ghost',
              onPress: () => onSetConfirmingGroupId(undefined),
              children: t('app:common.cancel'),
            }),
          )
        : h(IconButton, {
            icon: 'trash',
            accessibilityLabel: t('sources:sourcesList.deleteSource', { name: group.name }),
            testID: `settings-source-group-delete-${group.name}`,
            onPress: () => onSetConfirmingGroupId(group.name),
          }),
    ),
  )
}

export function SourcesSection({
  ctx,
  contributions = [],
  onNavigate,
}: SourcesSectionProps): ReactElement {
  const { t } = useI18n(ctx)
  const sourcesContribs = contributions.filter((c) => c.section === 'sources')
  const { items: audioSources, testConnection, testAll } = useAudioSourcesStatus(ctx)

  const specifiedDirs = useScanSpecifiedDirs(ctx)
  const scan = useScanState(ctx)

  const [configuringSourceId, setConfiguringSourceId] = useState<string | undefined>(undefined)
  const [activeGroupModal, setActiveGroupModal] = useState<SourceGroup | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | undefined>(undefined)
  const [confirmingGroupId, setConfirmingGroupId] = useState<string | undefined>(undefined)
  const [isLocalFoldersSheetOpen, setIsLocalFoldersSheetOpen] = useState(false)
  const [isScanModalOpen, setIsScanModalOpen] = useState(false)
  const [confirmingDeleteFolderId, setConfirmingDeleteFolderId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (scan.running) {
      setIsScanModalOpen(true)
    }
  }, [scan.running])

  // Group audio sources by source name
  const sourceGroups = useMemo<readonly SourceGroup[]>(() => {
    const map = new Map<string, AudioSourceStatusItem[]>()
    for (const item of audioSources) {
      const key = item.name.trim() || item.id
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return Array.from(map.entries()).map(([name, items]) => ({
      name,
      items,
      isMultiple: items.length > 1,
      isLocal: items.some((i) => isLocalSource(i.record)),
    }))
  }, [audioSources])

  const connectedCount = audioSources.filter(
    (item) => item.enabled && (isLocalSource(item.record) || item.authStatus.state === 'authenticated' || item.ping?.status === 'ok'),
  ).length

  // Filter out 'sources.settings', 'sources.list', and 'scanner.settings'
  const rawItems: readonly SettingsContribution[] = sourcesContribs.length > 0 ? sourcesContribs : [
    {
      id: 'sources.import',
      section: 'sources',
      title: t('settings:sources.importSourcesImportSources'),
      description: t('settings:sources.importThirdPartySourceScripts'),
      actionText: t('settings:sources.importSources'),
    },
  ]
  const items = rawItems.filter(
    (item) =>
      item.id !== 'sources.settings' &&
      item.id !== 'sources.list' &&
      item.title !== 'Music Sources' &&
      item.id !== 'scanner.settings' &&
      item.title !== 'Music folders',
  )

  const handleToggle = (id: string, enabled: boolean) => {
    const sourcesSvc = serviceOf<SourcesService>(ctx, 'sources')
    void sourcesSvc?.setEnabled?.(id, enabled)
  }

  const handleDelete = (id: string) => {
    setConfirmingDeleteId(undefined)
    const sourcesSvc = serviceOf<SourcesService>(ctx, 'sources')
    void sourcesSvc?.remove?.(id, { forgetCatalogue: true })
  }

  const handleToggleGroup = (group: SourceGroup) => {
    const sourcesSvc = serviceOf<SourcesService>(ctx, 'sources')
    const anyEnabled = group.items.some((i) => i.enabled)
    const target = !anyEnabled
    for (const item of group.items) {
      void sourcesSvc?.setEnabled?.(item.id, target)
    }
  }

  const handleDeleteGroup = (group: SourceGroup) => {
    setConfirmingGroupId(undefined)
    const sourcesSvc = serviceOf<SourcesService>(ctx, 'sources')
    for (const item of group.items) {
      void sourcesSvc?.remove?.(item.id, { forgetCatalogue: true })
    }
  }

  const handleAddFolder = async () => {
    try {
      const fs = serviceOf<FsService>(ctx, 'fs') ?? (ctx as unknown as { fs?: FsService }).fs
      const scanner = serviceOf<ScannerService>(ctx, 'scanner') ?? (ctx as unknown as { scanner?: ScannerService }).scanner

      let uri: string | undefined = undefined
      if (fs?.pickDirectory) {
        try {
          uri = await fs.pickDirectory()
        } catch (e) {
          ctx.logger?.warn?.(`fs.pickDirectory failed: ${String(e)}`)
        }
      }
      if (!uri) {
        const bridge =
          typeof window !== 'undefined'
            ? (window as unknown as { BBeBee?: { dialog?: { pickDirectory?: () => Promise<string | undefined> } } }).BBeBee
            : undefined
        if (bridge?.dialog?.pickDirectory) {
          const picked = await bridge.dialog.pickDirectory()
          if (picked) {
            const normalized = picked.replace(/\\/g, '/')
            uri = normalized.startsWith('file://')
              ? normalized
              : normalized.startsWith('/')
                ? `file://${normalized}`
                : `file:///${normalized}`
          }
        }
      }

      if (!uri) {
        return
      }

      if (!scanner) {
        ctx.logger?.warn?.('scanner service is not available')
        return
      }

      const dir = await scanner.addSpecifiedDir(uri as Uri)
      setIsScanModalOpen(true)
      void scanner.scan({ specifiedDirId: dir.id })
    } catch (err) {
      ctx.logger?.error?.(`handleAddFolder failed: ${String(err)}`)
    }
  }

  const handleScanNow = () => {
    const scanner = serviceOf<ScannerService>(ctx, 'scanner')
    if (!scanner) return
    setIsScanModalOpen(true)
    void scanner.scan()
  }

  const handleScanFolder = (dirId: string) => {
    const scanner = serviceOf<ScannerService>(ctx, 'scanner')
    if (!scanner) return
    setIsScanModalOpen(true)
    void scanner.scan({ specifiedDirId: dirId })
  }

  const handleToggleFolder = (dirId: string, enabled: boolean) => {
    const scanner = serviceOf<ScannerService>(ctx, 'scanner')
    void scanner?.setEnabled?.(dirId, enabled)
  }

  const handleDeleteFolder = (dirId: string) => {
    setConfirmingDeleteFolderId(undefined)
    const scanner = serviceOf<ScannerService>(ctx, 'scanner')
    // Async fire-and-forget: the scanner marks the dir's tracks unavailable
    // (hidden from local music) without deleting them, so playlists and
    // favorites that reference them by URN keep working.
    void scanner?.removeSpecifiedDir?.(dirId)
  }

  // Find updated active group if sources state changes
  const currentActiveGroup = useMemo(() => {
    if (!activeGroupModal) return null
    return sourceGroups.find((g) => g.name === activeGroupModal.name) ?? null
  }, [activeGroupModal, sourceGroups])

  const renderLocalFoldersExpanded = () =>
    h(
      'div',
      {
        'data-testid': 'source-local-folders-sheet',
        style: {
          margin: '4px 0 10px',
          padding: '16px 18px',
          borderRadius: 8,
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[3],
        },
      },
      h(
        'div',
        {
          'data-testid': 'source-local-folders-content',
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space[3],
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            },
          },
          h(
            Text,
            { variant: 'sm', tone: 'muted' },
            `${specifiedDirs.length} ${t('localScanner:index.musicFolders')}`,
          ),
          h(Button, {
            variant: 'secondary',
            testID: 'sheet-add-folder-btn',
            onPress: () => void handleAddFolder(),
            children: t('localScanner:index.addFolder'),
          }),
        ),
        specifiedDirs.length === 0
          ? h(
              'div',
              {
                'data-testid': 'sheet-folders-empty',
                style: {
                  padding: '24px 8px',
                  textAlign: 'center',
                  fontSize: 13,
                  color: 'var(--text-secondary, #8E8E93)',
                },
              },
              t('localScanner:index.noFoldersYet'),
            )
          : specifiedDirs.map((dir) => {
              const isConfirming = confirmingDeleteFolderId === dir.id
              return h(
                'div',
                {
                  key: dir.id,
                  'data-testid': `local-folder-row-${dir.id}`,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    gap: 12,
                    opacity: dir.enabled ? 1 : 0.5,
                  },
                },
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minWidth: 0,
                      flex: 1,
                    },
                  },
                  tablerIcon('folder', { size: 18, color: 'var(--color-primary, #5F87FF)' }),
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: 0,
                        overflow: 'hidden',
                      },
                    },
                    h(
                      'span',
                      {
                        style: {
                          fontSize: 13,
                          color: 'var(--bb-text-primary, #FFFFFF)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        },
                        title: dir.uri,
                      },
                      dir.uri,
                    ),
                    dir.lastError
                      ? h(
                          'span',
                          {
                            style: {
                              fontSize: 11,
                              color: '#F87171',
                              marginTop: 2,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            },
                          },
                          dir.lastError,
                        )
                      : null,
                  ),
                ),
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexShrink: 0,
                    },
                  },
                  h(Button, {
                    variant: 'ghost',
                    disabled: scan.running || !dir.enabled,
                    testID: `local-folder-scan-${dir.id}`,
                    onPress: () => handleScanFolder(dir.id),
                    children: t('localScanner:index.scan'),
                  }),
                  h(IconButton, {
                    icon: dir.enabled ? 'ban' : 'check',
                    accessibilityLabel: dir.enabled
                      ? t('localScanner:index.disable')
                      : t('localScanner:index.enable'),
                    testID: `local-folder-toggle-${dir.id}`,
                    onPress: () => handleToggleFolder(dir.id, !dir.enabled),
                  }),
                  isConfirming
                    ? h(
                        'div',
                        { style: { display: 'flex', gap: tokens.space[2], alignItems: 'center' } },
                        h(Text, { variant: 'sm', tone: 'warn' }, t('sources:sourcesList.deleteSourceConfirm') || t('app:common.confirmDelete')),
                        h(Button, {
                          testID: `local-folder-delete-confirm-${dir.id}`,
                          onPress: () => handleDeleteFolder(dir.id),
                          children: t('app:common.delete'),
                        }),
                        h(Button, {
                          variant: 'ghost',
                          onPress: () => setConfirmingDeleteFolderId(undefined),
                          children: t('app:common.cancel'),
                        }),
                      )
                    : h(IconButton, {
                        icon: 'trash',
                        accessibilityLabel: t('localScanner:index.removeUri', { uri: dir.uri }),
                        testID: `local-folder-delete-${dir.id}`,
                        onPress: () => setConfirmingDeleteFolderId(dir.id),
                      }),
                ),
              )
            }),
        h(
          Text,
          {
            variant: 'sm',
            tone: 'muted',
            style: { marginTop: tokens.space[2] },
          },
          t('localScanner:index.removeKeepsTracks'),
        ),
      ),
    )

  return h(
    'div',
    { id: 'section-sources' },
    // 1. 音乐源与文件 (移到已配置音源上面)
    h(
      SettingsSection,
      {
        id: 'section-sources-files',
        title: t('settings:sources.musicSourcesFiles'),
        description: t('settings:sources.manageMusicSourceProvidersOnline'),
      },
      items.map((item, idx) => {
        const isLast = idx === items.length - 1
        if (item.display === 'card' && ctx) {
          const CardView = ctx.ui?.viewFor?.(item.id) as React.ComponentType<{ ctx: Context }> | undefined
          if (CardView) return h(CardView, { key: item.id, ctx })
        }
        return h(SettingsRow, {
          ctx,
          key: item.id,
          title: getLocalizedTitle(t, item),
          description: getLocalizedDescription(t, item),
          borderBottom: !isLast,
          action: h(Button, {
            children: getLocalizedActionText(t, item),
            onPress: () => {
              if (item.action) void item.action()
              else onNavigate(item.id)
            },
          }),
        })
      }),
    ),
    // 2. 已配置音源
    h(
      SettingsSection,
      {
        id: 'section-sources-configured',
        title: t('settings:sources.configuredSources'),
        description: t('settings:sources.manageMusicSourceProvidersOnline'),
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 0',
            borderBottom: audioSources.length > 0 ? '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))' : 'none',
            marginBottom: audioSources.length > 0 ? 8 : 0,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          tablerIcon('server', { size: 16, color: 'var(--color-primary, #5F87FF)' }),
          h(
            'span',
            {
              style: {
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary, #C5CAD8)',
                background: 'var(--surface-hover, rgba(255, 255, 255, 0.08))',
                padding: '1px 8px',
                borderRadius: 8,
              },
            },
            `${connectedCount}/${audioSources.length}`,
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h(Button, {
            variant: 'secondary',
            testID: 'settings-sources-test-all',
            disabled: audioSources.filter((s) => !isLocalSource(s.record)).length === 0,
            onPress: () => void testAll(),
            children: t('settings:sources.testAll'),
          }),
        ),
      ),
      audioSources.length === 0
        ? h(
            'div',
            {
              'data-testid': 'settings-sources-empty',
              style: {
                padding: '24px 8px',
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--text-secondary, #8E8E93)',
              },
            },
            t('settings:sources.viewEnabledOnlineSourcesRun'),
          )
        : sourceGroups.map((group) => {
            if (group.isMultiple) {
              return h(AudioSourceGroupCard, {
                key: group.name,
                group,
                t,
                onClick: () => setActiveGroupModal(group),
                onToggleGroup: handleToggleGroup,
                onDeleteGroup: handleDeleteGroup,
                confirmingGroupId,
                onSetConfirmingGroupId: setConfirmingGroupId,
              })
            }
            const singleItem = group.items[0]!
            const isLocal = isLocalSource(singleItem.record)
            const row = h(AudioSourceRow, {
              key: singleItem.id,
              item: singleItem,
              t,
              onTest: (id) => void testConnection(id),
              onConfigure: (id) => setConfiguringSourceId(id),
              onToggle: handleToggle,
              onDelete: handleDelete,
              confirmingDeleteId,
              onSetConfirmingDeleteId: setConfirmingDeleteId,
              onOpenLocalFolders: () => setIsLocalFoldersSheetOpen((prev) => !prev),
              onAddLocalFolder: () => void handleAddFolder(),
              onScanLocal: handleScanNow,
              isScanning: scan.running,
              isExpanded: isLocal && isLocalFoldersSheetOpen,
              onNavigate,
            })
            if (!isLocal) return row
            return h(
              'div',
              { key: singleItem.id },
              row,
              isLocalFoldersSheetOpen ? renderLocalFoldersExpanded() : null,
            )
          }),
    ),

    // Multi-instance popout sheet ("点击那个卡片 跳出实例列表")
    currentActiveGroup
      ? h(
          Sheet,
          {
            open: true,
            onClose: () => setActiveGroupModal(null),
            title: `${currentActiveGroup.name} - ${t('settings:sources.instancesList')}`,
            testID: 'source-instances-modal',
          },
          h(
            'div',
            {
              'data-testid': `source-instances-list-${currentActiveGroup.name}`,
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: tokens.space[2],
                maxHeight: '75vh',
                overflowY: 'auto',
                paddingRight: tokens.space[1],
              },
            },
            currentActiveGroup.items.map((item) => {
              const isLocal = isLocalSource(item.record)
              const row = h(AudioSourceRow, {
                key: item.id,
                item,
                t,
                onTest: (id) => void testConnection(id),
                onConfigure: (id) => setConfiguringSourceId(id),
                onToggle: handleToggle,
                onDelete: handleDelete,
                confirmingDeleteId,
                onSetConfirmingDeleteId: setConfirmingDeleteId,
                isNestedInstance: true,
                onOpenLocalFolders: () => setIsLocalFoldersSheetOpen((prev) => !prev),
                onAddLocalFolder: () => void handleAddFolder(),
                onScanLocal: handleScanNow,
                isScanning: scan.running,
                isExpanded: isLocal && isLocalFoldersSheetOpen,
                onNavigate,
              })
              if (!isLocal) return row
              return h(
                'div',
                { key: item.id },
                row,
                isLocalFoldersSheetOpen ? renderLocalFoldersExpanded() : null,
              )
            }),
          ),
        )
      : null,



    // Scan Progress Modal
    isScanModalOpen
      ? h(
          Sheet,
          {
            open: true,
            onClose: () => setIsScanModalOpen(false),
            title: scan.running ? t('localScanner:index.scanning') : t('localScanner:index.musicFolders'),
            testID: 'source-scan-progress-modal',
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '16px 8px',
                gap: 16,
                textAlign: 'center',
                minWidth: 320,
              },
            },
            h(
              'div',
              {
                style: {
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: scan.running ? 'rgba(95, 135, 255, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                },
              },
              tablerIcon(scan.running ? 'refresh' : 'check', {
                size: 24,
                color: scan.running ? '#5F87FF' : '#22C55E',
              }),
            ),
            h(
              Text,
              {
                variant: 'md',
                testID: 'scan-modal-status-text',
              },
              scan.running
                ? scan.progress?.total
                  ? t('localScanner:index.scannedOf', { done: scan.progress.done, total: scan.progress.total })
                  : t('localScanner:index.scannedFiles', { done: scan.progress?.done ?? 0 })
                : scan.lastSummary
                  ? t('localScanner:index.lastScan', { summary: summarise(scan.lastSummary) })
                  : t('localScanner:index.scanNow'),
            ),
            // The file currently being read: when a scan looks stuck, this
            // is what says whether work is moving and where it is stuck.
            scan.running && scan.progress?.currentFile
              ? h(
                  Text,
                  {
                    variant: 'sm',
                    tone: 'muted',
                    numberOfLines: 1,
                    testID: 'scan-modal-current-file',
                  },
                  scan.progress.currentFile,
                )
              : null,
            scan.running && scan.progress?.total
              ? h(
                  'div',
                  {
                    style: {
                      width: '100%',
                      height: 6,
                      borderRadius: 3,
                      background: 'rgba(255, 255, 255, 0.1)',
                      overflow: 'hidden',
                    },
                  },
                  h('div', {
                    style: {
                      width: `${Math.min(100, Math.round((scan.progress.done / scan.progress.total) * 100))}%`,
                      height: '100%',
                      background: 'var(--color-primary, #5F87FF)',
                      borderRadius: 3,
                      transition: 'width 0.2s ease',
                    },
                  }),
                )
              : null,
            h(
              'div',
              { style: { display: 'flex', gap: 12, marginTop: 8 } },
              scan.running
                ? h(Button, {
                    variant: 'secondary',
                    testID: 'scan-modal-cancel-btn',
                    onPress: () => {
                      const scanner = serviceOf<ScannerService>(ctx, 'scanner')
                      scanner?.cancel?.()
                    },
                    children: t('app:common.cancel'),
                  })
                : h(Button, {
                    variant: 'secondary',
                    testID: 'scan-modal-close-btn',
                    onPress: () => setIsScanModalOpen(false),
                    children: t('app:common.close'),
                  }),
            ),
          ),
        )
      : null,

    // Source Configuration Modal
    h(SourceConfigureModal, {
      ctx,
      sourceId: configuringSourceId,
      open: configuringSourceId !== undefined,
      onClose: () => setConfiguringSourceId(undefined),
    }),
  )
}
