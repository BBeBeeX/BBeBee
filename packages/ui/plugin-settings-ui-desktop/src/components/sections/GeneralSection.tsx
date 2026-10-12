import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings } from '@BBeBee/protocol'
import { Select, Switch, useI18n } from '@BBeBee/ui-kit-desktop'
import { getLanguageOptions } from './language-options.js'
import { SettingsRow } from '../SettingsRow.js'
import { SettingsSection } from '../SettingsSection.js'

/**
 * The settings service's own general rows: interface language and the
 * desktop window/tray behaviour. Everything else in the general tab is
 * contributed by the plugin that owns it and rendered by the screen's
 * contribution aggregator — nothing cross-plugin is hardcoded here.
 */
export function GeneralSection({
  ctx,
  settings,
  update,
  onCloseToTrayChange,
}: {
  ctx: Context
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<unknown>
  onCloseToTrayChange: (closeToTray: boolean) => void
}): ReactElement {
  const { t } = useI18n(ctx)
  return h(
    'div',
    { id: 'section-general' },
    h(
      SettingsSection,
      {
        title: t('settings:general.generalInterfaceLanguage'),
        description: t('settings:general.setTheAppInterfaceLanguage'),
      },
      h(SettingsRow, {
        ctx,
        title: t('settings:general.interfaceLanguage'),
        description: t('settings:general.chooseTheDisplayLanguage'),
        borderBottom: false,
        action: h(Select<'zh' | 'en' | 'system'>, {
          value: settings.language,
          options: getLanguageOptions(t),
          accessibilityLabel: t('settings:general.interfaceLanguage'),
          onChange: (language) => void update({ language }),
        }),
      }),
    ),
    h(
      SettingsSection,
      {
        title: t('settings:general.systemBehavior'),
        description: t('settings:general.desktopWindowAndTrayBehavior'),
      },
      h(SettingsRow, {
        ctx,
        title: t('settings:general.minimizeToSystemTrayWhen'),
        description: t('settings:general.whenEnabledClickingTheClose'),
        borderBottom: false,
        action: h(Switch, {
          checked: settings.closeToTray,
          accessibilityLabel: t('settings:general.minimizeToSystemTrayWhen'),
          onChange: onCloseToTrayChange,
        }),
      }),
    ),
  )
}
