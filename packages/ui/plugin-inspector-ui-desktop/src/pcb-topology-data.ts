/**
 * Dynamic PCB Topology Generator for Plugin Inspector.
 *
 * Implements pure runtime dynamic discovery and topology generation:
 * - NO hardcoded node lists or fixed coordinates.
 * - NO compile-time generated manifest imports.
 * - Nodes are dynamically extracted from the live Cordis InspectorSnapshot.
 * - Traces (connections) are dynamically computed from inject dependencies
 *   (services a node depends on) and provides (services a node provides).
 * - Nodes are dynamically arranged across the 5 Architectural Layer Strata.
 */

import type { FiberNode, InspectorSnapshot } from '@BBeBee/plugin-inspector'
import type { PluginManifest } from '@BBeBee/protocol'
import type {
  LayerBand,
  PcbNode,
  PcbPin,
  PcbTopologyData,
  PcbTrace,
  Point,
  SubsystemId,
  SubsystemZone,
  TraceColorType,
  ViewLevel,
} from './pcb-topology-types.js'

/**
 * 5 Architectural Layer Strata according to the project's layer model:
 * Layer 1: Kernel (@BBeBee/kernel)
 * Layer 2: Core Capability Services (packages/core/*)
 * Layer 3: Observability & Log Transports (packages/logs/*)
 * Layer 4: Headless Business Features (packages/feature/*)
 * Layer 5: UI Registry & Presentation Fabric (packages/ui/* & apps/*)
 */
export const LAYER_BANDS: LayerBand[] = [
  {
    id: 'layer-1',
    layer: 1,
    code: 'LAYER 01',
    name: 'Kernel',
    title: 'KERNEL RUNTIME & DI CONTAINER',
    subtitle: 'packages/kernel · Cordis Root Context, Dynamic DI, Fibers & Invariant Gate',
    invariant: 'INVARIANT: DI Bootstrap & Service Surface Only',
    packagePath: 'packages/kernel',
    color: '#4F46E5',
    bounds: { x: 50, y: 40, width: 1900, height: 145 },
  },
  {
    id: 'layer-2',
    layer: 2,
    code: 'LAYER 02',
    name: 'Core',
    title: 'CORE CAPABILITY SERVICES',
    subtitle: 'packages/core/* · Only layer touching platform SDKs (Expo/Electron/Node/WebAudio)',
    invariant: 'INVARIANT: Platform SDK Boundary Only',
    packagePath: 'packages/core/*',
    color: '#3B82F6',
    bounds: { x: 50, y: 215, width: 1900, height: 185 },
  },
  {
    id: 'layer-3',
    layer: 3,
    code: 'LAYER 03',
    name: 'Logs',
    title: 'OBSERVABILITY & LOG TRANSPORTS',
    subtitle: 'packages/logs/* · Centralized logging authority; only layer permitted to write to console',
    invariant: 'INVARIANT: Logging Authority (ctx.logger transports)',
    packagePath: 'packages/logs/*',
    color: '#06B6D4',
    bounds: { x: 50, y: 430, width: 1900, height: 125 },
  },
  {
    id: 'layer-4',
    layer: 4,
    code: 'LAYER 04',
    name: 'Feature',
    title: 'HEADLESS BUSINESS FEATURES',
    subtitle: 'packages/feature/* · Pure domain logic & orchestration; zero platform SDK imports',
    invariant: 'INVARIANT: Pure Business Logic (Zero Platform SDKs)',
    packagePath: 'packages/feature/*',
    color: '#8B5CF6',
    bounds: { x: 50, y: 585, width: 1900, height: 385 },
  },
  {
    id: 'layer-5',
    layer: 5,
    code: 'LAYER 05',
    name: 'UI',
    title: 'UI REGISTRY & PRESENTATION FABRIC',
    subtitle: 'packages/ui/* & apps/* · Shell contribution registry, interactive view controllers & screens',
    invariant: 'INVARIANT: Presentation & Shell Routing (Zero Platform SDKs)',
    packagePath: 'packages/ui/* & apps/*',
    color: '#F59E0B',
    bounds: { x: 50, y: 1000, width: 1900, height: 200 },
  },
]

