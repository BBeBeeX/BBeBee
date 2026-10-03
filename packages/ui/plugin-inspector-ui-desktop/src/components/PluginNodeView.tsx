/**
 * Plugin Node Visual Component.
 *
 * Renders a circular/rounded circuit chip with technical status glow,
 * monospace labelling, and peripheral solder pin contacts matching the
 * motherboard topology aesthetic.
 */

import { memo, type ReactElement } from 'react'
import type { PluginNode } from '../graph-model.js'

export interface PluginNodeViewProps {
  node: PluginNode
  x: number
  y: number
  width: number
  height: number
  isSelected: boolean
  isHovered: boolean
  isRelated: boolean
  hasActiveSelection: boolean
  onClick: (id: string) => void
  onDoubleClick?: (id: string) => void
  onMouseEnter?: (id: string) => void
  onMouseLeave?: () => void
}

const STATUS_COLORS: Record<string, { main: string; glow: string; text: string }> = {
  ACTIVE: { main: '#38bdf8', glow: 'rgba(56, 189, 248, 0.4)', text: '#38bdf8' },
  PENDING: { main: '#f59e0b', glow: 'rgba(245, 158, 11, 0.4)', text: '#f59e0b' },
  LOADING: { main: '#eab308', glow: 'rgba(234, 179, 8, 0.4)', text: '#eab308' },
  FAILED: { main: '#ef4444', glow: 'rgba(239, 68, 68, 0.6)', text: '#ef4444' },
  DISPOSED: { main: '#64748b', glow: 'rgba(100, 116, 139, 0.2)', text: '#64748b' },
  UNLOADING: { main: '#a855f7', glow: 'rgba(168, 85, 247, 0.4)', text: '#a855f7' },
  UNKNOWN: { main: '#94a3b8', glow: 'rgba(148, 163, 184, 0.2)', text: '#94a3b8' },
}

export const PluginNodeView = memo(function PluginNodeView({
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
  onDoubleClick,
  onMouseEnter,
  onMouseLeave,
}: PluginNodeViewProps): ReactElement {
  const statusCfg = STATUS_COLORS[node.status] ?? STATUS_COLORS['UNKNOWN']!

  // Dim unrelated nodes when a selection is active
  const opacity = hasActiveSelection ? (isSelected || isRelated ? 1.0 : 0.22) : 1.0

  const centerX = x + width / 2
  const centerY = y + height / 2
  const radius = Math.min(width, height) / 2 - 2

  // Format short display label
  const rawName = node.name.replace(/^@BBeBee\//, '')
  const displayLabel = rawName.length > 12 ? rawName.slice(0, 11) + '…' : rawName

  return (
    <g
      className="plugin-node"
      data-testid={`plugin-node-${node.id}`}
      style={{
        cursor: 'pointer',
        opacity,
        transition: 'opacity 0.18s ease, transform 0.18s ease',
      }}
      onClick={(e) => {
        e.stopPropagation()
        onClick(node.id)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick?.(node.id)
      }}
      onMouseEnter={() => onMouseEnter?.(node.id)}
      onMouseLeave={() => onMouseLeave?.()}
    >
      {/* Selection / Hover Aura */}
      {(isSelected || isHovered) && (
        <circle
          cx={centerX}
          cy={centerY}
          r={radius + 8}
          fill="none"
          stroke={statusCfg.main}
          strokeWidth={isSelected ? 3 : 1.5}
          strokeDasharray={isSelected ? undefined : '4 4'}
          opacity={0.8}
        />
      )}

      {/* Main Node Circular Body */}
      <circle
        cx={centerX}
        cy={centerY}
        r={radius}
        fill="#0b1324"
        stroke={isSelected ? '#ffffff' : statusCfg.main}
        strokeWidth={isSelected ? 2.5 : 1.6}
        filter="url(#pcb-subtle-shadow)"
      />

      {/* Concentric Inner Ring */}
      <circle
        cx={centerX}
        cy={centerY}
        r={radius - 6}
        fill="rgba(15, 23, 42, 0.6)"
        stroke={statusCfg.glow}
        strokeWidth={1}
      />

      {/* Status Dot */}
      <circle
        cx={centerX}
        cy={centerY - 14}
        r={3.5}
        fill={statusCfg.main}
      />

      {/* Monospace Plugin Name */}
      <text
        x={centerX}
        y={centerY + 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#f8fafc"
        fontSize={10.5}
        fontWeight={600}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        letterSpacing={0.4}
      >
        {displayLabel}
      </text>

      {/* Version / Status Subtext */}
      <text
        x={centerX}
        y={centerY + 16}
        textAnchor="middle"
        dominantBaseline="central"
        fill={statusCfg.text}
        fontSize={8.5}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        opacity={0.85}
      >
        {node.status === 'ACTIVE' ? `v${node.version ?? '0.0'}` : node.status}
      </text>

      {/* Top Solder Pin Terminal */}
      <circle
        cx={centerX}
        cy={y}
        r={2.5}
        fill="#38bdf8"
        stroke="#05070d"
        strokeWidth={1}
      />

      {/* Bottom Solder Pin Terminal */}
      <circle
        cx={centerX}
        cy={y + height}
        r={2.5}
        fill="#38bdf8"
        stroke="#05070d"
        strokeWidth={1}
      />
    </g>
  )
})
