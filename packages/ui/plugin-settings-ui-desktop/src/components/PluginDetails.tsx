import { Switch } from '@BBeBee/ui-kit-desktop'
import { createElement as h, type ReactElement } from 'react'
import type { PluginInfo, ConfigStatus, PluginRuntimeState } from '@BBeBee/protocol'

export interface PluginDetailsProps {
  plugin: PluginInfo
  showAdvancedSettings?: boolean
  onToggleEnabled?: (plugin: PluginInfo, enabled: boolean) => void
}

function formatRuntimeState(state: PluginRuntimeState): string {
  switch (state) {
    case 'ACTIVE':
      return 'Running (ACTIVE)'
    case 'PENDING':
      return 'Waiting for dependencies (PENDING)'
    case 'LOADING':
      return 'Loading (LOADING)'
    case 'FAILED':
      return 'Failed to start (FAILED)'
    case 'DISPOSED':
      return 'Disposed (DISPOSED)'
    case 'UNLOADING':
      return 'Unloading (UNLOADING)'
    case 'UNLOADED':
      return 'Unloaded (UNLOADED)'
    default:
      return `${state}`
  }
}

function formatConfigStatus(status?: ConfigStatus): string {
  switch (status) {
    case 'customized':
      return 'Configurable and customized'
    case 'default':
      return 'Configurable, using defaults'
    case 'none':
    default:
      return 'No configurable options'
  }
}

export function PluginDetails({
  plugin,
  showAdvancedSettings = false,
  onToggleEnabled,
}: PluginDetailsProps): ReactElement {
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
      renderDetailRow('Full name', `${plugin.displayName} (${plugin.id})`),
      renderDetailRow('Version', plugin.version || '0.0.0'),
      renderDetailRow('Author', plugin.author || '—'),
      renderDetailRow('Config status', formatConfigStatus(plugin.configStatus)),
      renderDetailRow(
        'Runtime state',
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
          formatRuntimeState(plugin.state),
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
            plugin.error ? h('div', null, `Error: ${plugin.error}`) : null,
            plugin.waitingFor.length > 0
              ? h('div', null, `Waiting for services: ${plugin.waitingFor.join(', ')}`)
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
          `Dependencies (${plugin.dependencies.length})`,
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
          plugin.dependencies.length ? plugin.dependencies.join(', ') : 'None',
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
          `Dependents (${plugin.dependents.length})`,
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
          plugin.dependents.length ? plugin.dependents.join(', ') : 'None',
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
              h('span', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #FFFFFF)' } }, 'Enable plugin'),
              h(
                'span',
                { style: { fontSize: 11, color: 'var(--text-tertiary, #8E8E93)' } },
                plugin.enabled ? 'Enabled; turning off unloads it immediately' : 'Not enabled; turning on loads it immediately',
              ),
            ),
            h(Switch, {
              checked: plugin.enabled,
              onChange: (checked) => onToggleEnabled?.(plugin, checked),
              accessibilityLabel: `Toggle plugin ${plugin.displayName} enabled state`,
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
            '(Plugin enable/disable is hidden; enable advanced settings on the "About" page)',
          )
      : null,
  )
}
