/**
 * `plugin-desktop-taskbar` — desktop taskbar and tray playback controls.
 *
 * Bridges `ctx.player` to the desktop host (`window.BBeBee.taskbar`):
 * - Keeps playback state in sync for Windows thumbnail toolbar buttons and the tray menu.
 * - Dispatches taskbar button actions (`togglePlay`, `previous`, `next`) to `ctx.player`.
 */

import type { Context } from 'cordis'
import type { LibraryService, SourcesService } from '@BBeBee/protocol'

export interface TaskbarState {
  isPlaying: boolean
  canPlayOrPause: boolean
  canPrevious: boolean
  canNext: boolean
  isFavorite?: boolean
  canFavorite?: boolean
  title?: string
  artist?: string
}

export interface TaskbarBridge {
  update(state: TaskbarState): Promise<void>
  onAction(
    callback: (action: 'togglePlay' | 'previous' | 'next' | 'toggleFavorite') => void,
  ): () => void
}

export const name = 'plugin-desktop-taskbar'
export const inject = ['player']

export function computeTaskbarState(ctx: Context, isFavorite?: boolean): TaskbarState {
  const player = ctx.player
  const state = player?.state
  const queue = player?.queue ?? []
  const isPlaying = state?.status === 'playing'
  const hasCurrent = Boolean(state?.trackUrn || state?.currentItemId)
  const canPlayOrPause = Boolean(
    hasCurrent || queue.length > 0 || (state?.status && state.status !== 'idle'),
  )
  const canPrevious = Boolean(hasCurrent || queue.length > 0)
  const canNext = Boolean(hasCurrent || queue.length > 0)
  const canFavorite = hasCurrent

  return {
    isPlaying,
    canPlayOrPause,
    canPrevious,
    canNext,
    isFavorite: hasCurrent ? Boolean(isFavorite) : false,
    canFavorite,
    title: state?.nowPlaying?.title,
    artist: state?.nowPlaying?.artist,
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-desktop-taskbar: loaded')

  const bridge: TaskbarBridge | undefined =
    typeof window !== 'undefined'
      ? (window as unknown as { BBeBee?: { taskbar?: TaskbarBridge } }).BBeBee?.taskbar
      : undefined

  if (!bridge) {
    ctx.logger.debug(
      'plugin-desktop-taskbar: taskbar bridge not available (non-desktop environment or testing)',
    )
    return () => {}
  }

  let currentLibrary: LibraryService | undefined
  let currentSources: SourcesService | undefined
  let currentFavorite = false

  const checkFavorite = async () => {
    const urn = ctx.player?.state?.trackUrn
    if (!urn) {
      currentFavorite = false
      return
    }
    if (currentLibrary?.isSaved) {
      try {
        const saved = await currentLibrary.isSaved(urn)
        currentFavorite = Boolean(saved)
        return
      } catch {
        // Fall back to sources
      }
    }
    if (currentSources?.getTracks) {
      try {
        const tracks = await currentSources.getTracks([urn])
        currentFavorite = Boolean(tracks[0]?.loved)
        return
      } catch {
        // Fall back to false
      }
    }
    currentFavorite = false
  }

  const sync = () => {
    try {
      const state = computeTaskbarState(ctx, currentFavorite)
      void bridge.update(state).catch((err: unknown) => {
        ctx.logger.warn('plugin-desktop-taskbar: failed to update taskbar', err)
      })
    } catch (err: unknown) {
      ctx.logger.warn('plugin-desktop-taskbar: failed to compute taskbar state', err)
    }
  }

  const syncWithFavorite = () => {
    void checkFavorite().then(() => {
      sync()
    })
  }

  // Initial sync
  syncWithFavorite()

  const offAction = bridge.onAction((action) => {
    ctx.logger.info('plugin-desktop-taskbar: action received: %s', action)
    if (action === 'togglePlay') {
      ctx.player.togglePlay()
    } else if (action === 'previous') {
      void ctx.player.previous().catch((err: unknown) => {
        ctx.logger.warn('plugin-desktop-taskbar: previous track failed', err)
      })
    } else if (action === 'next') {
      void ctx.player.next().catch((err: unknown) => {
        ctx.logger.warn('plugin-desktop-taskbar: next track failed', err)
      })
    } else if (action === 'toggleFavorite') {
      const urn = ctx.player?.state?.trackUrn
      if (urn) {
        const nextFavorite = !currentFavorite
        currentFavorite = nextFavorite
        sync()
        // Dual-write invariant: write sources first, then library
        if (currentSources?.setLoved) {
          void currentSources.setLoved(urn, nextFavorite).catch((err: unknown) => {
            ctx.logger.warn('plugin-desktop-taskbar: setLoved failed', err)
          })
        }
        if (currentLibrary?.setSaved) {
          void currentLibrary.setSaved(urn, nextFavorite).catch((err: unknown) => {
            ctx.logger.warn('plugin-desktop-taskbar: setSaved failed', err)
          })
        }
      }
    }
  })

  const offState = ctx.on('player/state-changed', () => sync())
  const offTrack = ctx.on('player/track-changed', () => syncWithFavorite())
  const offQueue = ctx.on('queue/changed', () => sync())
  const offLibrary = ctx.on('library/changed', () => syncWithFavorite())

  const libFiber = ctx.inject(['library'], (libCtx) => {
    currentLibrary = libCtx.library
    syncWithFavorite()
    return () => {
      currentLibrary = undefined
    }
  })

  const srcFiber = ctx.inject(['sources'], (srcCtx) => {
    currentSources = srcCtx.sources
    syncWithFavorite()
    return () => {
      currentSources = undefined
    }
  })

  return () => {
    ctx.logger.info('plugin-desktop-taskbar: disposing')
    offAction?.()
    offState()
    offTrack()
    offQueue()
    offLibrary()
    libFiber?.dispose?.()
    srcFiber?.dispose?.()
  }
}

export default { name, inject, apply }
