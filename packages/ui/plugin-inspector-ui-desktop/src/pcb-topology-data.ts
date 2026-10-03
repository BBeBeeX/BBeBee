import type { FiberNode, InspectorSnapshot } from '@BBeBee/plugin-inspector'
import type { PluginManifest } from '@BBeBee/protocol'
import type {
  LayerBand,
  PcbNode,
  PcbPin,
  PcbTrace,
  SubsystemId,
  SubsystemZone,
  ViewLevel,
} from './pcb-topology-types.js'
import { PLUGIN_MANIFESTS } from './pcb-manifests.generated.js'

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
 * Mapped cleanly inside their respective parent architectural layers.
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
    bounds: { x: 70, y: 620, width: 380, height: 335 },
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
    bounds: { x: 740, y: 620, width: 550, height: 335 },
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
    bounds: { x: 470, y: 620, width: 250, height: 335 },
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
    bounds: { x: 1310, y: 620, width: 230, height: 335 },
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
    bounds: { x: 1560, y: 620, width: 170, height: 335 },
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
    bounds: { x: 1750, y: 620, width: 180, height: 335 },
    color: '#6474FF',
    description: 'Fiber tree introspection, labelled effect tracker, and runtime health monitor.',
  },
]

const NODE_MANIFEST_ALIAS: Record<string, string> = {
  downloads: '@BBeBee/plugin-download',
  mediaSession: '@BBeBee/core-media-session-electron',
  js: '@BBeBee/core-js-quickjs-node',
  scanner: '@BBeBee/plugin-local-scanner',
  'scanner-ui-bp': '@BBeBee/plugin-local-scanner-ui-desktop',
  localSource: '@BBeBee/plugin-source-local',
  sourceRuntime: '@BBeBee/plugin-source-runtime',
  nowplaying: '@BBeBee/plugin-now-playing',
  'nowplaying-ui-bp': '@BBeBee/plugin-now-playing-ui-desktop',
  sleeptimer: '@BBeBee/plugin-sleep-timer',
  desktopLyrics: '@BBeBee/plugin-desktop-lyrics',
  'desktopLyrics-ui': '@BBeBee/plugin-desktop-lyrics-ui-desktop',
  logs: '@BBeBee/plugin-log-buffer',
  'log-console': '@BBeBee/plugin-log-console',
  'inspector-ui': '@BBeBee/plugin-inspector-ui-desktop',
  'player-ui-bp': '@BBeBee/plugin-now-playing-ui-desktop',
}

/**
 * Find the plugin manifest matching a PCB node.
 */
export function findNodeManifest(nodeId: string): PluginManifest | undefined {
  if (NODE_MANIFEST_ALIAS[nodeId]) {
    return PLUGIN_MANIFESTS[NODE_MANIFEST_ALIAS[nodeId]]
  }
  const direct =
    PLUGIN_MANIFESTS[nodeId] ??
    PLUGIN_MANIFESTS[`@BBeBee/${nodeId}`] ??
    PLUGIN_MANIFESTS[`@BBeBee/plugin-${nodeId}`] ??
    PLUGIN_MANIFESTS[`plugin-${nodeId}`] ??
    PLUGIN_MANIFESTS[`@BBeBee/core-${nodeId}-node`] ??
    PLUGIN_MANIFESTS[`@BBeBee/core-${nodeId}-electron`] ??
    PLUGIN_MANIFESTS[`@BBeBee/core-${nodeId}-webaudio`] ??
    PLUGIN_MANIFESTS[`@BBeBee/core-${nodeId}-mpv`]
  if (direct) return direct

  if (nodeId.endsWith('-ui-bp') || nodeId.endsWith('-ui')) {
    const base = nodeId.replace('-ui-bp', '').replace('-ui', '')
    return (
      PLUGIN_MANIFESTS[`@BBeBee/plugin-${base}-ui-desktop`] ??
      PLUGIN_MANIFESTS[`plugin-${base}-ui-desktop`]
    )
  }

  return undefined
}

/**
 * Baseline Architectural Nodes representing the true system composition.
 * Includes compatibility identifiers (cs20, cs30, Level 4, Level 5) for tests and HUD.
 */
