import { Button, Switch, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AppSettings, GlobalShortcutsSettings } from '@BBeBee/protocol'
import { DEFAULT_SHORTCUTS_SETTINGS } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'

interface SettingsWriter {
  getSync(): AppSettings
  update(patch: Partial<AppSettings>): Promise<unknown>
}

function formatShortcut(val: string): string {
  return val.replace(/CommandOrControl/g, 'Command/Control')
}

const SHORTCUT_ITEMS = [
  { key: 'playPause', labelKey: 'settings:shortcuts.playPause', defaultVal: 'Command/Control+Alt+Space' },
  { key: 'prevTrack', labelKey: 'settings:shortcuts.previousSong', defaultVal: 'Command/Control+Alt+Left' },
  { key: 'nextTrack', labelKey: 'settings:shortcuts.nextSong', defaultVal: 'Command/Control+Alt+Right' },
  { key: 'volumeUp', labelKey: 'settings:shortcuts.volumeUp', defaultVal: 'Command/Control+Alt+Up' },
  { key: 'volumeDown', labelKey: 'settings:shortcuts.volumeDown', defaultVal: 'Command/Control+Alt+Down' },
  { key: 'toggleLyrics', labelKey: 'settings:shortcuts.showHideDesktopLyrics', defaultVal: 'Command/Control+Alt+L' },
  { key: 'toggleWindow', labelKey: 'settings:shortcuts.showHideMusicUI', defaultVal: 'Command/Control+Alt+W' },
  { key: 'toggleLoved', labelKey: 'settings:shortcuts.likeUnlike', defaultVal: 'Command/Control+Alt+K' },
  { key: 'seekForward', labelKey: 'settings:shortcuts.seekForward5s', defaultVal: 'Command/Control+Alt+]' },
  { key: 'seekBackward', labelKey: 'settings:shortcuts.seekBackward5s', defaultVal: 'Command/Control+Alt+[' },
] as const

/**
 * The global shortcuts card. Registration of the bindings is headless
 * orchestration owned by the `plugin-settings` feature (`watchGlobalShortcuts`);
 * this card only edits the configuration document.
 */
export function ShortcutsCard({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const settingsWriter = serviceOf<SettingsWriter>(ctx, 'settings')
  const [shortcuts, setShortcuts] = useState<GlobalShortcutsSettings>(() => ({
    enabled: settingsWriter?.getSync()?.shortcuts?.enabled ?? DEFAULT_SHORTCUTS_SETTINGS.enabled,
    keybindings: {
      ...DEFAULT_SHORTCUTS_SETTINGS.keybindings,
      ...(settingsWriter?.getSync()?.shortcuts?.keybindings ?? {}),
    },
  }))

  useEffect(() => {
    const refresh = () => {
      const s = serviceOf<SettingsWriter>(ctx, 'settings')?.getSync()?.shortcuts
      if (s) {
        setShortcuts({
          enabled: s.enabled,
          keybindings: { ...DEFAULT_SHORTCUTS_SETTINGS.keybindings, ...s.keybindings },
        })
      }
    }
    refresh()
    const off = ctx.on('settings/changed', refresh)
    return () => {
      off()
    }
  }, [ctx])

  const onUpdateShortcuts = (next: GlobalShortcutsSettings) => {
    setShortcuts(next)
    void settingsWriter?.update({ shortcuts: next })
  }

  return h(
    'div',
    { 'data-testid': 'shortcuts-card' },
    h(
      'div',
      { style: { padding: '4px 4px 12px' } },
      h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #F5F5F7)' } }, t('settings:settings.globalShortcuts')),
      h(
        'div',
        { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)', marginTop: 2 } },
        t('settings:shortcuts.cardDescription'),
      ),
    ),
    h(SettingsSection, { title: t('settings:shortcuts.keyBindings') }, h(SettingsRow, {
      ctx,
        title: t('settings:shortcuts.enableGlobalShortcuts'),
        description: t('settings:shortcuts.enabledByDefaultPlaybackStays'),
        action: h(Switch, {
          checked: shortcuts.enabled,
          accessibilityLabel: t('settings:shortcuts.enableGlobalShortcuts'),
          onChange: (enabled) => onUpdateShortcuts({ ...shortcuts, enabled }),
        }),
      }),
      ...SHORTCUT_ITEMS.map((item, index, arr) => {
        const raw = shortcuts.keybindings[item.key as keyof typeof shortcuts.keybindings] || item.defaultVal
        const formatted = formatShortcut(raw)
        return h(SettingsRow, {
          ctx,
          key: item.key,
          title: t(item.labelKey),
          description: t('settings:shortcuts.currentKeyBinding', { formatted }),
          borderBottom: index < arr.length - 1,
          action: h(
            'div',
            {
              style: {
                padding: '4px 12px',
                borderRadius: 6,
                background: 'var(--surface-hover, rgba(255, 255, 255, 0.08))',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.14))',
                color: 'var(--text-primary, #F5F5F7)',
                fontSize: 12,
                fontFamily: 'ui-monospace, monospace',
                fontWeight: 600,
              },
            },
            formatted,
          ),
        })
      }),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 12 } },
        h(Button, {
          variant: 'secondary',
          children: t('settings:shortcuts.restoreDefaults'),
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
