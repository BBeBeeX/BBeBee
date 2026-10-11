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
      title: 'Music source configuration (Music Sources)',
      description: 'View enabled online sources, run source capability health checks, or manage third-party sources',
      actionText: 'Manage music sources',
    },
    {
      id: 'sources.import',
      section: 'sources',
      title: 'Import sources (Import Sources)',
      description: 'Import third-party source scripts (Legado format) from clipboard text, local JSON rule files or a URL',
      actionText: 'Import sources',
    },
    {
      id: 'scanner.settings',
      section: 'sources',
      title: 'Music folders',
      description: 'Add folders containing local audio files; scanning and indexing run immediately',
      actionText: 'Manage folders',
    },
  ]

  return h(
    'div',
    { id: 'section-sources' },
    h(
      SettingsSection,
      {
        title: 'Music sources & files',
        description: 'Manage music source providers, online source capability diagnostics and local media folder indexing',
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
            children: item.actionText ?? 'Manage',
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
