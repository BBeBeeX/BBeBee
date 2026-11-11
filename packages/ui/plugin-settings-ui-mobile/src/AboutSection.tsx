/**
 * The About sub-page's body — the mobile transcription of the desktop twin's
 * `AboutSection` (plugin-settings-ui-desktop). Same sections in the same
 * order, same rows, same actions: the brand badge, the onboarding guide, the
 * architecture/sandbox/license rows, the advanced-settings toggle, and —
 * once advanced settings is on — the developer diagnostics and the danger
 * zone. A `SwitchRow` takes the place of the desktop's checkbox chip and the
 * brand badge renders through the injected `Image` primitive; everything
 * else is the same copy through the same i18n keys.
 */

import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { useAppSettings } from '@bbebee/plugin-settings/hooks'
import { serviceOf } from '@BBeBee/ui-core'
import { activePalette, Button, getScheme, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens, BBEBEE_LOGO_DARK_DATA_URL, BBEBEE_LOGO_WHITE_DATA_URL } from '@BBeBee/ui-tokens'
import { SwitchRow } from './SchemaForm.js'
import { renderCard, renderRow, renderSectionHeader } from './layout.js'

interface StoreLike {
  get<T>(k: string): Promise<T | undefined>
  set(k: string, v: unknown): Promise<void>
}

export interface AboutSectionProps {
  ctx: Context
  resetting: boolean
  onSetResetting: (resetting: boolean) => void
  onReset: () => void
  onNavigate: (route: string, params?: Record<string, unknown>) => void
}

export function AboutSection({
  ctx,
  resetting,
  onSetResetting,
  onReset,
  onNavigate,
}: AboutSectionProps): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const { settings } = useAppSettings(ctx)
  const liquidGlass = resolveMobileLiquidGlassSettings(settings.liquidGlass)
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)

  // The toggle persists across sessions under the same store key the desktop
  // twin writes — flipping it on either platform flips it everywhere.
  useEffect(() => {
    let cancelled = false
    const store = serviceOf<StoreLike>(ctx, 'store')
    if (store) {
      store
        .get<boolean>('settings.showAdvancedSettings')
        .then((val) => {
          if (!cancelled && typeof val === 'boolean') {
            setShowAdvancedSettings(val)
          }
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [ctx])

  const handleToggleAdvancedSettings = (val: boolean) => {
    setShowAdvancedSettings(val)
    const store = serviceOf<StoreLike>(ctx, 'store')
    void store?.set?.('settings.showAdvancedSettings', val)?.catch(() => {})
  }

  const handleOpenGuide = () => {
    const store = serviceOf<StoreLike>(ctx, 'store')
    void store?.set?.('onboarding.completed', false)?.catch(() => {})
    onNavigate('sources.recommend', { showGuide: true })
  }

  return h(
    native.View as never,
    { style: { gap: tokens.space[4] } },
    renderSectionHeader(t('settings:about.aboutBBeBee'), t('settings:about.appArchitectureAndVersionInformation')),
    renderCard([
      // Brand header badge
      h(
        native.View as never,
        {
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: tokens.space[4],
            paddingBottom: tokens.space[4],
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(255, 255, 255, 0.08)',
          },
        },
        h(
          native.View as never,
          {
            style: {
              width: 52,
              height: 52,
              borderRadius: 14,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: activePalette().bg.raised,
              borderWidth: 1,
              borderColor: activePalette().border.subtle,
            },
          },
          h(native.Image as never, {
            source: { uri: getScheme() === 'dark' ? BBEBEE_LOGO_WHITE_DATA_URL : BBEBEE_LOGO_DARK_DATA_URL },
            style: { width: 38, height: 38, resizeMode: 'contain' },
            accessibilityLabel: t('settings:about.bBeBeeLogo'),
          }),
        ),
        h(
          native.View as never,
          null,
          h(Text, { style: { fontSize: 18, fontWeight: '700' }, children: t('settings:about.bBeBee') }),
          h(Text, {
            variant: 'xs',
            tone: 'muted',
            style: { marginTop: 2 },
            children: t('settings:about.tagline'),
          }),
        ),
      ),
      // Onboarding & quick start guide
      renderRow(
        t('settings:about.onboardingGuide'),
        t('settings:about.onboardingGuideDesc'),
        h(Button, {
          variant: 'secondary',
          onPress: handleOpenGuide,
          testID: 'about-open-guide',
          children: t('settings:about.openGuide'),
        }),
      ),
      renderRow(t('settings:about.microkernelArchitecture'), t('settings:about.builtOnCordisDependencyInjection'), null),
      renderRow(t('settings:about.secureSandbox'), t('settings:about.sourceParsingRunsInAn'), null),
      renderRow(t('settings:about.openSourceLicense'), t('settings:about.openSourcedUnderTheMIT'), null),
    ]),
    // Advanced settings toggle — persisted under the desktop twin's store key.
    renderCard([
      renderRow(
        t('settings:about.advancedSettings'),
        undefined,
        h(SwitchRow, {
          checked: showAdvancedSettings,
          accessibilityLabel: t('settings:about.advancedSettings'),
          testID: 'about-advanced-toggle',
          onChange: handleToggleAdvancedSettings,
          liquid: liquidGlass,
        }),
      ),
    ]),
    // Developer diagnostics and Danger zone appear only when advanced is on.
    showAdvancedSettings
      ? h(
          native.View as never,
          { style: { gap: tokens.space[2] } },
          renderSectionHeader(
            t('settings:about.developerSystemDiagnostics'),
            t('settings:about.viewTheRuntimeEnvironmentLive'),
          ),
          renderCard([
            renderRow(
              t('settings:about.debugDiagnosticsCenterDebug'),
              t('settings:about.diagnosticsDesc'),
              h(Button, {
                variant: 'secondary',
                onPress: () => onNavigate('debug.view'),
                testID: 'about-open-debug',
                children: t('settings:about.openDebugCenter'),
              }),
            ),
          ]),
        )
      : null,
    showAdvancedSettings
      ? h(
          native.View as never,
          { style: { gap: tokens.space[2] } },
          renderSectionHeader(t('settings:about.dangerZone'), t('settings:about.lowLevelConfigurationResetOptions')),
          renderCard([
            renderRow(
              t('settings:about.resetAllSettings'),
              t('settings:about.restoreAllPreferencesToTheir'),
              resetting
                ? h(
                    native.View as never,
                    { style: { flexDirection: 'row', gap: tokens.space[2] } },
                    h(Button, {
                      variant: 'primary',
                      onPress: onReset,
                      testID: 'about-confirm-reset',
                      children: t('settings:mobile.confirmReset'),
                    }),
                    h(Button, {
                      variant: 'ghost',
                      onPress: () => onSetResetting(false),
                      testID: 'about-cancel-reset',
                      children: t('app:common.cancel'),
                    }),
                  )
                : h(Button, {
                    variant: 'secondary',
                    onPress: () => onSetResetting(true),
                    testID: 'about-restore-defaults',
                    children: t('settings:mobile.restoreDefaults'),
                  }),
            ),
          ]),
        )
      : null,
  )
}
