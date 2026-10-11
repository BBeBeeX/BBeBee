import { Button } from '@BBeBee/ui-kit-desktop'
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
  ctx?: Context
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
  const storageContribs = contributions.filter((c) => c.section === 'storage')
  const items: readonly SettingsContribution[] = storageContribs

  return h(
    'div',
    { id: 'section-storage' },
    h(
      SettingsSection,
      {
        title: 'Offline storage & downloads directory',
        description: 'Manage the local directory for downloaded music and its task policy',
      },
      h(SettingsRow, {
        title: 'Downloads directory',
        description: cleanDisplayPath(currentDownloadsDir),
        action: h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h(Button, {
            variant: 'secondary',
            children: 'Change directory',
            onPress: onPickDownloadDir,
          }),
          h(Button, {
            variant: 'secondary',
            children: 'Open folder',
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
          key: item.id,
          title: item.title,
          description: item.description,
          borderBottom: false,
          action: h(Button, {
            children: item.actionText ?? 'View details',
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
        title: 'Temp cache & storage directories',
        description: 'Storage paths and cleanup for online media stream buffering and artwork cache',
      },
      h(SettingsRow, {
        title: 'Song cache directory',
        description: cleanDisplayPath(currentCacheDir),
        action: h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h(Button, {
            variant: 'secondary',
            children: 'Change directory',
            onPress: onPickCacheDir,
          }),
          h(Button, {
            variant: 'secondary',
            children: 'Open folder',
            onPress: onOpenCacheDir,
          }),
        ),
      }),
      h(SettingsRow, {
        title: 'Cache usage',
        description: `Total: ${formatBytes(usage.totalBytes)} (artwork: ${formatBytes(usage.artworkBytes)} · streams: ${formatBytes(usage.streamBytes)})`,
        borderBottom: false,
        action: h(Button, {
          variant: 'secondary',
          disabled: clearingCache || usage.totalBytes === 0,
          loading: clearingCache,
          children: 'Clear all cache',
          onPress: onClearCache,
        }),
      }),
    ),
  )
}
