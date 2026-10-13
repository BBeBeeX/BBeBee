import { Button, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { I18nService, SettingsContribution } from '@BBeBee/protocol'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface SourcesSectionProps {
  ctx: Context
  contributions?: readonly SettingsContribution[]
  onNavigate: (route: string) => void
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
  if (item.id === 'scanner.settings' || item.title === 'Music folders') {
    return t('settings:sources.musicFolders')
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
  if (item.id === 'scanner.settings' || item.description?.startsWith('Add folders')) {
    return t('settings:sources.addFoldersContainingLocalAudio')
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
  if (item.id === 'scanner.settings' || item.actionText === 'Manage folders') {
    return t('settings:sources.manageFolders')
  }
  return item.actionText ?? t('settings:sources.manage')
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
  )
}
