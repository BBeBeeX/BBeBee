import { describe, expect, it } from 'vitest'
import {
  buildTopologyFromSnapshot,
  inferLayer,
  inferModule,
  mapSnapshotToTopology,
} from './pcb-topology-data.js'
import type { InspectorSnapshot } from '@BBeBee/plugin-inspector'

describe('Dynamic PCB Topology Generation from Live Runtime Snapshot', () => {
  const mockSnapshot: InspectorSnapshot = {
    counts: {
      ACTIVE: 4,
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
          name: 'core-audio-mpv',
          state: 'ACTIVE',
          uid: 2,
          inject: [],
          waitingFor: [],
          provides: ['audio'],
          effects: [],
          children: [],
        },
        {
          name: 'plugin-player',
          state: 'ACTIVE',
          uid: 3,
          inject: ['audio'],
          waitingFor: [],
          provides: ['player'],
          effects: [],
          children: [
            {
              name: 'player-child-worker',
              state: 'ACTIVE',
              uid: 10,
              inject: [],
              waitingFor: [],
              provides: [],
              effects: [],
              children: [],
            },
          ],
        },
        {
          name: 'plugin-now-playing-ui-desktop',
          state: 'ACTIVE',
          uid: 4,
          inject: ['player', 'ui'],
          waitingFor: [],
          provides: [],
          effects: [],
          children: [],
        },
      ],
    },
  }

  it('dynamically generates nodes from live snapshot across the 5 layer strata without hardcoding', () => {
    const topology = buildTopologyFromSnapshot(mockSnapshot, 1, null)
    expect(topology.nodes.length).toBe(5)

    // Layer 1: Kernel Root
    const rootNode = topology.nodes.find((n) => n.id === 'root')
    expect(rootNode).toBeDefined()
    expect(rootNode?.layer).toBe(1)
    expect(rootNode?.systemId).toBe('layer-1')

    // Layer 2: Core Capability Service
    const audioNode = topology.nodes.find((n) => n.id === 'core-audio-mpv')
    expect(audioNode).toBeDefined()
    expect(audioNode?.layer).toBe(2)
    expect(audioNode?.systemId).toBe('layer-2')
    expect(audioNode?.fiber?.provides).toContain('audio')

    // Layer 4: Feature Plugin
    const playerNode = topology.nodes.find((n) => n.id === 'player')
    expect(playerNode).toBeDefined()
    expect(playerNode?.layer).toBe(4)
    expect(playerNode?.systemId).toBe('layer-4')
    expect(playerNode?.moduleId).toBe('playback')
    expect(playerNode?.fiber?.provides).toContain('player')
    expect(playerNode?.fiber?.inject).toContain('audio')

    // Layer 5: UI Plugin
    const uiNode = topology.nodes.find((n) => n.id === 'now-playing-ui-desktop')
    expect(uiNode).toBeDefined()
    expect(uiNode?.layer).toBe(5)
    expect(uiNode?.systemId).toBe('layer-5')
    expect(uiNode?.moduleId).toBe('playback')
  })

  it('dynamically computes traces connecting nodes to what they depend on AND what depends on them', () => {
    const topology = buildTopologyFromSnapshot(mockSnapshot, 1, null)
    const traces = topology.traces

    // 1. Dependency link: core-audio-mpv (provider) -> player (consumer of 'audio')
    const audioToPlayer = traces.find(
      (t) => t.fromNodeId === 'core-audio-mpv' && t.toNodeId === 'player',
    )
    expect(audioToPlayer).toBeDefined()
    expect(audioToPlayer?.label).toBe('audio')
    expect(audioToPlayer?.category).toBe('dependency')

    // 2. Dependency link: player (provider) -> now-playing-ui-desktop (consumer of 'player')
    const playerToUi = traces.find(
      (t) => t.fromNodeId === 'player' && t.toNodeId === 'now-playing-ui-desktop',
    )
    expect(playerToUi).toBeDefined()
    expect(playerToUi?.label).toBe('player')

    // 3. Verify bidirectional connection query for 'player':
    // - Dependencies it depends on (incoming): core-audio-mpv -> player
    // - Dependents that depend on it (outgoing): player -> now-playing-ui-desktop
    // - Fiber tree leads: root -> player, player -> player-child-worker
    const playerTraces = traces.filter((t) => t.fromNodeId === 'player' || t.toNodeId === 'player')
    expect(playerTraces.length).toBe(4)

    // Upstream dependency (services it injects): core-audio-mpv
    const incomingDependencies = playerTraces.filter(
      (t) => t.toNodeId === 'player' && t.category === 'dependency',
    )
    expect(incomingDependencies.map((t) => t.fromNodeId)).toEqual(['core-audio-mpv'])

    // Downstream dependent (services that inject it): now-playing-ui-desktop
    const outgoingDependents = playerTraces.filter(
      (t) => t.fromNodeId === 'player' && t.category === 'dependency',
    )
    expect(outgoingDependents.map((t) => t.toNodeId)).toEqual(['now-playing-ui-desktop'])

    // Fiber tree hierarchy
    const fiberTreeLeads = playerTraces.filter((t) => t.category === 'control')
    expect(fiberTreeLeads.length).toBe(2)
  })

  it('dynamically orbits satellite child fibers around the selected node at ViewLevel 3', () => {
    const topology = buildTopologyFromSnapshot(mockSnapshot, 3, 'player')
    const satellites = topology.nodes.filter((n) => n.kind === 'satellite')
    expect(satellites.length).toBe(1)
    expect(satellites[0]?.parentPluginId).toBe('player')
    expect(satellites[0]?.name).toBe('player-child-worker')
    expect(satellites[0]?.layer).toBe(4)
    expect(satellites[0]?.systemId).toBe('layer-4')
  })

  it('supports backwards-compatible mapSnapshotToTopology without hardcoded manifest files', () => {
    const nodes = mapSnapshotToTopology(mockSnapshot, undefined, 1, null, null)
    expect(nodes.length).toBe(5)
    expect(nodes.map((n) => n.id)).toContain('player')
    expect(nodes.map((n) => n.id)).toContain('core-audio-mpv')
  })

  it('correctly infers layers and modules dynamically from fiber properties', () => {
    expect(inferLayer({ name: 'core-db-sqlite', uid: 5, state: 'ACTIVE', inject: [], waitingFor: [], provides: ['db'], effects: [], children: [] }).layer).toBe(2)
    expect(inferLayer({ name: 'plugin-log-console', uid: 6, state: 'ACTIVE', inject: [], waitingFor: [], provides: ['logger'], effects: [], children: [] }).layer).toBe(3)
    expect(inferLayer({ name: 'plugin-sources', uid: 7, state: 'ACTIVE', inject: [], waitingFor: [], provides: ['sources'], effects: [], children: [] }).layer).toBe(4)
    expect(inferLayer({ name: 'plugin-sources-ui-desktop', uid: 8, state: 'ACTIVE', inject: ['sources'], waitingFor: [], provides: [], effects: [], children: [] }).layer).toBe(5)

    expect(inferModule({ name: 'plugin-sources', uid: 7, state: 'ACTIVE', inject: [], waitingFor: [], provides: ['sources'], effects: [], children: [] }, 4).moduleId).toBe('sources')
    expect(inferModule({ name: 'plugin-player', uid: 3, state: 'ACTIVE', inject: ['audio'], waitingFor: [], provides: ['player'], effects: [], children: [] }, 4).moduleId).toBe('playback')
  })

  it('merges multiple fibers with the same name into a single node and combines their dependencies', () => {
    const duplicateSnapshot: InspectorSnapshot = {
      counts: { ACTIVE: 3, PENDING: 0, DISPOSED: 0, FAILED: 0, LOADING: 0, UNLOADING: 0, UNKNOWN: 0 },
      stalled: [],
      root: {
        name: 'root',
        state: 'ACTIVE',
        uid: 0,
        inject: [],
        waitingFor: [],
        provides: [],
        effects: [],
        children: [
          {
            name: 'plugin-player',
            state: 'ACTIVE',
            uid: 1,
            inject: ['audio'],
            waitingFor: [],
            provides: ['player'],
            effects: [{ label: 'effect-1', children: [] }],
            children: [],
          },
          {
            name: 'plugin-player',
            state: 'ACTIVE',
            uid: 2,
            inject: ['store', 'audio'],
            waitingFor: [],
            provides: [],
            effects: [{ label: 'effect-2', children: [] }],
            children: [],
          },
        ],
      },
    }

    const topology = buildTopologyFromSnapshot(duplicateSnapshot)
    // root (1) + merged player (1) = 2 nodes
    expect(topology.nodes.length).toBe(2)

    const playerNode = topology.nodes.find((n) => n.id === 'player')
    expect(playerNode).toBeDefined()
    // Combined provides: ['player']
    expect(playerNode?.fiber?.provides).toEqual(['player'])
    // Combined inject: ['audio', 'store']
    expect(playerNode?.fiber?.inject).toContain('audio')
    expect(playerNode?.fiber?.inject).toContain('store')
    // Combined effects: 2
    expect(playerNode?.fiber?.effects.length).toBe(2)
  })

  it('merges multiple fibers providing the same Service into a single service node', () => {
    const sameServiceSnapshot: InspectorSnapshot = {
      counts: { ACTIVE: 3, PENDING: 0, DISPOSED: 0, FAILED: 0, LOADING: 0, UNLOADING: 0, UNKNOWN: 0 },
      stalled: [],
      root: {
        name: 'root',
        state: 'ACTIVE',
        uid: 0,
        inject: [],
        waitingFor: [],
        provides: [],
        effects: [],
        children: [
          {
            name: 'core-audio-mpv',
            state: 'ACTIVE',
            uid: 10,
            inject: [],
            waitingFor: [],
            provides: ['audio'],
            effects: [],
            children: [],
          },
          {
            name: 'core-audio-webaudio',
            state: 'ACTIVE',
            uid: 11,
            inject: [],
            waitingFor: [],
            provides: ['audio'],
            effects: [],
            children: [],
          },
        ],
      },
    }

    const topology = buildTopologyFromSnapshot(sameServiceSnapshot)
    // root (1) + merged audio service (1) = 2 nodes
    expect(topology.nodes.length).toBe(2)
    const audioNode = topology.nodes.find((n) => n.fiber?.provides?.includes('audio'))
    expect(audioNode).toBeDefined()
    expect(audioNode?.layer).toBe(2)
  })

  it('merges fibers belonging to the same Plugin and eliminates self-dependency loops', () => {
    const samePluginSnapshot: InspectorSnapshot = {
      counts: { ACTIVE: 3, PENDING: 0, DISPOSED: 0, FAILED: 0, LOADING: 0, UNLOADING: 0, UNKNOWN: 0 },
      stalled: [],
      root: {
        name: 'root',
        state: 'ACTIVE',
        uid: 0,
        inject: [],
        waitingFor: [],
        provides: [],
        effects: [],
        children: [
          {
            name: '@BBeBee/plugin-lyrics',
            state: 'ACTIVE',
            uid: 20,
            inject: ['player'],
            waitingFor: [],
            provides: ['lyrics'],
            effects: [],
            children: [
              {
                name: 'plugin-lyrics',
                state: 'ACTIVE',
                uid: 21,
                // Injected 'lyrics' is provided by parent; should be filtered out to prevent self-loop
                inject: ['lyrics', 'store'],
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

    const topology = buildTopologyFromSnapshot(samePluginSnapshot)
    // root (1) + merged lyrics (1) = 2 nodes
    expect(topology.nodes.length).toBe(2)
    const lyricsNode = topology.nodes.find((n) => n.id === 'lyrics')
    expect(lyricsNode).toBeDefined()
    expect(lyricsNode?.fiber?.provides).toEqual(['lyrics'])
    // 'lyrics' was provided by the group, so it must NOT be in inject
    expect(lyricsNode?.fiber?.inject).not.toContain('lyrics')
    expect(lyricsNode?.fiber?.inject).toContain('player')
    expect(lyricsNode?.fiber?.inject).toContain('store')

    // Traces should have NO self loops from lyrics -> lyrics
    const selfLoops = topology.traces.filter((t) => t.fromNodeId === t.toNodeId)
    expect(selfLoops.length).toBe(0)
  })
})
