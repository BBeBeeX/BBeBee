import { describe, expect, it } from 'vitest'
import { ARCH_NODES, findNodeManifest, mapSnapshotToTopology } from './pcb-topology-data.js'
import { PLUGIN_MANIFESTS } from './pcb-manifests.generated.js'
import type { InspectorSnapshot } from '@BBeBee/plugin-inspector'

describe('PCB Topology Manifest Integration', () => {
  it('exposes PLUGIN_MANIFESTS with standard 13 fields', () => {
    expect(Object.keys(PLUGIN_MANIFESTS).length).toBeGreaterThan(30)
    const sourcesManifest = PLUGIN_MANIFESTS['@BBeBee/plugin-sources']
    expect(sourcesManifest).toBeDefined()
    expect(sourcesManifest!.id).toBe('@BBeBee/plugin-sources')
    expect(sourcesManifest!.name).toBe('@BBeBee/plugin-sources')
    expect(sourcesManifest!.displayName).toBe('Sources')
    expect(sourcesManifest!.description).toBeDefined()
    expect(sourcesManifest!.version).toBe('0.0.0')
    expect(sourcesManifest!.author).toBe('BBeBee Team')
    expect(sourcesManifest!.engines).toEqual({ BBeBee: '^0.1.0' })
    expect(sourcesManifest!.enabled).toBe(true)
    expect(Array.isArray(sourcesManifest!.dependencies)).toBe(true)
    expect(sourcesManifest!.systemId).toBe('layer-4')
    expect(sourcesManifest!.moduleId).toBe('sources')
    expect(sourcesManifest!.entry).toBeDefined()
    expect(Array.isArray(sourcesManifest!.capabilities)).toBe(true)
    expect(typeof sourcesManifest!.contributes).toBe('object')
  })

  it('exposes UI package manifest with layer-5 and respective moduleId', () => {
    const uiManifest = PLUGIN_MANIFESTS['@BBeBee/plugin-sources-ui-desktop']
    expect(uiManifest).toBeDefined()
    expect(uiManifest!.systemId).toBe('layer-5')
    expect(uiManifest!.moduleId).toBe('sources')
    expect(uiManifest!.dependencies).toContain('@BBeBee/plugin-ui')
    expect(uiManifest!.dependencies).toContain('@BBeBee/plugin-sources')
  })

  it('resolves node manifests via findNodeManifest', () => {
    const sources = findNodeManifest('sources')
    expect(sources?.id).toBe('@BBeBee/plugin-sources')
    expect(sources?.systemId).toBe('layer-4')
    expect(sources?.moduleId).toBe('sources')

    const sourcesUi = findNodeManifest('sources-ui-bp')
    expect(sourcesUi?.id).toBe('@BBeBee/plugin-sources-ui-desktop')
    expect(sourcesUi?.systemId).toBe('layer-5')
    expect(sourcesUi?.moduleId).toBe('sources')

    const player = findNodeManifest('player')
    expect(player?.id).toBe('@BBeBee/plugin-player')
    expect(player?.systemId).toBe('layer-4')
    expect(player?.moduleId).toBe('playback')
  })

  it('ensures every node in ARCH_NODES has systemId and moduleId', () => {
    for (const node of ARCH_NODES) {
      expect(node.systemId, `node ${node.id} missing systemId`).toBeDefined()
      expect(node.systemId).toMatch(/^layer-[1-5]$/)
      expect(node.moduleId, `node ${node.id} missing moduleId`).toBeDefined()
    }
  })

  it('propagates systemId and moduleId through mapSnapshotToTopology and satellites', () => {
    const mockSnapshot: InspectorSnapshot = {
      counts: {
        ACTIVE: 2,
        PENDING: 0,
        DISPOSED: 0,
        FAILED: 0,
        LOADING: 0,
        UNLOADING: 0,
        UNKNOWN: 0,
      },
      stalled: [],
      root: {
        name: 'root',
        state: 'ACTIVE',
        uid: 1,
        inject: [],
        waitingFor: [],
        provides: [],
        effects: [],
        children: [
          {
            name: 'plugin-player',
            state: 'ACTIVE',
            uid: 2,
            inject: [],
            waitingFor: [],
            provides: ['player'],
            effects: [],
            children: [
              {
                name: 'player-child-worker',
                state: 'ACTIVE',
                uid: 3,
                inject: [],
                waitingFor: [],
                provides: [],
                effects: [],
                children: [],
              },
            ],
          },
        ],
      },
    }

    const mapped = mapSnapshotToTopology(mockSnapshot, ARCH_NODES, 3, null, 'player')
    const playerNode = mapped.find((n) => n.id === 'player')
    expect(playerNode).toBeDefined()
    expect(playerNode?.systemId).toBe('layer-4')
    expect(playerNode?.moduleId).toBe('playback')
    expect(playerNode?.manifest?.id).toBe('@BBeBee/plugin-player')

    const satellite = mapped.find((n) => n.id.startsWith('satellite-player'))
    expect(satellite).toBeDefined()
    expect(satellite?.systemId).toBe('layer-4')
    expect(satellite?.moduleId).toBe('playback')
  })
})
