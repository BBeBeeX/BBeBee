/**
 * Style switcher — a button + popover for choosing the now-playing layout.
 *
 * Placed in the top-right corner of `NowPlayingScreen`, mirroring the close
 * button in the top-left corner.  The popover lists all four styles with
 * icons; the active one is highlighted.
 */

import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { NowPlayingService, NowPlayingStyleId } from '@BBeBee/protocol'
import { NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { serviceOf, shallowArrayEqual, useServiceState } from '@BBeBee/ui-core'
import { Text, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

export interface StyleSwitcherProps {
  ctx: Context
  styleId: NowPlayingStyleId
  onStyleChange: (id: NowPlayingStyleId) => void
}

export function StyleSwitcher({ ctx, styleId, onStyleChange }: StyleSwitcherProps): ReactElement {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const styles = useServiceState(
    ctx,
    ['now-playing/registry-changed'],
    () => serviceOf<NowPlayingService>(ctx, 'nowPlaying')?.getStyles?.() ?? NOW_PLAYING_STYLES,
    { isEqual: shallowArrayEqual },
  )

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return h(
    'div',
    {
      ref: containerRef,
      style: {
        position: 'absolute',
        top: tokens.space[5],
        right: tokens.space[5],
        zIndex: 10,
      },
    },
    /* trigger button */
    h(
      'button',
      {
        type: 'button',
        'aria-label': '切换播放页样式',
        'data-testid': 'style-switcher-button',
        title: '切换播放页样式',
        onClick: () => setOpen((prev) => !prev),
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: tokens.radius.pill,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          background: open ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.08)',
          color: 'var(--bb-text-primary, #FFFFFF)',
          cursor: 'pointer',
          transition: `background-color ${tokens.duration.fast}ms, transform ${tokens.duration.fast}ms`,
          WebkitAppRegion: 'no-drag' as unknown as undefined,
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.16)'
          e.currentTarget.style.transform = 'scale(1.06)'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = open ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.08)'
          e.currentTarget.style.transform = 'scale(1)'
        },
      },
      tablerIcon('layout-grid', { size: 22 }),
    ),
    /* popover */
    open
      ? h(
          'div',
          {
            role: 'menu',
            'aria-label': '播放页样式',
            style: {
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 8,
              minWidth: 200,
              padding: `${tokens.space[2]}px`,
              borderRadius: tokens.radius.md,
              backgroundColor: 'var(--surface-2, #111522)',
              border: '1px solid var(--border-subtle, rgba(148, 163, 184, 0.14))',
              boxShadow: 'var(--shadow-dropdown, 0 8px 24px rgba(0, 0, 0, 0.65))',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              zIndex: 100,
            },
          },
          ...styles.map((s) => {
            const isActive = s.id === styleId
            return h(
              'button',
              {
                key: s.id,
                type: 'button',
                role: 'menuitem',
                'aria-current': isActive ? 'true' : undefined,
                'data-testid': `style-option-${s.id}`,
                onClick: () => {
                  onStyleChange(s.id)
                  setOpen(false)
                },
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.space[3],
                  padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
                  borderRadius: tokens.radius.sm,
                  border: 'none',
                  background: isActive ? 'var(--surface-selected, rgba(117, 152, 255, 0.12))' : 'transparent',
                  color: isActive ? 'var(--color-primary, #5F87FF)' : 'var(--text-primary, #FFFFFF)',
                  cursor: 'pointer',
                  transition: 'background-color 0.12s ease',
                  textAlign: 'left',
                  width: '100%',
                },
                onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'var(--surface-hover, rgba(255, 255, 255, 0.06))'
                },
                onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
                },
              },
              h('span', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                },
              }, tablerIcon(s.icon, { size: 20 })),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 } },
                h(Text, { variant: 'sm', children: s.name }),
                h(Text, { variant: 'xs', tone: 'muted', children: s.description }),
              ),
            )
          }),
        )
      : null,
  )
}
