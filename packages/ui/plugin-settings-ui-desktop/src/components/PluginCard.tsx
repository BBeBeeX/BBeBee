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
        // Liveness verdict (audit W3): the registry entry is gone, the
        // installed copy is quarantined — say so on the card itself.
        plugin.delisted
          ? h(
              'span',
              {
                'data-testid': `plugin-delisted-${plugin.id}`,
                title: t('settings:pluginMarket.delistedHint'),
                style: {
                  alignSelf: 'flex-start',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 9,
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--state-error, #EF4444)',
                },
              },
              t('settings:pluginMarket.delisted'),
            )
          : null,
        // Registry ban (audit W5): a stronger state than delisting —
        // the registry actively banned this id; the reason rides in
        // the tooltip.
        plugin.blocked !== undefined
          ? h(
              'span',
              {
                'data-testid': `plugin-blocked-${plugin.id}`,
                title: t('settings:pluginMarket.blockedHint', { reason: plugin.blocked }),
                style: {
                  alignSelf: 'flex-start',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 7px',
                  borderRadius: 9,
                  background: 'rgba(239, 68, 68, 0.3)',
                  color: '#FCA5A5',
                },
              },
              t('settings:pluginMarket.blocked'),
            )
          : null,
        // npm provenance (audit W6): the installed version's
        // attestation names the registry entry's repo as its source —
        // the positive counterpart to the quarantine badges above.
        plugin.provenanceVerified
          ? h(
              'span',
              {
                'data-testid': `plugin-provenance-${plugin.id}`,
                title: t('settings:pluginMarket.provenanceVerifiedHint'),
                style: {
                  alignSelf: 'flex-start',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 9,
                  background: 'rgba(34, 197, 94, 0.15)',
                  color: 'var(--state-success, #22C55E)',
                },
              },
              t('settings:pluginMarket.provenanceVerified'),
            )
          : null,
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
