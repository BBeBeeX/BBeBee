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
    it('strips leading @BBeBee/ scope', () => {
      expect(normalizePluginId('@BBeBee/plugin-player')).toBe('plugin-player')
      expect(normalizePluginId('@BBeBee/plugin-lyrics-ui-desktop')).toBe('plugin-lyrics-ui-desktop')
    })

    it('leaves unscoped identifiers intact', () => {
      expect(normalizePluginId('plugin-player')).toBe('plugin-player')
      expect(normalizePluginId('@custom/my-plugin')).toBe('@custom/my-plugin')
    })
  })

  describe('matchesPluginId', () => {
    it('matches exact and unscoped IDs', () => {
      expect(matchesPluginId('@BBeBee/plugin-player', '@BBeBee/plugin-player')).toBe(true)
      expect(matchesPluginId('plugin-player', '@BBeBee/plugin-player')).toBe(true)
      expect(matchesPluginId('@BBeBee/plugin-player', 'plugin-player')).toBe(true)
      expect(matchesPluginId('plugin-other', '@BBeBee/plugin-player')).toBe(false)
    })

    it('matches targetName if supplied', () => {
      expect(matchesPluginId('player', '@BBeBee/plugin-player', 'player')).toBe(true)
      expect(matchesPluginId('@BBeBee/player', '@BBeBee/plugin-player', 'player')).toBe(true)
    })
  })

  describe('computeReverseDependents', () => {
    it('computes reverse dependents across items correctly', () => {
      const plugins = [
        { id: '@BBeBee/plugin-player', dependencies: [] },
        { id: '@BBeBee/plugin-lyrics', dependencies: ['@BBeBee/plugin-player'] },
        { id: '@BBeBee/plugin-queue', dependencies: ['plugin-player'] },
        { id: '@BBeBee/plugin-unrelated', dependencies: [] },
      ]

      const dependentsMap = computeReverseDependents(plugins)

      expect(dependentsMap.get('@BBeBee/plugin-player')).toEqual([
        '@BBeBee/plugin-lyrics',
        '@BBeBee/plugin-queue',
      ])
      expect(dependentsMap.get('@BBeBee/plugin-lyrics')).toEqual([])
      expect(dependentsMap.get('@BBeBee/plugin-queue')).toEqual([])
      expect(dependentsMap.get('@BBeBee/plugin-unrelated')).toEqual([])
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
      { id: '@BBeBee/plugin-player', name: 'plugin-player', displayName: '播放器', moduleId: 'playback' },
      { id: '@BBeBee/plugin-lyrics', name: 'plugin-lyrics', displayName: '歌词', moduleId: 'lyrics' },
      { id: '@BBeBee/plugin-theme', name: 'plugin-theme', displayName: '主题', moduleId: 'ui' },
    ]

    it('returns all when query is empty', () => {
      expect(filterPlugins(list, '')).toHaveLength(3)
      expect(filterPlugins(list, '   ')).toHaveLength(3)
    })

    it('filters case-insensitively across id, name, displayName, moduleId', () => {
      expect(filterPlugins(list, 'play')).toHaveLength(1)
      expect(filterPlugins(list, '歌词')).toHaveLength(1)
      expect(filterPlugins(list, 'LYRICS')).toHaveLength(1)
      expect(filterPlugins(list, 'ui')).toHaveLength(1)
      expect(filterPlugins(list, 'nonexistent')).toHaveLength(0)
    })
  })
})
