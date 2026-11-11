import { Button, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h } from 'react'
import type { ReactElement, ChangeEvent } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface AboutSectionProps {
  ctx: Context
  showAdvancedSettings: boolean
  resetting: boolean
  onToggleAdvancedSettings: (show: boolean) => void
  onSetResetting: (resetting: boolean) => void
  onReset: () => void
  onNavigate: (route: string, params?: Record<string, unknown>) => void
}
import { BBEBEE_LOGO_DARK_DATA_URL } from '@BBeBee/ui-tokens'

export function AboutSection({
  ctx,
  showAdvancedSettings,
  resetting,
  onToggleAdvancedSettings,
  onSetResetting,
  onReset,
  onNavigate,
}: AboutSectionProps): ReactElement {
  const { t } = useI18n(ctx)
  return h(
    'div',
    { id: 'section-about' },
    h(
      SettingsSection,
      {
        title: t('settings:about.aboutBBeBee'),
        description: t('settings:about.appArchitectureAndVersionInformation'),
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
              background: 'var(--card-bg, rgba(255, 255, 255, 0.05))',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
              boxShadow: '0 4px 14px var(--shadow-dropdown, rgba(0, 0, 0, 0.15))',
              flexShrink: 0,
            },
          },
          h('img', {
            src: BBEBEE_LOGO_DARK_DATA_URL,
            alt: t('settings:about.bBeBeeLogo'),
            width: 38,
            height: 38,
            style: { display: 'block', objectFit: 'contain', filter: 'var(--logo-filter, none)' },
          }),
        ),
        h(
          'div',
          null,
          h('div', { style: { fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #F5F5F7)' } }, t('settings:about.bBeBee')),
          h(
            'div',
            { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)', marginTop: 2 } },
            t('settings:about.tagline'),
          ),
        ),
      ),
      h(SettingsRow, {
        ctx,
        title: t('settings:about.onboardingGuide'),
        description: t('settings:about.onboardingGuideDesc'),
        action: h(Button, {
          variant: 'secondary',
          children: t('settings:about.openGuide'),
          onPress: () => {
            const store = serviceOf<{ set(k: string, v: unknown): Promise<void> }>(ctx, 'store')
            void store?.set?.('onboarding.completed', false)
            onNavigate('sources.recommend', { showGuide: true })
          },
        }),
      }),
      h(SettingsRow, {
        ctx,
        title: t('settings:about.microkernelArchitecture'),
        description: t('settings:about.builtOnCordisDependencyInjection'),
      }),
      h(SettingsRow, {
        ctx,
        title: t('settings:about.secureSandbox'),
        description: t('settings:about.sourceParsingRunsInAn'),
      }),
      h(SettingsRow, {
        ctx,
        title: t('settings:about.openSourceLicense'),
        description: t('settings:about.openSourcedUnderTheMIT'),
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
        h('span', { style: { fontWeight: 500 } }, t('settings:about.advancedSettings')),
      ),
    ),
    // Developer diagnostics and Danger zone appear only when advanced settings is enabled
    showAdvancedSettings &&
      h(
        SettingsSection,
        {
          title: t('settings:about.developerSystemDiagnostics'),
          description: t('settings:about.viewTheRuntimeEnvironmentLive'),
        },
        h(SettingsRow, {
          ctx,
          title: t('settings:about.debugDiagnosticsCenterDebug'),
          description: t('settings:about.diagnosticsDesc'),
          borderBottom: false,
          action: h(Button, {
            variant: 'secondary',
            children: t('settings:about.openDebugCenter'),
            onPress: () => onNavigate('debug.view'),
          }),
        }),
      ),
    showAdvancedSettings &&
      h(
        SettingsSection,
        {
          title: t('settings:about.dangerZone'),
          description: t('settings:about.lowLevelConfigurationResetOptions'),
        },
        h(SettingsRow, {
          ctx,
          title: t('settings:about.resetAllSettings'),
          description: t('settings:about.restoreAllPreferencesToTheir'),
          borderBottom: false,
          action: resetting
            ? h(
                'div',
                { style: { display: 'flex', gap: 8 } },
                h(Button, {
                  variant: 'primary',
                  children: t('settings:mobile.confirmReset'),
                  onPress: onReset,
                }),
                h(Button, {
                  variant: 'ghost',
                  children: t('app:common.cancel'),
                  onPress: () => onSetResetting(false),
                }),
              )
            : h(Button, {
                variant: 'secondary',
                children: t('settings:mobile.restoreDefaults'),
                onPress: () => onSetResetting(true),
              }),
        }),
      ),
  )
}
