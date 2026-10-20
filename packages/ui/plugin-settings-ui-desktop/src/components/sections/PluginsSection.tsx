import { Button, Sheet, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useMemo, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import type { PluginInfo, PluginManagerService } from '@BBeBee/protocol'
import { filterPlugins } from '@BBeBee/toolkit'
import { PluginSearchBox } from '../PluginSearchBox.js'
import { PluginGroupPanel } from '../PluginGroupPanel.js'
import { PluginMarketSection } from '../PluginMarketSection.js'

export interface PluginsSectionProps {
  ctx: Context
  showAdvancedSettings?: boolean
}

interface GroupSpec {
  systemId: string
  titleKey?: string
  fallbackTitle: string
  descriptionKey?: string
}

const GROUPS: readonly GroupSpec[] = [
  { systemId: 'layer-2', titleKey: 'settings:plugins.core', fallbackTitle: 'Core', descriptionKey: 'settings:plugins.desktopLowLevelInfrastructure' },
  { systemId: 'layer-3', titleKey: 'settings:plugins.logs', fallbackTitle: 'Logs' },
  { systemId: 'layer-4', titleKey: 'settings:plugins.features', fallbackTitle: 'Features' },
  { systemId: 'layer-5', titleKey: 'settings:plugins.ui', fallbackTitle: 'UI' },
]

export function PluginsSection({ ctx, showAdvancedSettings = false }: PluginsSectionProps): ReactElement {
  const { t } = useI18n(ctx)
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
    // Plugin Market (registry browse + npm install/update/uninstall)
    h(PluginMarketSection, { ctx }),

    // Search box
    h(PluginSearchBox, {
      ctx,
      value: searchQuery,
      onChange: setSearchQuery,
    }),

    // Four layered group panels
    GROUPS.map((g) => {
      const groupPlugins = filteredPlugins.filter((p) => p.systemId === g.systemId)
      return h(PluginGroupPanel, {
        key: g.systemId,
        ctx,
        title: g.titleKey ? t(g.titleKey) : g.fallbackTitle,
        systemId: g.systemId,
        description: g.descriptionKey ? t(g.descriptionKey) : undefined,
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
        title: t('settings:plugins.confirmDisablingPlugin'),
        accessibilityLabel: t('settings:plugins.confirmDisablingPlugin'),
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
              t('settings:plugins.disablingMayAffectTheFollowing', {
                displayName: pendingDisable.plugin.displayName,
              }),
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
              t('settings:plugins.ifYouContinue'),
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
                children: t('app:common.cancel'),
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
                t('settings:plugins.disablePlugin'),
              ),
            ),
          )
        : null,
    ),
  )
}
