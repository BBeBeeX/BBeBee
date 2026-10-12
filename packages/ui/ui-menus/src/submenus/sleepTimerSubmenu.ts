import type { Context } from 'cordis'
import type { MenuItemSpec, SubmenuSpec } from '@BBeBee/ui-core'
import type { SleepTimerService } from '@BBeBee/protocol'
import { menuTranslate } from '../utils/i18n.js'

/**
 * "Sleep Timer" submenu: 5min, 10min, 15min, 30min, 45min, 1h, end of track,
 * and a custom minutes input via `create`.
 */
export function sleepTimerSubmenu(
  sleepTimer: SleepTimerService | undefined,
  ctx?: Context,
): SubmenuSpec | undefined {
  if (!sleepTimer) return undefined
  const items: MenuItemSpec[] = []

  if (sleepTimer.state.active) {
    items.push({
      id: 'timer-cancel',
      label: menuTranslate(ctx, 'app:common.menu.turnOffSleepTimer', 'Turn off sleep timer'),
      icon: 'x',
      tone: 'danger',
      onSelect: () => sleepTimer.cancel(),
    })
  }

  items.push(
    {
      id: 'timer-5m',
      label: menuTranslate(ctx, 'app:common.menu.timer5m', '5 min'),
      onSelect: () => sleepTimer.startDuration(5 * 60 * 1000),
    },
    {
      id: 'timer-10m',
      label: menuTranslate(ctx, 'app:common.menu.timer10m', '10 min'),
      onSelect: () => sleepTimer.startDuration(10 * 60 * 1000),
    },
    {
      id: 'timer-15m',
      label: menuTranslate(ctx, 'app:common.menu.timer15m', '15 min'),
      onSelect: () => sleepTimer.startDuration(15 * 60 * 1000),
    },
    {
      id: 'timer-30m',
      label: menuTranslate(ctx, 'app:common.menu.timer30m', '30 min'),
      onSelect: () => sleepTimer.startDuration(30 * 60 * 1000),
    },
    {
      id: 'timer-45m',
      label: menuTranslate(ctx, 'app:common.menu.timer45m', '45 min'),
      onSelect: () => sleepTimer.startDuration(45 * 60 * 1000),
    },
    {
      id: 'timer-1h',
      label: menuTranslate(ctx, 'app:common.menu.timer1h', '1 hr'),
      onSelect: () => sleepTimer.startDuration(60 * 60 * 1000),
    },
    {
      id: 'timer-end-of-track',
      label: menuTranslate(ctx, 'app:common.menu.timerEndOfTrack', 'End of track'),
      onSelect: () => sleepTimer.startEndOfTrack(),
    },
  )

  return {
    title: menuTranslate(ctx, 'app:common.menu.sleepTimer', 'sleep timer'),
    create: {
      label: menuTranslate(ctx, 'app:common.menu.customTime', 'Custom time'),
      placeholder: menuTranslate(ctx, 'app:common.menu.customTimeMinutes', 'Custom time (in minutes)'),
      alwaysVisible: true,
      placement: 'bottom',
      buttonLabel: menuTranslate(ctx, 'app:common.confirm', 'OK'),
      onSelect: (val: string) => {
        const trimmed = val.trim()
        const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]!, 10)
          const minutes = parseInt(timeMatch[2]!, 10)
          const target = new Date()
          target.setHours(hours, minutes, 0, 0)
          if (target.getTime() <= Date.now()) {
            target.setDate(target.getDate() + 1)
          }
          sleepTimer.startAtEpoch(target.getTime())
          return
        }

        const mins = parseFloat(trimmed)
        if (Number.isFinite(mins) && mins > 0) {
          sleepTimer.startDuration(mins * 60 * 1000)
        }
      },
    },
    items,
  }
}
