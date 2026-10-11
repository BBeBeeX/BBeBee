import { Button, Select, Switch } from '@BBeBee/ui-kit-desktop'
import type { Context } from 'cordis'
import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { DownloadRegion, ProxySettings, SourceRecord } from '@BBeBee/protocol'
import { GitHubAccelerationEditor } from '../GitHubAccelerationEditor.js'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface NetworkSectionProps {
  /** The app context — passed through to the GitHub acceleration editor for i18n. */
  ctx: Context
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
  /** Stored download-region preference (advisory; official endpoints stay first). */
  downloadRegion: DownloadRegion
  /** Ordered custom GitHub acceleration prefixes (the jsDelivr line is built in). */
  githubAccelerationPrefixes: readonly string[]
  onUpdateDownloadRegion: (region: DownloadRegion) => void
  onUpdateGithubAccelerationPrefixes: (prefixes: readonly string[]) => void
}

export function NetworkSection({
  ctx,
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
  downloadRegion,
  githubAccelerationPrefixes,
  onUpdateDownloadRegion,
  onUpdateGithubAccelerationPrefixes,
}: NetworkSectionProps): ReactElement {
  return h(
    'div',
    { id: 'section-network' },
    h(
      SettingsSection,
      {
        title: 'Third-party service settings',
        description: 'Control third-party music and lyric sources, and the User-Agent used for outgoing requests',
      },
      h(SettingsRow, {
        title: 'Enable third-party music sources',
        description: 'When off, search and playback resolution of all imported third-party music sources is paused; local files are unaffected',
        action: h(Switch, {
          checked: thirdPartySourcesEnabled,
          accessibilityLabel: 'Enable third-party music sources',
          onChange: onToggleThirdPartySources,
        }),
      }),
      h(SettingsRow, {
        title: 'Enable third-party lyric sources',
        description: 'When off, lyrics are no longer fetched through lyric sources during playback; individual switches in the lyric source list below are preserved',
        action: h(Switch, {
          checked: thirdPartyLyricSourcesEnabled,
          accessibilityLabel: 'Enable third-party lyric sources',
          onChange: onToggleThirdPartyLyricSources,
        }),
      }),
      h(SettingsRow, {
        title: 'User-Agent',
        description:
          'Sent as the HTTP User-Agent header with every network request; leave empty to use the built-in default. Header rules carried by a music source take precedence',
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
            background: 'var(--bb-bg-overlay, rgba(255, 255, 255, 0.08))',
            border: '1px solid var(--bb-border-subtle, rgba(255, 255, 255, 0.15))',
            color: 'var(--bb-text-primary, #FFFFFF)',
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
        title: 'Network proxy settings',
        description: 'Configure the proxy protocol and routing strategy for outgoing requests and online sources',
      },
      h(SettingsRow, {
        title: 'Enable network proxy',
        description: 'When on, network and music requests are forwarded through the custom proxy server',
        action: h(Switch, {
          checked: proxy.enabled,
          accessibilityLabel: 'Enable network proxy',
          onChange: (enabled) => onUpdateProxy({ ...proxy, enabled }),
        }),
      }),
      proxy.enabled
        ? h(
            'div',
            null,
            h(SettingsRow, {
              title: 'Proxy protocol',
              description: 'Choose the transport protocol supported by the proxy server',
              action: h(Select<'http' | 'https' | 'socks5'>, {
                value: proxy.protocol,
                options: [
                  { value: 'http', label: 'HTTP proxy' },
                  { value: 'https', label: 'HTTPS proxy' },
                  { value: 'socks5', label: 'SOCKS5 proxy' },
                ],
                accessibilityLabel: 'Proxy protocol',
                onChange: (protocol) => onUpdateProxy({ ...proxy, protocol }),
              }),
            }),
            h(SettingsRow, {
              title: 'Server host & port',
              description: 'Set the proxy server host IP or domain and its listening port',
              action: h(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                h('input', {
                  type: 'text',
                  value: proxy.host,
                  placeholder: '127.0.0.1',
                  'aria-label': 'Proxy server host',
                  onChange: (e: { target: { value: string } }) =>
                    onUpdateProxy({ ...proxy, host: e.target.value.trim() }),
                  style: {
                    width: 140,
                    height: 32,
                    borderRadius: 6,
                    background: 'var(--bb-bg-overlay, rgba(255, 255, 255, 0.08))',
                    border: '1px solid var(--bb-border-subtle, rgba(255, 255, 255, 0.15))',
                    color: 'var(--bb-text-primary, #FFFFFF)',
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
                  'aria-label': 'Proxy server port',
                  onChange: (e: { target: { value: string } }) =>
                    onUpdateProxy({ ...proxy, port: Number(e.target.value) || 0 }),
                  style: {
                    width: 70,
                    height: 32,
                    borderRadius: 6,
                    background: 'var(--bb-bg-overlay, rgba(255, 255, 255, 0.08))',
                    border: '1px solid var(--bb-border-subtle, rgba(255, 255, 255, 0.15))',
                    color: 'var(--bb-text-primary, #FFFFFF)',
                    fontSize: 13,
                    padding: '0 8px',
                    outline: 'none',
                  },
                }),
                h(Button, {
                  variant: 'secondary',
                  disabled: proxyTesting || !proxy.host || !proxy.port,
                  loading: proxyTesting,
                  children: 'Test Google connection',
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
                    ? `✓ Google probe reachable, response latency: ${proxyTestResult.latencyMs ?? 0}ms`
                    : `✕ Proxy connection failed: ${proxyTestResult.error || 'connection timed out or server did not respond'}`,
                )
              : null,
            // Third-party Sources individual proxy management
            h(
              'div',
              {
                style: {
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: '1px solid var(--bb-border-subtle, rgba(255, 255, 255, 0.08))',
                },
              },
              h(
                'div',
                { style: { marginBottom: 12 } },
                h(
                  'div',
                  { style: { fontSize: 14, fontWeight: 600, color: 'var(--bb-text-primary, #F8FAFC)' } },
                  'Per-source proxy routing for third-party music sources',
                ),
                h(
                  'div',
                  { style: { fontSize: 12, color: '#8E8E93', marginTop: 2 } },
                  'Enable the network proxy individually for each installed third-party music source',
                ),
              ),
              thirdPartySources.length > 0
                ? thirdPartySources.map((s, index, arr) => {
                    const isEnabled = proxy.sourceRules[s.id] ?? false
                    return h(SettingsRow, {
                      key: s.id,
                      title: s.name || s.id,
                      description: s.group ? `Group: ${s.group} · ${s.sourceUrl}` : s.sourceUrl,
                      borderBottom: index < arr.length - 1,
                      action: h(Switch, {
                        checked: isEnabled,
                        accessibilityLabel: `Enable proxy for ${s.name || s.id}`,
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
                    'No third-party music sources installed yet. Import source rules to enable the proxy individually here.',
                  ),
            ),
          )
        : null,
    ),
    h(
      SettingsSection,
      {
        title: 'Download & GitHub acceleration',
        description:
          'Choose the download region preference and configure acceleration endpoints for GitHub resource downloads, tried in order (the official URL always comes first)',
      },
      h(SettingsRow, {
        title: 'Download region',
        description: 'Stored download region preference; GitHub requests still prefer the official URL, and acceleration follows the endpoint order below',
        action: h(
          'div',
          { 'data-testid': 'settings-download-region' },
          h(Select<DownloadRegion>, {
            value: downloadRegion,
            options: [
              { value: 'global', label: 'Global' },
              { value: 'mainland-china', label: 'Mainland China' },
            ],
            accessibilityLabel: 'Download region',
            onChange: onUpdateDownloadRegion,
          }),
        ),
      }),
      h(GitHubAccelerationEditor, {
        ctx,
        prefixes: githubAccelerationPrefixes,
        onUpdatePrefixes: onUpdateGithubAccelerationPrefixes,
      }),
    ),
  )
}
