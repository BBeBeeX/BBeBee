import { Button, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SettingsContribution } from '@BBeBee/protocol'
import { formatBytes } from '@BBeBee/toolkit'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface StorageUsage {
  totalBytes: number
  artworkBytes: number
  streamBytes: number
}

export interface StorageSectionProps {
  ctx: Context
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
          { style: { display: 'flex', gap: 8 } },
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
          { style: { display: 'flex', gap: 8 } },
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
