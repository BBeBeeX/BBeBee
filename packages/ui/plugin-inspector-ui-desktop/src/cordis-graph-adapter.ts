/**
 * Cordis Runtime Graph Adapter.
 *
 * Extracts real-time architectural state from the live Cordis Context:
 * - Plugin Registry (`ctx.registry`)
 * - Fiber State & Effect Hierarchy (`ctx.inspector.snapshot()`)
 * - Service Registry (`ctx.reflect.store`)
 * - Event Bus Hooks (`ctx.events._hooks`)
 * - Manifest Standards (`PLUGIN_MANIFESTS`)
 *
 * Produces the normalized `PluginGraph` data structure without modifying
 * or driving the Cordis kernel.
 */

import type { Context, Fiber } from 'cordis'
import { fiberStateName } from '@BBeBee/kernel'
import type {
  EventNode,
  GraphEdge,
  PluginGraph,
  PluginNode,
  PluginStatus,
  ServiceNode,
} from './graph-model.js'
import { ALL_LAYER_IDS, SYSTEM_LAYERS, getLayerInfo, resolvePluginLayer } from './layer-resolver.js'
import { PLUGIN_MANIFESTS } from './pcb-manifests.generated.js'
import type { FiberNode, InspectorSnapshot } from '@BBeBee/plugin-inspector'

