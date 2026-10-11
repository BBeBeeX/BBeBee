import { Button, Switch } from '@BBeBee/ui-kit-desktop'
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
  { key: 'playPause', label: 'Play / Pause', defaultVal: 'Command/Control+Alt+Space' },
  { key: 'prevTrack', label: 'Previous song', defaultVal: 'Command/Control+Alt+Left' },
  { key: 'nextTrack', label: 'Next song', defaultVal: 'Command/Control+Alt+Right' },
  { key: 'volumeUp', label: 'Volume up (+5%)', defaultVal: 'Command/Control+Alt+Up' },
  { key: 'volumeDown', label: 'Volume down (-5%)', defaultVal: 'Command/Control+Alt+Down' },
  { key: 'toggleLyrics', label: 'Show / hide desktop lyrics', defaultVal: 'Command/Control+Alt+L' },
  { key: 'toggleWindow', label: 'Show / hide music UI', defaultVal: 'Command/Control+Alt+W' },
  { key: 'toggleLoved', label: 'Like / unlike', defaultVal: 'Command/Control+Alt+K' },
  { key: 'seekForward', label: 'Seek forward (+5s)', defaultVal: 'Command/Control+Alt+]' },
  { key: 'seekBackward', label: 'Seek backward (-5s)', defaultVal: 'Command/Control+Alt+[' },
] as const

/**
 * The global shortcuts card. Registration of the bindings is headless
 * orchestration owned by the `plugin-settings` feature (`watchGlobalShortcuts`);
 * this card only edits the configuration document.
 */
export function ShortcutsCard({ ctx }: { ctx: Context }): ReactElement {
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
      h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary, #F5F5F7)' } }, 'Global shortcuts'),
      h(
        'div',
        { style: { fontSize: 12, color: 'var(--text-secondary, #8E8E93)', marginTop: 2 } },
        'Control music playback, volume and window visibility globally from the OS via keyboard combinations',
      ),
    ),
    h(SettingsSection, { title: 'Key bindings' }, h(SettingsRow, {
        title: 'Enable global shortcuts',
        description: 'Enabled by default. Playback stays controllable via shortcuts even when another app or game has focus',
        action: h(Switch, {
          checked: shortcuts.enabled,
          accessibilityLabel: 'Enable global shortcuts',
          onChange: (enabled) => onUpdateShortcuts({ ...shortcuts, enabled }),
        }),
      }),
      ...SHORTCUT_ITEMS.map((item, index, arr) => {
        const raw = shortcuts.keybindings[item.key as keyof typeof shortcuts.keybindings] || item.defaultVal
        const formatted = formatShortcut(raw)
        return h(SettingsRow, {
          key: item.key,
          title: item.label,
          description: `Current key binding: ${formatted}`,
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
          children: 'Restore default shortcuts',
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
