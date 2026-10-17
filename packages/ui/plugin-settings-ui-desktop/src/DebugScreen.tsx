/**
 * Desktop Debug Screen for `@BBeBee/plugin-settings-ui-desktop`.
 * Shows debug status, environment details, and navigation to discover/HTTP logs.
 */

import { Button, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { UiService, DeviceService } from '@BBeBee/protocol'
import { SETTINGS_VIEWS } from '@BBeBee/plugin-settings/views'

interface WindowWithBBeBee {
  BBeBee?: {
    platform?: string
    versions?: { tauri?: string; node?: string }
    isDebug?: boolean
    devtools?: { open(): Promise<void> }
  }
}

export function DebugScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const ui = serviceOf<UiService>(ctx, 'ui')
  /*
   * useMemo, not a bare call: `serviceOf` hands back a fresh traceable proxy
   * per access, and this value sits in the effect's dependency array — an
   * unstable identity there re-runs the effect every render, and the setState
   * inside it turns that into an endless render loop once a device service is
   * on the context. It stayed dormant only because the service used to be
   * absent everywhere this screen was mounted.
   */
  const device = useMemo(() => serviceOf<DeviceService>(ctx, 'device'), [ctx])
  const bbebee = typeof window !== 'undefined' ? (window as unknown as WindowWithBBeBee).BBeBee : undefined
  const nodeProc = typeof process !== 'undefined' ? process : undefined

  const [platformInfo, setPlatformInfo] = useState(() => ({
    platform: bbebee?.platform ?? device?.platform ?? nodeProc?.platform ?? 'desktop',
    arch: nodeProc?.arch ?? 'x64',
    node: bbebee?.versions?.node ?? nodeProc?.versions?.node ?? 'embedded',
    tauri:
      bbebee?.versions?.tauri ??
      (nodeProc?.versions as Record<string, string> | undefined)?.tauri ??
      '2.x',
    chrome:
      (typeof navigator !== 'undefined' && /Chrome\/([0-9.]+)/.exec(navigator.userAgent)?.[1]) ||
      'N/A',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    appVersion: device?.appVersion ?? '0.1.0-alpha',
  }))

  useEffect(() => {
    if (nodeProc) {
      setPlatformInfo({
        platform: bbebee?.platform ?? device?.platform ?? nodeProc.platform ?? 'desktop',
        arch: nodeProc.arch ?? 'x64',
        node: bbebee?.versions?.node ?? nodeProc.versions?.node ?? 'embedded',
        tauri:
          bbebee?.versions?.tauri ??
          (nodeProc.versions as Record<string, string> | undefined)?.tauri ??
          '2.x',
        chrome:
          (typeof navigator !== 'undefined' &&
            /Chrome\/([0-9.]+)/.exec(navigator.userAgent)?.[1]) ||
          'N/A',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        appVersion: device?.appVersion ?? '0.1.0-alpha',
      })
    }
  }, [nodeProc, bbebee, device])

  const envNodeEnv = nodeProc?.env?.['NODE_ENV']
  const envDebug = nodeProc?.env?.['DEBUG']
  const isDebugMode = Boolean(
    bbebee?.isDebug || (envNodeEnv && envNodeEnv !== 'production') || Boolean(envDebug),
  )

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-app, #0D0E15)',
        color: 'var(--text-primary, #E2E8F0)',
        padding: '32px 48px',
        boxSizing: 'border-box',
        overflowY: 'auto',
      },
    },
    // Top bar / Back navigation
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 28,
        },
      },
      h(Button, {
        variant: 'secondary',
        children: t('settings:settings.backToSettings'),
        onPress: () => ui?.navigate?.('settings.view'),
      }),
      h(
        'h1',
        {
          style: {
            fontSize: 22,
            fontWeight: 700,
            margin: 0,
            color: 'var(--text-primary, #F8FAFC)',
            letterSpacing: '-0.02em',
          },
        },
        t('settings:debug.title'),
      ),
    ),

    // Card 1: Debug Status
    h(
      'div',
      {
        style: cardStyle,
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          },
        },
        h(
          'div',
          null,
          h('div', { style: cardTitleStyle }, t('settings:debug.currentDebugStatus')),
          h('div', { style: cardSubtitleStyle }, t('settings:debug.checksTheDebugRunFlags')),
        ),
        h(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              borderRadius: 16,
              fontSize: 12,
              fontWeight: 600,
              background: isDebugMode ? 'rgba(34, 197, 94, 0.15)' : 'var(--surface-3, rgba(148, 163, 184, 0.15))',
              color: isDebugMode ? 'var(--color-success, #4ADE80)' : 'var(--text-secondary, #94A3B8)',
              border: `1px solid ${isDebugMode ? 'rgba(34, 197, 94, 0.3)' : 'var(--border-subtle, rgba(148, 163, 184, 0.2))'}`,
            },
          },
          h('span', {
            style: {
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isDebugMode ? '#22C55E' : 'var(--text-secondary, #94A3B8)',
            },
          }),
          isDebugMode ? t('settings:debug.debugModeActive') : t('settings:debug.productionEnvironment'),
        ),
      ),
      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
            background: 'var(--surface-2, rgba(255, 255, 255, 0.02))',
            padding: 16,
            borderRadius: 8,
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.04))',
          },
        },
        renderInfoItem(t('settings:debug.nodeEnvironment'), envNodeEnv || 'production'),
        renderInfoItem(t('settings:debug.logOutput'), 'RingBuffer (2000 lines)'),
        renderInfoItem(t('settings:debug.isolatedSandbox'), 'QuickJS Realm Isolation'),
      ),
    ),

    // Card 2: Environment Details
    h(
      'div',
      {
        style: cardStyle,
      },
      h(
        'div',
        { style: { marginBottom: 16 } },
        h('div', { style: cardTitleStyle }, t('settings:debug.currentRuntimeEnvironment')),
        h('div', { style: cardSubtitleStyle }, t('settings:debug.hardwarePlatformEngineAndHost')),
      ),
      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            background: 'var(--surface-2, rgba(255, 255, 255, 0.02))',
            padding: 16,
            borderRadius: 8,
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.04))',
          },
        },
        renderInfoItem(t('settings:debug.osPlatform'), platformInfo.platform),
        renderInfoItem(t('settings:debug.cpuArch'), platformInfo.arch),
        renderInfoItem(t('settings:debug.nodeVersion'), platformInfo.node),
        renderInfoItem(t('settings:debug.tauriVersion'), platformInfo.tauri),
        renderInfoItem(t('settings:debug.chromiumVersion'), platformInfo.chrome),
        renderInfoItem(t('settings:debug.appBuildVersion'), platformInfo.appVersion),
      ),
      h(
        'div',
        {
          style: {
            marginTop: 12,
            padding: '8px 12px',
            background: 'var(--surface-2, rgba(0, 0, 0, 0.25))',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'monospace',
            color: 'var(--text-secondary, #94A3B8)',
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.04))',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        },
        t('settings:debug.uA', { userAgent: platformInfo.userAgent || t('settings:debug.desktopAppShell') }),
      ),
    ),

    // Card 3: Diagnostic tools navigation
    h(
      'div',
      {
        style: cardStyle,
      },
      h(
        'div',
        { style: { marginBottom: 20 } },
        h('div', { style: cardTitleStyle }, t('settings:debug.diagnosticToolsSystemDevPanels')),
        h('div', { style: cardSubtitleStyle }, t('settings:debug.inspectKernelEventsCaptureNetwork')),
      ),
      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 20,
          },
        },
        // Discover Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, t('settings:debug.systemLogsDiscover')),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              t('settings:debug.discoverDesc'),
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: t('settings:debug.openDiscoverLogs'),
            onPress: () => ui?.navigate?.('debug.logs'),
          }),
        ),
        // HTTP Logs Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, t('settings:debug.thirdPartySourceNetworkLogs')),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              t('settings:debug.httpLogsDesc'),
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: t('settings:debug.openHttpLogs'),
            onPress: () => ui?.navigate?.('debug.http-logs'),
          }),
        ),
        // Theme Palette Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, t('settings:debug.themeVariablePaletteThemePalette')),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              t('settings:debug.themePaletteDesc'),
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: t('settings:debug.openThemePalette'),
            onPress: () => ui?.navigate?.(SETTINGS_VIEWS.themePalette),
          }),
        ),
        // Test Sources Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, t('settings:debug.testSourcesTestSources')),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              t('settings:debug.testSourcesDesc'),
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: t('settings:debug.openSourceTests'),
            onPress: () => ui?.navigate?.('sources.test'),
          }),
        ),
        // Inspector Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, t('settings:debug.systemArchitecturePluginTopologyInspector')),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              t('settings:debug.inspectorDesc'),
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: t('settings:debug.openInspector'),
            onPress: () => ui?.navigate?.('inspector.panel'),
          }),
        ),
        // DevTools Card
        h(
          'div',
          {
            style: actionCardStyle,
          },
          h(
            'div',
            null,
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, t('settings:debug.developerToolsDevTools')),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              t('settings:debug.devToolsDesc'),
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: t('settings:debug.openDevTools'),
            disabled: !bbebee?.devtools,
            onPress: () => void bbebee?.devtools?.open(),
          }),
        ),
      ),
    ),
  )
}

function renderInfoItem(label: string, value: string): ReactElement {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      },
    },
    h('span', { style: { fontSize: 12, color: 'var(--text-secondary, #64748B)' } }, label),
    h('span', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #E2E8F0)', fontFamily: 'monospace' } }, value),
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--settings-card-bg, var(--card-bg, var(--surface-1, rgba(255, 255, 255, 0.03))))',
  border: '1px solid var(--settings-card-border, var(--border-subtle, rgba(255, 255, 255, 0.06)))',
  borderRadius: 12,
  padding: 24,
  marginBottom: 20,
  boxShadow: 'var(--settings-card-shadow, none)',
}

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--text-primary, #F8FAFC)',
}

const cardSubtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-secondary, #94A3B8)',
  marginTop: 4,
}

const actionCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  background: 'var(--surface-2, rgba(255, 255, 255, 0.02))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
  borderRadius: 8,
  padding: 20,
}
