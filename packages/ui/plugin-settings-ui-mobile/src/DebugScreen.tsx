/**
 * Debug & diagnostics — the mobile transcription of the desktop twin's
 * `DebugScreen`. Same three cards: the debug-status badge and its info
 * items, the runtime environment, and the diagnostic-tool cards with their
 * open buttons.
 *
 * Platform transcription, two honest cuts: the environment card drops the
 * host-container facts a phone cannot answer (Node/Tauri/Chromium versions)
 * and reports the device service's own fields instead; a tool card whose
 * target view is not registered on this platform renders its button
 * disabled with the shared "not available on this platform" note rather
 * than navigating into the shell's dead end.
 */

import { createElement as h, Fragment } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import type { DeviceService, I18nService, UiService } from '@BBeBee/protocol'
import { BOTTOM_CHROME_HEIGHT, Button, Text, c, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

interface ToolCard {
  titleKey: string
  descKey: string
  buttonKey: string
  /** The view id the tool opens; unavailable when no view is registered. */
  viewId?: string
  onPress?: () => void
  testID?: string
}

export function DebugScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const ui = serviceOf<UiService>(ctx, 'ui')
  const device = serviceOf<DeviceService>(ctx, 'device')
  // 界面语言 is the app's UI language (the i18n service's), not the OS
  // locale the device service reports — the two disagree whenever the user
  // runs the app in a language their phone is not set to.
  const interfaceLanguage = serviceOf<I18nService>(ctx, 'i18n')?.locale ?? device?.locale ?? ''
  // The one debug signal a React Native build has; `__DEV__` is inlined by
  // the bundler (true under metro, false in a release bundle).
  const isDebugMode = (globalThis as { __DEV__?: boolean }).__DEV__ === true

  const hasView = (id: string): boolean => Boolean(ui?.viewFor?.(id))

  const tools: ToolCard[] = [
    {
      titleKey: 'settings:debug.systemLogsDiscover',
      descKey: 'settings:debug.discoverDesc',
      buttonKey: 'settings:debug.openDiscoverLogs',
      viewId: 'debug.logs',
      testID: 'debug-open-discover',
    },
    {
      titleKey: 'settings:debug.thirdPartySourceNetworkLogs',
      descKey: 'settings:debug.httpLogsDesc',
      buttonKey: 'settings:debug.openHttpLogs',
      viewId: 'debug.http-logs',
      testID: 'debug-open-http-logs',
    },
    {
      titleKey: 'settings:debug.themeVariablePaletteThemePalette',
      descKey: 'settings:debug.themePaletteDesc',
      buttonKey: 'settings:debug.openThemePalette',
      viewId: 'debug.theme-palette',
      testID: 'debug-open-theme-palette',
    },
    {
      titleKey: 'settings:debug.testSourcesTestSources',
      descKey: 'settings:debug.testSourcesDesc',
      buttonKey: 'settings:debug.openSourceTests',
      viewId: 'sources.test',
      testID: 'debug-open-sources-test',
    },
    {
      // Plugin management moved here from the settings home: on the desktop
      // it lives inside the settings screen, so its phone entrance joined the
      // other developer surfaces in the debug center.
      titleKey: 'settings:settings.plugins',
      descKey: 'settings:about.builtOnCordisDependencyInjection',
      buttonKey: 'settings:debug.openPlugins',
      viewId: 'plugin-manager.screen',
      testID: 'debug-open-plugins',
    },
  ]

  const infoItem = (label: string, value: string) =>
    h(
      native.View as never,
      { key: label, style: { gap: 2 } },
      h(Text, { variant: 'xs', tone: 'muted', children: label }),
      h(Text, { style: { fontSize: 13, fontWeight: '500', fontFamily: 'monospace' }, children: value }),
    )

  return h(
    native.ScrollView as never,
    {
      style: { flex: 1, backgroundColor: c().bg.base },
      contentContainerStyle: { padding: tokens.space[4], gap: tokens.space[3], paddingBottom: BOTTOM_CHROME_HEIGHT },
      accessibilityLabel: t('settings:debug.title'),
    },
    // Card 1 — debug status
    h(
      native.View as never,
      { style: cardStyle },
      h(
        native.View as never,
        { style: { marginBottom: tokens.space[3], gap: 2 } },
        h(Text, { variant: 'md', style: { fontWeight: '600' }, children: t('settings:debug.currentDebugStatus') }),
        h(Text, { variant: 'xs', tone: 'muted', children: t('settings:debug.checksTheDebugRunFlags') }),
      ),
      h(
        native.View as never,
        {
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-end',
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 4,
            borderRadius: 16,
            backgroundColor: isDebugMode ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)',
            borderWidth: 1,
            borderColor: isDebugMode ? 'rgba(34, 197, 94, 0.3)' : 'rgba(148, 163, 184, 0.2)',
          },
        },
        h(native.View as never, {
          style: {
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: isDebugMode ? '#22C55E' : c().text.secondary,
          },
        }),
        h(
          Text,
          { variant: 'xs', style: { fontWeight: '600', color: isDebugMode ? '#4ADE80' : c().text.secondary } },
          isDebugMode ? t('settings:debug.debugModeActive') : t('settings:debug.productionEnvironment'),
        ),
      ),
      h(
        native.View as never,
        {
          style: {
            gap: tokens.space[2],
            padding: tokens.space[3],
            borderRadius: tokens.radius.sm,
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.04)',
          },
        },
        infoItem(t('settings:debug.nodeEnvironment'), isDebugMode ? 'debug' : 'production'),
        infoItem(t('settings:debug.logOutput'), 'RingBuffer (2000 lines)'),
        infoItem(t('settings:debug.isolatedSandbox'), 'QuickJS Realm Isolation'),
      ),
    ),
    // Card 2 — runtime environment (the device's own answers)
    h(
      native.View as never,
      { style: cardStyle },
      h(
        native.View as never,
        { style: { marginBottom: tokens.space[3], gap: 2 } },
        h(Text, { variant: 'md', style: { fontWeight: '600' }, children: t('settings:debug.currentRuntimeEnvironment') }),
        h(Text, { variant: 'xs', tone: 'muted', children: t('settings:debug.hardwarePlatformEngineAndHost') }),
      ),
      h(
        native.View as never,
        {
          style: {
            gap: tokens.space[2],
            padding: tokens.space[3],
            borderRadius: tokens.radius.sm,
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.04)',
          },
        },
        infoItem(
          t('settings:debug.osPlatform'),
          device ? `${device.platform} · ${device.formFactor}` : 'android',
        ),
        infoItem(t('settings:debug.appBuildVersion'), device?.appVersion ?? '0.1.0'),
        infoItem(t('settings:general.interfaceLanguage'), interfaceLanguage),
      ),
    ),
    // Card 3 — diagnostic tools
    h(
      native.View as never,
      { style: cardStyle },
      h(
        native.View as never,
        { style: { marginBottom: tokens.space[3], gap: 2 } },
        h(Text, {
          variant: 'md',
          style: { fontWeight: '600' },
          children: t('settings:debug.diagnosticToolsSystemDevPanels'),
        }),
        h(Text, {
          variant: 'xs',
          tone: 'muted',
          children: t('settings:debug.inspectKernelEventsCaptureNetwork'),
        }),
      ),
      h(
        native.View as never,
        { style: { gap: tokens.space[3] } },
        ...tools.map((tool) => {
          const available = tool.viewId ? hasView(tool.viewId) : Boolean(tool.onPress)
          return h(
            native.View as never,
            {
              key: tool.titleKey,
              style: {
                padding: tokens.space[3],
                borderRadius: tokens.radius.sm,
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.06)',
                gap: tokens.space[2],
              },
            },
            h(Text, { variant: 'md', style: { fontWeight: '600' }, children: t(tool.titleKey) }),
            h(Text, { variant: 'xs', tone: 'muted', children: t(tool.descKey) }),
            h(
              Fragment,
              null,
              h(Button, {
                variant: 'primary',
                disabled: !available,
                testID: tool.testID,
                onPress: () => {
                  if (tool.viewId) ui?.navigate?.(tool.viewId)
                  else tool.onPress?.()
                },
                children: t(tool.buttonKey),
              }),
              available
                ? null
                : h(Text, {
                    variant: 'xs',
                    tone: 'muted',
                    children: t('settings:contributionBlock.notAvailableOnPlatform'),
                  }),
            ),
          )
        }),
      ),
    ),
  )
}

const cardStyle = {
  padding: tokens.space[4],
  borderRadius: tokens.radius.md,
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.06)',
} as const
