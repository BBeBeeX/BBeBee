import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Context } from 'cordis'
import type { LoudnessNormalizationMode, SettingsService } from '@BBeBee/protocol'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import { Button, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'

const p = () => palettes.dark

export function LoudnessNormalizationCard({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const { chain, setEnabled, setParam } = useDsp(ctx)
  const normEntry = chain.find((c) => c.effectId === 'normalize')

  const currentSettings = useServiceState(ctx, ['settings/changed'], () => {
    const s = serviceOf<SettingsService>(ctx, 'settings')
    return s?.getSync?.()
  })

  const isEnabled = currentSettings?.loudnessNormalizationEnabled ?? (normEntry?.enabled ?? false)
  const currentMode = currentSettings?.loudnessNormalizationMode ?? 'track'
  const currentLufs = currentSettings?.loudnessTargetLufs ?? -14

  const handleToggle = () => {
    const next = !isEnabled
    const s = serviceOf<SettingsService>(ctx, 'settings')
    if (s?.update) {
      void s.update({ loudnessNormalizationEnabled: next })
    }
    void setEnabled('normalize', next)
  }

  const handleModeChange = (mode: LoudnessNormalizationMode) => {
    const s = serviceOf<SettingsService>(ctx, 'settings')
    if (s?.update) {
      void s.update({ loudnessNormalizationMode: mode })
    }
    void setParam('normalize', 'mode', mode === 'dynamic' ? 'loudnorm' : mode)
  }

  const handleLufsChange = (lufs: number) => {
    const s = serviceOf<SettingsService>(ctx, 'settings')
    if (s?.update) {
      void s.update({ loudnessTargetLufs: lufs })
    }
    void setParam('normalize', 'targetLufs', lufs)
  }

  const renderSectionHeader = (title: string, subtitle?: string) =>
    h(
      native.View as never,
      { style: { marginBottom: tokens.space[2], marginTop: tokens.space[4] } },
      h(Text, { variant: 'sm', tone: 'accent', children: title }),
      subtitle ? h(Text, { variant: 'xs', tone: 'muted', children: subtitle }) : null,
    )

  const renderCard = (children: ReactNode[]) =>
    h(
      native.View as never,
      {
        style: {
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          borderRadius: tokens.radius.md,
          padding: tokens.space[3],
          gap: tokens.space[3],
        },
      },
      ...children,
    )

  const renderRow = (title: string, description: string | undefined, control: ReactNode) =>
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space[3],
        },
      },
      h(
        native.View as never,
        { style: { flex: 1 } },
        h(Text, { variant: 'md', children: title }),
        description ? h(Text, { variant: 'xs', tone: 'muted', children: description }) : null,
      ),
      control,
    )

  const renderToggle = (checked: boolean, onToggle: () => void) =>
    h(
      native.Pressable as never,
      {
        onPress: onToggle,
        style: {
          width: 48,
          height: 26,
          borderRadius: 13,
          backgroundColor: checked ? p().accent.base : 'rgba(255, 255, 255, 0.15)',
          justifyContent: 'center',
          padding: 2,
        },
      },
      h(native.View as never, {
        style: {
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: '#ffffff',
          transform: [{ translateX: checked ? 22 : 0 }],
        },
      }),
    )

  return h(
    native.View as never,
    null,
    renderSectionHeader(
      t('dsp:loudnessNormalization.loudnessNormalizationBetweenTracksLoudness'),
      t('dsp:loudnessNormalization.automaticallyBalancesVolumeDifferences'),
    ),
    renderCard([
      renderRow(
        t('dsp:loudnessNormalization.enableLoudnessNormalization'),
        isEnabled
          ? t('dsp:loudnessNormalization.automaticallyCalibratesTrackLoudnessTo')
          : t('dsp:loudnessNormalization.keepsTheOriginalGainLevel'),
        renderToggle(isEnabled, handleToggle),
      ),
      isEnabled
        ? h(
            native.View as never,
            { style: { gap: tokens.space[2], marginTop: tokens.space[1] } },
            h(Text, { variant: 'xs', tone: 'muted', children: t('dsp:loudnessNormalization.normalizationMode') }),
            h(
              native.View as never,
              { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1] } },
              [
                { id: 'track' as LoudnessNormalizationMode, label: t('dsp:loudnessNormalization.trackMode') },
                { id: 'album' as LoudnessNormalizationMode, label: t('dsp:loudnessNormalization.albumMode') },
                { id: 'dynamic' as LoudnessNormalizationMode, label: t('dsp:loudnessNormalization.dynamicR128') },
              ].map((m) =>
                h(Button, {
                  key: m.id,
                  variant: currentMode === m.id ? 'primary' : 'secondary',
                  onPress: () => handleModeChange(m.id),
                  children: m.label,
                }),
              ),
            ),
            h(Text, { variant: 'xs', tone: 'muted', children: t('dsp:loudnessNormalization.targetLoudnessValue', { value: currentLufs }) }),
            h(
              native.View as never,
              { style: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space[1] } },
              [
                { lufs: -14, label: t('dsp:loudnessNormalization.streaming') },
                { lufs: -18, label: t('dsp:loudnessNormalization.classical') },
                { lufs: -11, label: t('dsp:loudnessNormalization.loud') },
              ].map((item) =>
                h(Button, {
                  key: item.lufs,
                  variant: currentLufs === item.lufs ? 'primary' : 'secondary',
                  onPress: () => handleLufsChange(item.lufs),
                  children: item.label,
                }),
              ),
            ),
          )
        : null,
    ]),
  )
}
