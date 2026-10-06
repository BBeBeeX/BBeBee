import { createElement as h, useCallback, useState } from 'react'
import type React from 'react'
import type { SliderProps } from '@BBeBee/ui-core'
import { common, useHover } from '../theme.js'

export function Slider(props: SliderProps) {
  const { disabled = false } = props
  const [hovered, hoverProps] = useHover()
  const [dragging, setDragging] = useState<number | undefined>(undefined)

  const hasRange = Number.isFinite(props.max) && props.max > 0
  const isDisabled = Boolean(disabled) || !hasRange

  const commit = useCallback(
    (next: number) => {
      setDragging(undefined)
      if (isDisabled) return
      props.onCommit?.(next)
    },
    [props, isDisabled],
  )

  const rawValue = dragging ?? props.value
  const value = hasRange
    ? Math.max(0, Math.min(props.max, Number.isFinite(rawValue) ? rawValue : 0))
    : 0
  const percent = hasRange ? Math.max(0, Math.min(100, (value / props.max) * 100)) : 0
  const isInteracting = !isDisabled && (hovered || dragging !== undefined)
  const activeColor = isInteracting ? 'var(--slider-thumb, var(--color-primary, #5F87FF))' : 'var(--text-primary, #FFFFFF)'
  const trackBg = isInteracting
    ? `linear-gradient(to right, var(--electric-blue-600, #4F73FF) 0%, var(--color-primary, #5F87FF) ${percent * 0.5}%, var(--periwinkle-500, #7C86FF) ${percent}%, var(--slider-track, rgba(255, 255, 255, 0.10)) ${percent}%, var(--slider-track, rgba(255, 255, 255, 0.10)) 100%)`
    : `linear-gradient(to right, var(--text-primary, #FFFFFF) 0%, var(--text-primary, #FFFFFF) ${percent}%, var(--slider-track, rgba(255, 255, 255, 0.10)) ${percent}%, var(--slider-track, rgba(255, 255, 255, 0.10)) 100%)`

  return h('input', {
    ...common(props),
    ...hoverProps,
    type: 'range',
    min: 0,
    max: hasRange ? props.max : 0,
    value,
    disabled: isDisabled,
    'aria-valuenow': value,
    'aria-valuemax': hasRange ? props.max : 0,
    className: isInteracting ? 'is-dragging' : undefined,
    onChange: (event: { target: { value: string } }) => {
      if (isDisabled) return
      const next = Number(event.target.value)
      setDragging(next)
      props.onChange?.(next)
    },
    onPointerUp: (event: { currentTarget: { value: string } }) => {
      if (isDisabled) return
      commit(Number(event.currentTarget.value))
    },
    onKeyUp: (event: { currentTarget: { value: string } }) => {
      if (isDisabled) return
      commit(Number(event.currentTarget.value))
    },
    onBlur: () => setDragging(undefined),
    style: {
      width: '100%',
      accentColor: activeColor,
      cursor: isDisabled ? 'default' : 'pointer',
      '--slider-track-bg': trackBg,
    } as React.CSSProperties,
  })
}
