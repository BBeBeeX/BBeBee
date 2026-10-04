import { createElement as h, type ReactElement } from 'react'
import type { PluginRuntimeState } from '@BBeBee/protocol'

export interface PluginTrafficLightProps {
  enabled: boolean
  state: PluginRuntimeState
}

export function PluginTrafficLight({
  enabled,
  state,
}: PluginTrafficLightProps): ReactElement {
  let color = 'var(--bb-state-error, var(--error, #EF4444))'
  let label = '未启用'
  let glow = 'rgba(239, 68, 68, 0.4)'

  if (enabled) {
    if (state === 'ACTIVE') {
      color = 'var(--bb-state-ok, var(--success, #22C55E))'
      label = '已启用 · 运行正常 (ACTIVE)'
      glow = 'rgba(34, 197, 94, 0.4)'
    } else {
      color = 'var(--bb-state-warn, var(--warning, #F59E0B))'
      label = `已启用 · ${state}`
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
