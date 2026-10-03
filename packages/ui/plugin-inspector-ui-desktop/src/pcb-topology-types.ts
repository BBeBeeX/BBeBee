import type { FiberStateName } from '@BBeBee/kernel'
import type { EffectNode } from '@BBeBee/plugin-inspector'
import type { PluginManifest } from '@BBeBee/protocol'

export interface Point {
  x: number
  y: number
}

export type SubsystemId =
  | 'root'
  | 'core'
  | 'sources'
  | 'playback'
  | 'storage'
  | 'lyrics'
  | 'ui'
  | 'settings'
  | 'inspector'

export type ViewLevel = 1 | 2 | 3

export type NodeKind =
  | 'chip'
  | 'cloud'
  | 'root'
  | 'plugin'
  | 'service'
  | 'satellite'
  | 'ui'

export type TraceColorType =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'inactive'
  | 'warning'
  | 'ui'
  | 'control'

export type TraceCategory =
  | 'dependency'
  | 'provides'
  | 'event'
  | 'ui-contribution'
  | 'control'
  | 'bus'

export interface LayerBand {
  id: string
  layer: number // 1 to 5
  code: string // 'LAYER 01', 'LAYER 02', ...
  name: string
  title: string
  subtitle: string
  invariant: string // Architectural rule from AGENTS.md
  packagePath: string // e.g. "packages/core/*"
  color: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface SubsystemZone {
  id: SubsystemId
  name: string
  code: string
  title: string
  subtitle: string
  layer: number
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  color: string
  description?: string
}

export interface PcbPin {
  id: string
  x: number
  y: number
  length?: number
  angle?: number
  padSize?: number
  type?: 'dot' | 'pad' | 'bus' | 'satellite'
  label?: string
}

export interface PcbTrace {
  id: string
  path: string // SVG path string (strictly orthogonal with 90° bends and 45° chamfers)
  colorType: TraceColorType
  category?: TraceCategory
  width?: number
  fromNodeId?: string
  toNodeId?: string
  fromSubsystem?: SubsystemId
  toSubsystem?: SubsystemId
  hasSignalFlow?: boolean
  vias?: Point[] // Solder via points along or at the ends of this trace
  label?: string
}

export interface PcbNode {
  id: string // e.g. 'player', 'audio', 'cs20', 'cs30'
  code: string // Short display name, e.g. 'PLAYER', 'AUDIO', 'SOURCES'
  subCode?: string // PCB IC Ref, e.g. 'IC-CS30'
  name?: string // Full human name, e.g. 'Audio Playback Service'
  kind: NodeKind
  subsystem?: SubsystemId
  layer?: number // Layer 1 to 5
  systemId?: string // e.g. 'layer-2', 'layer-4'
  moduleId?: string // e.g. 'sources', 'playback'
  manifest?: PluginManifest
  x: number
  y: number
  radius: number
  width?: number
  height?: number
  pins?: PcbPin[]
  parentPluginId?: string
  // Associated Cordis Fiber data (if mapped)
  fiber?: {
    name: string
    state: FiberStateName | 'UNKNOWN'
    uid: number | null
    inject: string[]
    waitingFor: string[]
    provides: string[]
    effects: EffectNode[]
    childrenCount?: number
  }
}

export interface PcbTopologyData {
  nodes: PcbNode[]
  traces: PcbTrace[]
  pins: PcbPin[]
  zones: SubsystemZone[]
  layerBands: LayerBand[]
}
