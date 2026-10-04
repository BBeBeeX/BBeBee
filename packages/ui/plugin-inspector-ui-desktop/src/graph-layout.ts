/**
 * High-performance Layered & Orthogonal Circuit Layout Engine.
 *
 * Implements Sugiyama-style hierarchical layered stratification:
 *   Layer 1: Kernel  (Top)
 *   Layer 2: Core    (Infrastructure)
 *   Layer 3: Logs    (Observability)
 *   Layer 4: Feature (Headless features)
 *   Layer 5: UI      (Presentation)
 *
 * Computes:
 * - Layer container bounding boxes with circuit board aesthetics
 * - Node positions (circular/rounded plugins, hexagonal services, compact events)
 * - Multi-channel orthogonal bus routing (90° & 45° traces without diagonal clutter)
 * - Solder pin contact terminals on IC perimeters
 */

import type {
  EventNode,
  FilterOptions,
  GraphEdge,
  GraphFocus,
  GraphLayoutResult,
  LayerBounds,
  LayerId,
  LayoutEdge,
  LayoutNode,
  PluginGraph,
  PluginNode,
  Point,
  ServiceNode,
} from './graph-model.js'
import { matchesPluginId } from '@BBeBee/toolkit'
import { ALL_LAYER_IDS, SYSTEM_LAYERS } from './layer-resolver.js'

const NODE_SIZES = {
  plugin: { width: 112, height: 72, radius: 36 },
  service: { width: 100, height: 48, radius: 24 },
  event: { width: 92, height: 36, radius: 18 },
}

/**
 * Contextual / Focused Topology Generator.
 *
 * Extracts a local, contextual subgraph centered around a focal Plugin, Layer,
 * Service, or Event based on the GraphFocus specification.
 */
