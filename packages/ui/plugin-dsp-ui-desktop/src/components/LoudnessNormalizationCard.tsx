import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { LoudnessNormalizationMode, SettingsService } from '@BBeBee/protocol'
import { serviceOf, useServiceState } from '@BBeBee/toolkit/hooks'
import { Button, useI18n } from '@BBeBee/ui-kit-desktop'
import { useDsp } from '@BBeBee/plugin-dsp/hooks'

function Switch({
  checked,
  onChange,
  disabled = false,
  accessibilityLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  accessibilityLabel?: string
}): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      'aria-label': accessibilityLabel,
      disabled,
      onClick: () => {
        if (!disabled) onChange(!checked)
      },
      style: {
        width: 42,
        height: 24,
        borderRadius: 12,
        padding: 2,
        background: checked ? 'var(--accent-base, #5F87FF)' : 'var(--switch-off-bg, rgba(255, 255, 255, 0.15))',
        border: checked ? '1px solid transparent' : '1px solid var(--border-subtle, rgba(0, 0, 0, 0.08))',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        transition: 'background 0.2s ease',
        flexShrink: 0,
        outline: 'none',
      },
    },
    h('div', {
      style: {
        width: 20,
        height: 20,
        borderRadius: 10,
        background: '#FFFFFF',
        transform: checked ? 'translateX(18px)' : 'translateX(0)',
        transition: 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
      },
    }),
  )
}

function SectionWrapper({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}): ReactElement {
  return h(
    'section',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        marginBottom: 32,
        scrollMarginTop: 24,
      },
    },
    h(
      'header',
      {
        style: {
          paddingBottom: 4,
          marginBottom: 2,
        },
      },
      h(
        'h3',
        {
          style: {
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--bb-text-primary, #FFFFFF)',
            margin: 0,
            letterSpacing: '-0.01em',
          },
        },
        title,
      ),
      description
        ? h(
            'p',
            {
              style: {
                fontSize: 12,
                color: '#8E8E93',
                margin: '3px 0 0',
                lineHeight: 1.4,
              },
            },
            description,
          )
        : null,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--settings-card-bg, var(--card-bg, var(--surface-1, rgba(255, 255, 255, 0.03))))',
          border: '1px solid var(--settings-card-border, var(--border-subtle, rgba(255, 255, 255, 0.06)))',
          borderRadius: 10,
          padding: '2px 18px',
          marginTop: 8,
          boxShadow: 'var(--settings-card-shadow, none)',
        },
      },
      children,
    ),
  )
}

function RowWrapper({
  title,
  description,
  action,
  isNested = false,
  expandable = false,
  expanded = false,
  onToggleExpand,
  children,
  borderBottom = true,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  isNested?: boolean
  expandable?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  children?: React.ReactNode
  borderBottom?: boolean
}): ReactElement {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        borderBottom: borderBottom ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isNested ? '12px 16px 12px 28px' : '14px 4px',
          gap: 16,
          background: isNested ? 'rgba(255, 255, 255, 0.015)' : 'transparent',
          borderLeft: isNested ? '2px solid rgba(255, 255, 255, 0.15)' : 'none',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flex: 1,
            minWidth: 0,
          },
        },
        expandable
          ? h(
              'button',
              {
                type: 'button',
                onClick: onToggleExpand,
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: '#8E8E93',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                },
              },
              '▶',
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
          h('span', { style: { fontSize: 13, fontWeight: 500, color: 'var(--bb-text-primary, #FFFFFF)' } }, title),
          description
            ? h('span', { style: { fontSize: 12, color: '#8E8E93', lineHeight: 1.4 } }, description)
            : null,
        ),
      ),
      action ? h('div', { style: { flexShrink: 0 } }, action) : null,
    ),
    expandable && expanded && children ? children : null,
  )
}

export function LoudnessNormalizationCard({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const { chain, setEnabled, setParam } = useDsp(ctx)
  const normEntry = chain.find((c) => c.effectId === 'normalize')

  const currentSettings = useServiceState(ctx, ['settings/changed'], () => {
    const s = serviceOf<SettingsService>(ctx, 'settings')
    return s?.getSync?.()
  })

  const isEnabled = currentSettings?.loudnessNormalizationEnabled ?? (normEntry?.enabled ?? false)
  const currentMode = currentSettings?.loudnessNormalizationMode ?? 'track'
  const currentLufs = currentSettings?.loudnessTargetLufs ?? -14

  const handleToggle = (checked: boolean) => {
    const s = serviceOf<SettingsService>(ctx, 'settings')
    if (s?.update) {
      void s.update({ loudnessNormalizationEnabled: checked })
    }
    void setEnabled('normalize', checked)
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

  return h(
    SectionWrapper,
    {
      title: t('dsp:loudnessNormalization.loudnessNormalizationBetweenTracksLoudness'),
      description: t('dsp:loudnessNormalization.automaticallyBalancesVolumeDifferencesBetween'),
    },
    h(
      RowWrapper,
      {
        title: t('dsp:loudnessNormalization.enableLoudnessNormalization'),
        description: isEnabled
          ? t('dsp:loudnessNormalization.onAutomaticallyCalibrates')
          : t('dsp:loudnessNormalization.offPlaysBackOriginal'),
        action: h(Switch, {
          checked: isEnabled,
          accessibilityLabel: t('dsp:loudnessNormalization.loudnessNormalizationAria'),
          onChange: handleToggle,
        }),
        borderBottom: isEnabled,
      },
    ),
    isEnabled &&
      h(
        'div',
        null,
        h(RowWrapper, {
          isNested: true,
          title: t('dsp:loudnessNormalization.normalizationMode'),
          description:
            currentMode === 'album'
              ? t('dsp:loudnessNormalization.albumModePreservesDynamic')
              : currentMode === 'dynamic'
                ? t('dsp:loudnessNormalization.dynamicEbuR128Realtime')
                : t('dsp:loudnessNormalization.trackModeMatchesEach'),
          action: h(
            'div',
            { style: { display: 'flex', gap: 6 } },
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
        }),
        h(RowWrapper, {
          isNested: true,
          title: t('dsp:loudnessNormalization.targetLoudnessTargetLUFS'),
          description: t('dsp:loudnessNormalization.referenceTargetMatchesStreaming', {
            value: currentLufs,
          }),
          borderBottom: false,
          action: h(
            'div',
            { style: { display: 'flex', gap: 6 } },
            [
              { lufs: -14, label: t('dsp:loudnessNormalization.streaming') },
              { lufs: -18, label: t('dsp:loudnessNormalization.classicalQuiet') },
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
        }),
      ),
  )
}
