import { createElement as h, useMemo, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import type { PluginInfo, PluginManagerService } from '@BBeBee/protocol'
import { Button, Sheet } from '@BBeBee/ui-kit-desktop'
import { PluginSearchBox } from '../PluginSearchBox.js'
import { PluginGroupPanel } from '../PluginGroupPanel.js'

export interface PluginsSectionProps {
  ctx: Context
}

interface GroupSpec {
  systemId: string
  title: string
}

const GROUPS: readonly GroupSpec[] = [
  { systemId: 'layer-2', title: '核心 (core)' },
  { systemId: 'layer-3', title: '日志 (logs)' },
  { systemId: 'layer-4', title: '功能 (feature)' },
  { systemId: 'layer-5', title: '界面 (ui)' },
]

export function PluginsSection({ ctx }: PluginsSectionProps): ReactElement {
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
    const q = searchQuery.trim().toLowerCase()
    if (!q) return allPlugins
    return allPlugins.filter((p) => {
      const matchId = p.id.toLowerCase().includes(q)
      const matchName = p.name.toLowerCase().includes(q)
      const matchDisplay = (p.displayName || '').toLowerCase().includes(q)
      const matchModule = (p.moduleId || '').toLowerCase().includes(q)
      return matchId || matchName || matchDisplay || matchModule
    })
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
        plugins: groupPlugins,
        onToggleEnabled: handleToggle,
      })
    }),

    // Confirmation Sheet for disabling a plugin with active dependents
    h(
      Sheet,
      {
        open: Boolean(pendingDisable),
        onClose: () => setPendingDisable(null),
        title: '停用插件确认',
        accessibilityLabel: '停用插件确认',
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
              `停用「${pendingDisable.plugin.displayName}」可能会影响以下正在运行的依赖项：`,
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
              '若继续停用，依赖该插件的功能可能无法正常运行。是否确认停用？',
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
                children: '取消',
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
                '确认停用',
              ),
            ),
          )
        : null,
    ),
  )
}