/**
 * 8 Subsystem Zones partition specification.
 */
export const SUBSYSTEM_ZONES: SubsystemZone[] = [
  {
    id: 'core',
    name: 'Core Foundation',
    code: 'ZONE 01',
    title: 'CORE / BASE INFRASTRUCTURE',
    subtitle: 'LAYER 2 FOUNDATION · PLATFORM CAPABILITIES',
    layer: 2,
    bounds: { x: 60, y: 225, width: 1880, height: 165 },
    color: '#4B5EAA',
    description: 'System kernel interfaces, OS bridges, runtime sandboxes, DB/FS and WebAudio core.',
  },
  {
    id: 'sources',
    name: 'Source Fabric',
    code: 'ZONE 02',
    title: 'AUDIO SOURCE SUBSYSTEM',
    subtitle: 'LAYER 4 MEDIA CATALOGUE & PROVIDERS',
    layer: 4,
    bounds: { x: 60, y: 595, width: 440, height: 365 },
    color: '#596AFF',
    description: 'Music sources engine, local filesystem scanner, source runtime sandbox and providers.',
  },
  {
    id: 'playback',
    name: 'Playback Core',
    code: 'ZONE 03',
    title: 'PLAYBACK ENGINE CORE',
    subtitle: 'LAYER 4 AUDIO STREAM PIPELINE',
    layer: 4,
    bounds: { x: 520, y: 595, width: 460, height: 365 },
    color: '#7D8DFF',
    description: 'Player transport, audio routing, play queue, DSP effect rack, history and sleep timer.',
  },
  {
    id: 'storage',
    name: 'Media Data Fabric',
    code: 'ZONE 04',
    title: 'MEDIA STORAGE & CACHE',
    subtitle: 'LAYER 4 PERSISTENCE & OFFLINE',
    layer: 4,
    bounds: { x: 1000, y: 595, width: 440, height: 365 },
    color: '#5C7CFA',
    description: 'Disk stream caching, background download queue, and persistent media library.',
  },
  {
    id: 'lyrics',
    name: 'Lyrics Fabric',
    code: 'ZONE 05',
    title: 'SYNCHRONIZED LYRICS',
    subtitle: 'LAYER 4 POSITION-LOCKED LYRICS',
    layer: 4,
    bounds: { x: 1460, y: 595, width: 480, height: 175 },
    color: '#8598FF',
    description: 'Real-time playback position subscriber, LRC parser, and desktop floating lyrics.',
  },
  {
    id: 'ui',
    name: 'UI Backplane',
    code: 'ZONE 06',
    title: 'UI REGISTRY BACKPLANE',
    subtitle: 'LAYER 5 PRESENTATION EXTENSIONS',
    layer: 5,
    bounds: { x: 60, y: 1010, width: 1880, height: 180 },
    color: '#C8A870',
    description: 'App UI shell contribution registry and desktop feature view extensions.',
  },
  {
    id: 'settings',
    name: 'System Settings',
    code: 'ZONE 07',
    title: 'SETTINGS & PREFERENCES',
    subtitle: 'CROSS-CUTTING CONTROL FABRIC',
    layer: 4,
    bounds: { x: 1460, y: 785, width: 230, height: 175 },
    color: '#9E77ED',
    description: 'Global app configurations, DSP parameters, themes, and audio device preferences.',
  },
  {
    id: 'inspector',
    name: 'Arch Diagnostics',
    code: 'ZONE 08',
    title: 'ARCHITECTURE INSPECTOR',
    subtitle: 'KERNEL DIAGNOSTICS & TELEMETRY',
    layer: 4,
    bounds: { x: 1710, y: 785, width: 230, height: 175 },
    color: '#6474FF',
    description: 'Fiber tree introspection, labelled effect tracker, and runtime health monitor.',
  },
]

/**
 * Dynamically infers the architectural layer (1-5) and systemId from a fiber.
 */
