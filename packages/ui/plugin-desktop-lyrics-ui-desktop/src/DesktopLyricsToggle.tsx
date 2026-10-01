import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { DesktopLyricsService, DesktopLyricsSettings, SettingsService } from '@BBeBee/protocol'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import { tokens } from '@BBeBee/ui-tokens'

/**
 * Toggle button for floating desktop lyrics.
 * Synchronized bidirectionally with ctx.desktopLyrics and ctx.settings.
 */
export function DesktopLyricsToggle({ ctx }: { ctx: Context }): ReactElement {
  const isVisible = useServiceState<boolean>(
    ctx,
    ['desktop-lyrics/changed', 'settings/changed'],
    () => {
      const dl = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
      if (dl) return dl.state.visible
      const settings = serviceOf<SettingsService>(ctx, 'settings')
      return settings?.getSync()?.desktopLyrics?.enabled ?? false
    },
  )

  const handleToggle = () => {
    const service = serviceOf<DesktopLyricsService>(ctx, 'desktopLyrics')
    if (service) {
      service.toggleVisible()
    } else {
      const settings = serviceOf<SettingsService>(ctx, 'settings')
      if (settings) {
        const cur = settings.getSync()?.desktopLyrics
        void settings.update({
          desktopLyrics: {
            ...cur,
            enabled: !(cur?.enabled ?? false),
          } as DesktopLyricsSettings,
        })
      }
      void ctx.ui?.runCommand?.('desktop-lyrics.toggle')
    }
  }

  return h(
    'button',
    {
      type: 'button',
      'aria-label': isVisible ? '隐藏桌面歌词' : '显示桌面歌词',
      title: isVisible ? '隐藏桌面歌词' : '显示桌面歌词',
      'data-testid': 'desktop-lyrics-toggle',
      onClick: handleToggle,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: tokens.radius.sm,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: isVisible ? 'var(--color-accent, #A99CFF)' : 'var(--border-subtle, rgba(145, 176, 255, 0.14))',
        background: isVisible ? 'var(--surface-selected, rgba(117, 152, 255, 0.12))' : 'transparent',
        color: isVisible ? 'var(--text-primary, #FFFFFF)' : 'var(--text-secondary, rgba(255, 255, 255, 0.75))',
        boxShadow: isVisible ? 'var(--glow-purple-sm, 0 0 12px rgba(169, 156, 255, 0.20))' : 'none',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        outline: 'none',
        flexShrink: 0,
      },
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.borderColor = isVisible ? 'var(--color-accent-hover, #BEB4FF)' : 'var(--border-hover, rgba(145, 176, 255, 0.25))'
        e.currentTarget.style.color = 'var(--text-primary, #FFFFFF)'
        e.currentTarget.style.transform = 'scale(1.05)'
      },
      onMouseLeave: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.style.borderColor = isVisible ? 'var(--color-accent, #A99CFF)' : 'var(--border-subtle, rgba(145, 176, 255, 0.14))'
        e.currentTarget.style.color = isVisible ? 'var(--text-primary, #FFFFFF)' : 'var(--text-secondary, rgba(255, 255, 255, 0.75))'
        e.currentTarget.style.transform = 'scale(1)'
      },
    },
    '词',
  )
}
