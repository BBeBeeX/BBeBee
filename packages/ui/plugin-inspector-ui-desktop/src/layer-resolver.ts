/**
 * Centralized Architectural Layer Resolver.
 *
 * Implements the BBeBee 5-layer architectural hierarchy:
 *   Layer 1: Kernel  — Cordis runtime, DI container, capability gate, migrations
 *   Layer 2: Core    — Platform SDK boundary services (fs, audio, db, http, etc.)
 *   Layer 3: Logs    — Structured log transports & console writers
 *   Layer 4: Feature — Headless pure business logic (player, library, sources, etc.)
 *   Layer 5: UI      — View registration, user interface, and presentation
 */

import type { LayerId, LayerInfo } from './graph-model.js'
import type { PluginManifest } from '@BBeBee/protocol'

export const SYSTEM_LAYERS: Record<LayerId, LayerInfo> = {
  'layer-1': {
    id: 'layer-1',
    name: 'Kernel',
    order: 1,
    description: 'Cordis Runtime, DI Container & Capability Gate',
    color: '#38bdf8', // Cyan / Neon Blue
    borderColor: 'rgba(56, 189, 248, 0.35)',
    bgColor: 'rgba(56, 189, 248, 0.04)',
  },
  'layer-2': {
    id: 'layer-2',
    name: 'Core',
    order: 2,
    description: 'Infrastructure Capability Services (Platform SDK Boundary)',
    color: '#34d399', // Emerald Green
    borderColor: 'rgba(52, 211, 153, 0.35)',
    bgColor: 'rgba(52, 211, 153, 0.04)',
  },
  'layer-3': {
    id: 'layer-3',
    name: 'Logs',
    order: 3,
    description: 'Observability & Structured Log Transports',
    color: '#fbbf24', // Amber / Gold
    borderColor: 'rgba(251, 191, 36, 0.35)',
    bgColor: 'rgba(251, 191, 36, 0.04)',
  },
  'layer-4': {
    id: 'layer-4',
    name: 'Feature',
    order: 4,
    description: 'Headless Pure Business Features (Zero Platform SDKs)',
    color: '#818cf8', // Indigo / Purple
    borderColor: 'rgba(129, 140, 248, 0.35)',
    bgColor: 'rgba(129, 140, 248, 0.04)',
  },
  'layer-5': {
    id: 'layer-5',
    name: 'UI',
    order: 5,
    description: 'Desktop / Mobile Views & UI Infrastructure',
    color: '#f472b6', // Magenta / Pink
    borderColor: 'rgba(244, 114, 182, 0.35)',
    bgColor: 'rgba(244, 114, 182, 0.04)',
  },
}

export const ALL_LAYER_IDS: LayerId[] = ['layer-1', 'layer-2', 'layer-3', 'layer-4', 'layer-5']

export function getLayerInfo(id: LayerId): LayerInfo {
  return SYSTEM_LAYERS[id] ?? SYSTEM_LAYERS['layer-4']
}

export function resolvePluginLayer(
  pluginId: string,
  manifest?: PluginManifest | null,
): LayerId {
  // 1. Direct declaration in plugin manifest
  if (manifest?.systemId && manifest.systemId in SYSTEM_LAYERS) {
    return manifest.systemId as LayerId
  }

  const normalized = pluginId.toLowerCase()

  // 2. Kernel layer
  if (
    normalized === 'root' ||
    normalized.includes('kernel') ||
    normalized === '@bbebee/kernel'
  ) {
    return 'layer-1'
  }

  // 3. Core layer
  if (
    normalized.startsWith('@bbebee/core-') ||
    normalized.startsWith('core-') ||
    normalized.includes('desktop-bridge')
  ) {
    return 'layer-2'
  }

  // 4. Logs layer
  if (
    normalized.startsWith('@bbebee/logs-') ||
    normalized.startsWith('logs-') ||
    normalized.includes('logger')
  ) {
    return 'layer-3'
  }

  // 5. UI layer
  if (
    normalized.includes('-ui-') ||
    normalized.endsWith('-ui') ||
    normalized.startsWith('@bbebee/ui-') ||
    normalized.includes('ui-kit') ||
    normalized.includes('ui-core') ||
    normalized.includes('ui-menus')
  ) {
    return 'layer-5'
  }

  // 6. Default to Feature (headless domain)
  return 'layer-4'
}
