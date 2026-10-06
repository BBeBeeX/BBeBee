import { Button, Select, Switch } from '@BBeBee/ui-kit-desktop'
import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { ProxySettings, SourceRecord } from '@BBeBee/protocol'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface NetworkSectionProps {
  proxy: ProxySettings
  thirdPartySources: readonly SourceRecord[]
  proxyTesting: boolean
  proxyTestResult: { ok: boolean; latencyMs?: number; error?: string } | null
  onUpdateProxy: (proxy: ProxySettings) => void
  onTestProxy: () => void
  /** The `User-Agent` sent with every request that does not set its own. */
  userAgent: string
  /** Master switch over every imported third-party music source. */
  thirdPartySourcesEnabled: boolean
  /** Master switch over third-party lyric sources. */
  thirdPartyLyricSourcesEnabled: boolean
  onUpdateUserAgent: (userAgent: string) => void
  onToggleThirdPartySources: (enabled: boolean) => void
  onToggleThirdPartyLyricSources: (enabled: boolean) => void
}

export function NetworkSection({
  proxy,
  thirdPartySources,
  proxyTesting,
  proxyTestResult,
  onUpdateProxy,
  onTestProxy,
  userAgent,
  thirdPartySourcesEnabled,
  thirdPartyLyricSourcesEnabled,
  onUpdateUserAgent,
  onToggleThirdPartySources,
  onToggleThirdPartyLyricSources,
}: NetworkSectionProps): ReactElement {
  return h(
    'div',
    { id: 'section-network' },
    h(
      SettingsSection,
      {
        title: '第三方服务设置',
        description: '控制第三方音源与歌词源的启停，以及对外请求所使用的 User-Agent',
      },
      h(SettingsRow, {
        title: '启用第三方音乐源',
        description: '关闭后暂停所有已导入第三方音源的搜索与播放解析，本地文件不受影响',
        action: h(Switch, {
          checked: thirdPartySourcesEnabled,
          accessibilityLabel: '启用第三方音乐源',
          onChange: onToggleThirdPartySources,
        }),
      }),
      h(SettingsRow, {
        title: '启用第三方歌词源',
        description: '关闭后播放时不再通过歌词源检索歌词；下方歌词源列表中的单独开关会保留',
        action: h(Switch, {
          checked: thirdPartyLyricSourcesEnabled,
          accessibilityLabel: '启用第三方歌词源',
          onChange: onToggleThirdPartyLyricSources,
        }),
      }),
      h(SettingsRow, {
        title: 'User-Agent',
        description:
          '作为 HTTP User-Agent 请求头随所有网络请求发送；留空使用内置默认值。音源自带的 header 规则优先生效',
        action: h('input', {
          type: 'text',
          value: userAgent,
          placeholder: 'BBeBee/0.1',
          'aria-label': 'User-Agent',
          onChange: (e: { target: { value: string } }) => onUpdateUserAgent(e.target.value),
          style: {
            width: 280,
            height: 32,
            borderRadius: 6,
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF',
            fontSize: 13,
            padding: '0 10px',
            outline: 'none',
          },
        }),
      }),
    ),
    h(
      SettingsSection,
      {
        title: '网络代理设置',
        description: '配置应用外部请求与在线音源的网络代理协议与路由策略',
      },
      h(SettingsRow, {
        title: '启用网络代理',
        description: '开启后将通过自定义代理服务器转发网络与音乐请求',
        action: h(Switch, {
          checked: proxy.enabled,
          accessibilityLabel: '启用网络代理',
          onChange: (enabled) => onUpdateProxy({ ...proxy, enabled }),
        }),
      }),
      proxy.enabled
        ? h(
            'div',
            null,
            h(SettingsRow, {
              title: '代理协议类型',
              description: '选择代理服务器支持的传输协议',
              action: h(Select<'http' | 'https' | 'socks5'>, {
                value: proxy.protocol,
                options: [
                  { value: 'http', label: 'HTTP 代理' },
                  { value: 'https', label: 'HTTPS 代理' },
                  { value: 'socks5', label: 'SOCKS5 代理' },
                ],
                accessibilityLabel: '代理协议类型',
                onChange: (protocol) => onUpdateProxy({ ...proxy, protocol }),
              }),
            }),
            h(SettingsRow, {
              title: '服务器主机与端口',
              description: '设置代理服务器的主机 IP 或域名以及监听端口',
              action: h(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                h('input', {
                  type: 'text',
                  value: proxy.host,
                  placeholder: '127.0.0.1',
                  'aria-label': '代理服务器主机',
                  onChange: (e: { target: { value: string } }) =>
                    onUpdateProxy({ ...proxy, host: e.target.value.trim() }),
                  style: {
                    width: 140,
                    height: 32,
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#FFFFFF',
                    fontSize: 13,
                    padding: '0 10px',
                    outline: 'none',
                  },
                }),
                h('span', { style: { color: '#8E8E93' } }, ':'),
                h('input', {
                  type: 'number',
                  value: proxy.port || '',
                  placeholder: '7890',
                  'aria-label': '代理服务器端口',
                  onChange: (e: { target: { value: string } }) =>
                    onUpdateProxy({ ...proxy, port: Number(e.target.value) || 0 }),
                  style: {
                    width: 70,
                    height: 32,
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#FFFFFF',
                    fontSize: 13,
                    padding: '0 8px',
                    outline: 'none',
                  },
                }),
                h(Button, {
                  variant: 'secondary',
                  disabled: proxyTesting || !proxy.host || !proxy.port,
                  loading: proxyTesting,
                  children: '测试 Google 连接',
                  onPress: onTestProxy,
                }),
              ),
            }),
            proxyTestResult
              ? h(
                  'div',
                  {
                    style: {
                      padding: '8px 12px',
                      margin: '6px 0 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      background: proxyTestResult.ok
                        ? 'rgba(34, 197, 94, 0.12)'
                        : 'rgba(239, 68, 68, 0.12)',
                      color: proxyTestResult.ok ? 'var(--state-success, #22C55E)' : 'var(--state-error, #EF4444)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    },
                  },
                  proxyTestResult.ok
                    ? `✓ Google 探测节点连通正常，响应延迟: ${proxyTestResult.latencyMs ?? 0}ms`
                    : `✕ 代理连接失败: ${proxyTestResult.error || '连接超时或服务器无响应'}`,
                )
              : null,
            // Third-party Sources individual proxy management
            h(
              'div',
              {
                style: {
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                },
              },
              h(
                'div',
                { style: { marginBottom: 12 } },
                h(
                  'div',
                  { style: { fontSize: 14, fontWeight: 600, color: '#F8FAFC' } },
                  '第三方音源代理独立分流',
                ),
                h(
                  'div',
                  { style: { fontSize: 12, color: '#8E8E93', marginTop: 2 } },
                  '为已安装的每个第三方音乐来源单独指定是否启用网络代理',
                ),
              ),
              thirdPartySources.length > 0
                ? thirdPartySources.map((s, index, arr) => {
                    const isEnabled = proxy.sourceRules[s.id] ?? false
                    return h(SettingsRow, {
                      key: s.id,
                      title: s.name || s.id,
                      description: s.group ? `分组: ${s.group} · ${s.sourceUrl}` : s.sourceUrl,
                      borderBottom: index < arr.length - 1,
                      action: h(Switch, {
                        checked: isEnabled,
                        accessibilityLabel: `${s.name || s.id} 启用代理`,
                        onChange: (checked) => {
                          const nextRules = { ...proxy.sourceRules, [s.id]: checked }
                          onUpdateProxy({ ...proxy, sourceRules: nextRules })
                        },
                      }),
                    })
                  })
                : h(
                    'div',
                    { style: { color: '#8E8E93', fontSize: 13, padding: '8px 0' } },
                    '当前尚未安装第三方音乐源。导入源规则后即可在此处单独开启代理。',
                  ),
            ),
          )
        : null,
    ),
  )
}