export function buildFocusedGraph(
  graph: PluginGraph,
  focus: GraphFocus,
): PluginGraph {
  // Overview Mode: returns full graph with global edge toggles
  if (focus.mode === 'overview' || focus.type === 'overview') {
    const plugins = graph.plugins
    const services = focus.showServices ? graph.services : []
    const events = focus.showEvents ? graph.events : []

    const visibleNodeIds = new Set([
      ...plugins.map((p) => p.id),
      ...services.map((s) => s.id),
      ...events.map((e) => e.id),
    ])

    const edges = graph.edges.filter((e) => {
      if (!visibleNodeIds.has(e.source) || !visibleNodeIds.has(e.target)) return false
      if (e.type === 'dependency' && !focus.showDependencies) return false
      if (e.type === 'service' && !focus.showServices) return false
      if (e.type === 'event' && !focus.showEvents) return false
      return true
    })

    return {
      ...graph,
      plugins,
      services,
      events,
      edges,
      counts: {
        ...graph.counts,
        totalPlugins: plugins.length,
        totalServices: services.length,
        totalEvents: events.length,
        totalEdges: edges.length,
      },
    }
  }

  // Focused Mode
  const includedPluginIds = new Set<string>()
  const includedServiceIds = new Set<string>()
  const includedEventIds = new Set<string>()

  if (focus.type === 'plugin') {
    const focalPlugin = graph.plugins.find(
      (p) =>
        p.id === focus.id ||
        p.name === focus.id ||
        p.name.replace(/^@BBeBee\//, '') === focus.id,
    )

    if (!focalPlugin) {
      // Fallback: if not found, pick the first active plugin or return empty
      return {
        ...graph,
        plugins: [],
        services: [],
        events: [],
        edges: [],
      }
    }

    includedPluginIds.add(focalPlugin.id)
    let frontier = new Set<string>([focalPlugin.id])
    const maxDepth = focus.depth >= 99 ? 99 : Math.max(1, focus.depth)

    for (let d = 0; d < maxDepth; d++) {
      const nextFrontier = new Set<string>()

      for (const pid of frontier) {
        const p = graph.plugins.find((plug) => plug.id === pid)
        if (!p) continue

        // 1. Direct dependencies (upstream)
        if (focus.showDependencies) {
          for (const dep of p.dependencies) {
            const depPlugin = graph.plugins.find((dp) =>
              matchesPluginId(dep, dp.id, dp.name),
            )
            if (depPlugin && !includedPluginIds.has(depPlugin.id)) {
              includedPluginIds.add(depPlugin.id)
              nextFrontier.add(depPlugin.id)
            }
          }
          for (const e of graph.edges) {
            if (e.target === p.id && e.type === 'dependency') {
              if (!includedPluginIds.has(e.source)) {
                includedPluginIds.add(e.source)
                nextFrontier.add(e.source)
              }
            }
          }
        }

        // 2. Direct dependents (downstream)
        if (focus.showDependents) {
          for (const other of graph.plugins) {
            if (other.dependencies.some((dep) => matchesPluginId(dep, p.id, p.name))) {
              if (!includedPluginIds.has(other.id)) {
                includedPluginIds.add(other.id)
                nextFrontier.add(other.id)
              }
            }
          }
          for (const e of graph.edges) {
            if (e.source === p.id && e.type === 'dependency') {
              if (!includedPluginIds.has(e.target)) {
                includedPluginIds.add(e.target)
                nextFrontier.add(e.target)
              }
            }
          }
        }

        // 3. UI View associations
        for (const e of graph.edges) {
          if (e.type === 'ui') {
            if (e.source === p.id && !includedPluginIds.has(e.target)) {
              includedPluginIds.add(e.target)
              nextFrontier.add(e.target)
            }
            if (e.target === p.id && !includedPluginIds.has(e.source)) {
              includedPluginIds.add(e.source)
              nextFrontier.add(e.source)
            }
          }
        }

        // 4. Services provided & consumed
        if (focus.showServices) {
          for (const s of graph.services) {
            const isProvided = s.provider === p.id
            const isConsumed = s.consumers.includes(p.id)
            if (isProvided || isConsumed) {
              includedServiceIds.add(s.id)
              // If P consumes service S, also include provider of S so the flow is connected
              if (isConsumed && s.provider && !includedPluginIds.has(s.provider)) {
                includedPluginIds.add(s.provider)
                nextFrontier.add(s.provider)
              }
            }
          }
        }

        // 5. Events listened & emitted
        if (focus.showEvents) {
          for (const ev of graph.events) {
            if (ev.listeners.includes(p.id) || p.eventsListened.includes(ev.name)) {
              includedEventIds.add(ev.id)
            }
          }
        }
      }

      frontier = nextFrontier
      if (frontier.size === 0) break
    }
  } else if (focus.type === 'layer') {
    // Layer Focus: include all plugins in the stratum + direct Core/Logs dependencies
    const layerPlugins = graph.plugins.filter((p) => p.layer === focus.id)
    for (const p of layerPlugins) {
      includedPluginIds.add(p.id)
    }

    for (const p of layerPlugins) {
      if (focus.showDependencies) {
        for (const dep of p.dependencies) {
          const depPlugin = graph.plugins.find(
            (dp) =>
              dp.id === dep ||
              dp.name === dep ||
              dp.name.replace(/^@BBeBee\//, '') === dep,
          )
          if (depPlugin) includedPluginIds.add(depPlugin.id)
        }
      }
      if (focus.showServices) {
        for (const s of graph.services) {
          if (s.provider === p.id || s.consumers.includes(p.id)) {
            includedServiceIds.add(s.id)
            if (s.provider) includedPluginIds.add(s.provider)
          }
        }
      }
      if (focus.showEvents) {
        for (const ev of graph.events) {
          if (ev.listeners.includes(p.id)) includedEventIds.add(ev.id)
        }
      }
    }
  } else if (focus.type === 'service') {
    const s = graph.services.find((serv) => serv.id === focus.id || serv.name === focus.id)
    if (s) {
      includedServiceIds.add(s.id)
      if (s.provider) includedPluginIds.add(s.provider)
      for (const c of s.consumers) includedPluginIds.add(c)
    }
  } else if (focus.type === 'event') {
    const ev = graph.events.find((e) => e.id === focus.id || e.name === focus.id)
    if (ev) {
      includedEventIds.add(ev.id)
      for (const l of ev.listeners) includedPluginIds.add(l)
    }
  }

  const plugins = graph.plugins.filter((p) => includedPluginIds.has(p.id))
  const services = focus.showServices
    ? graph.services.filter((s) => includedServiceIds.has(s.id))
    : []
  const events = focus.showEvents
    ? graph.events.filter((e) => includedEventIds.has(e.id))
    : []

  const visibleNodeIds = new Set([
    ...plugins.map((p) => p.id),
    ...services.map((s) => s.id),
    ...events.map((e) => e.id),
  ])

  const edges = graph.edges.filter((e) => {
    if (!visibleNodeIds.has(e.source) || !visibleNodeIds.has(e.target)) return false
    if (e.type === 'dependency' && !focus.showDependencies) return false
    if (e.type === 'service' && !focus.showServices) return false
    if (e.type === 'event' && !focus.showEvents) return false
    return true
  })

  return {
    ...graph,
    plugins,
    services,
    events,
    edges,
    counts: {
      ...graph.counts,
      totalPlugins: plugins.length,
      activePlugins: plugins.filter((p) => p.status === 'ACTIVE').length,
      pendingPlugins: plugins.filter((p) => p.status === 'PENDING').length,
      failedPlugins: plugins.filter((p) => p.status === 'FAILED').length,
      totalServices: services.length,
      totalEvents: events.length,
      totalEdges: edges.length,
    },
  }
}


/**
 * Filter graph nodes and edges according to search query, layer toggles,
 * node types, and focus traversal.
 */
export function filterGraph(graph: PluginGraph, options: FilterOptions): {
  plugins: PluginNode[]
  services: ServiceNode[]
  events: EventNode[]
  edges: GraphEdge[]
} {
  const query = options.searchQuery.trim().toLowerCase()

  // 1. Focus subgraph extraction (Breadth-first search from focusNodeId)
  let focusedNodeIds: Set<string> | null = null
  if (options.focusNodeId) {
    focusedNodeIds = new Set<string>([options.focusNodeId])
    let currentFrontier = [options.focusNodeId]

    for (let depth = 0; depth < options.focusDepth; depth++) {
      const nextFrontier: string[] = []
      for (const nodeId of currentFrontier) {
        for (const e of graph.edges) {
          if (e.source === nodeId && !focusedNodeIds.has(e.target)) {
            focusedNodeIds.add(e.target)
            nextFrontier.push(e.target)
          } else if (e.target === nodeId && !focusedNodeIds.has(e.source)) {
            focusedNodeIds.add(e.source)
            nextFrontier.push(e.source)
          }
        }
      }
      currentFrontier = nextFrontier
      if (currentFrontier.length === 0) break
    }
  }

  // 2. Filter Plugins
  const plugins = graph.plugins.filter((p) => {
    if (focusedNodeIds && !focusedNodeIds.has(p.id)) return false
    if (!options.selectedLayers.has(p.layer)) return false
    if (!options.nodeTypes.has('plugin')) return false
    if (query) {
      const matchesName = p.name.toLowerCase().includes(query)
      const matchesDisplay = p.displayName.toLowerCase().includes(query)
      const matchesModule = p.moduleId.toLowerCase().includes(query)
      const matchesProvides = p.provides.some((pr) => pr.toLowerCase().includes(query))
      const matchesRequires = p.requires.some((rq) => rq.toLowerCase().includes(query))
      if (!matchesName && !matchesDisplay && !matchesModule && !matchesProvides && !matchesRequires) {
        return false
      }
    }
    return true
  })

  const pluginIds = new Set(plugins.map((p) => p.id))

  // 3. Filter Services
  const services = graph.services.filter((s) => {
    if (focusedNodeIds && !focusedNodeIds.has(s.id)) return false
    if (!options.nodeTypes.has('service')) return false
    if (query && !s.name.toLowerCase().includes(query)) return false
    // Keep service if its provider or at least one consumer is visible, or if directly searched
    if (query) return true
    if (s.provider && pluginIds.has(s.provider)) return true
    if (s.consumers.some((c) => pluginIds.has(c))) return true
    return false
  })

  const serviceIds = new Set(services.map((s) => s.id))

  // 4. Filter Events
  const events = graph.events.filter((e) => {
    if (focusedNodeIds && !focusedNodeIds.has(e.id)) return false
    if (!options.nodeTypes.has('event')) return false
    if (query && !e.name.toLowerCase().includes(query)) return false
    if (query) return true
    if (e.listeners.some((l) => pluginIds.has(l))) return true
    return false
  })

  const eventIds = new Set(events.map((e) => e.id))

  const visibleNodeIds = new Set([...pluginIds, ...serviceIds, ...eventIds])

  // 5. Filter Edges
  const edges = graph.edges.filter((e) => {
    if (!visibleNodeIds.has(e.source) || !visibleNodeIds.has(e.target)) return false
    if (!options.edgeTypes.has(e.type)) return false
    return true
  })

  return { plugins, services, events, edges }
}

/**
 * Perform hierarchical orthogonal layout.
 */
export function computeGraphLayout(
  graph: PluginGraph,
  options: FilterOptions,
  focus?: GraphFocus,
): GraphLayoutResult {
  const { plugins, services, events, edges } = filterGraph(graph, options)

  // Map of nodes by ID to compute positions
  const layoutNodes: LayoutNode[] = []
  const nodePositionMap = new Map<string, LayoutNode>()

  // Group plugins by layer
  const pluginsByLayer = new Map<LayerId, PluginNode[]>()
  for (const lid of ALL_LAYER_IDS) {
    pluginsByLayer.set(lid, [])
  }
  for (const p of plugins) {
    const list = pluginsByLayer.get(p.layer) ?? []
    list.push(p)
    pluginsByLayer.set(p.layer, list)
  }

  // Associate services and events to layers
  const servicesByLayer = new Map<LayerId, ServiceNode[]>()
  for (const lid of ALL_LAYER_IDS) {
    servicesByLayer.set(lid, [])
  }
  for (const s of services) {
    let layerId: LayerId = 'layer-2' // default services to Core
    if (s.provider) {
      const provPlugin = plugins.find((p) => p.id === s.provider)
      if (provPlugin) layerId = provPlugin.layer
    }
    servicesByLayer.get(layerId)!.push(s)
  }

  const eventsByLayer = new Map<LayerId, EventNode[]>()
  for (const lid of ALL_LAYER_IDS) {
    eventsByLayer.set(lid, [])
  }
  for (const ev of events) {
    let layerId: LayerId = 'layer-4' // default events to Feature
    const firstListener = ev.listeners[0]
    if (firstListener) {
      const listenerPlugin = plugins.find((p) => p.id === firstListener)
      if (listenerPlugin) layerId = listenerPlugin.layer
    }
    eventsByLayer.get(layerId)!.push(ev)
  }

  const layerBounds: LayerBounds[] = []
  let currentY = 80
  const canvasPaddingX = 80
  const totalVisibleNodes = plugins.length + services.length + events.length
  const isFocused = focus?.mode === 'focus'
  const minLayerWidth = isFocused
    ? Math.max(720, totalVisibleNodes * 110)
    : 1400

  let maxRowWidth = minLayerWidth

  // Allocate layout positions layer by layer
  for (const layerId of ALL_LAYER_IDS) {
    if (!options.selectedLayers.has(layerId)) continue

    const layerInfo = SYSTEM_LAYERS[layerId]
    const layerPlugins = pluginsByLayer.get(layerId) ?? []
    const layerServices = servicesByLayer.get(layerId) ?? []
    const layerEvents = eventsByLayer.get(layerId) ?? []

    const totalLayerNodes = layerPlugins.length + layerServices.length + layerEvents.length

    // In focused topology, skip empty layers to avoid vertical bloat
    if (focus?.mode === 'focus' && totalLayerNodes === 0) continue

    const startY = currentY
    const headerHeight = 56
    const rowSpacing = 110
    const colSpacing = 150

    // Arrange nodes in rows inside the layer band
    const itemsPerRow =
      totalVisibleNodes < 20
        ? Math.max(3, Math.min(6, Math.max(totalLayerNodes, 3)))
        : Math.max(6, Math.min(10, Math.ceil(Math.sqrt(totalLayerNodes * 2.5))))

    let rowIdx = 0
    let colIdx = 0

    const placeNode = (
      id: string,
      type: 'plugin' | 'service' | 'event',
      data: PluginNode | ServiceNode | EventNode,
    ) => {
      const size = NODE_SIZES[type]
      const nodeX = canvasPaddingX + 60 + colIdx * colSpacing
      const nodeY = startY + headerHeight + 30 + rowIdx * rowSpacing

      const ln: LayoutNode = {
        id,
        type,
        x: nodeX,
        y: nodeY,
        width: size.width,
        height: size.height,
        data,
      }

      layoutNodes.push(ln)
      nodePositionMap.set(id, ln)

      const rightEdge = nodeX + size.width + 80
      if (rightEdge > maxRowWidth) {
        maxRowWidth = rightEdge
      }

      colIdx++
      if (colIdx >= itemsPerRow) {
        colIdx = 0
        rowIdx++
      }
    }

    // Place plugins first, then services, then events
    for (const p of layerPlugins) {
      placeNode(p.id, 'plugin', p)
    }
    for (const s of layerServices) {
      placeNode(s.id, 'service', s)
    }
    for (const ev of layerEvents) {
      placeNode(ev.id, 'event', ev)
    }

    const totalRows = colIdx === 0 && rowIdx > 0 ? rowIdx : rowIdx + 1
    const layerContentHeight = headerHeight + 40 + Math.max(1, totalRows) * rowSpacing
    const layerHeight = Math.max(160, layerContentHeight)

    layerBounds.push({
      layer: layerInfo,
      x: canvasPaddingX,
      y: startY,
      width: maxRowWidth,
      height: layerHeight,
      nodeCount: totalLayerNodes,
    })

    // Advance currentY with inter-layer bus trunk channel spacing
    currentY = startY + layerHeight + 90
  }

  // Synchronize all layer bounding box widths
  for (const lb of layerBounds) {
    lb.width = maxRowWidth - canvasPaddingX + 40
  }

  // Multi-channel Orthogonal Bus Routing
  const layoutEdges: LayoutEdge[] = []
  let trunkCounter = 0

  for (const e of edges) {
    const srcNode = nodePositionMap.get(e.source)
    const tgtNode = nodePositionMap.get(e.target)
    if (!srcNode || !tgtNode) continue

    const srcW = srcNode.width
    const srcH = srcNode.height
    const tgtW = tgtNode.width
    const tgtH = tgtNode.height

    const srcCenter = { x: srcNode.x + srcW / 2, y: srcNode.y + srcH / 2 }
    const tgtCenter = { x: tgtNode.x + tgtW / 2, y: tgtNode.y + tgtH / 2 }

    const isDownward = tgtCenter.y > srcCenter.y + 20
    const isUpward = tgtCenter.y < srcCenter.y - 20

    let sourcePin: Point
    let targetPin: Point
    const points: Point[] = []

    // Distinct channel offset to prevent bus lines from overlapping
    const channelOffset = ((trunkCounter++ % 12) - 6) * 7

    if (isDownward) {
      // Source bottom pole -> Target top pole
      sourcePin = { x: srcCenter.x, y: srcNode.y + srcH }
      targetPin = { x: tgtCenter.x, y: tgtNode.y }

      const busY = (sourcePin.y + targetPin.y) / 2 + channelOffset

      points.push(sourcePin)
      points.push({ x: sourcePin.x, y: busY })
      points.push({ x: targetPin.x, y: busY })
      points.push(targetPin)
    } else if (isUpward) {
      // Upward reverse edge: Source top pole -> Target bottom pole via side channel
      sourcePin = { x: srcCenter.x, y: srcNode.y }
      targetPin = { x: tgtCenter.x, y: tgtNode.y + tgtH }

      const busY = (sourcePin.y + targetPin.y) / 2 + channelOffset

      points.push(sourcePin)
      points.push({ x: sourcePin.x, y: busY })
      points.push({ x: targetPin.x, y: busY })
      points.push(targetPin)
    } else {
      // Horizontal / lateral same-row edge
      if (srcCenter.x < tgtCenter.x) {
        sourcePin = { x: srcNode.x + srcW, y: srcCenter.y }
        targetPin = { x: tgtNode.x, y: tgtCenter.y }
      } else {
        sourcePin = { x: srcNode.x, y: srcCenter.y }
        targetPin = { x: tgtNode.x + tgtW, y: tgtCenter.y }
      }

      const lateralMidX = (sourcePin.x + targetPin.x) / 2
      points.push(sourcePin)
      points.push({ x: lateralMidX, y: sourcePin.y })
      points.push({ x: lateralMidX, y: targetPin.y })
      points.push(targetPin)
    }

    layoutEdges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      label: e.label,
      points,
      sourcePin,
      targetPin,
    })
  }

  const finalWidth = maxRowWidth + 120
  const finalHeight = currentY + 120

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    layerBounds,
    width: finalWidth,
    height: finalHeight,
  }
}