export class CordisGraphAdapter {
  private readonly ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /**
   * Produce a complete, live snapshot of the Cordis architecture.
   */
  getGraph(): PluginGraph {
    // 1. Obtain fiber tree snapshot from ctx.inspector if available,
    // or reconstruct defensively from registry.
    let snapshot: InspectorSnapshot | null = null
    try {
      if (this.ctx.inspector?.snapshot) {
        snapshot = this.ctx.inspector.snapshot()
      }
    } catch {
      snapshot = null
    }

    // 2. Discover all fibers across the runtime
    const fibersByName = new Map<string, Fiber>()
    try {
      for (const runtime of this.ctx.registry.values()) {
        for (const f of runtime.fibers) {
          if (f.name) fibersByName.set(f.name, f)
        }
      }
    } catch {
      // Defensive fallback if registry mutates during iteration
    }

    // 3. Service provider mapping from ctx.reflect.store
    const serviceProviders = new Map<string, string>() // serviceName -> pluginName
    const providedByFiber = new Map<string, string[]>() // pluginName -> serviceNames
    try {
      const reflectStore = (
        this.ctx.reflect as unknown as {
          store?: Record<symbol, { name: string; fiber: Fiber }>
        }
      )?.store
      if (reflectStore) {
        for (const sym of Object.getOwnPropertySymbols(reflectStore)) {
          const entry = reflectStore[sym]
          if (entry?.name && entry.fiber?.name) {
            const serviceName = entry.name
            const pluginName = entry.fiber.name
            serviceProviders.set(serviceName, pluginName)

            const list = providedByFiber.get(pluginName) ?? []
            if (!list.includes(serviceName)) list.push(serviceName)
            providedByFiber.set(pluginName, list)
          }
        }
      }
    } catch {
      // Fallback
    }

    // 4. Flatten fiber nodes from snapshot or discovered fibers
    const pluginNodesMap = new Map<string, PluginNode>()
    const processedFibers = new Set<string>()

    const ingestFiberNode = (fn: FiberNode) => {
      if (processedFibers.has(fn.name)) return
      processedFibers.add(fn.name)

      const manifest = PLUGIN_MANIFESTS[fn.name] ?? PLUGIN_MANIFESTS[`@BBeBee/${fn.name}`]
      const layerId = resolvePluginLayer(fn.name, manifest)
      const layer = getLayerInfo(layerId)

      const provides = Array.from(
        new Set([...(fn.provides ?? []), ...(providedByFiber.get(fn.name) ?? [])]),
      ).sort()

      const requires = (fn.inject ?? []).slice().sort()
      const waitingFor = (fn.waitingFor ?? []).slice().sort()

      const effectsList = (fn.effects ?? []).map((eff) => ({
        label: eff.label,
        count: 1 + (eff.children ? eff.children.length : 0),
      }))

      const displayName =
        manifest?.displayName ??
        fn.name
          .replace(/^@BBeBee\//, '')
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')

      const status: PluginStatus =
        fn.state === 'ACTIVE'
          ? 'ACTIVE'
          : fn.state === 'PENDING'
            ? 'PENDING'
            : fn.state === 'LOADING'
              ? 'LOADING'
              : fn.state === 'FAILED'
                ? 'FAILED'
                : fn.state === 'DISPOSED'
                  ? 'DISPOSED'
                  : fn.state === 'UNLOADING'
                    ? 'UNLOADING'
                    : 'UNKNOWN'

      const pluginNode: PluginNode = {
        id: fn.name,
        name: fn.name,
        displayName,
        version: manifest?.version ?? '0.0.0',
        layer: layerId,
        layerName: layer.name,
        moduleId: manifest?.moduleId ?? 'core',
        status,
        description: manifest?.description,
        provides,
        requires,
        waitingFor,
        dependencies: manifest?.dependencies ? [...manifest.dependencies] : [],
        eventsListened: [],
        effects: effectsList,
        fiberUid: fn.uid,
      }

      pluginNodesMap.set(fn.name, pluginNode)

      if (fn.children) {
        for (const child of fn.children) {
          ingestFiberNode(child)
        }
      }
    }

    if (snapshot?.root) {
      ingestFiberNode(snapshot.root)
    }

    // Ingest any fibers that might be in registry but omitted from snapshot
    for (const [name, fiber] of fibersByName.entries()) {
      if (!pluginNodesMap.has(name)) {
        const manifest = PLUGIN_MANIFESTS[name] ?? PLUGIN_MANIFESTS[`@BBeBee/${name}`]
        const layerId = resolvePluginLayer(name, manifest)
        const layer = getLayerInfo(layerId)
        const stateName = fiberStateName(fiber.state)
        const provides = providedByFiber.get(name) ?? []
        const requires = Object.keys(fiber.inject ?? {})

        pluginNodesMap.set(name, {
          id: name,
          name,
          displayName: manifest?.displayName ?? name,
          version: manifest?.version ?? '0.0.0',
          layer: layerId,
          layerName: layer.name,
          moduleId: manifest?.moduleId ?? 'core',
          status: stateName as PluginStatus,
          description: manifest?.description,
          provides,
          requires,
          waitingFor: [],
          dependencies: manifest?.dependencies ? [...manifest.dependencies] : [],
          eventsListened: [],
          effects: [],
          fiberUid: fiber.uid,
        })
      }
    }

    // Ensure root fiber node is always present
    if (!pluginNodesMap.has('root')) {
      pluginNodesMap.set('root', {
        id: 'root',
        name: 'root',
        displayName: 'Cordis Root Context',
        version: '4.0.0-rc.9',
        layer: 'layer-1',
        layerName: 'Kernel',
        moduleId: 'kernel',
        status: 'ACTIVE',
        description: 'Root Context and Dependency Injection Container',
        provides: ['registry', 'events', 'reflect'],
        requires: [],
        waitingFor: [],
        dependencies: [],
        eventsListened: [],
        effects: [],
        fiberUid: 0,
      })
    }

    // 5. Discover Event Hooks and associate with plugins
    const eventNodesMap = new Map<string, EventNode>()
    try {
      const hooks = (this.ctx.events as unknown as { _hooks?: Record<string, { ctx?: Context }[]> })
        ?._hooks
      if (hooks) {
        for (const [eventName, hookList] of Object.entries(hooks)) {
          if (!Array.isArray(hookList) || hookList.length === 0) continue
          // Filter out internal high-frequency lifecycle hooks from the main graph to reduce clutter
          if (eventName.startsWith('internal/dispatch') || eventName.startsWith('internal/get')) {
            continue
          }

          const listeners: string[] = []
          for (const hook of hookList) {
            const listenerFiberName = hook.ctx?.fiber?.name
            if (listenerFiberName && !listeners.includes(listenerFiberName)) {
              listeners.push(listenerFiberName)
              const p = pluginNodesMap.get(listenerFiberName)
              if (p && !p.eventsListened.includes(eventName)) {
                p.eventsListened.push(eventName)
              }
            }
          }

          eventNodesMap.set(eventName, {
            id: `event:${eventName}`,
            name: eventName,
            listenersCount: hookList.length,
            listeners,
          })
        }
      }
    } catch {
      // Defensive fallback
    }

    // 6. Build Service Nodes
    const serviceNodesMap = new Map<string, ServiceNode>()
    for (const [name, p] of pluginNodesMap.entries()) {
      for (const prov of p.provides) {
        if (!serviceNodesMap.has(prov)) {
          serviceNodesMap.set(prov, {
            id: `service:${prov}`,
            name: prov,
            provider: name,
            consumers: [],
            status: 'ACTIVE',
          })
        } else {
          const s = serviceNodesMap.get(prov)!
          s.provider = name
          s.status = 'ACTIVE'
        }
      }

      for (const req of p.requires) {
        let s = serviceNodesMap.get(req)
        if (!s) {
          s = {
            id: `service:${req}`,
            name: req,
            provider: serviceProviders.get(req),
            consumers: [],
            status: serviceProviders.has(req) ? 'ACTIVE' : 'UNAVAILABLE',
          }
          serviceNodesMap.set(req, s)
        }
        if (!s.consumers.includes(name)) {
          s.consumers.push(name)
        }
      }
    }

    // 7. Synthesize Graph Edges
    const edges: GraphEdge[] = []
    const edgeKeySet = new Set<string>()

    const addEdge = (edge: GraphEdge) => {
      const key = `${edge.type}:${edge.source}->${edge.target}`
      if (edgeKeySet.has(key)) return
      edgeKeySet.add(key)
      edges.push(edge)
    }

    // A. Plugin -> Service provides edges
    for (const s of serviceNodesMap.values()) {
      if (s.provider && pluginNodesMap.has(s.provider)) {
        addEdge({
          id: `edge:prov:${s.provider}->${s.id}`,
          source: s.provider,
          target: s.id,
          type: 'service',
          label: 'provides',
        })
      }

      // Service -> Plugin consumers requires edges
      for (const c of s.consumers) {
        if (pluginNodesMap.has(c)) {
          addEdge({
            id: `edge:req:${s.id}->${c}`,
            source: s.id,
            target: c,
            type: 'service',
            label: 'requires',
          })
        }
      }
    }

    // B. Direct Plugin-to-Plugin dependency edges
    for (const p of pluginNodesMap.values()) {
      for (const dep of p.dependencies) {
        const shortDep = dep.replace(/^@BBeBee\//, '')
        const targetId = pluginNodesMap.has(dep) ? dep : pluginNodesMap.has(shortDep) ? shortDep : null
        if (targetId && targetId !== p.id) {
          const isUiRel =
            p.layer === 'layer-5' ||
            p.id.includes('-ui-') ||
            targetId.includes('-ui-')

          addEdge({
            id: `edge:dep:${p.id}->${targetId}`,
            source: targetId,
            target: p.id,
            type: isUiRel ? 'ui' : 'dependency',
            label: isUiRel ? 'view for' : 'depends on',
          })
        }
      }
    }

    // C. Event listener edges
    for (const ev of eventNodesMap.values()) {
      for (const listener of ev.listeners) {
        if (pluginNodesMap.has(listener)) {
          addEdge({
            id: `edge:ev:${ev.id}->${listener}`,
            source: ev.id,
            target: listener,
            type: 'event',
            label: 'listens to',
          })
        }
      }
    }

    // 8. Calculate statistics
    const plugins = Array.from(pluginNodesMap.values())
    const services = Array.from(serviceNodesMap.values())
    const events = Array.from(eventNodesMap.values())

    const counts = {
      totalPlugins: plugins.length,
      activePlugins: plugins.filter((p) => p.status === 'ACTIVE').length,
      pendingPlugins: plugins.filter((p) => p.status === 'PENDING').length,
      loadingPlugins: plugins.filter((p) => p.status === 'LOADING').length,
      failedPlugins: plugins.filter((p) => p.status === 'FAILED').length,
      disposedPlugins: plugins.filter((p) => p.status === 'DISPOSED').length,
      unknownPlugins: plugins.filter((p) => p.status === 'UNKNOWN').length,
      totalServices: services.length,
      totalEvents: events.length,
      totalEdges: edges.length,
    }

    const layers = ALL_LAYER_IDS.map((id) => SYSTEM_LAYERS[id])

    return {
      layers,
      plugins,
      services,
      events,
      edges,
      timestamp: Date.now(),
      counts,
    }
  }
}
