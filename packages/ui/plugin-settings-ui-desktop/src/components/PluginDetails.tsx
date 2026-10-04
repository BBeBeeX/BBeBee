import { createElement as h, type ReactElement } from 'react'
import type { PluginInfo, ConfigStatus, PluginRuntimeState } from '@BBeBee/protocol'
import { Switch } from './Switch.js'

export interface PluginDetailsProps {
  plugin: PluginInfo
  onToggleEnabled?: (plugin: PluginInfo, enabled: boolean) => void
}

function formatRuntimeState(state: PluginRuntimeState): string {
  switch (state) {
    case 'ACTIVE':
      return '运行中 (ACTIVE)'
    case 'PENDING':
      return '等待依赖中 (PENDING)'
    case 'LOADING':
      return '加载中 (LOADING)'
    case 'FAILED':
      return '启动失败 (FAILED)'
    case 'DISPOSED':
      return '已释放 (DISPOSED)'
    case 'UNLOADING':
      return '卸载中 (UNLOADING)'
    case 'UNLOADED':
      return '未加载 (UNLOADED)'
    default:
      return `${state}`
  }
}

function formatConfigStatus(status?: ConfigStatus): string {
  switch (status) {
    case 'customized':
      return '有可配置项且已自定义'
    case 'default':
      return '有可配置项但用默认值'
    case 'none':
    default:
      return '无可配置项'
  }
}

export function PluginDetails({
  plugin,
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
      renderDetailRow('完整名称', `${plugin.displayName} (${plugin.id})`),
      renderDetailRow('版本', plugin.version || '0.0.0'),
      renderDetailRow('作者', plugin.author || '—'),
      renderDetailRow('配置状态', formatConfigStatus(plugin.configStatus)),
      renderDetailRow(
        '运行状态',
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
            plugin.error ? h('div', null, `错误：${plugin.error}`) : null,
            plugin.waitingFor.length > 0
              ? h('div', null, `等待服务：${plugin.waitingFor.join(', ')}`)
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
          `依赖 (${plugin.dependencies.length})`,
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
          plugin.dependencies.length ? plugin.dependencies.join(', ') : '无',
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
          `被依赖 (${plugin.dependents.length})`,
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
          plugin.dependents.length ? plugin.dependents.join(', ') : '无',
        ),
      ),
    ),

    // c. Enable switch (only for layer-4 feature and layer-5 ui)
    isFeatureOrUi
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
            h('span', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #FFFFFF)' } }, '启用插件'),
            h(
              'span',
              { style: { fontSize: 11, color: 'var(--text-tertiary, #8E8E93)' } },
              plugin.enabled ? '已启用，停用需重启或注销' : '未启用，开启后立即加载',
            ),
          ),
          h(Switch, {
            checked: plugin.enabled,
            onChange: (checked) => onToggleEnabled?.(plugin, checked),
            accessibilityLabel: `切换插件 ${plugin.displayName} 启用状态`,
          }),
        )
      : null,
  )
}
