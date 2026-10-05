import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SettingsContribution } from '@BBeBee/protocol'
import { formatBytes } from '@BBeBee/toolkit'
import { Button } from '@BBeBee/ui-kit-desktop'
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
        title: '离线存储与下载目录',
        description: '管理离线已下载音乐的本地保存目录及任务策略',
      },
      h(SettingsRow, {
        title: '下载目录',
        description: cleanDisplayPath(currentDownloadsDir),
        action: h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h(Button, {
            variant: 'secondary',
            children: '更改目录',
            onPress: onPickDownloadDir,
          }),
          h(Button, {
            variant: 'secondary',
            children: '打开文件夹',
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
            children: item.actionText ?? '查看详情',
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
        title: '临时缓存与存储目录',
        description: '在线媒体流临时缓冲文件与封面缓存存储路径与清理',
      },
      h(SettingsRow, {
        title: '歌曲缓存目录',
        description: cleanDisplayPath(currentCacheDir),
        action: h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h(Button, {
            variant: 'secondary',
            children: '更改目录',
            onPress: onPickCacheDir,
          }),
          h(Button, {
            variant: 'secondary',
            children: '打开文件夹',
            onPress: onOpenCacheDir,
          }),
        ),
      }),
      h(SettingsRow, {
        title: '缓存占用空间',
        description: `总计: ${formatBytes(usage.totalBytes)} (封面: ${formatBytes(usage.artworkBytes)} · 媒体流: ${formatBytes(usage.streamBytes)})`,
        borderBottom: false,
        action: h(Button, {
          variant: 'secondary',
          disabled: clearingCache || usage.totalBytes === 0,
          loading: clearingCache,
          children: '清除全部缓存',
          onPress: onClearCache,
        }),
      }),
    ),
  )
}
