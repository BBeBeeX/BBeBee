/**
 * Global shortcut registration — the orchestration behind the "全局快捷键"
 * settings section.
 *
 * This used to live in a `useEffect` of the desktop settings screen, which
 * was both a layering mistake and a bug: a global hotkey is business
 * orchestration, not view state, and registering it from a screen's effect
 * silently unregistered every binding the moment the user navigated away
 * from `/settings`. Here the watcher lives for as long as the settings
 * service does, re-registers on the same `settings/changed` event the
 * settings UI subscribes to, and reaches the optional `device` service
 * through a dynamic `ctx.inject(['device'])` so the plugin's static `inject`
 * array — and with it the manifest and load order — stays untouched.
 *
 * On platforms without a real hotkey implementation (mobile), the device
 * service's `registerHotkey` is a documented no-op, so subscribing here is
 * inert rather than wrong.
 */

import type { Context } from 'cordis'
import type {
  AppSettings,
  DesktopLyricsService,
  DesktopLyricsSettings,
  DeviceService,
  GlobalShortcutsSettings,
  PlayerService,
  SettingsService,
  ShortcutKeybindings,
  SourcesService,
} from '@BBeBee/protocol'
import { DEFAULT_SHORTCUTS_SETTINGS } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/toolkit/hooks'

/**
 * The effective shortcut config: the user's keybindings merged over the
 * protocol defaults — the same derivation the settings screen used to build
 * before handing it to its own registration effect.
 */
function shortcutsOf(settings?: AppSettings): GlobalShortcutsSettings {
  return {
    enabled: settings?.shortcuts?.enabled ?? DEFAULT_SHORTCUTS_SETTINGS.enabled,
    keybindings: {
      ...DEFAULT_SHORTCUTS_SETTINGS.keybindings,
      ...(settings?.shortcuts?.keybindings ?? {}),
    },
  }
}

/**
 * Register every configured accelerator, storing the disposers so a settings
 * change can unregister them all before re-registering.
 */
function registerKeybindings(
  ctx: Context,
  kb: ShortcutKeybindings,
  disposers: (() => void)[],
): void {
  const device = serviceOf<DeviceService>(ctx, 'device')
  if (!device?.registerHotkey) return

  const register = (acc: string | undefined, handler: () => void) => {
    if (!acc) return
    try {
      const off = device.registerHotkey(acc, handler)
      if (off) disposers.push(off)
    } catch {
      // ignore unavailable accelerator
    }
  }

  register(kb.playPause, () => {
    const p = serviceOf<PlayerService>(ctx, 'player')
    p?.togglePlay?.()
  })
  register(kb.prevTrack, () => {
    const p = serviceOf<PlayerService>(ctx, 'player')
    void p?.previous?.()
  })
  register(kb.nextTrack, () => {
    const p = serviceOf<PlayerService>(ctx, 'player')
    void p?.next?.()
  })
  register(kb.volumeUp, () => {
    const p = serviceOf<PlayerService>(ctx, 'player')
    const cur = p?.state?.volume ?? 0.8
    p?.setVolume?.(Math.min(1, Math.round((cur + 0.05) * 100) / 100))
  })
  register(kb.volumeDown, () => {
    const p = serviceOf<PlayerService>(ctx, 'player')
    const cur = p?.state?.volume ?? 0.8
    p?.setVolume?.(Math.max(0, Math.round((cur - 0.05) * 100) / 100))
  })
  register(kb.toggleLyrics, () => {
    const dl = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
    if (dl) {
      dl.toggleVisible()
    } else {
      const s = serviceOf<SettingsService>(ctx, 'settings')
      if (s) {
        const cur = s.getSync()?.desktopLyrics
        void s.update({
          desktopLyrics: {
            ...cur,
            enabled: !(cur?.enabled ?? false),
          } as DesktopLyricsSettings,
        })
      }
    }
  })
  register(kb.toggleWindow, () => {
    const bridge = (
      window as unknown as { BBeBee?: { window?: { toggle?: () => Promise<void> } } }
    ).BBeBee
    void bridge?.window?.toggle?.()
  })
  register(kb.toggleLoved, () => {
    const p = serviceOf<PlayerService>(ctx, 'player')
    const s = serviceOf<SourcesService>(ctx, 'sources')
    const urn = p?.state?.trackUrn
    if (urn && s?.setLoved) {
      void s.setLoved(urn, true)
    }
  })
  register(kb.seekForward, () => {
    const p = serviceOf<PlayerService>(ctx, 'player')
    const pos = p?.state?.positionMs ?? 0
    void p?.seek?.(pos + 5000)
  })
  register(kb.seekBackward, () => {
    const p = serviceOf<PlayerService>(ctx, 'player')
    const pos = p?.state?.positionMs ?? 0
    void p?.seek?.(Math.max(0, pos - 5000))
  })
}

function unregisterAll(disposers: (() => void)[]): void {
  for (const off of disposers) off()
  disposers.length = 0
}

/**
 * Keep global shortcuts in sync with the `shortcuts` section of the settings
 * service.
 *
 * Called once from `SettingsPlugin`'s init. The `device` service is optional
 * (it is the one thing that actually registers an accelerator, and it exists
 * only where the platform provides it), so it is resolved through a dynamic
 * `ctx.inject`: the callback runs when `device` is available, its return
 * value disposes the registration when `device` or the settings plugin goes
 * away, and any `settings/changed` event tears the bindings down and rebuilds
 * them.
 */
export function watchGlobalShortcuts(ctx: Context): void {
  ctx.inject(['device'], (scoped) => {
    const settings = serviceOf<SettingsService>(scoped, 'settings')
    const disposers: (() => void)[] = []

    const sync = (next?: AppSettings) => {
      unregisterAll(disposers)
      const shortcuts = shortcutsOf(next ?? settings?.getSync())
      if (shortcuts.enabled) {
        registerKeybindings(scoped, shortcuts.keybindings, disposers)
      }
    }

    sync()
    const offSettings = scoped.on('settings/changed', sync)

    return () => {
      offSettings()
      unregisterAll(disposers)
    }
  })
}
