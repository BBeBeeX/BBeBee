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
        title: 'General & interface language',
        description: 'Set the app interface language and display preferences',
      },
      h(SettingsRow, {
        title: 'Interface language',
        description: 'Choose the display language',
        borderBottom: false,
        action: h(Select<'zh' | 'en'>, {
          value: settings.language === 'en' ? 'en' : 'zh',
          options: [
            { value: 'zh', label: 'Simplified Chinese' },
            { value: 'en', label: 'English' },
          ],
          accessibilityLabel: 'Interface language',
          onChange: (language) => void update({ language }),
        }),
      }),
    ),
    h(
      SettingsSection,
      {
        title: 'System behavior',
        description: 'Desktop window and tray behavior',
      },
      h(SettingsRow, {
        title: 'Minimize to system tray when closing the main window',
        description: 'When enabled, clicking the close button keeps the app running in the tray instead of quitting',
        borderBottom: false,
        action: h(Switch, {
          checked: settings.closeToTray,
          accessibilityLabel: 'Minimize to system tray when closing the main window',
          onChange: onCloseToTrayChange,
        }),
      }),
    ),
  )
}
