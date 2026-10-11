import { Button, Sheet } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useMemo, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import type { PluginInfo, PluginManagerService } from '@BBeBee/protocol'
import { filterPlugins } from '@BBeBee/toolkit'
import { PluginSearchBox } from '../PluginSearchBox.js'
import { PluginGroupPanel } from '../PluginGroupPanel.js'

export interface PluginsSectionProps {
  ctx: Context
  showAdvancedSettings?: boolean
}

interface GroupSpec {
  systemId: string
  title: string
  description?: string
}

const GROUPS: readonly GroupSpec[] = [
  { systemId: 'layer-2', title: 'Core', description: 'Desktop low-level infrastructure' },
  { systemId: 'layer-3', title: 'Logs' },
  { systemId: 'layer-4', title: 'Features' },
  { systemId: 'layer-5', title: 'UI' },
]

export function PluginsSection({ ctx, showAdvancedSettings = false }: PluginsSectionProps): ReactElement {
  const [searchQuery, setSearchQuery] = useState('')
  const [pendingDisable, setPendingDisable] = useState<{
    plugin: PluginInfo
    activeDependents: PluginInfo[]
  } | null>(null)

  const pluginManager = serviceOf<PluginManagerService>(ctx, 'plugin-manager')

  const allPlugins = useServiceState<readonly PluginInfo[]>(
    ctx,
    [
      'plugin-manager/enabled-changed',
      'plugin-manager/changed',
      'plugin/loaded',
      'plugin/unloaded',
      'plugin/failed',
    ],
    () => {
      const pm = serviceOf<PluginManagerService>(ctx, 'plugin-manager')
      return pm?.list() ?? []
    },
  )

  const filteredPlugins = useMemo(() => {
    return filterPlugins(allPlugins, searchQuery)
  }, [allPlugins, searchQuery])

  const handleToggle = (plugin: PluginInfo, enabled: boolean) => {
    if (!pluginManager) return

    if (!enabled) {
      // Find active dependents
      const activeDependents = allPlugins.filter(
        (other) =>
          plugin.dependents.includes(other.id) &&
          other.enabled &&
          other.state === 'ACTIVE',
      )

      if (activeDependents.length > 0) {
        setPendingDisable({ plugin, activeDependents })
        return
      }
    }

    void pluginManager.setEnabled(plugin.id, enabled)
  }

  const handleConfirmDisable = () => {
    if (pendingDisable && pluginManager) {
      void pluginManager.setEnabled(pendingDisable.plugin.id, false)
    }
    setPendingDisable(null)
  }

  return h(
    'div',
    {
      id: 'section-plugins',
      'data-testid': 'plugins-section',
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      },
    },
    // Search box
    h(PluginSearchBox, {
      value: searchQuery,
      onChange: setSearchQuery,
    }),

    // Four layered group panels
    GROUPS.map((g) => {
      const groupPlugins = filteredPlugins.filter((p) => p.systemId === g.systemId)
      return h(PluginGroupPanel, {
        key: g.systemId,
        title: g.title,
        systemId: g.systemId,
        description: g.description,
        plugins: groupPlugins,
        showAdvancedSettings,
        onToggleEnabled: handleToggle,
      })
    }),

    // Confirmation Sheet for disabling a plugin with active dependents
    h(
      Sheet,
      {
        open: Boolean(pendingDisable),
        onClose: () => setPendingDisable(null),
        title: 'Confirm disabling plugin',
        accessibilityLabel: 'Confirm disabling plugin',
      },
      pendingDisable
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            h(
              'p',
              {
                style: {
                  margin: 0,
                  fontSize: 13,
                  color: 'var(--text-primary, #FFFFFF)',
                  lineHeight: 1.5,
                },
              },
              `Disabling "${pendingDisable.plugin.displayName}" may affect the following running dependents:`,
            ),
            h(
              'ul',
              {
                style: {
                  margin: 0,
                  paddingLeft: 20,
                  fontSize: 12,
                  color: 'var(--text-secondary, #C5CAD8)',
                  lineHeight: 1.6,
                },
              },
              pendingDisable.activeDependents.map((dep) =>
                h(
                  'li',
                  { key: dep.id },
                  `${dep.displayName} (${dep.id})`,
                ),
              ),
            ),
            h(
              'p',
              {
                style: {
                  margin: 0,
                  fontSize: 12,
                  color: 'var(--bb-state-warn, var(--warning, #F59E0B))',
                  lineHeight: 1.4,
                },
              },
              'If you continue, features that depend on this plugin may stop working. Disable it?',
            ),
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                  marginTop: 8,
                },
              },
              h(Button, {
                children: 'Cancel',
                variant: 'secondary',
                onPress: () => setPendingDisable(null),
              }),
              h(
                'button',
                {
                  type: 'button',
                  'data-testid': 'confirm-disable-plugin-btn',
                  onClick: handleConfirmDisable,
                  style: {
                    padding: '6px 16px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--bb-state-error, var(--error, #EF4444))',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: 13,
                  },
                },
                'Disable plugin',
              ),
            ),
          )
        : null,
    ),
  )
}
