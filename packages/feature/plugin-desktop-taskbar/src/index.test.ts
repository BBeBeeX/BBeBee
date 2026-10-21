import { describe, expect, it, vi } from 'vitest'
import type { Context } from 'cordis'
import {
  apply,
  computeTaskbarState,
  name,
  inject,
  type TaskbarBridge,
  type TaskbarState,
} from './index.js'

describe('plugin-desktop-taskbar', () => {
  it('declares correct name and dependencies', () => {
    expect(name).toBe('plugin-desktop-taskbar')
    expect(inject).toEqual(['player'])
  })

  describe('computeTaskbarState', () => {
    it('computes idle state correctly when player is empty', () => {
      const mockCtx = {
        player: {
          state: {
            status: 'idle',
            currentItemId: undefined,
            trackUrn: undefined,
            positionMs: 0,
            durationMs: 0,
            bufferedMs: 0,
            volume: 1,
            muted: false,
            repeat: 'off',
            shuffle: false,
            playMode: 'sequence',
          },
          queue: [],
        },
      } as unknown as Context

      const result = computeTaskbarState(mockCtx)
      expect(result).toEqual({
        isPlaying: false,
        canPlayOrPause: false,
        canPrevious: false,
        canNext: false,
        isFavorite: false,
        canFavorite: false,
        title: undefined,
        artist: undefined,
      })
    })

    it('computes playing state correctly with track metadata and queue', () => {
      const mockCtx = {
        player: {
          state: {
            status: 'playing',
            currentItemId: 'item-1',
            trackUrn: 'urn:track:local:1',
            nowPlaying: {
              title: 'Test Track',
              artist: 'Test Artist',
            },
          },
          queue: [{ id: 'item-1', trackUrn: 'urn:track:local:1', addedBy: 'user' }],
        },
      } as unknown as Context

      const result = computeTaskbarState(mockCtx, true)
      expect(result).toEqual({
        isPlaying: true,
        canPlayOrPause: true,
        canPrevious: true,
        canNext: true,
        isFavorite: true,
        canFavorite: true,
        title: 'Test Track',
        artist: 'Test Artist',
      })
    })

    it('computes paused state correctly', () => {
      const mockCtx = {
        player: {
          state: {
            status: 'paused',
            currentItemId: 'item-1',
            trackUrn: 'urn:track:local:1',
            nowPlaying: {
              title: 'Paused Track',
              artist: 'Artist',
            },
          },
          queue: [{ id: 'item-1', trackUrn: 'urn:track:local:1', addedBy: 'user' }],
        },
      } as unknown as Context

      const result = computeTaskbarState(mockCtx)
      expect(result.isPlaying).toBe(false)
      expect(result.canPlayOrPause).toBe(true)
      expect(result.isFavorite).toBe(false)
      expect(result.canFavorite).toBe(true)
      expect(result.title).toBe('Paused Track')
    })
  })

  describe('apply lifecycle and actions', () => {
    it('attaches to bridge, syncs state, handles actions, and cleans up on dispose', async () => {
      let actionHandler: ((action: 'togglePlay' | 'previous' | 'next' | 'toggleFavorite') => void) | undefined
      const updatedStates: TaskbarState[] = []

      const offActionSpy = vi.fn()
      const mockBridge: TaskbarBridge = {
        update: vi.fn(async (state: TaskbarState) => {
          updatedStates.push(state)
        }),
        onAction: vi.fn((cb) => {
          actionHandler = cb
          return offActionSpy
        }),
      }

      // Setup window.BBeBee.taskbar
      const originalWindow = globalThis.window
      globalThis.window = {
        BBeBee: {
          taskbar: mockBridge,
        },
      } as unknown as Window & typeof globalThis

      const mockPlayer = {
        state: {
          status: 'playing',
          currentItemId: 'item-1',
          trackUrn: 'urn:track:local:1',
          nowPlaying: { title: 'Song 1', artist: 'Artist 1' },
        },
        queue: [{ id: 'item-1', trackUrn: 'urn:track:local:1', addedBy: 'user' }],
        togglePlay: vi.fn(),
        previous: vi.fn(async () => {}),
        next: vi.fn(async () => {}),
      }

      const mockLibrary = {
        isSaved: vi.fn(async () => false),
        setSaved: vi.fn(async () => {}),
      }
      const mockSources = {
        setLoved: vi.fn(async () => {}),
      }

      const eventListeners: Record<string, () => void> = {}
      const offSpies: Record<string, ReturnType<typeof vi.fn>> = {}

      const mockCtx = {
        logger: {
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn(),
        },
        player: mockPlayer,
        on: vi.fn((event: string, cb: () => void) => {
          eventListeners[event] = cb
          const off = vi.fn()
          offSpies[event] = off
          return off
        }),
        inject: vi.fn((keys: string[], cb: (scoped: any) => () => void) => {
          if (keys.includes('library')) {
            cb({ library: mockLibrary })
          }
          if (keys.includes('sources')) {
            cb({ sources: mockSources })
          }
          return { dispose: vi.fn() }
        }),
      } as unknown as Context

      try {
        const dispose = await apply(mockCtx)

        // 1. Initial sync called
        expect(mockBridge.update).toHaveBeenCalled()
        expect(updatedStates[0]?.isPlaying).toBe(true)
        expect(updatedStates[0]?.title).toBe('Song 1')

        // 2. Action handling
        expect(actionHandler).toBeDefined()
        actionHandler?.('togglePlay')
        expect(mockPlayer.togglePlay).toHaveBeenCalledTimes(1)

        actionHandler?.('previous')
        expect(mockPlayer.previous).toHaveBeenCalledTimes(1)

        actionHandler?.('next')
        expect(mockPlayer.next).toHaveBeenCalledTimes(1)

        actionHandler?.('toggleFavorite')
        expect(mockSources.setLoved).toHaveBeenCalledWith('urn:track:local:1', true)
        expect(mockLibrary.setSaved).toHaveBeenCalledWith('urn:track:local:1', true)

        // 3. Reacting to player state change
        mockPlayer.state.status = 'paused'
        eventListeners['player/state-changed']?.()
        expect(mockBridge.update).toHaveBeenCalled()
        expect(updatedStates[updatedStates.length - 1]?.isPlaying).toBe(false)

        // 4. Dispose
        dispose()
        expect(offActionSpy).toHaveBeenCalledTimes(1)
        expect(offSpies['player/state-changed']).toHaveBeenCalledTimes(1)
        expect(offSpies['player/track-changed']).toHaveBeenCalledTimes(1)
        expect(offSpies['queue/changed']).toHaveBeenCalledTimes(1)
        expect(offSpies['library/changed']).toHaveBeenCalledTimes(1)
      } finally {
        globalThis.window = originalWindow
      }
    })

    it('gracefully handles missing taskbar bridge without throwing', async () => {
      const originalWindow = globalThis.window
      globalThis.window = undefined as unknown as Window & typeof globalThis

      const mockCtx = {
        logger: {
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn(),
        },
        player: {
          state: { status: 'idle' },
          queue: [],
        },
        on: vi.fn(),
      } as unknown as Context

      try {
        const dispose = await apply(mockCtx)
        expect(typeof dispose).toBe('function')
        dispose()
      } finally {
        globalThis.window = originalWindow
      }
    })
  })
})
