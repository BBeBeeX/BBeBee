import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings } from '@BBeBee/protocol'
import { Select, Switch, useI18n } from '@BBeBee/ui-kit-desktop'
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
          options: [
            // Native names by convention (macOS/iOS/browser settings do the
            // same): a user who cannot read the current UI language can still
            // find their own. "中文"/"English" are proper names — identical in
            // every locale, never translated (see i18n-allowlist.txt).
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
            { value: 'system', label: t('settings:index.followSystem') },
          ],
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
