/**
 * Graph Canvas Component.
 *
 * Implements the technical dark circuit motherboard canvas:
 * - Architectural Layer container bands (Kernel, Core, Logs, Feature, UI)
 * - Multi-channel orthogonal bus routing traces with solder pin terminals
 * - Highlighting of active subgraphs and edge selection
 * - Smooth pan and zoom viewport navigation
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type {
  EdgeType,
  GraphLayoutResult,
  PluginNode,
  Point,
  ServiceNode,
  EventNode,
} from '../graph-model.js'
import { PluginNodeView } from './PluginNodeView.js'
import { ServiceNodeView } from './ServiceNodeView.js'
import { EventNodeView } from './EventNodeView.js'

export interface GraphCanvasProps {
  layout: GraphLayoutResult
  selectedNodeId: string | null
  selectedEdgeId: string | null
  hoveredNodeId: string | null
  onSelectNode: (id: string | null) => void
  onSelectEdge: (id: string | null) => void
  onDoubleClickNode?: (id: string) => void
  onHoverNode: (id: string | null) => void
  zoom: number
  pan: Point
  onZoomChange: (zoom: number) => void
  onPanChange: (pan: Point) => void
  fitViewTrigger?: number
}

const EDGE_STYLES: Record<
  EdgeType,
  { stroke: string; strokeWidth: number; dashArray?: string; glow: string }
> = {
  dependency: { stroke: '#38bdf8', strokeWidth: 1.6, glow: 'rgba(56, 189, 248, 0.4)' },
  service: {
    stroke: '#2dd4bf',
    strokeWidth: 1.5,
    dashArray: '5 3',
    glow: 'rgba(45, 212, 191, 0.4)',
  },
  event: {
    stroke: '#c084fc',
    strokeWidth: 1.4,
    dashArray: '2 3',
    glow: 'rgba(192, 132, 252, 0.4)',
  },
  ui: { stroke: '#fbbf24', strokeWidth: 2.2, glow: 'rgba(251, 191, 36, 0.4)' },
}

/** Convert array of orthogonal points into SVG path string */
function pointsToPath(points: Point[]): string {
  if (points.length === 0) return ''
  let d = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i]!.x} ${points[i]!.y}`
  }
  return d
}

export const GraphCanvas = memo(function GraphCanvas({
  layout,
  selectedNodeId,
  selectedEdgeId,
  hoveredNodeId,
  onSelectNode,
  onSelectEdge,
  onDoubleClickNode,
  onHoverNode,
  zoom,
  pan,
  onZoomChange,
  onPanChange,
  fitViewTrigger,
}: GraphCanvasProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef<Point>({ x: 0, y: 0 })

  // Automatically center and fit whenever layout structure or fitViewTrigger changes
  useEffect(() => {
    if (!containerRef.current) return
    const { clientWidth, clientHeight } = containerRef.current
    if (clientWidth === 0 || clientHeight === 0 || layout.width === 0 || layout.height === 0) return

    const pad = 50
    const availW = Math.max(200, clientWidth - pad * 2)
    const availH = Math.max(200, clientHeight - pad * 2)

    const scaleX = availW / layout.width
    const scaleY = availH / layout.height
    const targetZoom = Math.min(1.2, Math.max(0.5, Math.min(scaleX, scaleY)))

    const targetPan = {
      x: Math.max(15, (clientWidth - layout.width * targetZoom) / 2),
      y: Math.max(20, (clientHeight - layout.height * targetZoom) / 2),
    }

    onZoomChange(targetZoom)
    onPanChange(targetPan)
  }, [layout, fitViewTrigger])

  // Connected nodes map for highlighting active subgraph
  const connectedNodeIds = useMemo(() => {
    const targetId = selectedNodeId || hoveredNodeId
    if (!targetId) return new Set<string>()

    const connected = new Set<string>([targetId])
    for (const e of layout.edges) {
      if (e.source === targetId) connected.add(e.target)
      if (e.target === targetId) connected.add(e.source)
    }
    return connected
  }, [selectedNodeId, hoveredNodeId, layout.edges])

  const hasActiveSelection = Boolean(selectedNodeId || hoveredNodeId || selectedEdgeId)

  // Pan interaction
  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      // Only initiate canvas drag on left button click and directly on canvas background
      if (e.button !== 0) return
      isDraggingRef.current = true
      dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
    },
    [pan],
  )

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      if (!isDraggingRef.current) return
      onPanChange({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      })
    },
    [onPanChange],
  )

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

  // Zoom interaction
  const handleWheel = useCallback(
    (e: ReactWheelEvent) => {
      e.preventDefault()
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92
      const newZoom = Math.min(2.5, Math.max(0.3, zoom * zoomFactor))
      onZoomChange(newZoom)
    },
    [zoom, onZoomChange],
  )

  const handleCanvasClick = useCallback(() => {
    onSelectNode(null)
    onSelectEdge(null)
  }, [onSelectNode, onSelectEdge])

  return (
    <div
      ref={containerRef}
      className="graph-canvas-container"
      data-testid="graph-canvas"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#05070d',
        overflow: 'hidden',
        cursor: isDraggingRef.current ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onClick={handleCanvasClick}
    >
      <svg
        width="100%"
        height="100%"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      >
        <defs>
          {/* Subtle PCB dot matrix grid */}
          <pattern id="pcb-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="16" cy="16" r="0.8" fill="rgba(255, 255, 255, 0.08)" />
          </pattern>

          {/* Technical drop shadow */}
          <filter id="pcb-subtle-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000000" floodOpacity="0.6" />
          </filter>

          {/* Arrowhead Markers */}
          <marker
            id="arrow-dependency"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
          </marker>
          <marker
            id="arrow-service"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#2dd4bf" />
          </marker>
          <marker
            id="arrow-event"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#c084fc" />
          </marker>
          <marker
            id="arrow-ui"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#fbbf24" />
          </marker>
        </defs>

        {/* Background Grid */}
        <rect width="100%" height="100%" fill="url(#pcb-grid)" />

        {/* Viewport Transform Group */}
        <g
          transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
          style={{ transformOrigin: '0 0' }}
        >
          {/* 1. Architectural Layer Container Bands */}
          {layout.layerBounds.map((lb) => {
            const isLayerFocused =
              selectedNodeId &&
              layout.nodes.find((n) => n.id === selectedNodeId && (n.data as PluginNode).layer === lb.layer.id)

            return (
              <g key={lb.layer.id} className="layer-band" data-testid={`layer-band-${lb.layer.id}`}>
                {/* Layer Outer Container Box */}
                <rect
                  x={lb.x}
                  y={lb.y}
                  width={lb.width}
                  height={lb.height}
                  rx={8}
                  fill={lb.layer.bgColor}
                  stroke={isLayerFocused ? lb.layer.color : lb.layer.borderColor}
                  strokeWidth={isLayerFocused ? 2 : 1}
                  strokeDasharray="6 4"
                />

                {/* Layer Header Tab */}
                <rect
                  x={lb.x}
                  y={lb.y}
                  width={220}
                  height={32}
                  rx={4}
                  fill="#0b1324"
                  stroke={lb.layer.borderColor}
                  strokeWidth={1}
                />

                {/* Layer Colored Marker */}
                <circle cx={lb.x + 14} cy={lb.y + 16} r={4.5} fill={lb.layer.color} />

                {/* Layer Name & Stratum Label */}
                <text
                  x={lb.x + 28}
                  y={lb.y + 17}
                  dominantBaseline="central"
                  fill="#f8fafc"
                  fontSize={11.5}
                  fontWeight={700}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                  letterSpacing={0.8}
                >
                  {lb.layer.name.toUpperCase()} · L{lb.layer.order}
                </text>

                {/* Node Count Badge */}
                <text
                  x={lb.x + lb.width - 16}
                  y={lb.y + 18}
                  textAnchor="end"
                  dominantBaseline="central"
                  fill="#94a3b8"
                  fontSize={10}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                >
                  {lb.nodeCount} nodes
                </text>

                {/* Layer Architectural Description */}
                <text
                  x={lb.x + 235}
                  y={lb.y + 17}
                  dominantBaseline="central"
                  fill="#64748b"
                  fontSize={10}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                >
                  // {lb.layer.description}
                </text>
              </g>
            )
          })}

          {/* 2. Orthogonal Bus Traces (Edges) */}
          <g className="edges-layer">
            {layout.edges.map((e) => {
              const edgeStyle = EDGE_STYLES[e.type] ?? EDGE_STYLES.dependency
              const isEdgeSelected = selectedEdgeId === e.id
              const isEdgeConnected =
                selectedNodeId === e.source ||
                selectedNodeId === e.target ||
                hoveredNodeId === e.source ||
                hoveredNodeId === e.target

              let opacity = 0.55
              if (hasActiveSelection) {
                opacity = isEdgeSelected || isEdgeConnected ? 1.0 : 0.12
              }

              const pathData = pointsToPath(e.points)

              return (
                <g
                  key={e.id}
                  className="graph-edge"
                  data-testid={`edge-${e.id}`}
                  style={{
                    cursor: 'pointer',
                    opacity,
                    transition: 'opacity 0.18s ease',
                  }}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onSelectEdge(e.id)
                  }}
                >
                  {/* Invisible thicker stroke for easy clicking/hovering */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Glow Aura when Selected or Connected */}
                  {(isEdgeSelected || isEdgeConnected) && (
                    <path
                      d={pathData}
                      fill="none"
                      stroke={edgeStyle.stroke}
                      strokeWidth={edgeStyle.strokeWidth + 3.5}
                      opacity={0.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Main Orthogonal Bus Line */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={isEdgeSelected ? '#ffffff' : edgeStyle.stroke}
                    strokeWidth={isEdgeSelected ? edgeStyle.strokeWidth + 1 : edgeStyle.strokeWidth}
                    strokeDasharray={edgeStyle.dashArray}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    markerEnd={`url(#arrow-${e.type})`}
                  />

                  {/* Source Terminal Pin Dot */}
                  <circle
                    cx={e.sourcePin.x}
                    cy={e.sourcePin.y}
                    r={2.2}
                    fill={edgeStyle.stroke}
                  />

                  {/* Target Terminal Pin Dot */}
                  <circle
                    cx={e.targetPin.x}
                    cy={e.targetPin.y}
                    r={2.2}
                    fill={edgeStyle.stroke}
                  />
                </g>
              )
            })}
          </g>

          {/* 3. Graph Nodes */}
          <g className="nodes-layer">
            {layout.nodes.map((n) => {
              const isSelected = selectedNodeId === n.id
              const isHovered = hoveredNodeId === n.id
              const isRelated = connectedNodeIds.has(n.id)

              if (n.type === 'plugin') {
                return (
                  <PluginNodeView
                    key={n.id}
                    node={n.data as PluginNode}
                    x={n.x}
                    y={n.y}
                    width={n.width}
                    height={n.height}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    isRelated={isRelated}
                    hasActiveSelection={hasActiveSelection}
                    onClick={onSelectNode}
                    onDoubleClick={onDoubleClickNode}
                    onMouseEnter={onHoverNode}
                    onMouseLeave={() => onHoverNode(null)}
                  />
                )
              }

              if (n.type === 'service') {
                return (
                  <ServiceNodeView
                    key={n.id}
                    node={n.data as ServiceNode}
                    x={n.x}
                    y={n.y}
                    width={n.width}
                    height={n.height}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    isRelated={isRelated}
                    hasActiveSelection={hasActiveSelection}
                    onClick={onSelectNode}
                    onMouseEnter={onHoverNode}
                    onMouseLeave={() => onHoverNode(null)}
                  />
                )
              }

              return (
                <EventNodeView
                  key={n.id}
                  node={n.data as EventNode}
                  x={n.x}
                  y={n.y}
                  width={n.width}
                  height={n.height}
                  isSelected={isSelected}
                  isHovered={isHovered}
                  isRelated={isRelated}
                  hasActiveSelection={hasActiveSelection}
                  onClick={onSelectNode}
                  onMouseEnter={onHoverNode}
                  onMouseLeave={() => onHoverNode(null)}
                />
              )
            })}
          </g>
        </g>
      </svg>
    </div>
  )
})
