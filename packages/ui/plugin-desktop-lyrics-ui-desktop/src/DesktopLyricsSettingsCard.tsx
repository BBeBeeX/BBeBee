import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { DesktopLyricsService, DesktopLyricsSettings, SettingsService } from '@BBeBee/protocol'
import { DEFAULT_DESKTOP_LYRICS_SETTINGS } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { ColorPicker, Select, Slider, Switch } from '@BBeBee/ui-kit-desktop'
import { LyricsPreview } from './LyricsPreview.js'

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '14px 4px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
}

const titleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: '#F5F5F7' }
const descStyle: React.CSSProperties = { fontSize: 12, color: '#8E8E93', marginTop: 3, lineHeight: 1.45 }
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
      h('div', { style: titleStyle }, '桌面歌词设置'),
      h(
        'div',
        { style: descStyle },
        '配置悬浮桌面歌词的显示行数、对齐、字体、字号、颜色及透明度',
      ),
    ),
    h(
      'div',
      { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, '开启桌面歌词'),
        h('div', { style: descStyle }, '在屏幕最上层显示悬浮桌面歌词窗口'),
      ),
      h(Switch, {
        checked: visible,
        accessibilityLabel: '开启桌面歌词',
        onChange: toggleVisible,
      }),
    ),
    h(
      'div',
      { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, '歌词显示行数'),
        h('div', { style: descStyle }, '选择同时显示当前歌词与下一句歌词，或仅显示单行'),
      ),
      h(Select<'single' | 'double'>, {
        value: settings.lineMode,
        options: [
          { value: 'double', label: '双行显示' },
          { value: 'single', label: '单行显示' },
        ],
        accessibilityLabel: '歌词显示行数',
        onChange: (lineMode) => update({ lineMode }),
      }),
    ),
    h(
      'div',
      { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, '文本对齐方式'),
        h('div', { style: descStyle }, '配置歌词文字在窗口内的水平排版方向'),
      ),
      h(Select<'center' | 'left' | 'right'>, {
        value: settings.align,
        options: [
          { value: 'center', label: '居中对齐' },
          { value: 'left', label: '左对齐' },
          { value: 'right', label: '右对齐' },
        ],
        accessibilityLabel: '文本对齐方式',
        onChange: (align) => update({ align }),
      }),
    ),
    h(
      'div',
      { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, '歌词字体'),
        h('div', { style: descStyle }, '选择歌词呈现的字型族'),
      ),
      h(Select<string>, {
        value: settings.fontFamily,
        options: [
          { value: 'system-ui', label: '系统默认' },
          { value: 'PingFang SC, -apple-system', label: '苹方 (PingFang SC)' },
          { value: 'Microsoft YaHei, Segoe UI', label: '微软雅黑 (YaHei)' },
          { value: 'SimHei, sans-serif', label: '黑体 (SimHei)' },
          { value: 'KaiTi, STKaiti, serif', label: '楷体 (KaiTi)' },
          { value: 'JetBrains Mono, monospace', label: '等宽代码体' },
        ],
        accessibilityLabel: '歌词字体',
        onChange: (fontFamily) => update({ fontFamily }),
      }),
    ),
    h(
      'div',
      { style: rowStyle },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, '歌词字号'),
        h('div', { style: descStyle }, `当前字号大小: ${settings.fontSize}px`),
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
            accessibilityLabel: '歌词字号',
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
        h('div', { style: titleStyle }, '歌词高亮颜色'),
        h('div', { style: descStyle }, '主播放行歌词的高亮渲染颜色'),
      ),
      h(ColorPicker, {
        value: settings.textColor,
        accessibilityLabel: '歌词高亮颜色',
        onChange: (textColor) => update({ textColor }),
      }),
    ),
    h(
      'div',
      { style: { ...rowStyle, borderBottom: 'none' } },
      h(
        'div',
        null,
        h('div', { style: titleStyle }, '文字透明度'),
        h('div', { style: descStyle }, `当前透明度: ${Math.round(settings.opacity * 100)}%`),
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
            accessibilityLabel: '文字透明度',
            onChange: (op: number) => update({ opacity: Math.max(20, Math.round(op)) / 100 }),
          }),
        ),
      ),
    ),
    h(LyricsPreview, { settings }),
  )
}