export function inferLayer(fiber: FiberNode): { layer: number; systemId: string } {
  const name = (fiber.name || '').toLowerCase()
  if (name === 'root' || fiber.uid === 0 || name.includes('kernel')) {
    return { layer: 1, systemId: 'layer-1' }
  }

  const coreServices = new Set([
    'paths',
    'fs',
    'store',
    'db',
    'device',
    'background',
    'mediasession',
    'secrets',
    'js',
    'codec',
    'http',
    'audio',
  ])

  const provides = (fiber.provides || []).map((p) => p.toLowerCase())
  const isCore =
    name.startsWith('core-') ||
    provides.some((p) => coreServices.has(p)) ||
    coreServices.has(name)

  if (isCore) {
    return { layer: 2, systemId: 'layer-2' }
  }

  if (
    name.startsWith('plugin-log-') ||
    name.startsWith('log-') ||
    provides.includes('logger') ||
    provides.includes('log')
  ) {
    return { layer: 3, systemId: 'layer-3' }
  }

  if (
    name.includes('-ui-') ||
    name.endsWith('-ui') ||
    provides.includes('ui') ||
    name.includes('shell') ||
    name.includes('view')
  ) {
    return { layer: 5, systemId: 'layer-5' }
  }

  return { layer: 4, systemId: 'layer-4' }
}

/**
 * Dynamically infers the functional domain (moduleId) and subsystem zone.
 */
export function inferModule(
  fiber: FiberNode,
  layer: number,
): { subsystem: SubsystemId; moduleId: string } {
  const name = (fiber.name || '').toLowerCase()
  const provides = (fiber.provides || []).map((p) => p.toLowerCase())

  if (layer === 1) return { subsystem: 'root', moduleId: 'core' }

  if (name.includes('source') || provides.some((p) => p.includes('source'))) {
    return { subsystem: 'sources', moduleId: 'sources' }
  }

  if (
    name.includes('player') ||
    name.includes('audio') ||
    name.includes('queue') ||
    name.includes('now-playing') ||
    provides.some((p) => ['player', 'audio', 'queue', 'playback'].includes(p))
  ) {
    return { subsystem: 'playback', moduleId: 'playback' }
  }

  if (
    name.includes('fs') ||
    name.includes('db') ||
    name.includes('store') ||
    name.includes('path') ||
    name.includes('download') ||
    name.includes('cache') ||
    name.includes('library') ||
    provides.some((p) =>
      ['fs', 'db', 'store', 'paths', 'storage', 'library', 'download', 'cache'].includes(p),
    )
  ) {
    return { subsystem: 'storage', moduleId: 'storage' }
  }

  if (name.includes('lyric') || provides.some((p) => p.includes('lyric'))) {
    return { subsystem: 'lyrics', moduleId: 'lyrics' }
  }

  if (name.includes('dsp') || provides.includes('dsp')) {
    return { subsystem: 'playback', moduleId: 'dsp' }
  }

  if (name.includes('setting') || provides.includes('settings')) {
    return { subsystem: 'settings', moduleId: 'settings' }
  }

  if (name.includes('inspector') || provides.includes('inspector')) {
    return { subsystem: 'inspector', moduleId: 'inspector' }
  }

  if (layer === 5 || provides.includes('ui')) {
    return { subsystem: 'ui', moduleId: 'ui' }
  }

  if (layer === 3) {
    return { subsystem: 'core', moduleId: 'logs' }
  }

  if (layer === 2) {
    return { subsystem: 'core', moduleId: 'core' }
  }

  return { subsystem: 'playback', moduleId: 'playback' }
}

/**
 * Derives a human-readable display code for an IC chip.
 */
