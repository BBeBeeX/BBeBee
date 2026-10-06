import { createElement as h, type ReactElement } from 'react'
import type { AppSettings } from '@BBeBee/protocol'
import { Select, Switch } from '@BBeBee/ui-kit-desktop'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

/**
 * The settings service's own general rows: interface language and the
 * desktop window/tray behaviour. Everything else in the general tab is
 * contributed by the plugin that owns it and rendered by the screen's
 * contribution aggregator — nothing cross-plugin is hardcoded here.
 */
export function GeneralSection({
  settings,
  update,
  onCloseToTrayChange,
}: {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<unknown>
  onCloseToTrayChange: (closeToTray: boolean) => void
}): ReactElement {
  return h(
    'div',
    { id: 'section-general' },
    h(
      SettingsSection,
      {
        title: '常规与界面语言',
        description: '设置应用程序的界面语言与显示偏好',
      },
      h(SettingsRow, {
        title: '界面语言',
        description: '设置显示的语言选项',
        borderBottom: false,
        action: h(Select<'zh' | 'en'>, {
          value: settings.language === 'en' ? 'en' : 'zh',
          options: [
            { value: 'zh', label: '简体中文' },
            { value: 'en', label: 'English' },
          ],
          accessibilityLabel: '界面语言',
          onChange: (language) => void update({ language }),
        }),
      }),
    ),
    h(
      SettingsSection,
      {
        title: '系统行为',
        description: '桌面端窗口及托盘运行策略',
      },
      h(SettingsRow, {
        title: '关闭主窗口时最小化到系统托盘',
        description: '开启后点击关闭按钮不会退出应用程序，而是保留在托盘后台运行',
        borderBottom: false,
        action: h(Switch, {
          checked: settings.closeToTray,
          accessibilityLabel: '关闭主窗口时最小化到系统托盘',
          onChange: onCloseToTrayChange,
        }),
      }),
    ),
  )
}
