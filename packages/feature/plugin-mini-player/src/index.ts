/**
 * `plugin-mini-player` — headless state and controls for independent floating mini player and Dynamic Island.
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {
  MiniPlayerData,
  MiniPlayerAction,
  MiniPlayerDisplayMode,
  MiniPlayerService as IMiniPlayerService,
  MiniPlayerServiceState,
  PlayerService,
} from '@BBeBee/protocol'

export type {
  MiniPlayerData,
  MiniPlayerAction,
  MiniPlayerDisplayMode,
  MiniPlayerServiceState,
}

interface MiniPlayerBridge {
  open?(options?: { mode?: MiniPlayerDisplayMode }): Promise<void>
  close?(): Promise<void>
  restoreMain?(): Promise<void>
  setMode?(mode: MiniPlayerDisplayMode): Promise<void>
  getState?(): Promise<MiniPlayerServiceState>
  getData?(): Promise<MiniPlayerData | undefined>
  updateData?(data: MiniPlayerData): Promise<void>
  sendAction?(action: MiniPlayerAction): Promise<void>
  onData?(callback: (data: unknown) => void): () => void
  onState?(callback: (state: unknown) => void): () => void
  onAction?(callback: (action: unknown) => void): () => void
}

function getBridge(): MiniPlayerBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { BBeBee?: { miniPlayer?: MiniPlayerBridge } }).BBeBee?.miniPlayer
}

function resolveArtworkUri(transport: { nowPlaying?: { artworkUri?: string; artwork?: { sourceUrl?: string } } } | undefined): string | undefined {
  const raw =
    transport?.nowPlaying?.artworkUri ||
    transport?.nowPlaying?.artwork?.sourceUrl
  if (!raw) return undefined
  if (raw.startsWith('file://')) {
    return raw.replace(/^file:\/\//, 'bbebee-file://')
  }
  return raw
}

export class MiniPlayerService extends Service implements IMiniPlayerService {
  static inject = ['player']

  private readonly ownCtx: Context
  private currentState: MiniPlayerServiceState = {
    visible: false,
    mode: 'normal',
    windowState: 'hidden',
  }

  constructor(ctx: Context) {
    super(ctx, 'miniPlayer')
    this.ownCtx = ctx
  }

  async [Service.init]() {
    this.ownCtx.logger.info('plugin-mini-player: initialized')

    let offState: (() => void) | undefined
    let offAction: (() => void) | undefined

    const bridge = getBridge()

    if (bridge) {
      void bridge.getState?.().then((s: unknown) => {
        if (s && typeof s === 'object') {
          this.update(s as Partial<MiniPlayerServiceState>)
        }
      })

      offState = bridge.onState?.((state: unknown) => {
        if (state && typeof state === 'object') {
          this.update(state as Partial<MiniPlayerServiceState>)
        }
      })

      offAction = bridge.onAction?.((action: unknown) => {
        const act = action as MiniPlayerAction
        if (!act) return
        this.handleAction(act)
      })
    }

    // Connect to player service if present
    this.ownCtx.inject(['player'], (scoped: Context) => {
      const syncPlayerState = () => {
        const player = scoped.player as PlayerService | undefined
        const transport = player?.state
        const hasCurrent = Boolean(transport?.trackUrn || transport?.currentItemId)
        const queue = player?.queue ?? []

        const data: MiniPlayerData = {
          trackUrn: transport?.trackUrn,
          title: transport?.nowPlaying?.title ?? (hasCurrent ? 'Unknown Title' : 'No track playing'),
          artist: transport?.nowPlaying?.artist ?? 'BBeBee',
          album: transport?.nowPlaying?.album,
          artworkUri: resolveArtworkUri(transport),
          status: transport?.status ?? 'idle',
          positionMs: transport?.positionMs ?? 0,
          durationMs: transport?.durationMs ?? 0,
          canPlayOrPause: Boolean(hasCurrent || queue.length > 0 || (transport?.status && transport.status !== 'idle')),
          canPrevious: Boolean(hasCurrent || queue.length > 0),
          canNext: Boolean(hasCurrent || queue.length > 0),
          volume: transport?.volume ?? 1,
          muted: transport?.muted ?? false,
        }
        bridge?.updateData?.(data)
      }

      syncPlayerState()

      scoped.on('player/state-changed', syncPlayerState)
      scoped.on('player/track-changed', syncPlayerState)
      scoped.on('player/position', (pos, dur) => {
        const player = scoped.player as PlayerService | undefined
        const transport = player?.state
        const hasCurrent = Boolean(transport?.trackUrn || transport?.currentItemId)
        const queue = player?.queue ?? []

        bridge?.updateData?.({
          trackUrn: transport?.trackUrn,
          title: transport?.nowPlaying?.title ?? (hasCurrent ? 'Unknown Title' : 'No track playing'),
          artist: transport?.nowPlaying?.artist ?? 'BBeBee',
          album: transport?.nowPlaying?.album,
          artworkUri: resolveArtworkUri(transport),
          status: transport?.status ?? 'idle',
          positionMs: pos,
          durationMs: dur,
          canPlayOrPause: Boolean(hasCurrent || queue.length > 0 || (transport?.status && transport.status !== 'idle')),
          canPrevious: Boolean(hasCurrent || queue.length > 0),
          canNext: Boolean(hasCurrent || queue.length > 0),
          volume: transport?.volume ?? 1,
          muted: transport?.muted ?? false,
        })
      })
    })

    // Contribute commands via ctx.ui if available
    const open = () => this.open()
    const close = () => this.close()
    const toggle = () => this.toggle()
    const restoreMain = () => this.restoreMain()

    this.ownCtx.inject(['ui'], (scoped: Context) =>
      scoped.effect(function* () {
        scoped.logger.debug('mini-player: contributing commands')
        yield scoped.ui.contribute({
          kind: 'command',
          id: 'mini-player.open',
          title: 'Open mini player',
          run: open,
        })
        yield scoped.ui.contribute({
          kind: 'command',
          id: 'mini-player.close',
          title: 'Close mini player',
          run: close,
        })
        yield scoped.ui.contribute({
          kind: 'command',
          id: 'mini-player.toggle',
          title: 'Toggle mini player',
          run: toggle,
        })
        yield scoped.ui.contribute({
          kind: 'command',
          id: 'mini-player.restore-main',
          title: 'Restore main player',
          run: restoreMain,
        })
      }, 'mini-player-contributions'),
    )

    return () => {
      this.ownCtx.logger.info('plugin-mini-player: disposing')
      offState?.()
      offAction?.()
    }
  }

  get isSupported(): boolean {
    return Boolean(getBridge())
  }

  get state(): Readonly<MiniPlayerServiceState> {
    return this.currentState
  }

  private update(patch: Partial<MiniPlayerServiceState>): void {
    this.currentState = { ...this.currentState, ...patch }
    this.ownCtx.emit('mini-player/changed', this.currentState)
  }

  private handleAction(action: MiniPlayerAction): void {
    const player = (this.ctx as unknown as { player?: PlayerService }).player
    switch (action.type) {
      case 'togglePlay':
        player?.togglePlay?.()
        break
      case 'play':
        void player?.play?.()
        break
      case 'pause':
        player?.pause?.()
        break
      case 'previous':
        void player?.previous?.()
        break
      case 'next':
        void player?.next?.()
        break
      case 'seek':
        void player?.seek?.(action.positionMs)
        break
      case 'setVolume':
        player?.setVolume?.(action.volume)
        break
      case 'restoreMain':
        void this.restoreMain()
        break
      case 'close':
        void this.close()
        break
      case 'setMode':
        void this.setMode(action.mode)
        break
    }
  }

  async open(options?: { mode?: MiniPlayerDisplayMode }): Promise<void> {
    const bridge = getBridge()
    this.ctx.logger.info(`mini-player: open() called, hasBridge=${Boolean(bridge)}`)
    if (bridge) {
      try {
        await bridge.open?.(options)
        this.ctx.logger.info('mini-player: bridge.open resolved')
      } catch (e) {
        this.ctx.logger.error(`mini-player: bridge.open rejected: ${String(e)}`)
        throw e
      }
    } else {
      this.update({
        visible: true,
        mode: options?.mode ?? this.currentState.mode,
        windowState: options?.mode ?? 'normal',
      })
    }
  }

  async close(): Promise<void> {
    const bridge = getBridge()
    this.ctx.logger.info(`mini-player: close() called, hasBridge=${Boolean(bridge)}`)
    if (bridge) {
      try {
        await bridge.close?.()
        this.ctx.logger.info('mini-player: bridge.close resolved')
      } catch (e) {
        this.ctx.logger.error(`mini-player: bridge.close rejected: ${String(e)}`)
        throw e
      }
    } else {
      this.update({ visible: false, windowState: 'hidden' })
    }
  }

  async toggle(): Promise<void> {
    this.ctx.logger.info(
      `mini-player: toggle() called, current visible=${this.currentState.visible}`,
    )
    if (this.currentState.visible) {
      await this.close()
    } else {
      await this.open()
    }
  }

  async setMode(mode: MiniPlayerDisplayMode): Promise<void> {
    const bridge = getBridge()
    if (bridge) {
      await bridge.setMode?.(mode)
    } else {
      this.update({ mode, windowState: mode })
    }
  }

  async restoreMain(): Promise<void> {
    const bridge = getBridge()
    if (bridge) {
      await bridge.restoreMain?.()
    }
  }
}

export const name = 'plugin-mini-player'
export const inject = ['player']

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-mini-player: loaded')
  const fiber = await ctx.plugin(MiniPlayerService)
  return () => {
    fiber.dispose()
  }
}

export default { name, inject, apply }
