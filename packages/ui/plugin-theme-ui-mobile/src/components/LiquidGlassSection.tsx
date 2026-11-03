import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, MobileLiquidGlassSettings } from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { tokens } from '@BBeBee/ui-tokens'
import { Slider, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { Chip as ChipComponent } from './Chip.js'

/**
 * The mobile Liquid Glass settings section, rendered by the theme card
 * below the appearance mode — not inside a theme-pack category, because
 * it is a visual preference, not a pack.
 *
 * Ownership: plugin-theme (appearance). This edits `AppSettings.liquidGlass`
 * only; the desktop glass in `settings.glass` (CSS variables + OS-window
 * effects) is untouched and stays desktop-only.
 *
 * Two tiers, matching the protocol model:
 * - 通用档 (general): both platforms — switch, style, interactive, intensity.
 * - 附加档 (advanced): Android-only shader props, labelled as such and
 *   passed through unconditionally (the library documents them as no-ops
 *   on iOS, so no `Platform.OS` branch is needed anywhere).
 */

type SettingsLike = { getSync(): AppSettings; update(p: unknown): Promise<unknown> }

function readLiquidGlass(ctx: Context): MobileLiquidGlassSettings {
  const settings = serviceOf<SettingsLike>(ctx, 'settings')
  return resolveMobileLiquidGlassSettings(settings?.getSync().liquidGlass)
}

export function LiquidGlassSection({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const settings = serviceOf<SettingsLike>(ctx, 'settings')
  const [liquidGlass, setLiquidGlass] = useState<MobileLiquidGlassSettings>(() =>
    readLiquidGlass(ctx),
  )

  useEffect(() => {
    const update = () => setLiquidGlass(readLiquidGlass(ctx))
    update()
    const off = ctx.on('settings/changed', update)
    return () => {
      off()
    }
  }, [ctx])

  const updateGeneral = (
    patch: Partial<MobileLiquidGlassSettings['general']>,
  ): void => {
    const next = {
      general: { ...liquidGlass.general, ...patch },
      advanced: liquidGlass.advanced,
    }
    setLiquidGlass(next)
    void settings?.update({ liquidGlass: next })
  }

  const updateAdvanced = (
    patch: Partial<MobileLiquidGlassSettings['advanced']>,
  ): void => {
    const next = {
      general: liquidGlass.general,
      advanced: { ...liquidGlass.advanced, ...patch },
    }
    setLiquidGlass(next)
    void settings?.update({ liquidGlass: next })
  }

  const onOff = (
    testIDPrefix: string,
    value: boolean,
    onPress: (next: boolean) => void,
  ): ReactElement =>
    h(
      native.View as never,
      { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2] } },
      ([true, false] as const).map((option) =>
        h(ChipComponent, {
          key: String(option),
          label: t(
            option
              ? 'theme:themeManagement.liquidGlassOn'
              : 'theme:themeManagement.liquidGlassOff',
          ),
          selected: value === option,
          onPress: () => onPress(option),
          testID: `${testIDPrefix}-${option ? 'on' : 'off'}`,
        }),
      ),
    )

  const { general, advanced } = liquidGlass
  const slider = (
    value: number,
    max: number,
    onCommit: (next: number) => void,
    testID: string,
    label: string,
  ): ReactElement =>
    h(
      native.View as never,
      { style: { gap: tokens.space[1] } },
      h(Text, { variant: 'xs', tone: 'muted' }, label),
      h(Slider, {
        value,
        max,
        onCommit,
        testID,
        accessibilityLabel: label,
      }),
    )

  return h(
    native.View as never,
    { testID: 'liquid-glass-section', style: { gap: tokens.space[3] } },
    h(
      native.View as never,
      { style: { gap: 3 } },
      h(Text, { variant: 'md' }, t('theme:themeManagement.liquidGlassTitle')),
      h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.liquidGlassDesc')),
    ),
    h(
      native.View as never,
      { style: { gap: tokens.space[2] } },
      h(Text, { variant: 'sm' }, t('theme:themeManagement.liquidGlassGeneral')),
      h(
        native.View as never,
        { style: { gap: tokens.space[1] } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.liquidGlassEnabled')),
        onOff('liquid-glass-enabled', general.enabled, (next) => updateGeneral({ enabled: next })),
      ),
      h(
        native.View as never,
        { style: { gap: tokens.space[1] } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.liquidGlassVariant')),
        h(
          native.View as never,
          { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[2] } },
          (['regular', 'clear'] as const).map((variant) =>
            h(ChipComponent, {
              key: variant,
              label: t(
                variant === 'regular'
                  ? 'theme:themeManagement.liquidGlassVariantRegular'
                  : 'theme:themeManagement.liquidGlassVariantClear',
              ),
              selected: general.variant === variant,
              onPress: () => updateGeneral({ variant }),
              testID: `liquid-glass-variant-${variant}`,
            }),
          ),
        ),
      ),
      h(
        native.View as never,
        { style: { gap: tokens.space[1] } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.liquidGlassInteractive')),
        onOff('liquid-glass-interactive', general.interactive, (next) => updateGeneral({ interactive: next })),
      ),
      slider(
        general.intensity,
        100,
        (next) => updateGeneral({ intensity: next }),
        'liquid-glass-intensity',
        t('theme:themeManagement.liquidGlassIntensity'),
      ),
      h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.liquidGlassIntensityNote')),
    ),
    h(
      native.View as never,
      { style: { gap: tokens.space[2] } },
      h(Text, { variant: 'sm' }, t('theme:themeManagement.liquidGlassAdvanced')),
      h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.liquidGlassAdvancedDesc')),
      slider(
        Math.round(advanced.thickness * 100),
        200,
        (next) => updateAdvanced({ thickness: next / 100 }),
        'liquid-glass-thickness',
        t('theme:themeManagement.liquidGlassThickness'),
      ),
      h(
        native.View as never,
        { style: { gap: tokens.space[1] } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.liquidGlassRefraction')),
        onOff('liquid-glass-refraction', advanced.refraction, (next) => updateAdvanced({ refraction: next })),
      ),
      h(
        native.View as never,
        { style: { gap: tokens.space[1] } },
        h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.liquidGlassTilt')),
        onOff('liquid-glass-tilt', advanced.tilt, (next) => updateAdvanced({ tilt: next })),
      ),
      h(Text, { variant: 'xs', tone: 'muted' }, t('theme:themeManagement.liquidGlassTiltNote')),
      slider(
        Math.round(advanced.edgeReflectionStrength * 100),
        100,
        (next) => updateAdvanced({ edgeReflectionStrength: next / 100 }),
        'liquid-glass-edge-reflection',
        t('theme:themeManagement.liquidGlassEdgeReflection'),
      ),
      slider(
        Math.round(advanced.legibilityFloor * 100),
        100,
        (next) => updateAdvanced({ legibilityFloor: next / 100 }),
        'liquid-glass-legibility-floor',
        t('theme:themeManagement.liquidGlassLegibilityFloor'),
      ),
    ),
  )
}
