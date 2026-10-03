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
import { PLUGIN_MANIFESTS } from './pcb-manifests.generated.js'

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

/**
 * Resolves a plugin to its architectural layer based on its manifest `systemId`.
 *
 * Elimination of hardcoding:
 * 1. Reads `manifest.systemId` directly if present on the passed manifest.
 * 2. If no manifest passed, looks up the manifest in `PLUGIN_MANIFESTS` by ID/name.
 * 3. If the plugin provides services, finds the manifest in `PLUGIN_MANIFESTS` that
 *    contributes that service and inherits its `systemId`.
 * 4. Fuzzy matches against registered manifest IDs by normalized name.
 * 5. Cordis runtime root context resolves to 'layer-1' (Kernel).
 * 6. Defaults to 'layer-4' (Feature) if no manifest or systemId can be found.
 */
export function resolvePluginLayer(
  pluginId: string,
  manifest?: PluginManifest | null,
  provides: string[] = [],
): LayerId {
  // 1. Direct declaration in plugin manifest
  if (manifest?.systemId && manifest.systemId in SYSTEM_LAYERS) {
    return manifest.systemId as LayerId
  }

  // 2. Kernel layer (Cordis DI container root context)
  if (
    pluginId === 'root' ||
    pluginId.toLowerCase() === 'cordis' ||
    pluginId.toLowerCase().includes('kernel')
  ) {
    return 'layer-1'
  }

  // 3. Resolve manifest from registry by plugin ID
  const registered =
    PLUGIN_MANIFESTS[pluginId] ??
    PLUGIN_MANIFESTS[`@BBeBee/${pluginId}`] ??
    PLUGIN_MANIFESTS[pluginId.replace(/^@BBeBee\//, '')]

  if (registered?.systemId && registered.systemId in SYSTEM_LAYERS) {
    return registered.systemId as LayerId
  }

  // 4. Resolve via provided services: lookup which manifest contributes the service and use its systemId
  if (provides.length > 0) {
    for (const serviceName of provides) {
      for (const m of Object.values(PLUGIN_MANIFESTS)) {
        if (
          (m.contributes?.services?.includes(serviceName) ||
            (m.capabilities as readonly string[] | undefined)?.includes(serviceName)) &&
          m.systemId &&
          m.systemId in SYSTEM_LAYERS
        ) {
          return m.systemId as LayerId
        }
      }
    }
  }

  // 5. Fuzzy match against registered manifests by normalized identifier
  const clean = pluginId.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const m of Object.values(PLUGIN_MANIFESTS)) {
    const cleanId = m.id.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (cleanId.includes(clean) || clean.includes(cleanId.replace('bbebee', ''))) {
      if (m.systemId && m.systemId in SYSTEM_LAYERS) {
        return m.systemId as LayerId
      }
    }
  }

  // 6. Default to Feature (headless domain)
  return 'layer-4'
}
