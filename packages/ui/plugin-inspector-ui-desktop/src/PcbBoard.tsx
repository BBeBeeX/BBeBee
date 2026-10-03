import {
  createElement as h,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react'
import type {
  LayerBand,
  PcbNode,
  PcbPin,
  PcbTrace,
  SubsystemId,
  SubsystemZone,
  ViewLevel,
} from './pcb-topology-types.js'

export interface PcbBoardProps {
  nodes: PcbNode[]
  traces: PcbTrace[]
  pins: PcbPin[]
  zones: SubsystemZone[]
  layerBands?: LayerBand[]
  selectedNodeId: string | null
  activeSubsystemId?: SubsystemId | null
  activeLayerId?: number | null
  viewLevel?: ViewLevel
  onSelectNode: (node: PcbNode | null) => void
  onDoubleClickNode?: (node: PcbNode) => void
  onSelectSubsystem?: (subsystem: SubsystemId | null) => void
  onSelectLayer?: (layer: number | null) => void
  onDrillDownLevel?: (level: ViewLevel, nodeId?: string) => void
  onHoverNode?: (nodeId: string | null) => void
  zoom: number
  pan: { x: number; y: number }
  onZoomChange: (zoom: number) => void
  onPanChange: (pan: { x: number; y: number }) => void
}

const TRACE_COLORS: Record<string, string> = {
  primary: '#596AFF',
  secondary: '#7D8DFF',
  accent: '#B86B7D',
  ui: '#C8A870',
  control: '#A78BFA',
  warning: '#FFB020',
  inactive: '#1F293D',
}

export function PcbBoard({
  nodes,
  traces,
  pins,
  zones,
  layerBands,
  selectedNodeId,
  activeSubsystemId,
  activeLayerId,
  viewLevel = 1,
  onSelectNode,
  onDoubleClickNode,
  onSelectSubsystem,
  onSelectLayer,
  onDrillDownLevel,
  onHoverNode,
  zoom,
  pan,
  onZoomChange,
  onPanChange,
}: PcbBoardProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // Only drag with primary mouse button
      if (e.button !== 0) return
      isDraggingRef.current = true
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      }
    },
    [pan],
  )

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      onPanChange({
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      })
    },
    [onPanChange],
  )

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9
      const newZoom = Math.max(0.3, Math.min(3.0, zoom * zoomFactor))

      const rect = container.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // Zoom towards mouse pointer
      const newPanX = mouseX - ((mouseX - pan.x) / zoom) * newZoom
      const newPanY = mouseY - ((mouseY - pan.y) / zoom) * newZoom

      onZoomChange(newZoom)
      onPanChange({ x: newPanX, y: newPanY })
    }

    container.addEventListener('wheel', handleWheelNative, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheelNative)
    }
  }, [zoom, pan, onZoomChange, onPanChange])

  useEffect(() => {
    onHoverNode?.(hoveredNodeId)
  }, [hoveredNodeId, onHoverNode])

  // Determine connected traces for focus graph (only when a node is selected, not on hover)
  const activeNodeId = selectedNodeId
  const connectedTraceIds = new Set<string>()
  if (activeNodeId) {
    for (const t of traces) {
      if (t.fromNodeId === activeNodeId || t.toNodeId === activeNodeId) {
        connectedTraceIds.add(t.id)
      }
    }
  }

  // Node lookup map
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  // Cloud path for Level 4 & Level 5 (organic cloud SVG shape)
  const getCloudPath = (x: number, y: number, w: number, h: number) => {
    const rx = w / 2
    const ry = h / 2
    return `
      M ${x - rx + 24} ${y + ry}
      A 22 22 0 0 1 ${x - rx + 14} ${y - ry + 20}
      A 28 28 0 0 1 ${x - 10} ${y - ry + 8}
      A 34 34 0 0 1 ${x + rx - 16} ${y - ry + 12}
      A 26 26 0 0 1 ${x + rx} ${y + ry - 8}
      A 22 22 0 0 1 ${x + rx - 28} ${y + ry}
      Z
    `
  }

  return h(
    'div',
    {
      ref: containerRef,
      'data-testid': 'pcb-board-viewport',
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
      onClick: (e: ReactMouseEvent) => {
        // Deselect when clicking on empty canvas board
        if (e.target === containerRef.current || (e.target as HTMLElement).tagName === 'svg') {
          onSelectNode(null)
        }
      },
      onDoubleClick: (e: ReactMouseEvent) => {
        // Clear layer & module highlight when double clicking empty board
        if (e.target === containerRef.current || (e.target as HTMLElement).tagName === 'svg') {
          onSelectLayer?.(null)
          onSelectSubsystem?.(null)
        }
      },
      style: {
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        cursor: isDraggingRef.current ? 'grabbing' : 'grab',
        background: '#05070D',
        userSelect: 'none',
      },
    },
    // CSS Keyframes for smooth Signal Flow pulse animation and breath glow
    h(
      'style',
      null,
      `
      @keyframes pcbSignalPulse {
        0% { stroke-dashoffset: 0; }
        100% { stroke-dashoffset: -400; }
      }
      @keyframes nodeBreathing {
        0%, 100% { filter: drop-shadow(0 0 4px rgba(89, 106, 255, 0.4)); }
        50% { filter: drop-shadow(0 0 14px rgba(125, 141, 255, 0.85)); }
      }
      .signal-flow-path {
        stroke-dasharray: 10 160;
        animation: pcbSignalPulse 8s linear infinite;
      }
      .selected-halo {
        animation: nodeBreathing 2.8s ease-in-out infinite;
      }
      .pcb-zone-rect {
        transition: stroke 0.25s, fill 0.25s;
      }
      .pcb-zone-rect:hover {
        stroke: rgba(125, 141, 255, 0.5) !important;
        fill: rgba(16, 24, 48, 0.55) !important;
      }
    `,
    ),
    h(
      'svg',
      {
        width: '100%',
        height: '100%',
        style: { display: 'block', width: '100%', height: '100%' },
        onClick: (e: ReactMouseEvent) => {
          if (e.target === e.currentTarget) {
            onSelectNode(null)
          }
        },
        onDoubleClick: (e: ReactMouseEvent) => {
          if (e.target === e.currentTarget) {
            onSelectLayer?.(null)
            onSelectSubsystem?.(null)
          }
        },
      },
      // Layer 0: Definitions, Filters & Grid Patterns
      h(
        'defs',
        null,
        // High-tech PCB Grid Pattern
        h(
          'pattern',
          {
            id: 'pcb-grid-pattern',
            width: 40,
            height: 40,
            patternUnits: 'userSpaceOnUse',
          },
          h('path', {
            d: 'M 40 0 L 0 0 0 40',
            fill: 'none',
            stroke: 'rgba(89, 106, 255, 0.05)',
            strokeWidth: 1,
          }),
          h('circle', {
            cx: 0,
            cy: 0,
            r: 1,
            fill: 'rgba(125, 141, 255, 0.12)',
          }),
        ),
        // Controlled, non-blinding PCB Glow Filter
        h(
          'filter',
          {
            id: 'pcb-glow',
            x: '-30%',
            y: '-30%',
            width: '160%',
            height: '160%',
          },
          h('feGaussianBlur', { stdDeviation: '3.5', result: 'blur' }),
          h(
            'feMerge',
            null,
            h('feMergeNode', { in: 'blur' }),
            h('feMergeNode', { in: 'SourceGraphic' }),
          ),
        ),
        // Ambient backlight radial gradient
        h(
          'radialGradient',
          { id: 'ambient-glow-1', cx: '50%', cy: '50%', r: '50%' },
          h('stop', { offset: '0%', stopColor: 'rgba(74, 94, 218, 0.14)' }),
          h('stop', { offset: '100%', stopColor: 'rgba(5, 7, 13, 0)' }),
        ),
      ),

      // Background Grid
      h('rect', {
        width: '100%',
        height: '100%',
        fill: 'url(#pcb-grid-pattern)',
        pointerEvents: 'none',
      }),

      // Root Canvas Transform Group
      h(
        'g',
        {
          transform: `translate(${pan.x}, ${pan.y}) scale(${zoom})`,
          style: { transformOrigin: '0 0' },
        },

        // ═══════════════════════════════════════════════════════
        // LAYER 0.2: ARCHITECTURAL STRATA (Layer 1 to Layer 5)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'layer-strata-layer' },
          ...(layerBands ?? []).map((band) => {
            const isLayerActive = activeLayerId === band.layer
            const isLayerDimmed =
              activeLayerId !== null && activeLayerId !== undefined && !isLayerActive

            return h(
              'g',
              {
                key: `layer-band-${band.layer}`,
                className: 'pcb-layer-band-group',
                opacity: isLayerDimmed ? 0.25 : 1,
                style: { transition: 'opacity 0.25s' },
              },
              // Layer band background area
              h('rect', {
                className: 'pcb-layer-band-rect',
                x: band.bounds.x,
                y: band.bounds.y,
                width: band.bounds.width,
                height: band.bounds.height,
                fill: isLayerActive ? `${band.color}15` : 'rgba(7, 10, 20, 0.45)',
                stroke: isLayerActive ? band.color : `${band.color}35`,
                strokeWidth: isLayerActive ? 1.6 : 1,
                strokeDasharray: '8 6',
                rx: 6,
                cursor: 'pointer',
                onClick: (e: ReactMouseEvent) => {
                  e.stopPropagation()
                  onSelectLayer?.(band.layer)
                },
              }),
              // Layer Left Edge Heavy Bus Bar
              h('rect', {
                x: band.bounds.x,
                y: band.bounds.y,
                width: 6,
                height: band.bounds.height,
                fill: band.color,
                opacity: isLayerActive ? 0.95 : 0.6,
                rx: 3,
              }),
              // Corner bracket accents
              h('path', {
                d: `M ${band.bounds.x + 20} ${band.bounds.y} L ${band.bounds.x} ${band.bounds.y} L ${band.bounds.x} ${band.bounds.y + 20}`,
                fill: 'none',
                stroke: band.color,
                strokeWidth: 2,
                pointerEvents: 'none',
              }),
              h('path', {
                d: `M ${band.bounds.x + band.bounds.width - 20} ${band.bounds.y} L ${band.bounds.x + band.bounds.width} ${band.bounds.y} L ${band.bounds.x + band.bounds.width} ${band.bounds.y + 20}`,
                fill: 'none',
                stroke: band.color,
                strokeWidth: 2,
                pointerEvents: 'none',
              }),
              h('path', {
                d: `M ${band.bounds.x + 20} ${band.bounds.y + band.bounds.height} L ${band.bounds.x} ${band.bounds.y + band.bounds.height} L ${band.bounds.x} ${band.bounds.y + band.bounds.height - 20}`,
                fill: 'none',
                stroke: band.color,
                strokeWidth: 2,
                pointerEvents: 'none',
              }),
              h('path', {
                d: `M ${band.bounds.x + band.bounds.width - 20} ${band.bounds.y + band.bounds.height} L ${band.bounds.x + band.bounds.width} ${band.bounds.y + band.bounds.height} L ${band.bounds.x + band.bounds.width} ${band.bounds.y + band.bounds.height - 20}`,
                fill: 'none',
                stroke: band.color,
                strokeWidth: 2,
                pointerEvents: 'none',
              }),
              // Layer Header Title Badge
              h(
                'text',
                {
                  x: band.bounds.x + 24,
                  y: band.bounds.y + 22,
                  fill: band.color,
                  fontSize: 12,
                  fontWeight: 800,
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  letterSpacing: 1.5,
                  pointerEvents: 'none',
                },
                `[ ${band.code}: ${band.title} ]`,
              ),
              // Layer Subtitle & Package Path
              h(
                'text',
                {
                  x: band.bounds.x + 24,
                  y: band.bounds.y + 36,
                  fill: 'rgba(226, 236, 255, 0.65)',
                  fontSize: 9.5,
                  fontWeight: 600,
                  fontFamily: 'ui-monospace, monospace',
                  letterSpacing: 0.8,
                  pointerEvents: 'none',
                },
                `${band.subtitle} · ${band.packagePath}`,
              ),
              // Architectural Invariant Note (Right-aligned in layer band header)
              h(
                'text',
                {
                  x: band.bounds.x + band.bounds.width - 24,
                  y: band.bounds.y + 22,
                  textAnchor: 'end',
                  fill: isLayerActive ? '#FFB020' : 'rgba(255, 176, 32, 0.7)',
                  fontSize: 9.5,
                  fontWeight: 700,
                  fontFamily: 'ui-monospace, monospace',
                  letterSpacing: 0.8,
                  pointerEvents: 'none',
                },
                `RULE: ${band.invariant}`,
              ),
            )
          }),
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 0.5: SUBSYSTEM ZONES (Functional PCB Partitions)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'subsystem-zones-layer' },
          ...zones.map((zone) => {
            const isZoneInActiveLayer = activeLayerId == null || zone.layer === activeLayerId
            const isZoneActive = activeSubsystemId === zone.id
            const isZoneDimmed =
              (activeSubsystemId !== null && activeSubsystemId !== undefined && !isZoneActive) ||
              (activeLayerId !== null && activeLayerId !== undefined && !isZoneInActiveLayer)

            return h(
              'g',
              {
                key: `zone-${zone.id}`,
                className: 'pcb-zone-group',
                opacity: isZoneDimmed ? 0.25 : 1,
                style: { transition: 'opacity 0.25s' },
              },
              // Zone boundary box
              h('rect', {
                className: 'pcb-zone-rect',
                x: zone.bounds.x,
                y: zone.bounds.y,
                width: zone.bounds.width,
                height: zone.bounds.height,
                fill: isZoneActive ? 'rgba(89, 106, 255, 0.08)' : 'rgba(8, 12, 22, 0.65)',
                stroke: isZoneActive ? '#7D8DFF' : 'rgba(89, 106, 255, 0.22)',
                strokeWidth: isZoneActive ? 1.8 : 1,
                strokeDasharray: '6 4',
                rx: 4,
                cursor: 'pointer',
                onClick: (e: ReactMouseEvent) => {
                  e.stopPropagation()
                  onSelectSubsystem?.(zone.id)
                  if (viewLevel === 1) {
                    onDrillDownLevel?.(2)
                  }
                },
              }),
              // Zone PCB Corner Bracket Markings (Top-Left, Top-Right, Bottom-Left, Bottom-Right)
              h('path', {
                d: `M ${zone.bounds.x + 8} ${zone.bounds.y} L ${zone.bounds.x} ${zone.bounds.y} L ${zone.bounds.x} ${zone.bounds.y + 8}`,
                fill: 'none',
                stroke: '#596AFF',
                strokeWidth: 1.8,
                pointerEvents: 'none',
              }),
              h('path', {
                d: `M ${zone.bounds.x + zone.bounds.width - 8} ${zone.bounds.y} L ${zone.bounds.x + zone.bounds.width} ${zone.bounds.y} L ${zone.bounds.x + zone.bounds.width} ${zone.bounds.y + 8}`,
                fill: 'none',
                stroke: '#596AFF',
                strokeWidth: 1.8,
                pointerEvents: 'none',
              }),
              h('path', {
                d: `M ${zone.bounds.x + 8} ${zone.bounds.y + zone.bounds.height} L ${zone.bounds.x} ${zone.bounds.y + zone.bounds.height} L ${zone.bounds.x} ${zone.bounds.y + zone.bounds.height - 8}`,
                fill: 'none',
                stroke: '#596AFF',
                strokeWidth: 1.8,
                pointerEvents: 'none',
              }),
              h('path', {
                d: `M ${zone.bounds.x + zone.bounds.width - 8} ${zone.bounds.y + zone.bounds.height} L ${zone.bounds.x + zone.bounds.width} ${zone.bounds.y + zone.bounds.height} L ${zone.bounds.x + zone.bounds.width} ${zone.bounds.y + zone.bounds.height - 8}`,
                fill: 'none',
                stroke: '#596AFF',
                strokeWidth: 1.8,
                pointerEvents: 'none',
              }),
              // Zone Stencil Label
              h(
                'text',
                {
                  x: zone.bounds.x + 14,
                  y: zone.bounds.y + 22,
                  fill: isZoneActive ? '#9AA6FF' : '#7D8DFF',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  letterSpacing: 1.2,
                  pointerEvents: 'none',
                },
                `[ ${zone.code}: ${zone.title} ]`,
              ),
              // Zone Subtitle & Layer Badge
              h(
                'text',
                {
                  x: zone.bounds.x + 14,
                  y: zone.bounds.y + 36,
                  fill: 'rgba(142, 164, 206, 0.45)',
                  fontSize: 9,
                  fontWeight: 600,
                  fontFamily: 'ui-monospace, monospace',
                  letterSpacing: 0.8,
                  pointerEvents: 'none',
                },
                zone.subtitle,
              ),
            )
          }),
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 1: GLOW LAYER (Ambient Light & Trace Bloom)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'glow-layer', pointerEvents: 'none' },
          // Ambient circuit cluster backlights
          h('ellipse', {
            cx: 1030,
            cy: 590,
            rx: 650,
            ry: 450,
            fill: 'url(#ambient-glow-1)',
          }),
          h('ellipse', {
            cx: 270,
            cy: 565,
            rx: 350,
            ry: 300,
            fill: 'url(#ambient-glow-1)',
          }),

          // Diffused soft bloom along PCB traces
          ...traces.map((trace) => {
            const fromNode = trace.fromNodeId ? nodeMap.get(trace.fromNodeId) : null
            const toNode = trace.toNodeId ? nodeMap.get(trace.toNodeId) : null
            const isTraceInActiveLayer =
              activeLayerId == null ||
              fromNode?.layer === activeLayerId ||
              toNode?.layer === activeLayerId

            const isTraceActive = activeNodeId ? connectedTraceIds.has(trace.id) : true
            const isIncoming = activeNodeId ? trace.toNodeId === activeNodeId : false
            const baseColor = TRACE_COLORS[trace.colorType] ?? '#596AFF'
            const strokeColor = isTraceActive
              ? activeNodeId
                ? isIncoming
                  ? '#7D8DFF'
                  : '#A78BFA'
                : baseColor
              : baseColor
            return h('path', {
              key: `glow-${trace.id}`,
              d: trace.path,
              fill: 'none',
              stroke: strokeColor,
              strokeWidth: (trace.width ?? 2) + 3.5,
              strokeOpacity: isTraceActive
                ? activeNodeId
                  ? 0.45
                  : isTraceInActiveLayer
                    ? 0.18
                    : 0.05
                : 0.02,
              filter: 'url(#pcb-glow)',
            })
          }),

          // Glow halo for selected node
          selectedNodeId
            ? (() => {
                const node = nodes.find((n) => n.id === selectedNodeId)
                if (!node) return null
                return h('circle', {
                  className: 'selected-halo',
                  cx: node.x,
                  cy: node.y,
                  r: node.radius + 7,
                  fill: 'none',
                  stroke: '#9AA6FF',
                  strokeWidth: 2.5,
                  strokeOpacity: 0.9,
                  filter: 'url(#pcb-glow)',
                })
              })()
            : null,
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 2: TRACE LAYER (Orthogonal PCB Traces & Vias)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'trace-layer' },
          ...traces.map((trace) => {
            const fromNode = trace.fromNodeId ? nodeMap.get(trace.fromNodeId) : null
            const toNode = trace.toNodeId ? nodeMap.get(trace.toNodeId) : null
            const isTraceInActiveLayer =
              activeLayerId == null ||
              fromNode?.layer === activeLayerId ||
              toNode?.layer === activeLayerId

            const isTraceActive = activeNodeId ? connectedTraceIds.has(trace.id) : true
            const isIncoming = activeNodeId ? trace.toNodeId === activeNodeId : false
            const isOutgoing = activeNodeId ? trace.fromNodeId === activeNodeId : false

            const baseColor = TRACE_COLORS[trace.colorType] ?? '#596AFF'
            const strokeColor = isTraceActive
              ? activeNodeId
                ? isIncoming
                  ? '#7D8DFF'
                  : isOutgoing
                    ? '#A78BFA'
                    : baseColor
                : baseColor
              : 'rgba(50, 65, 95, 0.25)'

            const traceOpacity = isTraceActive
              ? isTraceInActiveLayer
                ? 1
                : 0.2
              : 0.15

            return h(
              'g',
              { key: trace.id },
              h('path', {
                d: trace.path,
                fill: 'none',
                stroke: strokeColor,
                strokeWidth: isTraceActive && activeNodeId ? (trace.width ?? 2) + 0.8 : trace.width ?? 2,
                strokeLinejoin: 'round',
                strokeLinecap: 'round',
                opacity: traceOpacity,
                transition: 'stroke 0.2s, opacity 0.2s',
              }),
              // Via solder pads along this trace
              ...(trace.vias ?? []).map((via, vi) =>
                h(
                  'g',
                  { key: `via-${trace.id}-${vi}` },
                  h('circle', {
                    cx: via.x,
                    cy: via.y,
                    r: 4,
                    fill: '#05070D',
                    stroke: strokeColor,
                    strokeWidth: 1.5,
                  }),
                  h('circle', {
                    cx: via.x,
                    cy: via.y,
                    r: 1.6,
                    fill: strokeColor,
                  }),
                ),
              ),
            )
          }),
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 3: PIN LAYER (Connector Pins & Solder Buses)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'pin-layer' },
          ...pins.map((pin) => {
            if (pin.type === 'bus') {
              // Vertical parallel pin bus between stacked chips
              return h(
                'g',
                { key: pin.id },
                h('line', {
                  x1: pin.x,
                  y1: pin.y,
                  x2: pin.x,
                  y2: pin.y + (pin.length ?? 60),
                  stroke: '#596AFF',
                  strokeWidth: 1.8,
                }),
                // Top solder pad
                h('circle', {
                  cx: pin.x,
                  cy: pin.y + 3,
                  r: pin.padSize ?? 4,
                  fill: '#8598B2',
                  stroke: '#0A1220',
                  strokeWidth: 1,
                }),
                // Bottom solder pad
                h('circle', {
                  cx: pin.x,
                  cy: pin.y + (pin.length ?? 60) - 3,
                  r: pin.padSize ?? 4,
                  fill: '#8598B2',
                  stroke: '#0A1220',
                  strokeWidth: 1,
                }),
              )
            }

            // Radial connector pin pad around major IC
            return h(
              'g',
              { key: pin.id },
              h('circle', {
                cx: pin.x,
                cy: pin.y,
                r: pin.padSize ?? 3.5,
                fill: '#7D8DFF',
                stroke: '#05070D',
                strokeWidth: 1.2,
              }),
            )
          }),
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 4: NODE LAYER (IC Chips & Architecture Modules)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'node-layer' },
          ...nodes.map((node) => {
            const isSelected = node.id === selectedNodeId
            const isHovered = node.id === hoveredNodeId
            const isStalled = node.fiber?.state === 'PENDING' || node.fiber?.state === 'FAILED'
            const isNodeInActiveLayer = activeLayerId == null || node.layer === activeLayerId
            const isNodeDimmed =
              (activeSubsystemId !== null && activeSubsystemId !== undefined && node.subsystem !== activeSubsystemId) ||
              (activeLayerId !== null && activeLayerId !== undefined && !isNodeInActiveLayer)

            // Cloud modules (Level 4 & Level 5 for architecture tags and test compatibility)
            if (node.kind === 'cloud') {
              const cloudPath = getCloudPath(
                node.x,
                node.y,
                node.width ?? 140,
                node.height ?? 56,
              )
              return h(
                'g',
                {
                  key: node.id,
                  'data-testid': `node-${node.id}`,
                  onClick: (e: ReactMouseEvent) => {
                    e.stopPropagation()
                    onSelectNode(node)
                  },
                  onDoubleClick: (e: ReactMouseEvent) => {
                    e.stopPropagation()
                    if (containerRef.current) {
                      const rect = containerRef.current.getBoundingClientRect()
                      onPanChange({
                        x: rect.width / 2 - node.x * zoom,
                        y: rect.height / 2 - node.y * zoom,
                      })
                    }
                    onDoubleClickNode?.(node)
                  },
                  onMouseEnter: () => setHoveredNodeId(node.id),
                  onMouseLeave: () => setHoveredNodeId(null),
                  opacity: isNodeDimmed ? 0.22 : 1,
                  style: { cursor: 'pointer', transition: 'opacity 0.25s' },
                },
                h('path', {
                  d: cloudPath,
                  fill: '#8598B2',
                  stroke: isSelected ? '#9AA6FF' : '#596AFF',
                  strokeWidth: isSelected ? 2.5 : 1.5,
                  filter: isHovered || isSelected ? 'url(#pcb-glow)' : undefined,
                  transition: 'stroke 0.2s',
                }),
                h(
                  'text',
                  {
                    x: node.x,
                    y: node.y + 5,
                    textAnchor: 'middle',
                    fill: '#0A1220',
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  },
                  node.code,
                ),
              )
            }

            // Satellite Child Fiber Node (Level 3 Orbit)
            if (node.kind === 'satellite') {
              return h(
                'g',
                {
                  key: node.id,
                  'data-testid': `node-${node.id}`,
                  onClick: (e: ReactMouseEvent) => {
                    e.stopPropagation()
                    onSelectNode(node)
                  },
                  onDoubleClick: (e: ReactMouseEvent) => {
                    e.stopPropagation()
                    if (containerRef.current) {
                      const rect = containerRef.current.getBoundingClientRect()
                      onPanChange({
                        x: rect.width / 2 - node.x * zoom,
                        y: rect.height / 2 - node.y * zoom,
                      })
                    }
                    onDoubleClickNode?.(node)
                  },
                  onMouseEnter: () => setHoveredNodeId(node.id),
                  onMouseLeave: () => setHoveredNodeId(null),
                  opacity: isNodeDimmed ? 0.22 : 1,
                  style: { cursor: 'pointer', transition: 'opacity 0.25s' },
                },
                h('circle', {
                  cx: node.x,
                  cy: node.y,
                  r: node.radius,
                  fill: isSelected ? '#9AA6FF' : '#8598B2',
                  stroke: isSelected ? '#D4F658' : '#596AFF',
                  strokeWidth: 1.5,
                }),
                h(
                  'text',
                  {
                    x: node.x,
                    y: node.y + 3,
                    textAnchor: 'middle',
                    fill: '#0A1220',
                    fontSize: 8,
                    fontWeight: 700,
                    fontFamily: 'ui-monospace, monospace',
                  },
                  node.code,
                ),
              )
            }

            // Circular IC Chip Node
            const isUiNode = node.kind === 'ui'
            const isRootNode = node.kind === 'root'
            const fillColor = isStalled ? '#B86B7D' : '#8598B2'
            const strokeColor = isSelected
              ? '#9AA6FF'
              : isHovered
                ? '#E2ECFF'
                : isUiNode
                  ? '#C8A870'
                  : isRootNode
                    ? '#596AFF'
                    : '#AAB9D0'

            return h(
              'g',
              {
                key: node.id,
                'data-testid': `node-${node.id}`,
                onClick: (e: ReactMouseEvent) => {
                  e.stopPropagation()
                  onSelectNode(node)
                },
                onDoubleClick: (e: ReactMouseEvent) => {
                  e.stopPropagation()
                  // Center node and trigger layer & module highlight
                  if (containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect()
                    onPanChange({
                      x: rect.width / 2 - node.x * zoom,
                      y: rect.height / 2 - node.y * zoom,
                    })
                  }
                  onDoubleClickNode?.(node)
                },
                onMouseEnter: () => setHoveredNodeId(node.id),
                onMouseLeave: () => setHoveredNodeId(null),
                opacity: isNodeDimmed ? 0.22 : 1,
                style: { cursor: 'pointer', transition: 'opacity 0.25s' },
              },
              // Chip outer border
              h('circle', {
                cx: node.x,
                cy: node.y,
                r: node.radius,
                fill: fillColor,
                stroke: strokeColor,
                strokeWidth: isSelected ? 3 : isRootNode ? 2.5 : 1.8,
                filter: isHovered ? 'url(#pcb-glow)' : undefined,
                transition: 'stroke 0.2s, stroke-width 0.2s',
              }),
              // Chip inner technical ring
              h('circle', {
                cx: node.x,
                cy: node.y,
                r: Math.max(4, node.radius - (isRootNode ? 6 : 4)),
                fill: 'none',
                stroke: 'rgba(10, 18, 32, 0.28)',
                strokeWidth: 1,
              }),
              // Root extra concentric IC mark
              isRootNode
                ? h('circle', {
                    cx: node.x,
                    cy: node.y,
                    r: node.radius - 12,
                    fill: 'none',
                    stroke: 'rgba(10, 18, 32, 0.18)',
                    strokeWidth: 1,
                    strokeDasharray: '3 2',
                  })
                : null,
              // Centered Monospace Technical ID (e.g. PLAYER, SOURCES, AUDIO, ROOT)
              h(
                'text',
                {
                  x: node.x,
                  y: node.y + (node.radius > 36 ? 4.5 : node.radius > 26 ? 3.5 : 3),
                  textAnchor: 'middle',
                  fill: '#0A1220',
                  fontSize: node.radius > 36 ? 13 : node.radius > 26 ? 10 : 8.5,
                  fontWeight: 800,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  letterSpacing: -0.2,
                },
                node.code,
              ),
              // Hover overlay tag showing full fiber service name
              isHovered && (node.name || node.fiber)
                ? h(
                    'text',
                    {
                      x: node.x,
                      y: node.y + node.radius + 16,
                      textAnchor: 'middle',
                      fill: '#E2ECFF',
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: 'ui-monospace, monospace',
                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))',
                    },
                    node.name ?? node.fiber?.name,
                  )
                : null,
            )
          }),
        ),

        // ═══════════════════════════════════════════════════════
        // LAYER 5: SIGNAL FLOW LAYER (Restrained Data Pulses)
        // ═══════════════════════════════════════════════════════
        h(
          'g',
          { className: 'signal-flow-layer', pointerEvents: 'none' },
          ...traces
            .filter((t) => t.hasSignalFlow && (!activeNodeId || connectedTraceIds.has(t.id)))
            .map((trace) => {
              const isIncoming = activeNodeId ? trace.toNodeId === activeNodeId : false
              return h('path', {
                key: `signal-${trace.id}`,
                className: 'signal-flow-path',
                d: trace.path,
                fill: 'none',
                stroke: isIncoming ? '#9AA6FF' : '#D4BBFF',
                strokeWidth: (trace.width ?? 2) + 0.8,
                strokeLinecap: 'round',
                filter: 'url(#pcb-glow)',
                opacity: 0.85,
              })
            }),
        ),
      ),
    ),
  )
}