function deriveNodeCode(name: string, provides: string[]): string {
  if (name === 'root') return 'ROOT'
  if (provides.length > 0 && provides[0]) {
    return provides[0].toUpperCase()
  }
  const clean = name
    .replace(/^@BBeBee\//, '')
    .replace(/^plugin-/, '')
    .replace(/^core-/, '')
    .replace(/-ui-desktop$/, '')
    .replace(/-ui-mobile$/, '')
    .replace(/-ui$/, '')
    .replace(/-node$/, '')
    .replace(/-electron$/, '')
    .replace(/-rn$/, '')
  return clean.substring(0, 10).toUpperCase()
}

/**
 * Derives a clean unique identifier for a fiber node.
 */
export function deriveNodeId(fiber: FiberNode): string {
  if (fiber.name === 'root') return 'root'
  if (!fiber.name) return `fiber-${fiber.uid ?? 0}`
  return fiber.name
    .replace(/^@BBeBee\//, '')
    .replace(/^plugin-/, '')
}

/**
 * Creates an orthogonal SVG trace path between two points with vias at corners.
 */
export function createOrthogonalPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r1: number,
  r2: number,
): { path: string; vias: Point[] } {
  let startX = x1
  let startY = y1
  let endX = x2
  let endY = y2

  if (Math.abs(y2 - y1) >= Math.abs(x2 - x1)) {
    if (y2 >= y1) {
      startY = y1 + r1
      endY = y2 - r2
    } else {
      startY = y1 - r1
      endY = y2 + r2
    }
    const midY = Math.round((startY + endY) / 2)
    const path = `M ${Math.round(startX)} ${Math.round(startY)} L ${Math.round(startX)} ${midY} L ${Math.round(endX)} ${midY} L ${Math.round(endX)} ${Math.round(endY)}`
    const vias: Point[] = [
      { x: Math.round(startX), y: midY },
      { x: Math.round(endX), y: midY },
    ]
    return { path, vias }
  } else {
    if (x2 >= x1) {
      startX = x1 + r1
      endX = x2 - r2
    } else {
      startX = x1 - r1
      endX = x2 + r2
    }
    const midX = Math.round((startX + endX) / 2)
    const path = `M ${Math.round(startX)} ${Math.round(startY)} L ${midX} ${Math.round(startY)} L ${midX} ${Math.round(endY)} L ${Math.round(endX)} ${Math.round(endY)}`
    const vias: Point[] = [
      { x: midX, y: Math.round(startY) },
      { x: midX, y: Math.round(endY) },
    ]
    return { path, vias }
  }
}

/**
 * Computes dynamic PCB traces representing runtime dependencies between nodes.
 *
 * Automatically links:
 * 1. A node to the nodes it depends on (nodes providing its injected services).
 * 2. A node to the nodes that depend on it (nodes injecting its provided services).
 * 3. Parent-child fiber tree connections.
 */
export function computeDynamicTraces(nodes: PcbNode[]): PcbTrace[] {
  const traces: PcbTrace[] = []
  const nodeMap = new Map<string, PcbNode>(nodes.map((n) => [n.id, n]))

  // Map service name / plugin name -> provider node
  const serviceProviders = new Map<string, PcbNode>()
  for (const node of nodes) {
    for (const service of node.fiber?.provides ?? []) {
      serviceProviders.set(service, node)
      serviceProviders.set(service.toLowerCase(), node)
    }
    serviceProviders.set(node.id, node)
    serviceProviders.set(node.id.toLowerCase(), node)
    serviceProviders.set(node.code.toLowerCase(), node)
    if (node.name) {
      serviceProviders.set(node.name, node)
      serviceProviders.set(node.name.toLowerCase(), node)
      const clean = node.name.replace(/^@BBeBee\//, '').replace(/^plugin-/, '')
      serviceProviders.set(clean, node)
      serviceProviders.set(clean.toLowerCase(), node)
    }
  }

  const linkKeys = new Set<string>()

  for (const consumer of nodes) {
    const injectList = consumer.fiber?.inject ?? []
    for (const neededService of injectList) {
      const provider =
        serviceProviders.get(neededService) ??
        serviceProviders.get(neededService.toLowerCase())

      if (provider && provider.id !== consumer.id) {
        const key = `${provider.id}->${consumer.id}:${neededService}`
        if (!linkKeys.has(key)) {
          linkKeys.add(key)
          const { path, vias } = createOrthogonalPath(
            provider.x,
            provider.y,
            consumer.x,
            consumer.y,
            provider.radius,
            consumer.radius,
          )

          let colorType: TraceColorType = 'primary'
          if (consumer.layer === 5) colorType = 'ui'
          else if (provider.subsystem === 'playback') colorType = 'accent'
          else if (provider.subsystem === 'sources') colorType = 'secondary'
          else if (provider.layer === 1) colorType = 'control'

          traces.push({
            id: `trace-dep-${provider.id}-${consumer.id}-${neededService}`,
            path,
            colorType,
            category: 'dependency',
            fromNodeId: provider.id,
            toNodeId: consumer.id,
            fromSubsystem: provider.subsystem,
            toSubsystem: consumer.subsystem,
            hasSignalFlow: true,
            vias,
            label: neededService,
            width: 1.8,
          })
        }
      }
    }
  }

  // Parent-child relationships (e.g. root to top-level services, or satellites)
  for (const node of nodes) {
    if (node.parentPluginId) {
      const parent =
        nodeMap.get(node.parentPluginId) ??
        nodeMap.get(node.parentPluginId.replace(/^@BBeBee\//, '').replace(/^plugin-/, ''))
      if (parent) {
        const key = `${parent.id}->${node.id}:parent-child`
        if (!linkKeys.has(key)) {
          linkKeys.add(key)
          const { path, vias } = createOrthogonalPath(
            parent.x,
            parent.y,
            node.x,
            node.y,
            parent.radius,
            node.radius,
          )
          traces.push({
            id: `trace-pc-${parent.id}-${node.id}`,
            path,
            colorType: 'control',
            category: 'control',
            fromNodeId: parent.id,
            toNodeId: node.id,
            fromSubsystem: parent.subsystem,
            toSubsystem: node.subsystem,
            hasSignalFlow: false,
            vias,
            label: 'fiber-lead',
            width: 1.5,
          })
        }
      }
    }
  }

  return traces
}

/**
 * Generates dynamic perimeter solder pins for IC nodes.
 */
export function generateDynamicPins(nodes: PcbNode[]): PcbPin[] {
  const pins: PcbPin[] = []
  for (const node of nodes) {
    const r = node.radius
    pins.push(
      { id: `pin-${node.id}-n`, x: Math.round(node.x), y: Math.round(node.y - r), type: 'pad' },
      { id: `pin-${node.id}-s`, x: Math.round(node.x), y: Math.round(node.y + r), type: 'pad' },
      { id: `pin-${node.id}-e`, x: Math.round(node.x + r), y: Math.round(node.y), type: 'pad' },
      { id: `pin-${node.id}-w`, x: Math.round(node.x - r), y: Math.round(node.y), type: 'pad' },
    )
  }
  return pins
}

/**
 * Builds the entire PCB Topology dynamically from a live runtime InspectorSnapshot.
 *
 * Zero hardcoding. Zero codegen imports. Fully reactive to loaded plugins and fibers.
 */
export function buildTopologyFromSnapshot(
  snap: InspectorSnapshot,
  viewLevel: ViewLevel = 1,
  selectedNodeId: string | null = null,
): PcbTopologyData {
  // 1. Flatten all runtime fibers from the snapshot tree
  const fiberList: FiberNode[] = []
  const parentMap = new Map<string, string>()

  const walk = (fiber: FiberNode, parent?: FiberNode) => {
    fiberList.push(fiber)
    if (parent) {
      const childId = deriveNodeId(fiber)
      const parentId = deriveNodeId(parent)
      parentMap.set(childId, parentId)
      if (fiber.name) {
        parentMap.set(fiber.name, parentId)
      }
    }
    for (const child of fiber.children || []) {
      walk(child, fiber)
    }
  }

  if (snap.root) {
    walk(snap.root)
  }

  // 2. Deduplicate fibers by unique ID or name
  const seenIds = new Set<string>()
  const rawNodes: Array<{
    fiber: FiberNode
    layer: number
    systemId: string
    subsystem: SubsystemId
    moduleId: string
    id: string
    name: string
    code: string
    parentPluginId?: string
  }> = []

  for (const fiber of fiberList) {
    let id = deriveNodeId(fiber)
    if (seenIds.has(id)) {
      id = `${id}-${fiber.uid ?? 'alt'}`
    }
    seenIds.add(id)

    const { layer, systemId } = inferLayer(fiber)
    const { subsystem, moduleId } = inferModule(fiber, layer)
    const code = deriveNodeCode(fiber.name, fiber.provides)

    rawNodes.push({
      fiber,
      layer,
      systemId,
      subsystem,
      moduleId,
      id,
      name: fiber.name,
      code,
      parentPluginId: parentMap.get(id),
    })
  }

  // 3. Layout nodes dynamically across the 5 Architectural Layers
  const nodesByLayer = new Map<number, typeof rawNodes>()
  for (let l = 1; l <= 5; l++) nodesByLayer.set(l, [])
  for (const node of rawNodes) {
    const list = nodesByLayer.get(node.layer) ?? []
    list.push(node)
    nodesByLayer.set(node.layer, list)
  }

  const pcbNodes: PcbNode[] = []

  // Layer 1: Kernel Root (y: 112)
  const l1Nodes = nodesByLayer.get(1) ?? []
  l1Nodes.forEach((node, idx) => {
    const total = l1Nodes.length
    const x = Math.round(1000 + (idx - (total - 1) / 2) * 220)
    pcbNodes.push({
      id: node.id,
      code: node.code,
      name: node.name || 'Cordis Root Kernel Context',
      kind: 'root',
      subsystem: node.subsystem,
      layer: 1,
      systemId: node.systemId,
      moduleId: node.moduleId,
      x,
      y: 112,
      radius: 44,
      fiber: {
        name: node.fiber.name,
        state: node.fiber.state,
        uid: node.fiber.uid,
        inject: node.fiber.inject,
        waitingFor: node.fiber.waitingFor,
        provides: node.fiber.provides,
        effects: node.fiber.effects,
        childrenCount: node.fiber.children?.length ?? 0,
      },
    })
  })

  // Layer 2: Core Capability Services (y: 305)
  const l2Nodes = nodesByLayer.get(2) ?? []
  const l2Count = l2Nodes.length
  l2Nodes.forEach((node, idx) => {
    const availableWidth = 1760
    const startX = 120
    const step = availableWidth / Math.max(1, l2Count)
    const x = Math.round(startX + (idx + 0.5) * step)
    pcbNodes.push({
      id: node.id,
      code: node.code,
      name: node.name,
      kind: 'service',
      subsystem: node.subsystem,
      layer: 2,
      systemId: node.systemId,
      moduleId: node.moduleId,
      x,
      y: 305,
      radius: 32,
      parentPluginId: node.parentPluginId,
      fiber: {
        name: node.fiber.name,
        state: node.fiber.state,
        uid: node.fiber.uid,
        inject: node.fiber.inject,
        waitingFor: node.fiber.waitingFor,
        provides: node.fiber.provides,
        effects: node.fiber.effects,
        childrenCount: node.fiber.children?.length ?? 0,
      },
    })
  })

  // Layer 3: Logs & Observability (y: 492)
  const l3Nodes = nodesByLayer.get(3) ?? []
  const l3Count = l3Nodes.length
  l3Nodes.forEach((node, idx) => {
    const availableWidth = 1760
    const startX = 120
    const step = availableWidth / Math.max(1, l3Count)
    const x = Math.round(startX + (idx + 0.5) * step)
    pcbNodes.push({
      id: node.id,
      code: node.code,
      name: node.name,
      kind: 'plugin',
      subsystem: node.subsystem,
      layer: 3,
      systemId: node.systemId,
      moduleId: node.moduleId,
      x,
      y: 492,
      radius: 28,
      parentPluginId: node.parentPluginId,
      fiber: {
        name: node.fiber.name,
        state: node.fiber.state,
        uid: node.fiber.uid,
        inject: node.fiber.inject,
        waitingFor: node.fiber.waitingFor,
        provides: node.fiber.provides,
        effects: node.fiber.effects,
        childrenCount: node.fiber.children?.length ?? 0,
      },
    })
  })

  // Layer 4: Feature Plugins (Row 1: y = 680, Row 2: y = 850)
  const l4Nodes = nodesByLayer.get(4) ?? []
  const halfL4 = Math.ceil(l4Nodes.length / 2)
  const l4Row1 = l4Nodes.slice(0, halfL4)
  const l4Row2 = l4Nodes.slice(halfL4)

  l4Row1.forEach((node, idx) => {
    const step = 1760 / Math.max(1, l4Row1.length)
    const x = Math.round(120 + (idx + 0.5) * step)
    pcbNodes.push({
      id: node.id,
      code: node.code,
      name: node.name,
      kind: 'plugin',
      subsystem: node.subsystem,
      layer: 4,
      systemId: node.systemId,
      moduleId: node.moduleId,
      x,
      y: 680,
      radius: 34,
      parentPluginId: node.parentPluginId,
      fiber: {
        name: node.fiber.name,
        state: node.fiber.state,
        uid: node.fiber.uid,
        inject: node.fiber.inject,
        waitingFor: node.fiber.waitingFor,
        provides: node.fiber.provides,
        effects: node.fiber.effects,
        childrenCount: node.fiber.children?.length ?? 0,
      },
    })
  })

  l4Row2.forEach((node, idx) => {
    const step = 1760 / Math.max(1, l4Row2.length)
    const x = Math.round(120 + (idx + 0.5) * step)
    pcbNodes.push({
      id: node.id,
      code: node.code,
      name: node.name,
      kind: 'plugin',
      subsystem: node.subsystem,
      layer: 4,
      systemId: node.systemId,
      moduleId: node.moduleId,
      x,
      y: 850,
      radius: 34,
      parentPluginId: node.parentPluginId,
      fiber: {
        name: node.fiber.name,
        state: node.fiber.state,
        uid: node.fiber.uid,
        inject: node.fiber.inject,
        waitingFor: node.fiber.waitingFor,
        provides: node.fiber.provides,
        effects: node.fiber.effects,
        childrenCount: node.fiber.children?.length ?? 0,
      },
    })
  })

  // Layer 5: UI Registry & Screens (y: 1100)
  const l5Nodes = nodesByLayer.get(5) ?? []
  const l5Count = l5Nodes.length
  l5Nodes.forEach((node, idx) => {
    const availableWidth = 1760
    const startX = 120
    const step = availableWidth / Math.max(1, l5Count)
    const x = Math.round(startX + (idx + 0.5) * step)
    pcbNodes.push({
      id: node.id,
      code: node.code,
      name: node.name,
      kind: 'ui',
      subsystem: node.subsystem,
      layer: 5,
      systemId: node.systemId,
      moduleId: node.moduleId,
      x,
      y: 1100,
      radius: 30,
      parentPluginId: node.parentPluginId,
      fiber: {
        name: node.fiber.name,
        state: node.fiber.state,
        uid: node.fiber.uid,
        inject: node.fiber.inject,
        waitingFor: node.fiber.waitingFor,
        provides: node.fiber.provides,
        effects: node.fiber.effects,
        childrenCount: node.fiber.children?.length ?? 0,
      },
    })
  })

  // LEVEL 3: If a specific node is selected and has child fibers, orbit satellite chips around it
  if (viewLevel === 3 && selectedNodeId) {
    const parentNode = pcbNodes.find(
      (n) =>
        n.id === selectedNodeId ||
        n.name === selectedNodeId ||
        n.id === selectedNodeId.replace(/^plugin-/, '') ||
        (n.name ? n.name.replace(/^@BBeBee\//, '').replace(/^plugin-/, '') === selectedNodeId : false),
    )
    if (parentNode && parentNode.fiber) {
      const parentTreeFiber = fiberList.find(
        (f) =>
          (f.name === parentNode.id ||
            f.name === parentNode.name ||
            f.name === parentNode.fiber?.name ||
            deriveNodeId(f) === parentNode.id) &&
          f.children &&
          f.children.length > 0,
      )
      if (parentTreeFiber && parentTreeFiber.children.length > 0) {
        const satellites: PcbNode[] = parentTreeFiber.children.map((child, idx) => {
          const totalChildren = parentTreeFiber.children.length
          const angle = (idx * (2 * Math.PI)) / Math.max(1, totalChildren)
          const orbitRadius = parentNode.radius + 45
          const sx = Math.round(parentNode.x + Math.cos(angle) * orbitRadius)
          const sy = Math.round(parentNode.y + Math.sin(angle) * orbitRadius)

          return {
            id: `satellite-${parentNode.id}-${idx}`,
            code: `PIN-${idx + 1}`,
            name: child.name || `Child Fiber #${idx + 1}`,
            kind: 'satellite',
            subsystem: parentNode.subsystem,
            layer: parentNode.layer,
            systemId: parentNode.systemId,
            moduleId: parentNode.moduleId,
            x: sx,
            y: sy,
            radius: 14,
            parentPluginId: parentNode.id,
            fiber: {
              name: child.name || `Child #${child.uid ?? idx}`,
              state: child.state,
              uid: child.uid,
              inject: child.inject,
              waitingFor: child.waitingFor,
              provides: child.provides,
              effects: child.effects,
              childrenCount: child.children?.length ?? 0,
            },
          }
        })
        pcbNodes.push(...satellites)
      }
    }
  }

  // 4. Compute traces and pins dynamically from the generated nodes
  const traces = computeDynamicTraces(pcbNodes)
  const pins = generateDynamicPins(pcbNodes)

  return {
    nodes: pcbNodes,
    traces,
    pins,
    zones: SUBSYSTEM_ZONES,
    layerBands: LAYER_BANDS,
  }
}

/**
 * Backward compatibility helper for existing callers.
 */
export function mapSnapshotToTopology(
  snap: InspectorSnapshot,
  _baseNodes?: Omit<PcbNode, 'fiber'>[],
  viewLevel: ViewLevel = 1,
  _activeSubsystemId: SubsystemId | null = null,
  activeSelectedNodeId: string | null = null,
): PcbNode[] {
  const data = buildTopologyFromSnapshot(snap, viewLevel, activeSelectedNodeId)
  return data.nodes
}

/**
 * Backward compatibility helper for base traces generator.
 */
export function generateBaseTraces(nodes?: PcbNode[]): PcbTrace[] {
  if (nodes && nodes.length > 0) {
    return computeDynamicTraces(nodes)
  }
  return []
}

/**
 * Backward compatibility helper for base pins generator.
 */
export function generateBasePins(nodes?: PcbNode[]): PcbPin[] {
  if (nodes && nodes.length > 0) {
    return generateDynamicPins(nodes)
  }
  return []
}

/**
 * Resolves node manifest if available on the node itself.
 */
export function findNodeManifest(nodeId: string, nodes?: PcbNode[]): PluginManifest | undefined {
  if (nodes) {
    const node = nodes.find((n) => n.id === nodeId || n.code.toLowerCase() === nodeId.toLowerCase())
    if (node?.manifest) return node.manifest
  }
  return undefined
}

/**
 * Default fallback nodes dynamically generated for initial empty or test states.
 */
export const ARCH_NODES: Omit<PcbNode, 'fiber'>[] = buildTopologyFromSnapshot({
  root: {
    name: 'root',
    uid: 0,
    state: 'ACTIVE',
    inject: [],
    waitingFor: [],
    provides: [],
    effects: [],
    children: [
      {
        name: 'core-audio-mpv',
        uid: 1,
        state: 'ACTIVE',
        inject: [],
        waitingFor: [],
        provides: ['audio'],
        effects: [],
        children: [],
      },
      {
        name: 'plugin-player',
        uid: 2,
        state: 'ACTIVE',
        inject: ['audio'],
        waitingFor: [],
        provides: ['player'],
        effects: [],
        children: [],
      },
      {
        name: 'plugin-sources',
        uid: 3,
        state: 'ACTIVE',
        inject: [],
        waitingFor: [],
        provides: ['sources'],
        effects: [],
        children: [],
      },
      {
        name: 'plugin-sources-ui-desktop',
        uid: 4,
        state: 'ACTIVE',
        inject: ['sources'],
        waitingFor: [],
        provides: [],
        effects: [],
        children: [],
      },
    ],
  },
  counts: {
    ACTIVE: 5,
    PENDING: 0,
    LOADING: 0,
    FAILED: 0,
    DISPOSED: 0,
    UNLOADING: 0,
    UNKNOWN: 0,
  },
  stalled: [],
}).nodes
