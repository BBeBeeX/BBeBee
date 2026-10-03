/**
 * Service Node Visual Component.
 *
 * Distinct hexagonal / diamond IC chip representing Cordis Services
 * (e.g. `ctx.audio`, `ctx.player`, `ctx.ui`, `ctx.inspector`).
 */

import { memo, type ReactElement } from 'react'
import type { ServiceNode } from '../graph-model.js'

export interface ServiceNodeViewProps {
  node: ServiceNode
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

export const ServiceNodeView = memo(function ServiceNodeView({
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
}: ServiceNodeViewProps): ReactElement {
  const opacity = hasActiveSelection ? (isSelected || isRelated ? 1.0 : 0.22) : 1.0
  const isAvailable = node.status === 'ACTIVE'

  const strokeColor = isSelected ? '#ffffff' : isAvailable ? '#2dd4bf' : '#f59e0b'
  const fillColor = isAvailable ? '#042f2e' : '#291c0b'

  const centerX = x + width / 2
  const centerY = y + height / 2

  // Hexagonal polygon points
  const p1 = `${centerX},${y}`
  const p2 = `${x + width},${y + height * 0.25}`
  const p3 = `${x + width},${y + height * 0.75}`
  const p4 = `${centerX},${y + height}`
  const p5 = `${x},${y + height * 0.75}`
  const p6 = `${x},${y + height * 0.25}`
  const hexPoints = `${p1} ${p2} ${p3} ${p4} ${p5} ${p6}`

  const displayLabel = node.name.length > 11 ? node.name.slice(0, 10) + '…' : node.name

  return (
    <g
      className="service-node"
      data-testid={`service-node-${node.id}`}
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
      {/* Selection / Hover Glow */}
      {(isSelected || isHovered) && (
        <polygon
          points={hexPoints}
          fill="none"
          stroke={strokeColor}
          strokeWidth={isSelected ? 3.5 : 2}
          strokeDasharray={isSelected ? undefined : '3 3'}
          opacity={0.85}
          transform={`scale(1.08) translate(${-centerX * 0.08}, ${-centerY * 0.08})`}
        />
      )}

      {/* Hexagonal Body */}
      <polygon
        points={hexPoints}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={1.8}
        strokeDasharray={isAvailable ? undefined : '4 2'}
      />

      {/* Service Diamond Glyph and Label */}
      <text
        x={centerX}
        y={centerY}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#e2e8f0"
        fontSize={10}
        fontWeight={700}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
      >
        ◇ {displayLabel}
      </text>

      {/* Top Terminal Pin */}
      <circle cx={centerX} cy={y} r={2.5} fill="#2dd4bf" stroke="#05070d" strokeWidth={1} />
      {/* Bottom Terminal Pin */}
      <circle
        cx={centerX}
        cy={y + height}
        r={2.5}
        fill="#2dd4bf"
        stroke="#05070d"
        strokeWidth={1}
      />
    </g>
  )
})
