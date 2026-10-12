import { Switch, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PluginInfo, ConfigStatus, PluginRuntimeState } from '@BBeBee/protocol'

export interface PluginDetailsProps {
  ctx: Context
  plugin: PluginInfo
  showAdvancedSettings?: boolean
  onToggleEnabled?: (plugin: PluginInfo, enabled: boolean) => void
}

function formatRuntimeState(state: PluginRuntimeState, t: (key: string) => string): string {
  switch (state) {
    case 'ACTIVE':
      return t('settings:pluginDetails.stateActive')
    case 'PENDING':
      return t('settings:pluginDetails.statePending')
    case 'LOADING':
      return t('settings:pluginDetails.stateLoading')
    case 'FAILED':
      return t('settings:pluginDetails.stateFailed')
    case 'DISPOSED':
      return t('settings:pluginDetails.stateDisposed')
    case 'UNLOADING':
      return t('settings:pluginDetails.stateUnloading')
    case 'UNLOADED':
      return t('settings:pluginDetails.stateUnloaded')
    default:
      return `${state}`
  }
}

function formatConfigStatus(status: ConfigStatus | undefined, t: (key: string) => string): string {
  switch (status) {
    case 'customized':
      return t('settings:pluginDetails.configCustomized')
    case 'default':
      return t('settings:pluginDetails.configDefault')
    case 'none':
    default:
      return t('settings:pluginDetails.configNone')
  }
}

export function PluginDetails({
  ctx,
  plugin,
  showAdvancedSettings = false,
  onToggleEnabled,
}: PluginDetailsProps): ReactElement {
  const { t } = useI18n(ctx)
  const isFeatureOrUi = plugin.systemId === 'layer-4' || plugin.systemId === 'layer-5'

  const renderDetailRow = (label: string, value: string | ReactElement) =>
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          fontSize: 12,
          lineHeight: '18px',
          gap: 12,
        },
      },
      h('span', { style: { color: 'var(--text-tertiary, #8E8E93)', flexShrink: 0 } }, label),
      h(
        'span',
        {
          style: {
            color: 'var(--text-primary, #FFFFFF)',
            textAlign: 'right',
            wordBreak: 'break-all',
          },
        },
        value,
      ),
    )

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        paddingTop: 12,
        borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
      },
    },
    // a. Key-value details
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      renderDetailRow(t('settings:pluginDetails.fullName'), `${plugin.displayName} (${plugin.id})`),
      renderDetailRow(t('settings:pluginDetails.version'), plugin.version || '0.0.0'),
      renderDetailRow(t('settings:pluginDetails.author'), plugin.author || '—'),
      renderDetailRow(t('settings:pluginDetails.configStatus'), formatConfigStatus(plugin.configStatus, t)),
      renderDetailRow(
        t('settings:pluginDetails.runtimeState'),
        h(
          'span',
          {
            style: {
              color:
                plugin.state === 'ACTIVE'
                  ? 'var(--bb-state-ok, var(--success, #22C55E))'
                  : plugin.state === 'FAILED'
                    ? 'var(--bb-state-error, var(--error, #EF4444))'
                    : 'var(--text-secondary, #C5CAD8)',
            },
          },
          formatRuntimeState(plugin.state, t),
        ),
      ),
      plugin.state === 'FAILED' && (plugin.error || plugin.waitingFor.length > 0)
        ? h(
            'div',
            {
              style: {
                marginTop: 4,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                fontSize: 11,
                color: 'var(--bb-state-error, var(--error, #EF4444))',
                lineHeight: 1.4,
              },
            },
            plugin.error ? h('div', null, t('settings:pluginDetails.error', { error: plugin.error })) : null,
            plugin.waitingFor.length > 0
              ? h('div', null, t('settings:pluginDetails.waitingForServices', { services: plugin.waitingFor.join(', ') }))
              : null,
          )
        : null,
    ),

    // b. Dependencies section (lighter background box)
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
          borderRadius: 6,
          padding: '10px 12px',
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(
          'div',
          {
            style: {
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary, #C5CAD8)',
            },
          },
          t('settings:pluginDetails.dependenciesCount', { count: plugin.dependencies.length }),
        ),
        h(
          'div',
          {
            style: {
              fontSize: 11,
              color: plugin.dependencies.length ? 'var(--text-primary, #FFFFFF)' : 'var(--text-tertiary, #8E8E93)',
              lineHeight: 1.4,
              wordBreak: 'break-all',
            },
          },
          plugin.dependencies.length ? plugin.dependencies.join(', ') : t('settings:pluginDetails.none'),
        ),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            paddingTop: 6,
          },
        },
        h(
          'div',
          {
            style: {
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary, #C5CAD8)',
            },
          },
          t('settings:pluginDetails.dependentsCount', { count: plugin.dependents.length }),
        ),
        h(
          'div',
          {
            style: {
              fontSize: 11,
              color: plugin.dependents.length ? 'var(--text-primary, #FFFFFF)' : 'var(--text-tertiary, #8E8E93)',
              lineHeight: 1.4,
              wordBreak: 'break-all',
            },
          },
          plugin.dependents.length ? plugin.dependents.join(', ') : t('settings:pluginDetails.none'),
        ),
      ),
    ),

    // c. Enable switch (only for layer-4 feature and layer-5 ui, and ONLY when showAdvancedSettings is true)
    isFeatureOrUi
      ? showAdvancedSettings
        ? h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 4,
                gap: 12,
              },
            },
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              h('span', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #FFFFFF)' } }, t('settings:pluginDetails.enablePlugin')),
              h(
                'span',
                { style: { fontSize: 11, color: 'var(--text-tertiary, #8E8E93)' } },
                plugin.enabled
                  ? t('settings:pluginDetails.enabledTurningOffUnloadsIt')
                  : t('settings:pluginDetails.notEnabledTurningOnLoads'),
              ),
            ),
            h(Switch, {
              checked: plugin.enabled,
              onChange: (checked) => onToggleEnabled?.(plugin, checked),
              accessibilityLabel: t('settings:pluginDetails.togglePluginEnabledState', {
                displayName: plugin.displayName,
              }),
            }),
          )
        : h(
            'div',
            {
              style: {
                fontSize: 11,
                color: 'var(--text-tertiary, #8E8E93)',
                fontStyle: 'italic',
                paddingTop: 4,
              },
            },
            t('settings:pluginDetails.enableHidden'),
          )
      : null,
  )
}
