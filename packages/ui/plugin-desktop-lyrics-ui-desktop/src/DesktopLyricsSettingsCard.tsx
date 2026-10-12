import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { DesktopLyricsService, DesktopLyricsSettings, SettingsService } from '@BBeBee/protocol'
import { DEFAULT_DESKTOP_LYRICS_SETTINGS } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { ColorPicker, Select, Slider, Switch, useI18n } from '@BBeBee/ui-kit-desktop'
import { LyricsPreview } from './LyricsPreview.js'

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '14px 4px',
  borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
}

const titleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary, #F5F5F7)' }
const descStyle: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-secondary, #8E8E93)', marginTop: 3, lineHeight: 1.45 }
const sliderBoxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: 220,
}

/**
 * The desktop lyrics settings card, contributed by `plugin-desktop-lyrics`
 * and rendered inline by the settings screen (`display: 'card'`).
 *
 * React holds no business state: the display style lives in the settings
 * document, the window visibility in the desktop-lyrics service — this card
 * only subscribes and dispatches.
 */
export function DesktopLyricsSettingsCard({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const [settings, setSettings] = useState<DesktopLyricsSettings>(() => ({
    ...DEFAULT_DESKTOP_LYRICS_SETTINGS,
    ...(serviceOf<SettingsService>(ctx, 'settings')?.getSync()?.desktopLyrics ?? {}),
  }))
  const [visible, setVisible] = useState<boolean>(() => {
    const dl = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
    if (dl) return dl.state.visible
    return (
      serviceOf<SettingsService>(ctx, 'settings')?.getSync()?.desktopLyrics?.enabled ?? false
    )
  })

  useEffect(() => {
    const refresh = () => {
      const s = serviceOf<SettingsService>(ctx, 'settings')
      const dl = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
      setSettings({
        ...DEFAULT_DESKTOP_LYRICS_SETTINGS,
        ...(s?.getSync()?.desktopLyrics ?? {}),
      })
      setVisible(dl ? dl.state.visible : (s?.getSync()?.desktopLyrics?.enabled ?? false))
    }
    refresh()
    const off1 = ctx.on('settings/changed', refresh)
    const off2 = ctx.on('desktop-lyrics/changed', refresh)
    return () => {
      off1()
      off2()
    }
  }, [ctx])

  const update = (patch: Partial<DesktopLyricsSettings>) => {
    const s = serviceOf<SettingsService>(ctx, 'settings')
    void s?.update({ desktopLyrics: { ...settings, ...patch } })
  }

  const toggleVisible = (enabled: boolean) => {
    void update({ enabled })
    const dl = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
    dl?.setVisible?.(enabled)
  }

  return h(
    'div',
    { 'data-testid': 'desktop-lyrics-settings-card' },
    h(
      'div',
      { style: { padding: '4px 4px 8px' } },
      h('div', { style: titleStyle }, t('lyrics:desktopLyricsSettings.desktopLyricsSettings')),
      h(
        'div',
        { style: descStyle },
        t('lyrics:desktopLyricsSettings.configureDescription'),
      ),
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
          marginBottom: 16,
          boxShadow: 'var(--settings-card-shadow, none)',
        },
      },
      h(
        'div',
        { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, t('lyrics:desktopLyricsSettings.enableDesktopLyrics')),
        h('div', { style: descStyle }, t('lyrics:desktopLyricsSettings.showTheFloatingDesktopLyrics')),
      ),
      h(Switch, {
        checked: visible,
        accessibilityLabel: t('lyrics:desktopLyricsSettings.enableDesktopLyrics'),
        onChange: toggleVisible,
      }),
    ),
    h(
      'div',
      { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, t('lyrics:desktopLyricsSettings.lyricLineCount')),
        h('div', { style: descStyle }, t('lyrics:desktopLyricsSettings.showTheCurrentAndNext')),
      ),
      h(Select<'single' | 'double'>, {
        value: settings.lineMode,
        options: [
          { value: 'double', label: t('lyrics:desktopLyricsSettings.doubleLine') },
          { value: 'single', label: t('lyrics:desktopLyricsSettings.singleLine') },
        ],
        accessibilityLabel: t('lyrics:desktopLyricsSettings.lyricLineCount'),
        onChange: (lineMode) => update({ lineMode }),
      }),
    ),
    h(
      'div',
      { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, t('lyrics:desktopLyricsSettings.textAlignment')),
        h('div', { style: descStyle }, t('lyrics:desktopLyricsSettings.setTheHorizontalLayoutDirection')),
      ),
      h(Select<'center' | 'left' | 'right'>, {
        value: settings.align,
        options: [
          { value: 'center', label: t('lyrics:desktopLyricsSettings.center') },
          { value: 'left', label: t('lyrics:desktopLyricsSettings.left') },
          { value: 'right', label: t('lyrics:desktopLyricsSettings.right') },
        ],
        accessibilityLabel: t('lyrics:desktopLyricsSettings.textAlignment'),
        onChange: (align) => update({ align }),
      }),
    ),
    h(
      'div',
      { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, t('lyrics:desktopLyricsSettings.lyricsFont')),
        h('div', { style: descStyle }, t('lyrics:desktopLyricsSettings.chooseTheFontFamilyLyrics')),
      ),
      h(Select<string>, {
        value: settings.fontFamily,
        options: [
          { value: 'system-ui', label: t('lyrics:desktopLyricsSettings.systemDefault') },
          { value: 'PingFang SC, -apple-system', label: t('lyrics:desktopLyricsSettings.pingFangSC') },
          { value: 'Microsoft YaHei, Segoe UI', label: t('lyrics:desktopLyricsSettings.microsoftYaHei') },
          { value: 'SimHei, sans-serif', label: t('lyrics:desktopLyricsSettings.simHei') },
          { value: 'KaiTi, STKaiti, serif', label: t('lyrics:desktopLyricsSettings.kaiTi') },
          { value: 'JetBrains Mono, monospace', label: t('lyrics:desktopLyricsSettings.monospace') },
        ],
        accessibilityLabel: t('lyrics:desktopLyricsSettings.lyricsFont'),
        onChange: (fontFamily) => update({ fontFamily }),
      }),
    ),
    h(
      'div',
      { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, t('lyrics:desktopLyricsSettings.lyricsFontSize')),
        h('div', { style: descStyle }, t('lyrics:desktopLyricsSettings.currentFontSize', { n: settings.fontSize })),
      ),
      h(
        'div',
        { style: sliderBoxStyle },
        h(
          'div',
          { style: { flex: 1 } },
          h(Slider, {
            value: settings.fontSize,
            max: 48,
            accessibilityLabel: t('lyrics:desktopLyricsSettings.lyricsFontSize'),
            onChange: (size: number) => update({ fontSize: Math.max(14, Math.round(size)) }),
          }),
        ),
      ),
    ),
    h(
      'div',
      { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, t('lyrics:desktopLyricsSettings.lyricsHighlightColor')),
        h('div', { style: descStyle }, t('lyrics:desktopLyricsSettings.highlightColorForTheActive')),
      ),
      h(ColorPicker, {
        value: settings.textColor,
        accessibilityLabel: t('lyrics:desktopLyricsSettings.lyricsHighlightColor'),
        onChange: (textColor) => update({ textColor }),
      }),
    ),
    h(
      'div',
      { style: { ...rowStyle, borderBottom: 'none' } },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, t('lyrics:desktopLyricsSettings.textOpacity')),
        h('div', { style: descStyle }, t('lyrics:desktopLyricsSettings.currentOpacity', { n: Math.round(settings.opacity * 100) })),
      ),
      h(
        'div',
        { style: sliderBoxStyle },
        h(
          'div',
          { style: { flex: 1 } },
          h(Slider, {
            value: Math.round(settings.opacity * 100),
            max: 100,
            accessibilityLabel: t('lyrics:desktopLyricsSettings.textOpacity'),
            onChange: (op: number) => update({ opacity: Math.max(20, Math.round(op)) / 100 }),
          }),
        ),
      ),
    ),
    ),
    h(LyricsPreview, {
      settings,
      // Presentational component without ctx: labels are translated here.
      lineModeLabel: t(
        settings.lineMode === 'double'
          ? 'lyrics:desktopLyricsSettings.doubleLine'
          : 'lyrics:desktopLyricsSettings.singleLine',
      ),
      livePreviewBadge: t('lyrics:desktopLyricsSettings.livePreview'),
    }),
  )
}
