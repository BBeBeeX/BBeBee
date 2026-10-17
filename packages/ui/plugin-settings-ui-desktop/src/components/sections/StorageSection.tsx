import { Button, Switch, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, SettingsContribution } from '@BBeBee/protocol'
import { formatBytes } from '@BBeBee/toolkit'
import { SegmentedControl } from '../SegmentedControl.js'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface StorageUsage {
  totalBytes: number
  artworkBytes: number
  streamBytes: number
}

export interface StorageSectionProps {
  ctx: Context
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<unknown>
  currentDownloadsDir: string
  currentCacheDir: string
  usage: StorageUsage
  clearingCache: boolean
  contributions?: readonly SettingsContribution[]
  onPickDownloadDir: () => void
  onOpenDownloadDir: () => void
  onPickCacheDir: () => void
  onOpenCacheDir: () => void
  onClearCache: () => void
  onNavigate: (route: string) => void
}

function cleanDisplayPath(rawPath?: string): string {
  if (!rawPath) return ''
  let p = rawPath
  if (p.startsWith('file://')) {
    p = decodeURIComponent(p.replace(/^file:\/\//, ''))
    if (/^\/[a-zA-Z]:/.test(p)) {
      p = p.slice(1)
    }
  }
  return p
}

export function StorageSection({
  ctx,
  settings,
  update,
  currentDownloadsDir,
  currentCacheDir,
  usage,
  clearingCache,
  contributions = [],
  onPickDownloadDir,
  onOpenDownloadDir,
  onPickCacheDir,
  onOpenCacheDir,
  onClearCache,
  onNavigate,
}: StorageSectionProps): ReactElement {
  const { t } = useI18n(ctx)
  const storageContribs = contributions.filter((c) => c.section === 'storage')
  const items: readonly SettingsContribution[] = storageContribs

  return h(
    'div',
    { id: 'section-storage' },
    h(
      SettingsSection,
      {
        title: t('settings:storage.offlineStorageDownloadsDirectory'),
        description: t('settings:storage.manageTheLocalDirectoryFor'),
      },
      h(SettingsRow, {
        ctx,
        title: t('settings:storage.downloadsDirectory'),
        description: cleanDisplayPath(currentDownloadsDir),
        action: h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          h(Button, {
            variant: 'secondary',
            children: t('settings:schemaForm.changeDirectory'),
            onPress: onPickDownloadDir,
          }),
          h(Button, {
            variant: 'secondary',
            children: t('settings:schemaForm.openFolder'),
            onPress: onOpenDownloadDir,
          }),
        ),
      }),
      h(SettingsRow, {
        ctx,
        title: t('settings:storage.downloadFormat'),
        description: t('settings:storage.downloadFormatDesc'),
        action: h(SegmentedControl<'auto' | 'flac' | 'mp3' | 'mp4'>, {
          value: (settings.downloadFormat as 'auto' | 'flac' | 'mp3' | 'mp4') ?? 'auto',
          options: [
            { value: 'auto', label: t('settings:storage.formatAuto') },
            { value: 'flac', label: t('settings:storage.formatFlac') },
            { value: 'mp3', label: t('settings:storage.formatMp3') },
            { value: 'mp4', label: t('settings:storage.formatMp4') },
          ],
          onChange: (format) => void update({ downloadFormat: format }),
        }),
      }),
      h(SettingsRow, {
        ctx,
        title: t('settings:storage.downloadWifiOnly'),
        description: t('settings:storage.downloadWifiOnlyDesc'),
        action: h(Switch, {
          checked: settings.downloadWifiOnly ?? false,
          accessibilityLabel: t('settings:storage.downloadWifiOnly'),
          onChange: (checked) => {
            void update({ downloadWifiOnly: checked })
            void (ctx as { downloads?: { setPolicy(p: { wifiOnly?: boolean }): Promise<void> } }).downloads?.setPolicy?.({ wifiOnly: checked })
          },
        }),
      }),
      items.map((item) => {
        if (item.display === 'card' && ctx) {
          const CardView = ctx.ui?.viewFor?.(item.id) as React.ComponentType<{ ctx: Context }> | undefined
          if (CardView) return h(CardView, { key: item.id, ctx })
        }
        return h(SettingsRow, {
          ctx,
          key: item.id,
          title: item.title,
          description: item.description,
          borderBottom: false,
          action: h(Button, {
            children: item.actionText ?? t('settings:storage.viewDetails'),
            onPress: () => {
              if (item.action) void item.action()
              else onNavigate(item.id)
            },
          }),
        })
      }),
    ),
    h(
      SettingsSection,
      {
        title: t('settings:storage.tempCacheStorageDirectories'),
        description: t('settings:storage.storagePathsAndCleanupFor'),
      },
      h(SettingsRow, {
        ctx,
        title: t('settings:storage.songCacheDirectory'),
        description: cleanDisplayPath(currentCacheDir),
        action: h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          h(Button, {
            variant: 'secondary',
            children: t('settings:schemaForm.changeDirectory'),
            onPress: onPickCacheDir,
          }),
          h(Button, {
            variant: 'secondary',
            children: t('settings:schemaForm.openFolder'),
            onPress: onOpenCacheDir,
          }),
        ),
      }),
      h(SettingsRow, {
        ctx,
        title: t('settings:storage.cacheUsage'),
        description: t('settings:storage.cacheUsageDetail', {
          total: formatBytes(usage.totalBytes),
          artwork: formatBytes(usage.artworkBytes),
          streams: formatBytes(usage.streamBytes),
        }),
        borderBottom: false,
        action: h(Button, {
          variant: 'secondary',
          disabled: clearingCache || usage.totalBytes === 0,
          loading: clearingCache,
          children: t('settings:storage.clearAllCache'),
          onPress: onClearCache,
        }),
      }),
    ),
  )
}
