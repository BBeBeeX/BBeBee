import { createElement as h, useRef } from 'react'
import type { ReactElement, MouseEvent } from 'react'
import type { MiniPlayerData, MiniPlayerAction } from '@BBeBee/protocol'

export function formatTime(ms: number): string {
  if (!ms || isNaN(ms) || ms < 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

export interface TransportButtonsProps {
  data: MiniPlayerData
  onAction: (action: MiniPlayerAction) => void
  size?: 'sm' | 'md'
}

export function TransportButtons({
  data,
  onAction,
  size = 'md',
}: TransportButtonsProps): ReactElement {
  const isPlaying = data.status === 'playing'
  const buttonSize = size === 'sm' ? 26 : 32
  const playButtonSize = size === 'sm' ? 30 : 36
  const iconSize = size === 'sm' ? 14 : 16

  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: size === 'sm' ? 4 : 8,
        WebkitAppRegion: 'no-drag',
      },
    },
    // Previous Button
    h(
      'button',
      {
        type: 'button',
        'aria-label': '上一曲',
        title: '上一曲',
        disabled: !data.canPrevious,
        onClick: () => onAction({ type: 'previous' }),
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: buttonSize,
          height: buttonSize,
          borderRadius: '50%',
          border: 'none',
          background: 'transparent',
          color: data.canPrevious ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.3)',
          cursor: data.canPrevious ? 'pointer' : 'default',
          transition: 'all 0.15s ease',
          outline: 'none',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          if (data.canPrevious) {
            e.currentTarget.style.color = '#FFFFFF'
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
          }
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = data.canPrevious ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.3)'
        },
      },
      h(
        'svg',
        { width: iconSize, height: iconSize, viewBox: '0 0 24 24', fill: 'currentColor' },
        h('path', { d: 'M6 6h2v12H6zm3.5 6 8.5 6V6z' }),
      ),
    ),
    // Play / Pause Button
    h(
      'button',
      {
        type: 'button',
        'aria-label': isPlaying ? '暂停' : '播放',
        title: isPlaying ? '暂停' : '播放',
        disabled: !data.canPlayOrPause,
        onClick: () => onAction({ type: 'togglePlay' }),
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: playButtonSize,
          height: playButtonSize,
          borderRadius: '50%',
          background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
          color: 'var(--button-primary-text, #FFFFFF)',
          cursor: data.canPlayOrPause ? 'pointer' : 'default',
          boxShadow: isPlaying ? 'var(--glow-brand-sm, 0 0 12px rgba(95, 135, 255, 0.35))' : 'none',
          transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
          outline: 'none',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          if (data.canPlayOrPause) {
            e.currentTarget.style.transform = 'scale(1.08)'
            e.currentTarget.style.boxShadow = '0 0 16px rgba(255, 255, 255, 0.5)'
          }
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = isPlaying ? '0 0 12px rgba(255, 255, 255, 0.35)' : 'none'
        },
      },
      isPlaying
        ? h(
            'svg',
            { width: iconSize, height: iconSize, viewBox: '0 0 24 24', fill: 'currentColor' },
            h('path', { d: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' }),
          )
        : h(
            'svg',
            { width: iconSize, height: iconSize, viewBox: '0 0 24 24', fill: 'currentColor', style: { marginLeft: 2 } },
            h('path', { d: 'M8 5v14l11-7z' }),
          ),
    ),
    // Next Button
    h(
      'button',
      {
        type: 'button',
        'aria-label': '下一曲',
        title: '下一曲',
        disabled: !data.canNext,
        onClick: () => onAction({ type: 'next' }),
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: buttonSize,
          height: buttonSize,
          borderRadius: '50%',
          border: 'none',
          background: 'transparent',
          color: data.canNext ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.3)',
          cursor: data.canNext ? 'pointer' : 'default',
          transition: 'all 0.15s ease',
          outline: 'none',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          if (data.canNext) {
            e.currentTarget.style.color = '#FFFFFF'
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
          }
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = data.canNext ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.3)'
        },
      },
      h(
        'svg',
        { width: iconSize, height: iconSize, viewBox: '0 0 24 24', fill: 'currentColor' },
        h('path', { d: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z' }),
      ),
    ),
  )
}

export interface ProgressBarProps {
  positionMs: number
  durationMs: number
  onSeek?: (positionMs: number) => void
  showTimestamps?: boolean
}

export function ProgressBar({
  positionMs,
  durationMs,
  onSeek,
  showTimestamps = false,
}: ProgressBarProps): ReactElement {
  const barRef = useRef<HTMLDivElement>(null)
  const progressPercent = durationMs > 0 ? Math.min(100, Math.max(0, (positionMs / durationMs) * 100)) : 0

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onSeek || durationMs <= 0 || !barRef.current) return
    const rect = barRef.current.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    onSeek(Math.round(ratio * durationMs))
  }

  return h(
    'div',
    {
      style: {
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        WebkitAppRegion: 'no-drag',
      },
    },
    // Rail
    h(
      'div',
      {
        ref: barRef,
        onClick: handleClick,
        style: {
          width: '100%',
          height: 4,
          borderRadius: 2,
          backgroundColor: 'rgba(255, 255, 255, 0.16)',
          cursor: onSeek ? 'pointer' : 'default',
          position: 'relative',
          overflow: 'hidden',
          transition: 'height 0.15s ease',
        },
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          if (onSeek) e.currentTarget.style.height = '6px'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.height = '4px'
        },
      },
      // Filled track
      h('div', {
        style: {
          width: `${progressPercent}%`,
          height: '100%',
          borderRadius: 2,
          backgroundColor: '#FFFFFF',
          transition: 'width 0.1s linear',
        },
      }),
    ),
    // Timestamps
    showTimestamps &&
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            color: 'rgba(255, 255, 255, 0.5)',
            userSelect: 'none',
          },
        },
        h('span', null, formatTime(positionMs)),
        // A live stream has no duration; `formatTime` renders 0 as `0:00`,
        // which would claim it is zero seconds long — the same honesty the
        // toolkit's `formatDuration` already applies to unknown durations.
        h('span', null, durationMs > 0 ? formatTime(durationMs) : '--:--'),
      ),
  )
}
