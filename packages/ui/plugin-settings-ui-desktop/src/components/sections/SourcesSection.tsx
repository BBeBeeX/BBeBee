import { Button } from '@BBeBee/ui-kit-desktop'
import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SettingsContribution } from '@BBeBee/protocol'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface SourcesSectionProps {
  ctx?: Context
  contributions?: readonly SettingsContribution[]
  onNavigate: (route: string) => void
}

export function SourcesSection({
  ctx,
  contributions = [],
  onNavigate,
}: SourcesSectionProps): ReactElement {
  const sourcesContribs = contributions.filter((c) => c.section === 'sources')

  const items: readonly SettingsContribution[] = sourcesContribs.length > 0 ? sourcesContribs : [
    {
      id: 'sources.settings',
      section: 'sources',
      title: '音乐来源配置 (Music Sources)',
      description: '查看已启用的网络音源、进行源能力健康诊断或管理第三方音源列表',
      actionText: '管理音乐源',
    },
    {
      id: 'sources.import',
      section: 'sources',
      title: '导入音源 (Import Sources)',
      description: '从剪贴板文本、本地 JSON 规则文件或网络 URL 导入第三方音源脚本 (Legado 格式)',
      actionText: '导入音源',
    },
    {
      id: 'scanner.settings',
      section: 'sources',
      title: '本地音乐文件夹 (Music Folders)',
      description: '添加包含本地音频文件的文件夹，即时执行扫描并建立索引',
      actionText: '管理文件夹',
    },
  ]

  return h(
    'div',
    { id: 'section-sources' },
    h(
      SettingsSection,
      {
        title: '曲库音源与文件',
        description: '管理音乐来源提供方、网络源能力诊断及本地媒体目录索引',
      },
      items.map((item, idx) => {
        const isLast = idx === items.length - 1
        if (item.display === 'card' && ctx) {
          const CardView = ctx.ui?.viewFor?.(item.id) as React.ComponentType<{ ctx: Context }> | undefined
          if (CardView) return h(CardView, { key: item.id, ctx })
        }
        return h(SettingsRow, {
          key: item.id,
          title: item.title,
          description: item.description,
          borderBottom: !isLast,
          action: h(Button, {
            children: item.actionText ?? '管理',
            onPress: () => {
              if (item.action) void item.action()
              else onNavigate(item.id)
            },
          }),
        })
      }),
    ),
  )
}
