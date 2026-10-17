import { Button, Select, Switch, useI18n } from '@BBeBee/ui-kit-desktop'
import type { Context } from 'cordis'
import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { DEFAULT_USER_AGENT } from '@BBeBee/protocol'
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
  const { t } = useI18n(ctx)
  return h(
    'div',
    { id: 'section-network' },
    h(
      SettingsSection,
      {
        title: t('settings:network.thirdPartyServiceSettings'),
        description: t('settings:network.controlThirdPartyMusicAnd'),
      },
      h(SettingsRow, {
        ctx,
        title: t('settings:network.enableThirdPartyMusicSources'),
        description: t('settings:network.whenOffSearchAndPlayback'),
        action: h(Switch, {
          checked: thirdPartySourcesEnabled,
          accessibilityLabel: t('settings:network.enableThirdPartyMusicSources'),
          onChange: onToggleThirdPartySources,
        }),
      }),
      h(SettingsRow, {
        ctx,
        title: t('settings:network.enableThirdPartyLyricSources'),
        description: t('settings:network.whenOffLyricsAreNo'),
        action: h(Switch, {
          checked: thirdPartyLyricSourcesEnabled,
          accessibilityLabel: t('settings:network.enableThirdPartyLyricSources'),
          onChange: onToggleThirdPartyLyricSources,
        }),
      }),
      h(SettingsRow, {
        ctx,
        title: t('settings:network.userAgent'),
        description: t('settings:network.userAgentDescription'),
        action: h('input', {
          type: 'text',
          value: userAgent || DEFAULT_USER_AGENT,
          placeholder: t('settings:network.userAgentPlaceholder'),
          'aria-label': t('settings:network.userAgent'),
          onChange: (e: { target: { value: string } }) => onUpdateUserAgent(e.target.value),
          style: {
            width: 280,
            maxWidth: '100%',
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
        title: t('settings:network.networkProxySettings'),
        description: t('settings:network.configureTheProxyProtocolAnd'),
      },
      h(SettingsRow, {
        ctx,
        title: t('settings:network.enableNetworkProxy'),
        description: t('settings:network.whenOnNetworkAndMusic'),
        action: h(Switch, {
          checked: proxy.enabled,
          accessibilityLabel: t('settings:network.enableNetworkProxy'),
          onChange: (enabled) => onUpdateProxy({ ...proxy, enabled }),
        }),
      }),
      proxy.enabled
        ? h(
            'div',
            null,
            h(SettingsRow, {
              ctx,
              title: t('settings:network.proxyProtocol'),
              description: t('settings:network.chooseTheTransportProtocolSupported'),
              action: h(Select<'http' | 'https' | 'socks5'>, {
                value: proxy.protocol,
                options: [
                  { value: 'http', label: t('settings:network.hTTPProxy') },
                  { value: 'https', label: t('settings:network.hTTPSProxy') },
                  { value: 'socks5', label: t('settings:network.sOCKS5Proxy') },
                ],
                accessibilityLabel: t('settings:network.proxyProtocol'),
                onChange: (protocol) => onUpdateProxy({ ...proxy, protocol }),
              }),
            }),
            h(SettingsRow, {
              ctx,
              title: t('settings:network.serverHostPort'),
              description: t('settings:network.setTheProxyServerHost'),
              action: h(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                h('input', {
                  type: 'text',
                  value: proxy.host,
                  placeholder: t('settings:network.proxyHostPlaceholder'),
                  'aria-label': t('settings:network.proxyServerHost'),
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
                  'aria-label': t('settings:network.proxyServerPort'),
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
                  children: t('settings:network.testGoogleConnection'),
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
                    ? t('settings:network.googleProbeReachable', {
                        latencyMs: proxyTestResult.latencyMs ?? 0,
                      })
                    : t('settings:network.proxyConnectionFailed', {
                        error:
                          proxyTestResult.error || t('settings:network.proxyConnectionTimedOut'),
                      }),
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
                  t('settings:network.perSourceProxyRouting'),
                ),
                h(
                  'div',
                  { style: { fontSize: 12, color: '#8E8E93', marginTop: 2 } },
                  t('settings:network.perSourceProxyRoutingDesc'),
                ),
              ),
              thirdPartySources.length > 0
                ? thirdPartySources.map((s, index, arr) => {
                    const isEnabled = proxy.sourceRules[s.id] ?? false
                    return h(SettingsRow, {
                      ctx,
                      key: s.id,
                      title: s.name || s.id,
                      description: s.group
                        ? t('settings:network.group', { group: s.group, sourceUrl: s.sourceUrl })
                        : s.sourceUrl,
                      borderBottom: index < arr.length - 1,
                      action: h(Switch, {
                        checked: isEnabled,
                        accessibilityLabel: t('settings:network.enableProxyFor', { name: s.name || s.id }),
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
                    t('settings:network.noThirdPartySourcesYet'),
                  ),
            ),
          )
        : null,
    ),
    h(
      SettingsSection,
      {
        title: t('settings:network.downloadGitHubAcceleration'),
        description: t('settings:network.downloadSectionDesc'),
      },
      h(SettingsRow, {
        ctx,
        title: t('settings:network.downloadRegion'),
        description: t('settings:network.storedDownloadRegionPreferenceGitHub'),
        action: h(
          'div',
          { 'data-testid': 'settings-download-region' },
          h(Select<DownloadRegion>, {
            value: downloadRegion,
            options: [
              { value: 'global', label: t('settings:network.global') },
              { value: 'mainland-china', label: t('settings:network.mainlandChina') },
            ],
            accessibilityLabel: t('settings:network.downloadRegion'),
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
