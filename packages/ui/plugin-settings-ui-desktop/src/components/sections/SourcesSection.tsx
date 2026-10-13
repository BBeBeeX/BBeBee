import { Button, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { I18nService, SettingsContribution } from '@BBeBee/protocol'
import { useAudioSourcesStatus, type AudioSourceStatusItem } from '@BBeBee/plugin-sources/hooks'
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

function AudioSourceRow({
  item,
  t,
  onTest,
  onManage,
}: {
  item: AudioSourceStatusItem
  t: I18nService['t']
  onTest: (id: string) => void
  onManage: (id: string) => void
}): ReactElement {
  const isAuth = item.authStatus.state === 'authenticated'
  const isExpired = item.authStatus.state === 'expired'
  const isAuthError = item.authStatus.state === 'error'
  const pingStatus = item.ping?.status

  let dotColor = '#94A3B8'
  let probeText = t('settings:sources.offline')
  let probeBg = 'rgba(255, 255, 255, 0.05)'
  let probeColor = 'var(--text-secondary, #C5CAD8)'

  if (!item.enabled) {
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

  if (item.authStatus.state === 'authenticated') {
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

  return h(
    'div',
    {
      key: item.id,
      'data-testid': `settings-source-item-${item.id}`,
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 14px',
        margin: '6px 0',
        borderRadius: 8,
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        gap: 12,
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
        'data-testid': `settings-source-dot-${item.id}`,
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
        },
      },
      h(
        'span',
        {
          'data-testid': `settings-source-auth-${item.id}`,
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
          'data-testid': `settings-source-probe-${item.id}`,
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
        variant: 'secondary',
        testID: `settings-source-test-${item.id}`,
        disabled: item.isPinging || !item.enabled,
        onPress: () => onTest(item.id),
        children: item.isPinging ? '…' : t('settings:sources.test'),
      }),
      h(Button, {
        variant: 'ghost',
        testID: `settings-source-manage-${item.id}`,
        onPress: () => onManage(item.id),
        children: t('settings:sources.manage'),
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

  const connectedCount = audioSources.filter(
    (item) => item.enabled && (item.authStatus.state === 'authenticated' || item.ping?.status === 'ok'),
  ).length

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
            disabled: audioSources.length === 0,
            onPress: () => void testAll(),
            children: t('settings:sources.testAll'),
          }),
          h(Button, {
            variant: 'secondary',
            testID: 'settings-sources-manage-all',
            onPress: () => onNavigate('sources.settings'),
            children: t('settings:sources.manageMusicSources'),
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
        : audioSources.map((item) =>
            h(AudioSourceRow, {
              key: item.id,
              item,
              t,
              onTest: (id) => void testConnection(id),
              onManage: () => onNavigate('sources.settings'),
            }),
          ),
    ),
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

