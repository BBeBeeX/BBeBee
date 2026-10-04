import { createElement as h, useState, type ReactElement } from 'react'
import type { PluginInfo } from '@BBeBee/protocol'
import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { PluginCard } from './PluginCard.js'

export interface PluginGroupPanelProps {
  title: string
  systemId: string
  plugins: readonly PluginInfo[]
  description?: string
  showAdvancedSettings?: boolean
  onToggleEnabled?: (plugin: PluginInfo, enabled: boolean) => void
  defaultExpanded?: boolean
}

export function PluginGroupPanel({
  title,
  systemId,
  plugins,
  description,
  showAdvancedSettings = false,
  onToggleEnabled,
  defaultExpanded = true,
}: PluginGroupPanelProps): ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return h(
    'div',
    {
      'data-testid': `plugin-group-${systemId}`,
      style: {
        display: 'flex',
        flexDirection: 'column',
        borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
        paddingBottom: 20,
        marginBottom: 20,
      },
    },
    // Header row
    h(
      'button',
      {
        type: 'button',
        onClick: () => setExpanded((prev) => !prev),
        'aria-expanded': expanded,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '8px 4px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          userSelect: 'none',
        },
      },
      // Left: Group title & Count badge & Description
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          },
        },
        h(
          'span',
          {
            style: {
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary, #FFFFFF)',
            },
          },
          title,
        ),
        h(
          'span',
          {
            style: {
              fontSize: 11,
              fontWeight: 600,
              padding: '1px 7px',
              borderRadius: 10,
              background: 'rgba(255, 255, 255, 0.08)',
              color: 'var(--text-secondary, #C5CAD8)',
            },
          },
          plugins.length,
        ),
        description
          ? h(
              'span',
              {
                style: {
                  fontSize: 12,
                  color: 'var(--text-tertiary, #8E8E93)',
                  fontWeight: 400,
                  marginLeft: 4,
                },
              },
              `— ${description}`,
            )
          : null,
      ),
      // Right: expand / collapse arrow
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

    // Group Content (Grid)
    expanded
      ? plugins.length === 0
        ? h(
            'div',
            {
              style: {
                fontSize: 12,
                color: 'var(--text-tertiary, #8E8E93)',
                padding: '16px 4px',
                fontStyle: 'italic',
              },
            },
            '无匹配的插件',
          )
        : h(
            'div',
            {
              style: {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, max(280px, calc(50% - 6px))), 1fr))',
                alignItems: 'start',
                gap: 12,
                marginTop: 10,
              },
            },
            plugins.map((plugin) =>
              h(PluginCard, {
                key: plugin.id,
                plugin,
                showAdvancedSettings,
                onToggleEnabled,
              }),
            ),
          )
      : null,
  )
}
