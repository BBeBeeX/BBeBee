/**
 * Data model for the Cordis Plugin Topology Explorer.
 *
 * Separates the internal Cordis runtime entities (fibers, runtimes, hooks)
 * into a clean, serializable graph model consumable by layout algorithms
 * and React presentation components.
 */

export type PluginStatus =
  | 'ACTIVE'
  | 'PENDING'
  | 'LOADING'
  | 'FAILED'
  | 'DISPOSED'
  | 'UNLOADING'
  | 'UNKNOWN'

export type LayerId = 'layer-1' | 'layer-2' | 'layer-3' | 'layer-4' | 'layer-5'

export interface LayerInfo {
  id: LayerId
  name: string
  order: number
  description: string
  color: string
  borderColor: string
  bgColor: string
}

export interface PluginNode {
  id: string
  name: string
  displayName: string
  version?: string
  layer: LayerId
  layerName: string
  moduleId: string
  status: PluginStatus
  description?: string
  provides: string[]
  requires: string[]
  waitingFor: string[]
  dependencies: string[]
  eventsListened: string[]
  effects: { label: string; count: number }[]
  fiberUid: number | null
}

export interface ServiceNode {
  id: string
  name: string
  provider?: string
  consumers: string[]
  status: 'ACTIVE' | 'UNAVAILABLE'
}

export interface EventNode {
  id: string
  name: string
  listenersCount: number
  listeners: string[]
}

export type EdgeType = 'dependency' | 'service' | 'event' | 'ui'

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: EdgeType
  label?: string
}

export interface PluginGraph {
  layers: LayerInfo[]
  plugins: PluginNode[]
  services: ServiceNode[]
  events: EventNode[]
  edges: GraphEdge[]
  timestamp: number
  counts: {
    totalPlugins: number
    activePlugins: number
    pendingPlugins: number
    loadingPlugins: number
    failedPlugins: number
    disposedPlugins: number
    unknownPlugins: number
    totalServices: number
    totalEvents: number
    totalEdges: number
  }
}

export interface Point {
  x: number
  y: number
}

export interface LayoutNode {
  id: string
  type: 'plugin' | 'service' | 'event'
  x: number
  y: number
  width: number
  height: number
  data: PluginNode | ServiceNode | EventNode
}

export interface LayoutEdge {
  id: string
  source: string
  target: string
  type: EdgeType
  label?: string
  points: Point[]
  sourcePin: Point
  targetPin: Point
}

export interface LayerBounds {
  layer: LayerInfo
  x: number
  y: number
  width: number
  height: number
  nodeCount: number
}

export interface GraphLayoutResult {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  layerBounds: LayerBounds[]
  width: number
  height: number
}

export interface FilterOptions {
  searchQuery: string
  selectedLayers: Set<LayerId>
  nodeTypes: Set<'plugin' | 'service' | 'event'>
  edgeTypes: Set<EdgeType>
  focusNodeId: string | null
  focusDepth: number
}

export type FocusType = 'overview' | 'plugin' | 'layer' | 'service' | 'event'

export interface GraphFocus {
  mode: 'focus' | 'overview'
  type: FocusType
  id?: string
  depth: number

  showDependencies: boolean
  showDependents: boolean
  showServices: boolean
  showEvents: boolean
}

