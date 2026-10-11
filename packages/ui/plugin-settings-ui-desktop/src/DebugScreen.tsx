/**
 * Desktop Debug Screen for `@BBeBee/plugin-settings-ui-desktop`.
 * Shows debug status, environment details, and navigation to discover/HTTP logs.
 */

import { Button } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { UiService, DeviceService } from '@BBeBee/protocol'
import { SETTINGS_VIEWS } from '@BBeBee/plugin-settings/views'

interface WindowWithBBeBee {
  BBeBee?: {
    platform?: string
    versions?: { electron?: string; node?: string }
    isDebug?: boolean
    devtools?: { open(): Promise<void> }
  }
}

export function DebugScreen({ ctx }: { ctx: Context }): ReactElement {
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
    electron:
      bbebee?.versions?.electron ??
      (nodeProc?.versions as Record<string, string> | undefined)?.electron ??
      'N/A',
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
        electron:
          bbebee?.versions?.electron ??
          (nodeProc.versions as Record<string, string> | undefined)?.electron ??
          'N/A',
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
        children: '← Back to settings',
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
        'Debug & diagnostics (Debug)',
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
          h('div', { style: cardTitleStyle }, 'Current debug status'),
          h('div', { style: cardSubtitleStyle }, 'Checks the debug run flags of the kernel and renderer process'),
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
          isDebugMode ? 'Debug mode active' : 'Production environment (Production)',
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
        renderInfoItem('Node environment', envNodeEnv || 'production'),
        renderInfoItem('Log output', 'RingBuffer (2000 lines)'),
        renderInfoItem('Isolated sandbox', 'QuickJS Realm Isolation'),
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
        h('div', { style: cardTitleStyle }, 'Current runtime environment'),
        h('div', { style: cardSubtitleStyle }, 'Hardware platform, engine and host container versions'),
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
        renderInfoItem('Operating system platform', platformInfo.platform),
        renderInfoItem('Processor architecture', platformInfo.arch),
        renderInfoItem('Node.js version', platformInfo.node),
        renderInfoItem('Electron version', platformInfo.electron),
        renderInfoItem('Chromium version', platformInfo.chrome),
        renderInfoItem('App build version', platformInfo.appVersion),
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
        `UA: ${platformInfo.userAgent || 'Desktop App Shell'}`,
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
        h('div', { style: cardTitleStyle }, 'Diagnostic tools & system dev panels'),
        h('div', { style: cardSubtitleStyle }, 'Inspect kernel events, capture network traffic, test sources step by step and monitor the architecture topology'),
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
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, 'System logs (Discover)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              'Live log stream of the Cordis microkernel lifecycle, service assembly and all registered plugins.',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: 'Open Discover logs →',
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
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, 'Third-party source network logs (HTTP Logs)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              'Captures every network request made by third-party source plugins, analyzing request method, status code and round-trip time in real time.',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: 'Open HTTP logs page →',
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
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, 'Theme variable palette (Theme Palette)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              'Inspect and verify every color token, opacity variant and CSS variable mapping produced by themeToCssVariables for the active theme.',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: 'Open theme palette →',
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
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, 'Test sources (Test Sources)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              'Step through and verify a third-party source\'s search rules, playback stream URL resolution and the built-in JS sandbox execution.',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: 'Open source tests →',
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
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, 'System architecture & plugin topology (Inspector)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              'Monitor the system\'s Layer 1~5 nodes and Cordis service assembly in real time with a PCB circuit-board visual.',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: 'Open architecture topology (Inspector) →',
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
            h('div', { style: { fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: 4 } }, 'Developer tools (DevTools)'),
            h(
              'div',
              { style: { fontSize: 13, color: 'var(--text-secondary, #94A3B8)', lineHeight: 1.5, marginBottom: 16 } },
              'Open the current window\'s Chromium DevTools in a separate window to inspect the renderer DOM, network and console output.',
            ),
          ),
          h(Button, {
            variant: 'primary',
            children: 'Open developer tools →',
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
