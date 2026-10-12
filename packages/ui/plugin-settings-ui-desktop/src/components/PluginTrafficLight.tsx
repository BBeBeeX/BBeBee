import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { useI18n } from '@BBeBee/ui-kit-desktop'
import type { PluginRuntimeState } from '@BBeBee/protocol'

export interface PluginTrafficLightProps {
  ctx: Context
  enabled: boolean
  state: PluginRuntimeState
}

export function PluginTrafficLight({
  ctx,
  enabled,
  state,
}: PluginTrafficLightProps): ReactElement {
  const { t } = useI18n(ctx)
  let color = 'var(--bb-state-error, var(--error, #EF4444))'
  let label = t('settings:pluginTrafficLight.notEnabled')
  let glow = 'rgba(239, 68, 68, 0.4)'

  if (enabled) {
    if (state === 'ACTIVE') {
      color = 'var(--bb-state-ok, var(--success, #22C55E))'
      label = t('settings:pluginTrafficLight.enabledRunningNormallyACTIVE')
      glow = 'rgba(34, 197, 94, 0.4)'
    } else {
      color = 'var(--bb-state-warn, var(--warning, #F59E0B))'
      label = t('settings:pluginTrafficLight.enabled', { state })
      glow = 'rgba(245, 158, 11, 0.4)'
    }
  }

  return h('span', {
    title: label,
    'aria-label': label,
    'data-testid': 'plugin-traffic-light',
    style: {
      display: 'inline-block',
      width: 9,
      height: 9,
      borderRadius: '50%',
      backgroundColor: color,
      boxShadow: `0 0 6px ${glow}`,
      flexShrink: 0,
      transition: 'background-color 0.2s ease, box-shadow 0.2s ease',
    },
  })
}
