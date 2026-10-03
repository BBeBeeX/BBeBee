/**
 * Event Node Visual Component.
 *
 * Compact circuit badge representing Cordis Event Hooks (e.g. `ui/changed`, `player/track-changed`).
 */

import { memo, type ReactElement } from 'react'
import type { EventNode } from '../graph-model.js'

export interface EventNodeViewProps {
  node: EventNode
  x: number
  y: number
  width: number
  height: number
  isSelected: boolean
  isHovered: boolean
  isRelated: boolean
  hasActiveSelection: boolean
  onClick: (id: string) => void
  onMouseEnter?: (id: string) => void
  onMouseLeave?: () => void
}

export const EventNodeView = memo(function EventNodeView({
  node,
  x,
  y,
  width,
  height,
  isSelected,
  isHovered,
  isRelated,
  hasActiveSelection,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: EventNodeViewProps): ReactElement {
  const opacity = hasActiveSelection ? (isSelected || isRelated ? 1.0 : 0.22) : 1.0

  const centerX = x + width / 2
  const centerY = y + height / 2
  const strokeColor = isSelected ? '#ffffff' : '#c084fc'

  const displayLabel = node.name.length > 11 ? node.name.slice(0, 10) + '…' : node.name

  return (
    <g
      className="event-node"
      data-testid={`event-node-${node.id}`}
      style={{
        cursor: 'pointer',
        opacity,
        transition: 'opacity 0.18s ease',
      }}
      onClick={(e) => {
        e.stopPropagation()
        onClick(node.id)
      }}
      onMouseEnter={() => onMouseEnter?.(node.id)}
      onMouseLeave={() => onMouseLeave?.()}
    >
      {/* Outer Halo */}
      {(isSelected || isHovered) && (
        <rect
          x={x - 3}
          y={y - 3}
          width={width + 6}
          height={height + 6}
          rx={height / 2 + 3}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2}
          opacity={0.8}
        />
      )}

      {/* Pill Body */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={height / 2}
        fill="#1e1136"
        stroke={strokeColor}
        strokeWidth={1.4}
      />

      {/* Event Dot Icon */}
      <circle cx={x + 12} cy={centerY} r={3} fill="#c084fc" />

      {/* Event Name */}
      <text
        x={x + 22}
        y={centerY}
        dominantBaseline="central"
        fill="#f3e8ff"
        fontSize={9}
        fontWeight={600}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
      >
        {displayLabel}
      </text>

      {/* Top Terminal Pin */}
      <circle cx={centerX} cy={y} r={2} fill="#c084fc" stroke="#05070d" strokeWidth={1} />
      {/* Bottom Terminal Pin */}
      <circle cx={centerX} cy={y + height} r={2} fill="#c084fc" stroke="#05070d" strokeWidth={1} />
    </g>
  )
})
