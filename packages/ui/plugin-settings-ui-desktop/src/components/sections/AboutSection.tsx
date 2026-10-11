import { Button } from '@BBeBee/ui-kit-desktop'
import { createElement as h } from 'react'
import type { ReactElement, ChangeEvent } from 'react'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface AboutSectionProps {
  showAdvancedSettings: boolean
  resetting: boolean
  onToggleAdvancedSettings: (show: boolean) => void
  onSetResetting: (resetting: boolean) => void
  onReset: () => void
  onNavigate: (route: string) => void
}

const BBEBEE_LOGO_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAH0AAACWBAMAAAABLZpXAAAAD1BMVEUQFBX///9mZ2fe396srKxD0ysfAAACh0lEQVRo3u3ZfXKrIBAA8A3mACIeAEkOIGkOoDH3P9OjOk2VL3fZee+PNzidJs34yy4LIlKQrKOF6quvvvr/wz/MHDutN3eU7wGEjZymAQaMHwGgCc/q4h+HfnInimh4uGLjQ1ABBVjfRs98ADb/HiIJrOFx9VsL4CcwpdMPvNJBAmtO0V6NjT/1fHnBXE3FQhm/LgV7aH0qeMJ3h2J1qdKlrx+9b8AYG1B53+0boBM9n/Fql3J/KAby+p9+Y7bZ9BO++0VTNv2E3yWtc9UP/Mtsh+tzIbTRRrh37u+3xfl19EaPu+V5EDPPAyxMDzPTC6aPDAWaD4cy0TdMH8wkRB8MZqpvmF4wvd8DeS/e7ylfgBO/3br3x4XoleevRO9/RPZjtgPOfe81gOrlxPR9bgAgvJcA3SvN88cxVOAPLSjxPaf+xwREke+YXhaP/8dybEBD9CPcDg2gzh9uRX3b98BMjr/GVEXz5xZ/P41cSzxc7E8BB1mQ//frFL+D4+K7qm3T2E0WxXdpt/EFBNI3mx9K/XV9vclSL9h+ipYP73V8BYf2Px/Ysvr18dsv2nec68f1/+cuOtii8Vc8f23xX8Xz/xZ/Si2AMt4Y/YmfXAEm/frI/AyWH34BUv6z0B3zK8iUn2XKHwuY8I1M+xnhZcYP577xdmSofs7Fv5x7mfPNqRdM3/ibPwyveV4By6sOCup/zTUf0//efhzZD5nwmPEv9huHJdfPPc0Bdf2b5etpEE+g5OdP7PyHfAKne8vzpPX3+QbA331+Dw/a+vV8C+rf7t8I3v5RZAuP4gVv/81Yzv6fWSj7p/7x/qr//6q++uqrr57kbYm3yv0o98va7zfuSxJf0/4Bf17uCrH7aT4AAAAASUVORK5CYII='

export function AboutSection({
  showAdvancedSettings,
  resetting,
  onToggleAdvancedSettings,
  onSetResetting,
  onReset,
  onNavigate,
}: AboutSectionProps): ReactElement {
  return h(
    'div',
    { id: 'section-about' },
    h(
      SettingsSection,
      {
        title: 'About BBeBee',
        description: 'App architecture and version information',
      },
      // Brand header badge
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '16px 4px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            marginBottom: 4,
          },
        },
        h(
          'div',
          {
            style: {
              width: 52,
              height: 52,
              borderRadius: 14,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 255, 255, 1)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
              flexShrink: 0,
            },
          },
          h('img', {
            src: BBEBEE_LOGO_DATA_URL,
            alt: 'BBeBee Logo',
            width: 38,
            height: 38,
            style: { display: 'block', objectFit: 'contain' },
          }),
        ),
        h(
          'div',
          null,
          h('div', { style: { fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #F5F5F7)' } }, 'BBeBee'),
          h(
            'div',
            { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)', marginTop: 2 } },
            'Cross-platform plugin-based music player · Version 0.1.0',
          ),
        ),
      ),
      h(SettingsRow, {
        title: 'Microkernel architecture',
        description: 'Built on Cordis dependency injection and lifecycle management, with features fully decoupled into independent plugins',
      }),
      h(SettingsRow, {
        title: 'Secure sandbox',
        description: 'Source parsing runs in an isolated QuickJS Realm sandbox, fully cut off from network and local permissions',
      }),
      h(SettingsRow, {
        title: 'Open-source license',
        description: 'Open-sourced under the MIT license — free, flexible, transparent',
        borderBottom: false,
      }),
    ),
    // Advanced Settings Checkbox Toggle
    h(
      'div',
      {
        style: {
          padding: '12px 4px 16px',
          display: 'flex',
          alignItems: 'center',
        },
      },
      h(
        'label',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            fontSize: 13,
            color: showAdvancedSettings ? '#F8FAFC' : '#94A3B8',
            userSelect: 'none',
            padding: '6px 14px',
            borderRadius: 6,
            background: showAdvancedSettings
              ? 'rgba(124, 58, 237, 0.15)'
              : 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${showAdvancedSettings ? 'rgba(124, 58, 237, 0.35)' : 'rgba(255, 255, 255, 0.08)'}`,
            transition: 'all 0.15s ease',
          },
        },
        h('input', {
          type: 'checkbox',
          checked: showAdvancedSettings,
          onChange: (e: ChangeEvent<HTMLInputElement>) =>
            onToggleAdvancedSettings(e.target.checked),
          style: {
            cursor: 'pointer',
            accentColor: '#7C3AED',
            width: 15,
            height: 15,
          },
        }),
        h('span', { style: { fontWeight: 500 } }, 'Advanced settings'),
      ),
    ),
    // Developer diagnostics and Danger zone appear only when advanced settings is enabled
    showAdvancedSettings &&
      h(
        SettingsSection,
        {
          title: 'Developer & system diagnostics',
          description: 'View the runtime environment, live Discover logs, source testing and the microkernel architecture topology (Inspector)',
        },
        h(SettingsRow, {
          title: 'Debug & diagnostics center (Debug)',
          description:
            'Environment info, Discover system logs, source HTTP capture, source testing and the Inspector architecture topology',
          borderBottom: false,
          action: h(Button, {
            variant: 'secondary',
            children: 'Open Debug center →',
            onPress: () => onNavigate('debug.view'),
          }),
        }),
      ),
    showAdvancedSettings &&
      h(
        SettingsSection,
        {
          title: 'Danger zone',
          description: 'Low-level configuration reset options',
        },
        h(SettingsRow, {
          title: 'Reset all settings',
          description: 'Restore all preferences to their initial defaults (downloaded songs and playlists are not deleted)',
          borderBottom: false,
          action: resetting
            ? h(
                'div',
                { style: { display: 'flex', gap: 8 } },
                h(Button, {
                  variant: 'primary',
                  children: 'Confirm reset',
                  onPress: onReset,
                }),
                h(Button, {
                  variant: 'ghost',
                  children: 'Cancel',
                  onPress: () => onSetResetting(false),
                }),
              )
            : h(Button, {
                variant: 'secondary',
                children: 'Restore defaults',
                onPress: () => onSetResetting(true),
              }),
        }),
      ),
  )
}
