import { describe, expect, it } from 'vitest'
import {
  computeReverseDependents,
  filterPlugins,
  flattenFiberNodes,
  matchesPluginId,
  normalizePluginId,
} from './plugins.js'

describe('toolkit: plugins', () => {
  describe('normalizePluginId', () => {
    it('strips the current @bbebee/ scope and the legacy @BBeBee/ scope', () => {
      expect(normalizePluginId('@bbebee/plugin-player')).toBe('plugin-player')
      expect(normalizePluginId('@bbebee/plugin-lyrics-ui-desktop')).toBe('plugin-lyrics-ui-desktop')
      expect(normalizePluginId('@bbebee/plugin-player')).toBe('plugin-player')
    })

    it('leaves unscoped identifiers intact', () => {
      expect(normalizePluginId('plugin-player')).toBe('plugin-player')
      expect(normalizePluginId('@custom/my-plugin')).toBe('@custom/my-plugin')
    })
  })

  describe('matchesPluginId', () => {
    it('matches exact and unscoped IDs', () => {
      expect(matchesPluginId('@bbebee/plugin-player', '@bbebee/plugin-player')).toBe(true)
      expect(matchesPluginId('plugin-player', '@bbebee/plugin-player')).toBe(true)
      expect(matchesPluginId('@bbebee/plugin-player', 'plugin-player')).toBe(true)
      expect(matchesPluginId('plugin-other', '@bbebee/plugin-player')).toBe(false)
    })

    it('matches targetName if supplied', () => {
      expect(matchesPluginId('player', '@bbebee/plugin-player', 'player')).toBe(true)
      expect(matchesPluginId('@BBeBee/player', '@bbebee/plugin-player', 'player')).toBe(true)
    })
  })

  describe('computeReverseDependents', () => {
    it('computes reverse dependents across items correctly', () => {
      const plugins = [
        { id: '@bbebee/plugin-player', dependencies: [] },
        { id: '@bbebee/plugin-lyrics', dependencies: ['@bbebee/plugin-player'] },
        { id: '@bbebee/plugin-queue', dependencies: ['plugin-player'] },
        { id: '@bbebee/plugin-unrelated', dependencies: [] },
      ]

      const dependentsMap = computeReverseDependents(plugins)

      expect(dependentsMap.get('@bbebee/plugin-player')).toEqual([
        '@bbebee/plugin-lyrics',
        '@bbebee/plugin-queue',
      ])
      expect(dependentsMap.get('@bbebee/plugin-lyrics')).toEqual([])
      expect(dependentsMap.get('@bbebee/plugin-queue')).toEqual([])
      expect(dependentsMap.get('@bbebee/plugin-unrelated')).toEqual([])
    })
  })

  describe('flattenFiberNodes', () => {
    it('flattens fiber tree and skips root/anonymous', () => {
      const tree = {
        name: 'root',
        children: [
          {
            name: 'plugin-player',
            children: [
              { name: 'anonymous', children: [] },
              { name: 'plugin-lyrics', children: [] },
            ],
          },
          {
            name: 'plugin-ui',
            children: [],
          },
        ],
      }

      const map = flattenFiberNodes(tree)
      expect(Array.from(map.keys())).toEqual(['plugin-player', 'plugin-lyrics', 'plugin-ui'])
      expect(map.get('plugin-player')?.name).toBe('plugin-player')
    })

    it('handles null/undefined gracefully', () => {
      const map = flattenFiberNodes(null)
      expect(map.size).toBe(0)
    })
  })

  describe('filterPlugins', () => {
    const list = [
      { id: '@bbebee/plugin-player', name: 'plugin-player', displayName: 'Player', moduleId: 'playback' },
      { id: '@bbebee/plugin-lyrics', name: 'plugin-lyrics', displayName: 'Lyrics', moduleId: 'lyrics' },
      { id: '@bbebee/plugin-theme', name: 'plugin-theme', displayName: 'Theme', moduleId: 'ui' },
    ]

    it('returns all when query is empty', () => {
      expect(filterPlugins(list, '')).toHaveLength(3)
      expect(filterPlugins(list, '   ')).toHaveLength(3)
    })

    it('filters case-insensitively across id, name, displayName, moduleId', () => {
      expect(filterPlugins(list, 'play')).toHaveLength(1)
      expect(filterPlugins(list, 'Lyrics')).toHaveLength(1)
      expect(filterPlugins(list, 'LYRICS')).toHaveLength(1)
      expect(filterPlugins(list, 'ui')).toHaveLength(1)
      expect(filterPlugins(list, 'nonexistent')).toHaveLength(0)
    })
  })
})
