import { Button, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SettingsContribution } from '@BBeBee/protocol'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface SourcesSectionProps {
  ctx: Context
  contributions?: readonly SettingsContribution[]
  onNavigate: (route: string) => void
}

export function SourcesSection({
  ctx,
  contributions = [],
  onNavigate,
}: SourcesSectionProps): ReactElement {
  const { t } = useI18n(ctx)
  const sourcesContribs = contributions.filter((c) => c.section === 'sources')

  const items: readonly SettingsContribution[] = sourcesContribs.length > 0 ? sourcesContribs : [
    {
      id: 'sources.settings',
      section: 'sources',
      title: t('settings:sources.musicSourceConfigurationMusicSources'),
      description: t('settings:sources.viewEnabledOnlineSourcesRun'),
      actionText: t('settings:sources.manageMusicSources'),
    },
    {
      id: 'sources.import',
      section: 'sources',
      title: t('settings:sources.importSourcesImportSources'),
      description: t('settings:sources.importThirdPartySourceScripts'),
      actionText: t('settings:sources.importSources'),
    },
    {
      id: 'scanner.settings',
      section: 'sources',
      title: t('settings:sources.musicFolders'),
      description: t('settings:sources.addFoldersContainingLocalAudio'),
      actionText: t('settings:sources.manageFolders'),
    },
  ]

  return h(
    'div',
    { id: 'section-sources' },
    h(
      SettingsSection,
      {
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
          title: item.title,
          description: item.description,
          borderBottom: !isLast,
          action: h(Button, {
            children: item.actionText ?? t('settings:sources.manage'),
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