const RAW_ARCH_NODES: Omit<PcbNode, 'fiber'>[] = [
  // ── LAYER 1: KERNEL RUNTIME ────────────────────────────────────────────────
  {
    id: 'root',
    code: 'ROOT',
    name: 'Cordis Root Kernel Context',
    kind: 'root',
    subsystem: 'root',
    layer: 1,
    x: 960,
    y: 110,
    radius: 46,
  },

  // ── LAYER 2: CORE CAPABILITY SERVICES ──────────────────────────────────────
  // Storage / Virtual Filesystem
  {
    id: 'paths',
    code: 'PATHS',
    name: 'Path Resolution Service',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 140,
    y: 310,
    radius: 28,
  },
  {
    id: 'fs',
    code: 'FS',
    name: 'Virtual Filesystem Service',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 270,
    y: 310,
    radius: 28,
  },
  {
    id: 'store',
    code: 'STORE',
    name: 'Key-Value Store Service',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 400,
    y: 310,
    radius: 28,
  },
  {
    id: 'db',
    code: 'DB',
    name: 'SQLite WAL Database Service',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 540,
    y: 310,
    radius: 32,
  },
  // OS Integration
  {
    id: 'device',
    code: 'DEVICE',
    name: 'Device & Battery Service',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 710,
    y: 310,
    radius: 28,
  },
  {
    id: 'background',
    code: 'BKGND',
    name: 'Background Wake Lock Service',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 840,
    y: 310,
    radius: 28,
  },
  {
    id: 'mediaSession',
    code: 'MEDIASES',
    name: 'OS Media Session Integration',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 970,
    y: 310,
    radius: 30,
  },
  // Runtime Infrastructure
  {
    id: 'codec',
    code: 'CODEC',
    name: 'Audio Codec & Metadata Decoder',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 1130,
    y: 310,
    radius: 28,
  },
  {
    id: 'http',
    code: 'HTTP',
    name: 'HTTP Network Client & Streaming',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 1260,
    y: 310,
    radius: 28,
  },
  {
    id: 'secrets',
    code: 'SECRETS',
    name: 'Secure Keystore & Token Storage',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 1390,
    y: 310,
    radius: 28,
  },
  {
    id: 'js',
    code: 'JS/QJS',
    name: 'QuickJS Sandboxed Engine Realm',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 1520,
    y: 310,
    radius: 28,
  },
  // Audio Graph Engine
  {
    id: 'audio',
    code: 'AUDIO',
    name: 'WebAudio Core Graph Engine',
    kind: 'service',
    subsystem: 'core',
    layer: 2,
    x: 1720,
    y: 310,
    radius: 36,
  },

  // ── LAYER 3: OBSERVABILITY & LOG TRANSPORTS ────────────────────────────────
  {
    id: 'logs',
    code: 'LOGS',
    name: 'Layer 3 Observability & Log Buffer',
    kind: 'service',
    subsystem: 'core',
    layer: 3,
    x: 880,
    y: 495,
    radius: 32,
  },
  {
    id: 'log-console',
    code: 'LOG-CON',
    name: 'Console Log Transport',
    kind: 'service',
    subsystem: 'core',
    layer: 3,
    x: 1040,
    y: 495,
    radius: 30,
  },

  // ── LAYER 4: HEADLESS BUSINESS FEATURES ────────────────────────────────────
  // Sources Subsystem
  {
    id: 'sources',
    code: 'SOURCES',
    name: 'Music Sources Registry',
    kind: 'service',
    subsystem: 'sources',
    layer: 4,
    x: 200,
    y: 700,
    radius: 38,
  },
  {
    id: 'scanner',
    code: 'SCANNER',
    name: 'Local Filesystem Walk Scanner',
    kind: 'service',
    subsystem: 'sources',
    layer: 4,
    x: 140,
    y: 840,
    radius: 26,
  },
  {
    id: 'localSource',
    code: 'LOCAL-SRC',
    name: 'Local Audio Provider',
    kind: 'service',
    subsystem: 'sources',
    layer: 4,
    x: 260,
    y: 840,
    radius: 26,
  },
  {
    id: 'sourceRuntime',
    code: 'RUNTIME',
    name: 'Source Runtime QuickJS Engine',
    kind: 'service',
    subsystem: 'sources',
    layer: 4,
    x: 380,
    y: 840,
    radius: 26,
  },
  // Storage & Cache Subsystem
  {
    id: 'cache',
    code: 'CACHE',
    name: 'Audio Stream LRU Cache',
    kind: 'service',
    subsystem: 'storage',
    layer: 4,
    x: 540,
    y: 700,
    radius: 32,
  },
  {
    id: 'downloads',
    code: 'DOWNLOADS',
    name: 'Offline Download Queue & Sync',
    kind: 'service',
    subsystem: 'storage',
    layer: 4,
    x: 540,
    y: 840,
    radius: 30,
  },
  {
    id: 'library',
    code: 'LIBRARY',
    name: 'Local Music Metadata Library',
    kind: 'service',
    subsystem: 'storage',
    layer: 4,
    x: 650,
    y: 770,
    radius: 32,
  },
  // Playback Engine Core
  {
    id: 'player',
    code: 'PLAYER',
    name: 'Core Playback Engine Controller',
    kind: 'service',
    subsystem: 'playback',
    layer: 4,
    x: 960,
    y: 710,
    radius: 46,
  },
  {
    id: 'queue',
    code: 'QUEUE',
    name: 'Dynamic Play Queue Manager',
    kind: 'service',
    subsystem: 'playback',
    layer: 4,
    x: 820,
    y: 840,
    radius: 32,
  },
  {
    id: 'nowplaying',
    code: 'NOWPLAY',
    name: 'Now Playing State Broadcast',
    kind: 'service',
    subsystem: 'playback',
    layer: 4,
    x: 960,
    y: 870,
    radius: 28,
  },
  {
    id: 'history',
    code: 'HISTORY',
    name: 'Play History & Analytics Tracker',
    kind: 'service',
    subsystem: 'playback',
    layer: 4,
    x: 1100,
    y: 840,
    radius: 30,
  },
  {
    id: 'dsp',
    code: 'DSP',
    name: 'Parametric Equalizer & DSP Rack',
    kind: 'service',
    subsystem: 'playback',
    layer: 4,
    x: 1230,
    y: 710,
    radius: 34,
  },
  {
    id: 'sleeptimer',
    code: 'SLEEP',
    name: 'Timed Auto-Stop Controller',
    kind: 'service',
    subsystem: 'playback',
    layer: 4,
    x: 1230,
    y: 840,
    radius: 26,
  },
  // Synchronized Lyrics Subsystem
  {
    id: 'lyrics',
    code: 'LYRICS',
    name: 'Synchronized Lyrics Engine',
    kind: 'service',
    subsystem: 'lyrics',
    layer: 4,
    x: 1420,
    y: 710,
    radius: 36,
  },
  {
    id: 'desktopLyrics',
    code: 'DSK-LYR',
    name: 'Desktop Floating Lyrics Controller',
    kind: 'service',
    subsystem: 'lyrics',
    layer: 4,
    x: 1420,
    y: 840,
    radius: 30,
  },
  // Settings & Telemetry
  {
    id: 'settings',
    code: 'SETTINGS',
    name: 'System Settings & Preference Store',
    kind: 'service',
    subsystem: 'settings',
    layer: 4,
    x: 1650,
    y: 710,
    radius: 36,
  },
  {
    id: 'inspector',
    code: 'INSPECT',
    name: 'Kernel Inspector Service',
    kind: 'service',
    subsystem: 'inspector',
    layer: 4,
    x: 1810,
    y: 710,
    radius: 32,
  },
  {
    id: 'diag-socket',
    code: 'TEST-SKT',
    name: 'Diagnostic Plug Test Socket',
    kind: 'service',
    subsystem: 'inspector',
    layer: 4,
    x: 1810,
    y: 840,
    radius: 28,
  },

  // ── LAYER 5: UI REGISTRY & PRESENTATION FABRIC ─────────────────────────────
  {
    id: 'ui',
    code: 'UI-REG',
    name: 'UI Registry & Component Backplane',
    kind: 'service',
    subsystem: 'ui',
    layer: 5,
    x: 180,
    y: 1100,
    radius: 38,
  },
  {
    id: 'scanner-ui-bp',
    code: 'SCN-UI',
    name: 'Scanner Desktop View',
    kind: 'ui',
    subsystem: 'ui',
    layer: 5,
    x: 300,
    y: 1100,
    radius: 22,
  },
  {
    id: 'sources-ui-bp',
    code: 'SRC-UI',
    name: 'Sources Desktop View',
    kind: 'ui',
    subsystem: 'ui',
    layer: 5,
    x: 420,
    y: 1100,
    radius: 22,
  },
  {
    id: 'download-ui-bp',
    code: 'DWN-UI',
    name: 'Downloads Desktop View',
    kind: 'ui',
    subsystem: 'ui',
    layer: 5,
    x: 540,
    y: 1100,
    radius: 22,
  },
  {
    id: 'library-ui-bp',
    code: 'LIB-UI',
    name: 'Library Desktop View',
    kind: 'ui',
    subsystem: 'ui',
    layer: 5,
    x: 660,
    y: 1100,
    radius: 22,
  },
  {
    id: 'queue-ui-bp',
    code: 'QUE-UI',
    name: 'Queue Up-Next Sidebar View',
    kind: 'ui',
    subsystem: 'ui',
    layer: 5,
    x: 820,
    y: 1100,
    radius: 22,
  },
  {
    id: 'player-ui-bp',
    code: 'PLY-UI',
    name: 'Player Persistent Bar View',
    kind: 'ui',
    subsystem: 'ui',
    layer: 5,
    x: 960,
    y: 1100,
    radius: 32,
  },
  {
    id: 'history-ui-bp',
    code: 'HIS-UI',
    name: 'Play History Screen View',
    kind: 'ui',
    subsystem: 'ui',
    layer: 5,
    x: 1100,
    y: 1100,
    radius: 22,
  },
  {
    id: 'dsp-ui-bp',
    code: 'DSP-UI',
    name: 'DSP Equalizer Drawer View',
    kind: 'ui',
    subsystem: 'ui',
    layer: 5,
    x: 1230,
    y: 1100,
    radius: 22,
  },
  {
    id: 'lyrics-ui-bp',
    code: 'LYR-UI',
    name: 'Lyrics Panel View',
    kind: 'ui',
    subsystem: 'ui',
    layer: 5,
    x: 1380,
    y: 1100,
    radius: 22,
  },
  {
    id: 'desktopLyrics-ui',
    code: 'DLR-UI',
    name: 'Desktop Floating Window UI',
    kind: 'ui',
    subsystem: 'lyrics',
    layer: 5,
    x: 1490,
    y: 1100,
    radius: 22,
  },
  {
    id: 'settings-ui-bp',
    code: 'SET-UI',
    name: 'Settings Screen View',
    kind: 'ui',
    subsystem: 'ui',
    layer: 5,
    x: 1650,
    y: 1100,
    radius: 22,
  },
  {
    id: 'inspector-ui',
    code: 'INS-UI',
    name: 'Inspector PCB Topology View',
    kind: 'ui',
    subsystem: 'inspector',
    layer: 5,
    x: 1810,
    y: 1100,
    radius: 26,
  },
]

