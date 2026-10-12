import { tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { PluginInfo } from '@BBeBee/protocol'
import { PluginTrafficLight } from './PluginTrafficLight.js'
import { PluginDetails } from './PluginDetails.js'

export interface PluginCardProps {
  ctx: Context
  plugin: PluginInfo
  showAdvancedSettings?: boolean
  onToggleEnabled?: (plugin: PluginInfo, enabled: boolean) => void
  defaultExpanded?: boolean
}

export function PluginCard({
  ctx,
  plugin,
  showAdvancedSettings = false,
  onToggleEnabled,
  defaultExpanded = false,
}: PluginCardProps): ReactElement {
  const { t } = useI18n(ctx)
  const [expanded, setExpanded] = useState(defaultExpanded)

  return h(
    'div',
    {
      'data-testid': `plugin-card-${plugin.id}`,
      style: {
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 8,
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
        background: 'rgba(255, 255, 255, 0.025)',
        padding: '12px 14px',
        gap: expanded ? 12 : 0,
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
      },
    },
    // Header row
    h(
      'div',
      {
        role: 'button',
        tabIndex: 0,
        'aria-label': expanded
          ? t('settings:settingsRow.collapse', { title: plugin.displayName || plugin.name })
          : t('settings:settingsRow.expand', { title: plugin.displayName || plugin.name }),
        onClick: () => setExpanded((prev) => !prev),
        onKeyDown: (e: { key: string }) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setExpanded((prev) => !prev)
          }
        },
        'aria-expanded': expanded,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          gap: 12,
        },
      },
      // Left title and ID
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            overflow: 'hidden',
          },
        },
        h(
          'span',
          {
            style: {
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary, #FFFFFF)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          plugin.displayName || plugin.name,
        ),
        h(
          'span',
          {
            style: {
              fontSize: 11,
              color: 'var(--text-tertiary, #8E8E93)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          plugin.id,
        ),
      ),
      // Right status traffic light and chevron
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          },
        },
        h(PluginTrafficLight, {
          ctx,
          enabled: plugin.enabled,
          state: plugin.state,
        }),
        h(
          'span',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              color: 'var(--text-tertiary, #8E8E93)',
              transition: 'transform 0.2s ease',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            },
          },
          tablerIcon('chevron-down', { size: 16 }),
        ),
      ),
    ),

    // Expanded details
    expanded
      ? h(PluginDetails, {
          ctx,
          plugin,
          showAdvancedSettings,
          onToggleEnabled,
        })
      : null,
  )
}
