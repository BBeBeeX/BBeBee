import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { GlobalShortcutsSettings } from '@BBeBee/protocol'
import { DEFAULT_SHORTCUTS_SETTINGS } from '@BBeBee/protocol'
import { Button } from '@BBeBee/ui-kit-desktop'
import { Switch } from '../Switch.js'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

export interface ShortcutsSectionProps {
  shortcuts: GlobalShortcutsSettings
  onUpdateShortcuts: (shortcuts: GlobalShortcutsSettings) => void
}

const SHORTCUT_ITEMS = [
  { key: 'playPause', label: '播放 / 暂停', defaultVal: 'Ctrl+Alt+Space' },
  { key: 'prevTrack', label: '上一首歌曲', defaultVal: 'Ctrl+Alt+Left' },
  { key: 'nextTrack', label: '下一首歌曲', defaultVal: 'Ctrl+Alt+Right' },
  { key: 'volumeUp', label: '增大音量 (+5%)', defaultVal: 'Ctrl+Alt+Up' },
  { key: 'volumeDown', label: '调小音量 (-5%)', defaultVal: 'Ctrl+Alt+Down' },
  { key: 'toggleLyrics', label: '显示 / 隐藏桌面歌词', defaultVal: 'Ctrl+Alt+L' },
  { key: 'toggleWindow', label: '显示 / 隐藏音乐界面', defaultVal: 'Ctrl+Alt+W' },
  { key: 'toggleLoved', label: '添加喜欢 / 取消喜欢', defaultVal: 'Ctrl+Alt+K' },
  { key: 'seekForward', label: '歌曲快进 (+5秒)', defaultVal: 'Ctrl+Alt+]' },
  { key: 'seekBackward', label: '歌曲快退 (-5秒)', defaultVal: 'Ctrl+Alt+[' },
] as const

export function ShortcutsSection({
  shortcuts,
  onUpdateShortcuts,
}: ShortcutsSectionProps): ReactElement {
  return h(
    'div',
    { id: 'section-shortcuts' },
    h(
      SettingsSection,
      {
        title: '全局快捷键',
        description: '在操作系统后台通过键盘组合键全局控制音乐播放、音量与窗口显隐',
      },
      h(SettingsRow, {
        title: '启用全局快捷键',
        description: '默认启用。切换至其他应用或游戏时依然可通过快捷键控制播放',
        action: h(Switch, {
          checked: shortcuts.enabled,
          accessibilityLabel: '启用全局快捷键',
          onChange: (enabled) => onUpdateShortcuts({ ...shortcuts, enabled }),
        }),
      }),
      ...SHORTCUT_ITEMS.map((item, index, arr) =>
        h(SettingsRow, {
          key: item.key,
          title: item.label,
          description: `当前快捷键绑定: ${shortcuts.keybindings[item.key as keyof typeof shortcuts.keybindings] || item.defaultVal}`,
          borderBottom: index < arr.length - 1,
          action: h(
            'div',
            {
              style: {
                padding: '4px 12px',
                borderRadius: 6,
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                color: '#F5F5F7',
                fontSize: 12,
                fontFamily: 'ui-monospace, monospace',
                fontWeight: 600,
              },
            },
            shortcuts.keybindings[item.key as keyof typeof shortcuts.keybindings] || item.defaultVal,
          ),
        }),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 12 } },
        h(Button, {
          variant: 'secondary',
          children: '恢复默认快捷键',
          onPress: () =>
            onUpdateShortcuts({
              enabled: true,
              keybindings: { ...DEFAULT_SHORTCUTS_SETTINGS.keybindings },
            }),
        }),
      ),
    ),
  )
}