export const ARCH_NODES: Omit<PcbNode, 'fiber'>[] = RAW_ARCH_NODES.map((node) => {
  const manifest = findNodeManifest(node.id)
  return {
    ...node,
    manifest,
    systemId: node.systemId ?? manifest?.systemId ?? `layer-${node.layer ?? 4}`,
    moduleId: node.moduleId ?? manifest?.moduleId ?? (node.subsystem as string) ?? 'core',
    name: manifest?.displayName ?? manifest?.name ?? node.name,
  }
})

// Keep export BASE_NODES pointing to ARCH_NODES for compatibility
export const BASE_NODES = ARCH_NODES

/**
 * Generate high-clarity Orthogonal PCB traces (strictly 90° bends and 45° chamfers)
 * connecting Layer 1 -> Layer 2 -> Layer 3 -> Layer 4 -> Layer 5.
 */
export function generateBaseTraces(): PcbTrace[] {
  const traces: PcbTrace[] = []

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. LAYER 1 KERNEL TRUNK BUSES (Feeds down to Layer 2 and Layer 3)
  // ═══════════════════════════════════════════════════════════════════════════
  traces.push({
    id: 'tr-l1-l2-root-bus',
    fromNodeId: 'root',
    fromSubsystem: 'root',
    toSubsystem: 'core',
    colorType: 'primary',
    category: 'bus',
    hasSignalFlow: true,
    width: 2.6,
    path: 'M 960 156 L 960 215',
    vias: [{ x: 960, y: 156 }, { x: 960, y: 215 }],
  })

  traces.push({
    id: 'tr-root-db',
    fromNodeId: 'root',
    toNodeId: 'db',
    fromSubsystem: 'root',
    toSubsystem: 'core',
    colorType: 'primary',
    category: 'dependency',
    width: 2.2,
    path: 'M 930 146 L 930 185 L 540 185 L 540 278',
    vias: [{ x: 930, y: 185 }, { x: 540, y: 185 }],
  })

  traces.push({
    id: 'tr-root-audio',
    fromNodeId: 'root',
    toNodeId: 'audio',
    fromSubsystem: 'root',
    toSubsystem: 'core',
    colorType: 'secondary',
    category: 'dependency',
    width: 2.2,
    path: 'M 990 146 L 990 185 L 1720 185 L 1720 274',
    vias: [{ x: 990, y: 185 }, { x: 1720, y: 185 }],
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. LAYER 2 HORIZONTAL CAPABILITY BUS
  // ═══════════════════════════════════════════════════════════════════════════
  traces.push({
    id: 'tr-l2-main-bus',
    colorType: 'primary',
    category: 'bus',
    hasSignalFlow: true,
    width: 2.6,
    path: 'M 100 370 L 1800 370',
    vias: [
      { x: 140, y: 370 },
      { x: 270, y: 370 },
      { x: 400, y: 370 },
      { x: 540, y: 370 },
      { x: 710, y: 370 },
      { x: 840, y: 370 },
      { x: 970, y: 370 },
      { x: 1130, y: 370 },
      { x: 1260, y: 370 },
      { x: 1390, y: 370 },
      { x: 1520, y: 370 },
      { x: 1720, y: 370 },
    ],
  })

  // Layer 2 internal connections
  // fs -> paths
  traces.push({
    id: 'tr-core-fs-paths',
    fromNodeId: 'fs',
    toNodeId: 'paths',
    fromSubsystem: 'core',
    toSubsystem: 'core',
    colorType: 'secondary',
    category: 'dependency',
    width: 2,
    path: 'M 242 310 L 168 310',
  })
  // db -> fs
  traces.push({
    id: 'tr-core-db-fs',
    fromNodeId: 'db',
    toNodeId: 'fs',
    fromSubsystem: 'core',
    toSubsystem: 'core',
    colorType: 'primary',
    category: 'dependency',
    width: 2,
    path: 'M 508 310 L 298 310',
  })
  // store -> fs
  traces.push({
    id: 'tr-core-store-fs',
    fromNodeId: 'store',
    toNodeId: 'fs',
    fromSubsystem: 'core',
    toSubsystem: 'core',
    colorType: 'secondary',
    category: 'dependency',
    width: 1.8,
    path: 'M 372 310 L 298 310',
  })
  // http -> secrets
  traces.push({
    id: 'tr-core-http-secrets',
    fromNodeId: 'http',
    toNodeId: 'secrets',
    fromSubsystem: 'core',
    toSubsystem: 'core',
    colorType: 'secondary',
    category: 'dependency',
    width: 1.8,
    path: 'M 1288 310 L 1362 310',
  })
  // js -> secrets
  traces.push({
    id: 'tr-core-js-secrets',
    fromNodeId: 'js',
    toNodeId: 'secrets',
    fromSubsystem: 'core',
    toSubsystem: 'core',
    colorType: 'secondary',
    category: 'dependency',
    width: 1.8,
    path: 'M 1492 310 L 1418 310',
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. LAYER 3 OBSERVABILITY & LOG TRANSPORTS BUS
  // ═══════════════════════════════════════════════════════════════════════════
  traces.push({
    id: 'tr-l3-bus',
    fromNodeId: 'logs',
    toNodeId: 'log-console',
    fromSubsystem: 'core',
    toSubsystem: 'core',
    colorType: 'secondary',
    category: 'bus',
    hasSignalFlow: true,
    width: 2.2,
    path: 'M 912 495 L 1010 495',
    vias: [{ x: 912, y: 495 }, { x: 1010, y: 495 }],
  })
  // Feed from Root to Logs
  traces.push({
    id: 'tr-root-logs',
    fromNodeId: 'root',
    toNodeId: 'logs',
    fromSubsystem: 'root',
    toSubsystem: 'core',
    colorType: 'secondary',
    category: 'dependency',
    width: 1.8,
    path: 'M 940 156 L 940 420 L 880 420 L 880 463',
    vias: [{ x: 940, y: 420 }, { x: 880, y: 420 }],
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. INTER-LAYER BRIDGES: LAYER 4 CONSUMES LAYER 2 SERVICES
  // ═══════════════════════════════════════════════════════════════════════════
  // Player -> Audio
  traces.push({
    id: 'tr-player-audio',
    fromNodeId: 'player',
    toNodeId: 'audio',
    fromSubsystem: 'playback',
    toSubsystem: 'core',
    colorType: 'primary',
    category: 'dependency',
    hasSignalFlow: true,
    width: 2.6,
    path: 'M 1006 710 L 1720 710 L 1720 346',
    vias: [{ x: 1720, y: 710 }],
  })

  // DSP -> Audio
  traces.push({
    id: 'tr-dsp-audio',
    fromNodeId: 'dsp',
    toNodeId: 'audio',
    fromSubsystem: 'playback',
    toSubsystem: 'core',
    colorType: 'primary',
    category: 'dependency',
    hasSignalFlow: true,
    width: 2.2,
    path: 'M 1264 710 L 1700 710 L 1700 346',
    vias: [{ x: 1700, y: 710 }],
  })

  // Player -> DB
  traces.push({
    id: 'tr-player-db',
    fromNodeId: 'player',
    toNodeId: 'db',
    fromSubsystem: 'playback',
    toSubsystem: 'core',
    colorType: 'primary',
    category: 'dependency',
    width: 2.2,
    path: 'M 914 710 L 540 710 L 540 342',
    vias: [{ x: 540, y: 710 }],
  })

  // Sources -> Paths & FS
  traces.push({
    id: 'tr-sources-fs',
    fromNodeId: 'sources',
    toNodeId: 'fs',
    fromSubsystem: 'sources',
    toSubsystem: 'core',
    colorType: 'primary',
    category: 'dependency',
    width: 2.2,
    path: 'M 200 662 L 200 450 L 270 450 L 270 338',
    vias: [{ x: 200, y: 450 }, { x: 270, y: 450 }],
  })

  // Sources -> HTTP
  traces.push({
    id: 'tr-sources-http',
    fromNodeId: 'sources',
    toNodeId: 'http',
    fromSubsystem: 'sources',
    toSubsystem: 'core',
    colorType: 'secondary',
    category: 'dependency',
    width: 2,
    path: 'M 238 700 L 460 700 L 460 410 L 1260 410 L 1260 338',
    vias: [{ x: 460, y: 700 }, { x: 460, y: 410 }, { x: 1260, y: 410 }],
  })

  // Cache -> FS
  traces.push({
    id: 'tr-cache-fs',
    fromNodeId: 'cache',
    toNodeId: 'fs',
    fromSubsystem: 'storage',
    toSubsystem: 'core',
    colorType: 'secondary',
    category: 'dependency',
    width: 2,
    path: 'M 508 700 L 270 700 L 270 338',
    vias: [{ x: 270, y: 700 }],
  })

  // Settings -> Store
  traces.push({
    id: 'tr-settings-store',
    fromNodeId: 'settings',
    toNodeId: 'store',
    fromSubsystem: 'settings',
    toSubsystem: 'core',
    colorType: 'secondary',
    category: 'dependency',
    width: 2,
    path: 'M 1650 674 L 1650 420 L 400 420 L 400 338',
    vias: [{ x: 1650, y: 420 }, { x: 400, y: 420 }],
  })

  // Player -> MediaSession (OS lock screen & media session integration)
  traces.push({
    id: 'tr-player-mediasession',
    fromNodeId: 'player',
    toNodeId: 'mediaSession',
    fromSubsystem: 'playback',
    toSubsystem: 'core',
    colorType: 'primary',
    category: 'dependency',
    hasSignalFlow: true,
    width: 2.2,
    path: 'M 960 664 L 970 664 L 970 340',
    vias: [{ x: 970, y: 664 }],
  })

  // Sources -> DB (Source configuration & rule persistence)
  traces.push({
    id: 'tr-sources-db',
    fromNodeId: 'sources',
    toNodeId: 'db',
    fromSubsystem: 'sources',
    toSubsystem: 'core',
    colorType: 'primary',
    category: 'dependency',
    width: 2.2,
    path: 'M 200 662 L 200 480 L 540 480 L 540 342',
    vias: [{ x: 200, y: 480 }, { x: 540, y: 480 }],
  })

  // Library -> DB (Music metadata repository)
  traces.push({
    id: 'tr-library-db',
    fromNodeId: 'library',
    toNodeId: 'db',
    fromSubsystem: 'storage',
    toSubsystem: 'core',
    colorType: 'primary',
    category: 'dependency',
    width: 2,
    path: 'M 650 738 L 650 460 L 540 460 L 540 342',
    vias: [{ x: 650, y: 460 }, { x: 540, y: 460 }],
  })

  // DSP -> Store (Equalizer & effect presets persistence)
  traces.push({
    id: 'tr-dsp-store',
    fromNodeId: 'dsp',
    toNodeId: 'store',
    fromSubsystem: 'playback',
    toSubsystem: 'core',
    colorType: 'secondary',
    category: 'dependency',
    width: 2,
    path: 'M 1230 676 L 1230 440 L 400 440 L 400 338',
    vias: [{ x: 1230, y: 440 }, { x: 400, y: 440 }],
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. LAYER 4 INTERNAL DOMAIN COLLABORATION TRACES
  // ═══════════════════════════════════════════════════════════════════════════
  // Player -> Sources
  traces.push({
    id: 'tr-player-sources',
    fromNodeId: 'player',
    toNodeId: 'sources',
    fromSubsystem: 'playback',
    toSubsystem: 'sources',
    colorType: 'primary',
    category: 'dependency',
    hasSignalFlow: true,
    width: 2.4,
    path: 'M 914 710 L 238 710',
  })

  // Player -> Queue
  traces.push({
    id: 'tr-player-queue',
    fromNodeId: 'player',
    toNodeId: 'queue',
    fromSubsystem: 'playback',
    toSubsystem: 'playback',
    colorType: 'secondary',
    category: 'dependency',
    hasSignalFlow: true,
    width: 2.2,
    path: 'M 920 740 L 820 740 L 820 808',
    vias: [{ x: 820, y: 740 }],
  })

  // Player -> NowPlaying
  traces.push({
    id: 'tr-player-nowplaying',
    fromNodeId: 'player',
    toNodeId: 'nowplaying',
    fromSubsystem: 'playback',
    toSubsystem: 'playback',
    colorType: 'secondary',
    category: 'dependency',
    width: 2,
    path: 'M 960 756 L 960 842',
  })

  // Player -> History
  traces.push({
    id: 'tr-player-history',
    fromNodeId: 'player',
    toNodeId: 'history',
    fromSubsystem: 'playback',
    toSubsystem: 'playback',
    colorType: 'secondary',
    category: 'dependency',
    width: 2,
    path: 'M 1000 740 L 1100 740 L 1100 810',
    vias: [{ x: 1100, y: 740 }],
  })

  // Player -> DSP
  traces.push({
    id: 'tr-player-dsp',
    fromNodeId: 'player',
    toNodeId: 'dsp',
    fromSubsystem: 'playback',
    toSubsystem: 'playback',
    colorType: 'secondary',
    category: 'dependency',
    width: 2.2,
    path: 'M 1006 710 L 1196 710',
  })

  // Player -> SleepTimer
  traces.push({
    id: 'tr-player-sleeptimer',
    fromNodeId: 'player',
    toNodeId: 'sleeptimer',
    fromSubsystem: 'playback',
    toSubsystem: 'playback',
    colorType: 'secondary',
    category: 'dependency',
    width: 1.8,
    path: 'M 1000 745 L 1230 745 L 1230 814',
    vias: [{ x: 1230, y: 745 }],
  })

  // Player -> Lyrics
  traces.push({
    id: 'tr-player-lyrics',
    fromNodeId: 'player',
    toNodeId: 'lyrics',
    fromSubsystem: 'playback',
    toSubsystem: 'lyrics',
    colorType: 'primary',
    category: 'dependency',
    hasSignalFlow: true,
    width: 2.2,
    path: 'M 1006 710 L 1384 710',
  })

  // Lyrics -> DesktopLyrics
  traces.push({
    id: 'tr-lyrics-desktoplyrics',
    fromNodeId: 'lyrics',
    toNodeId: 'desktopLyrics',
    fromSubsystem: 'lyrics',
    toSubsystem: 'lyrics',
    colorType: 'secondary',
    category: 'dependency',
    width: 2,
    path: 'M 1420 746 L 1420 810',
  })

  // Sources -> Scanner / LocalSource / SourceRuntime
  traces.push({
    id: 'tr-sources-scanner',
    fromNodeId: 'sources',
    toNodeId: 'scanner',
    fromSubsystem: 'sources',
    toSubsystem: 'sources',
    colorType: 'secondary',
    category: 'dependency',
    width: 1.8,
    path: 'M 180 735 L 140 735 L 140 814',
    vias: [{ x: 140, y: 735 }],
  })
  traces.push({
    id: 'tr-sources-localsource',
    fromNodeId: 'sources',
    toNodeId: 'localSource',
    fromSubsystem: 'sources',
    toSubsystem: 'sources',
    colorType: 'secondary',
    category: 'dependency',
    width: 1.8,
    path: 'M 220 735 L 260 735 L 260 814',
    vias: [{ x: 260, y: 735 }],
  })
  traces.push({
    id: 'tr-sources-sourceruntime',
    fromNodeId: 'sources',
    toNodeId: 'sourceRuntime',
    fromSubsystem: 'sources',
    toSubsystem: 'sources',
    colorType: 'secondary',
    category: 'dependency',
    width: 1.8,
    path: 'M 238 720 L 380 720 L 380 814',
    vias: [{ x: 380, y: 720 }],
  })

  // Storage: Cache -> Downloads -> Library
  traces.push({
    id: 'tr-cache-downloads',
    fromNodeId: 'cache',
    toNodeId: 'downloads',
    fromSubsystem: 'storage',
    toSubsystem: 'storage',
    colorType: 'secondary',
    category: 'dependency',
    width: 2,
    path: 'M 540 732 L 540 810',
  })
  traces.push({
    id: 'tr-downloads-library',
    fromNodeId: 'downloads',
    toNodeId: 'library',
    fromSubsystem: 'storage',
    toSubsystem: 'storage',
    colorType: 'secondary',
    category: 'dependency',
    width: 1.8,
    path: 'M 570 840 L 650 840 L 650 802',
    vias: [{ x: 650, y: 840 }],
  })

  // Settings cross-cutting control
  traces.push({
    id: 'tr-settings-player',
    fromNodeId: 'settings',
    toNodeId: 'player',
    fromSubsystem: 'settings',
    toSubsystem: 'playback',
    colorType: 'control',
    category: 'control',
    width: 1.8,
    path: 'M 1650 674 L 1650 645 L 960 645 L 960 664',
    vias: [{ x: 1650, y: 645 }, { x: 960, y: 645 }],
  })
  traces.push({
    id: 'tr-settings-dsp',
    fromNodeId: 'settings',
    toNodeId: 'dsp',
    fromSubsystem: 'settings',
    toSubsystem: 'playback',
    colorType: 'control',
    category: 'control',
    width: 1.8,
    path: 'M 1620 710 L 1264 710',
  })
  traces.push({
    id: 'tr-settings-lyrics',
    fromNodeId: 'settings',
    toNodeId: 'lyrics',
    fromSubsystem: 'settings',
    toSubsystem: 'lyrics',
    colorType: 'control',
    category: 'control',
    width: 1.8,
    path: 'M 1620 730 L 1456 730',
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. LAYER 5 UI REGISTRY & VIEW MOUNTING TRACES
  // ═══════════════════════════════════════════════════════════════════════════
  // UI Backplane Bus along the bottom
  traces.push({
    id: 'tr-l5-ui-backplane-bus',
    fromNodeId: 'ui',
    fromSubsystem: 'ui',
    toSubsystem: 'ui',
    colorType: 'ui',
    category: 'bus',
    hasSignalFlow: true,
    width: 2.8,
    path: 'M 180 1100 L 1810 1100',
    vias: [
      { x: 180, y: 1100 },
      { x: 300, y: 1100 },
      { x: 420, y: 1100 },
      { x: 540, y: 1100 },
      { x: 660, y: 1100 },
      { x: 820, y: 1100 },
      { x: 960, y: 1100 },
      { x: 1100, y: 1100 },
      { x: 1230, y: 1100 },
      { x: 1380, y: 1100 },
      { x: 1490, y: 1100 },
      { x: 1650, y: 1100 },
      { x: 1810, y: 1100 },
    ],
  })

  // Vertical feeds from Layer 4 Features down to Layer 5 UI
  // Player -> Player UI
  traces.push({
    id: 'tr-l4-l5-player-ui',
    fromNodeId: 'player',
    toNodeId: 'player-ui-bp',
    fromSubsystem: 'playback',
    toSubsystem: 'ui',
    colorType: 'ui',
    category: 'ui-contribution',
    hasSignalFlow: true,
    width: 2.4,
    path: 'M 960 756 L 960 1068',
  })

  // Sources -> Sources UI
  traces.push({
    id: 'tr-l4-l5-sources-ui',
    fromNodeId: 'sources',
    toNodeId: 'sources-ui-bp',
    fromSubsystem: 'sources',
    toSubsystem: 'ui',
    colorType: 'ui',
    category: 'ui-contribution',
    width: 1.8,
    path: 'M 200 738 L 200 970 L 420 970 L 420 1078',
    vias: [{ x: 200, y: 970 }, { x: 420, y: 970 }],
  })

  // DSP -> DSP UI
  traces.push({
    id: 'tr-l4-l5-dsp-ui',
    fromNodeId: 'dsp',
    toNodeId: 'dsp-ui-bp',
    fromSubsystem: 'playback',
    toSubsystem: 'ui',
    colorType: 'ui',
    category: 'ui-contribution',
    width: 1.8,
    path: 'M 1230 744 L 1230 1078',
  })

  // Lyrics -> Lyrics UI
  traces.push({
    id: 'tr-l4-l5-lyrics-ui',
    fromNodeId: 'lyrics',
    toNodeId: 'lyrics-ui-bp',
    fromSubsystem: 'lyrics',
    toSubsystem: 'ui',
    colorType: 'ui',
    category: 'ui-contribution',
    width: 1.8,
    path: 'M 1420 746 L 1420 970 L 1380 970 L 1380 1078',
    vias: [{ x: 1420, y: 970 }, { x: 1380, y: 970 }],
  })

  // Settings -> Settings UI
  traces.push({
    id: 'tr-l4-l5-settings-ui',
    fromNodeId: 'settings',
    toNodeId: 'settings-ui-bp',
    fromSubsystem: 'settings',
    toSubsystem: 'ui',
    colorType: 'ui',
    category: 'ui-contribution',
    width: 1.8,
    path: 'M 1650 746 L 1650 1078',
  })

  // Inspector -> Inspector UI
  traces.push({
    id: 'tr-l4-l5-inspector-ui',
    fromNodeId: 'inspector',
    toNodeId: 'inspector-ui',
    fromSubsystem: 'inspector',
    toSubsystem: 'inspector',
    colorType: 'primary',
    category: 'ui-contribution',
    width: 1.8,
    path: 'M 1810 742 L 1810 1074',
  })

  return traces
}

/**
 * Generate technical pin connectors and vertical IC solder buses.
 */
export function generateBasePins(): PcbPin[] {
  const pins: PcbPin[] = []

  // Vertical 5-pin bus between Scanner and LocalSource in Layer 4
  const scannerBusX = [188, 194, 200, 206, 212]
  scannerBusX.forEach((x, i) => {
    pins.push({
      id: `pin-bus-scanner-${i}`,
      x,
      y: 770,
      length: 50,
      type: 'bus',
      padSize: 4,
    })
  })

  // Vertical 5-pin bus between Lyrics and DesktopLyrics in Layer 4
  const lyricsBusX = [1408, 1414, 1420, 1426, 1432]
  lyricsBusX.forEach((x, i) => {
    pins.push({
      id: `pin-bus-lyrics-${i}`,
      x,
      y: 760,
      length: 55,
      type: 'bus',
      padSize: 4,
    })
  })

  // Key master IC pin pads perimeter (Root, Player, Sources, Audio, UI)
  const majorChips = [
    { id: 'root', x: 960, y: 110, r: 46 },
    { id: 'player', x: 960, y: 710, r: 46 },
    { id: 'sources', x: 200, y: 700, r: 38 },
    { id: 'audio', x: 1720, y: 310, r: 36 },
    { id: 'ui', x: 180, y: 1100, r: 38 },
  ]

  majorChips.forEach((chip) => {
    for (let a = 0; a < 8; a++) {
      const angle = (a * Math.PI) / 4
      const px = chip.x + Math.cos(angle) * (chip.r + 7)
      const py = chip.y + Math.sin(angle) * (chip.r + 7)
      pins.push({
        id: `pin-${chip.id}-${a}`,
        x: px,
        y: py,
        length: 7,
        angle,
        type: 'pad',
        padSize: 3.5,
      })
    }
  })

  return pins
}

/**
 * Mapping rule from Cordis snapshot fibers to our architectural nodes.
 */
function findMatchingFiber(
  nodeId: string,
  fibers: FiberNode[],
  stalled: FiberNode[],
): FiberNode | undefined {
  if (nodeId === 'diag-socket' && stalled.length > 0) {
    return stalled[0]
  }

  const directIdMap: Record<string, (f: FiberNode) => boolean> = {
    root: (f) => f.name === 'root' || f.name === 'ROOT',
    player: (f) => f.provides.includes('player') || f.name === 'plugin-player',
    audio: (f) => f.provides.includes('audio') || f.name.includes('audio'),
    sources: (f) => f.provides.includes('sources') || f.name === 'plugin-sources',
    scanner: (f) => f.provides.includes('scanner') || f.name === 'plugin-local-scanner',
    localSource: (f) => f.provides.includes('sourceLocal') || f.name === 'plugin-source-local',
    sourceRuntime: (f) => f.name === 'plugin-source-runtime' || f.name.includes('source-runtime'),
    library: (f) => f.provides.includes('library') || f.name === 'plugin-library',
    cache: (f) => f.provides.includes('cache') || f.name === 'plugin-cache',
    downloads: (f) => f.provides.includes('downloads') || f.name === 'plugin-download',
    lyrics: (f) => f.provides.includes('lyrics') || f.name === 'plugin-lyrics',
    desktopLyrics: (f) =>
      f.provides.includes('desktopLyrics') || f.name === 'plugin-desktop-lyrics',
    dsp: (f) => f.provides.includes('dsp') || f.name === 'plugin-dsp',
    queue: (f) => f.name === 'plugin-queue' || f.provides.includes('queue'),
    history: (f) => f.name === 'plugin-history',
    nowplaying: (f) => f.name === 'plugin-now-playing' || f.name.includes('now-playing'),
    sleeptimer: (f) => f.provides.includes('sleepTimer') || f.name === 'plugin-sleep-timer',
    settings: (f) => f.provides.includes('settings') || f.name === 'plugin-settings',
    inspector: (f) => f.provides.includes('inspector') || f.name === 'plugin-inspector',
    ui: (f) => f.provides.includes('ui') || f.name === 'plugin-ui',
    paths: (f) => f.provides.includes('paths') || f.name.includes('paths'),
    fs: (f) => f.provides.includes('fs') || f.name.includes('fs'),
    store: (f) => f.provides.includes('store') || f.name.includes('store'),
    db: (f) => f.provides.includes('db') || f.name.includes('db'),
    codec: (f) => f.provides.includes('codec') || f.name.includes('codec'),
    http: (f) => f.provides.includes('http') || f.name.includes('http'),
    secrets: (f) => f.provides.includes('secrets') || f.name.includes('secrets'),
    js: (f) => f.provides.includes('js') || f.name.includes('quickjs'),
    device: (f) => f.provides.includes('device') || f.name.includes('device'),
    background: (f) => f.provides.includes('background') || f.name.includes('background'),
    mediaSession: (f) => f.provides.includes('mediaSession') || f.name.includes('media-session'),
    logs: (f) => f.name.includes('log') || f.provides.includes('logBuffer'),
    'log-console': (f) => f.name.includes('console'),
    'inspector-ui': (f) => f.name === 'plugin-inspector-ui-desktop',
  }

  const matcher = directIdMap[nodeId]
  if (matcher) {
    return fibers.find(matcher)
  }

  // Backplane UI matchers
  if (nodeId.endsWith('-ui-bp') || nodeId.endsWith('-ui')) {
    const baseName = nodeId.replace('-ui-bp', '').replace('-ui', '')
    return fibers.find(
      (f) => f.name.includes(baseName) && f.name.includes('ui-desktop'),
    )
  }

  return undefined
}

/**
 * Maps the live Cordis Inspector snapshot to the topology nodes,
 * supporting 3-Level view filtering and dynamic child satellite pin generation.
 */
export function mapSnapshotToTopology(
  snap: InspectorSnapshot,
  baseNodes: Omit<PcbNode, 'fiber'>[] = ARCH_NODES,
  viewLevel: ViewLevel = 1,
  _activeSubsystemId: SubsystemId | null = null,
  activeSelectedNodeId: string | null = null,
): PcbNode[] {
  // Collect all fibers from the snapshot tree
  const fiberList: FiberNode[] = []
  const queue: FiberNode[] = [snap.root]
  while (queue.length > 0) {
    const f = queue.shift()!
    fiberList.push(f)
    for (const child of f.children) {
      queue.push(child)
    }
  }

  // Collect stalled fibers
  const stalledFibers = fiberList.filter(
    (f) => f.state !== 'ACTIVE' && f.uid !== null && f.name !== 'root',
  )

  // Map each base node
  const mappedNodes = baseNodes.map((base) => {
    let assignedFiber = findMatchingFiber(base.id, fiberList, stalledFibers)

    // Fallback assignment for stalled fibers that don't match any slot
    if (!assignedFiber && stalledFibers.length > 0 && base.id === 'diag-socket') {
      assignedFiber = stalledFibers[0]
    }

    const node: PcbNode = {
      ...base,
      fiber: assignedFiber
        ? {
            name: assignedFiber.name,
            state: assignedFiber.state,
            uid: assignedFiber.uid,
            inject: assignedFiber.inject,
            waitingFor: assignedFiber.waitingFor,
            provides: assignedFiber.provides,
            effects: assignedFiber.effects,
            childrenCount: assignedFiber.children.length,
          }
        : {
            name: `${base.code.toLowerCase()}.service`,
            state: 'ACTIVE',
            uid: null,
            inject: [],
            waitingFor: [],
            provides: [base.code.toLowerCase()],
            effects: [],
            childrenCount: 0,
          },
    }

    return node
  })

  // LEVEL 3: If a specific node is selected and has child fibers,
  // dynamically generate satellite child chips orbiting the parent node!
  if (viewLevel === 3 && activeSelectedNodeId) {
    const parentNode = mappedNodes.find((n) => n.id === activeSelectedNodeId)
    if (parentNode && parentNode.fiber) {
      // Find the corresponding fiber node in the tree to read its direct children
      const matchingTreeFiber = fiberList.find((f) => f.name === parentNode.fiber?.name)
      if (matchingTreeFiber && matchingTreeFiber.children.length > 0) {
        const satellites: PcbNode[] = matchingTreeFiber.children.map((child, idx) => {
          const totalChildren = matchingTreeFiber.children.length
          const angle = (idx * (2 * Math.PI)) / Math.max(1, totalChildren)
          const orbitRadius = parentNode.radius + 40
          const sx = parentNode.x + Math.cos(angle) * orbitRadius
          const sy = parentNode.y + Math.sin(angle) * orbitRadius

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
              childrenCount: child.children.length,
            },
          }
        })
        return [...mappedNodes, ...satellites]
      }
    }
  }

  return mappedNodes
}
