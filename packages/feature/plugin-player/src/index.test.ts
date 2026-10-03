/**
 * The transport, against a mock engine.
 *
 * Four of M1's exit criteria are settled here: the six transport controls,
 * headphone-unplug, queue-and-position restore without auto-play, and the
 * prefetch that makes gapless possible. The rest need a device.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import { createMockAudio, type MockAudio } from '@BBeBee/protocol/conformance'
import { NetworkError, NotFoundError, AuthError } from '@BBeBee/protocol'
import type {
  Capabilities,
  DbService,
  MediaProvider,
  NowPlaying,
  StreamHandle,
  Track,
} from '@BBeBee/protocol'
import plugin, { type Player } from './index.js'

const SOURCE = 'local'
const urn = (id: string) => `BBeBee:${SOURCE}:track:${id}`

/** Real time, for the one policy in the player that is a wall-clock timeout. */
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** `ctx.audio`, provided by the mock rather than by a real engine. */
function mockAudioPlugin(mock: MockAudio) {
  class MockAudioService extends Service {
    constructor(ctx: Context) {
      super(ctx, 'audio')
    }
  }
  // Cordis services are objects on the context; delegate every member.
  Object.assign(MockAudioService.prototype, mock.service, {
    load(this: MockAudioService, src: any, opts: any) {
      const config = this[Service.resolveConfig]() as { granted?: string[]; pluginId?: string } | undefined
      if (config && config.granted && !config.granted.includes('audio')) {
        throw new Error(`${config.pluginId} was not granted audio`)
      }
      return mock.service.load(src, opts)
    },
  })
  return MockAudioService
}

/** A provider that resolves everything to a local file. */
function localProvider(overrides: Partial<MediaProvider> = {}): MediaProvider {
  const capabilities: Capabilities = {
    search: { tracks: false, albums: false, artists: false, playlists: false, fullText: false },
    browse: false,
    recommend: false,
    lyrics: false,
    artwork: false,
    library: { read: true, save: false, playlistWrite: false, playlistReorder: false },
    streaming: { qualities: ['lossless'], transcoding: false, seekable: true, urlExpiry: false },
    regional: false,
  }
  return {
    sourceId: SOURCE,
    displayName: 'This device',
    capabilities,
    auth: {
      flow: { kind: 'none' },
      status: { state: 'authenticated' },
      async signIn() {},
      async signOut() {},
      onStatusChange: () => () => {},
    },
    getTrack: async (id) => ({ urn: urn(id), title: id }) as Track,
    resolveStream: async (id): Promise<StreamHandle> => ({
      kind: 'local',
      target: `file:///music/${id}.flac`,
      seekable: true,
    }),
    ping: async () => true,
    ...overrides,
  }
}

/** What a lock screen was told, in order. */
interface SessionLog {
  states: ('playing' | 'paused' | 'stopped')[]
  updates: NowPlaying[]
  cleared: number
}

/**
 * A minimal `ctx.mediaSession`.
 *
 * Opt-in, because most transport tests have no interest in the OS surface and
 * a session on every one of them would publish on every state change for
 * nothing.
 */
function mediaSessionStub(log: SessionLog) {
  class MediaSessionStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'mediaSession')
    }
    update(np: NowPlaying) {
      log.updates.push(np)
    }
    setPlaybackState(state: 'playing' | 'paused' | 'stopped') {
      log.states.push(state)
    }
    onCommand() {
      return () => {}
    }
    setSupportedCommands() {}
    clear() {
      log.cleared++
    }
  }
  return MediaSessionStub
}

/** What the host was asked to keep awake, and whether it still is. */
interface WakeLog {
  taken: string[]
  released: number
  get held(): number
}

/**
 * A minimal `ctx.background`.
 *
 * Opt-in like the media session: most transport tests do not care whether the
 * machine is allowed to sleep, and a service on all of them would be noise.
 */
function backgroundStub(
  log: WakeLog,
  opts: { refuse?: boolean; gate?: () => Promise<void> } = {},
) {
  class BackgroundStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'background')
    }
    async canRunInBackground() {
      return true
    }
    async acquireWakeLock(reason: string) {
      if (opts.refuse) throw new Error('no blocker available')
      // A gate lets a test hold the acquire open and change the transport
      // underneath it, which is the only way to reach the race.
      if (opts.gate) await opts.gate()
      log.taken.push(reason)
      let released = false
      return () => {
        // Idempotent, like the real one: a double release must not free
        // someone else's lock.
        if (released) return
        released = true
        log.released++
      }
    }
    schedule() {
      return () => {}
    }
    onWillSuspend() {
      return () => {}
    }
  }
  return BackgroundStub
}

function wakeLog(): WakeLog {
  return {
    taken: [],
    released: 0,
    get held() {
      return this.taken.length - this.released
    },
  }
}

interface Harness {
  ctx: Context
  player: Player
  audio: MockAudio
  db: DbService
  root: string
  session: SessionLog
  wake: WakeLog
  restart(): Promise<Harness>
}

async function harness(
  opts: {
    root?: string
    provider?: MediaProvider
    config?: Record<string, unknown>
    mediaSession?: boolean
    background?: boolean | { refuse?: boolean; gate?: () => Promise<void> }
    /** What a loaded source reports; 0 models a stream that knows no duration. */
    sourceDurationMs?: number
    /** What the catalogue row holds for every URN. */
    trackDurationMs?: number
    /** Augment the mock engine before it mounts (e.g. add `preloadNext`). */
    audio?: (audio: MockAudio) => void
  } = {},
): Promise<Harness> {
  const root = opts.root ?? (await tempDir('bbebee-player'))
  const audio = createMockAudio({ durationMs: opts.sourceDurationMs ?? 200_000 })
  opts.audio?.(audio)
  const session: SessionLog = { states: [], updates: [], cleared: 0 }
  const wake = wakeLog()

  const ctx = new Context()
  const fibers = [
    await ctx.plugin(PathsNode, { root }),
    await ctx.plugin(FsNode),
    // A file-backed database, so a "restart" is a real restart.
    await ctx.plugin(DbNode, { fileName: 'player-test.db' }),
    await ctx.plugin(mockAudioPlugin(audio)),
    ...(opts.mediaSession ? [await ctx.plugin(mediaSessionStub(session))] : []),
    ...(opts.background
      ? [
          await ctx.plugin(
            backgroundStub(wake, typeof opts.background === 'object' ? opts.background : {}),
          ),
        ]
      : []),
    await ctx.plugin(sourcesStub(opts.provider ?? localProvider(), opts.trackDurationMs)),
    await ctx.plugin(plugin, { tickMs: 3_600_000, saveThrottleMs: 0, ...opts.config }),
  ]
  await tick()

  const self: Harness = {
    ctx,
    player: ctx.player as Player,
    audio,
    db: ctx.db,
    root,
    session,
    wake,
    restart: async () => {
      // Teardown in reverse, exactly as the kernel does it, so the player
      // flushes its state before the database closes underneath it.
      for (const fiber of [...fibers].reverse()) await fiber.dispose()
      await tick()
      return harness({ ...opts, root })
    },
  }
  return self
}

/** A minimal `ctx.sources`: `forUrn` to resolve, `getTracks` for durations. */
function sourcesStub(provider: MediaProvider, trackDurationMs?: number) {
  class SourcesStub extends Service {
    constructor(ctx: Context) {
      super(ctx, 'sources')
    }
    forUrn(u: string) {
      return u.startsWith(`BBeBee:${provider.sourceId}:`) ? provider : undefined
    }
    async getTracks(urns: readonly string[]) {
      return urns.map(
        (u) =>
          ({
            urn: u,
            title: u,
            artists: [],
            ...(trackDurationMs !== undefined ? { durationMs: trackDurationMs } : {}),
          }) as Track,
      )
    }
    get providers() {
      return [provider]
    }
    get(id: string) {
      return id === provider.sourceId ? provider : undefined
    }
  }
  return SourcesStub
}

describe('transport', () => {
  it('plays, pauses, and resumes', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a')])

    expect(player.state.status).toBe('playing')
    expect(player.state.trackUrn).toBe(urn('a'))
    expect(audio.playing?.src).toBe('file:///music/a.flac')
    // A source is connected to chainInput, never to the destination.
    expect(audio.sources[0]!.connected).toBe(true)

    audio.advance(5000)
    await player.refresh()
    expect(player.state.positionMs).toBe(5000)

    player.pause()
    expect(player.state.status).toBe('paused')
    audio.advance(5000)
    await player.refresh()
    expect(player.state.positionMs, 'position holds while paused').toBe(5000)

    await player.play()
    expect(player.state.status).toBe('playing')
    audio.advance(1000)
    await player.refresh()
    expect(player.state.positionMs).toBe(6000)
  })

  it('falls back to the catalogue duration when the stream reports none', async () => {
    /*
     * Bilibili's DASH audio is an fMP4 segment whose `moov` can carry no
     * duration: the element reports `Infinity`, which the audio contract maps
     * to 0 — and a progress bar with no maximum never leaves zero. The search
     * rule stored the duration, so the transport uses it.
     */
    const { player, audio } = await harness({ sourceDurationMs: 0, trackDurationMs: 303_000 })
    await player.playNow([urn('a')])

    expect(player.state.status).toBe('playing')
    expect(player.state.durationMs, 'the catalogue knows how long it is').toBe(303_000)
    // Still a real source, not a synthesised one.
    expect(audio.playing?.src).toBe('file:///music/a.flac')
  })

  it('prefers the source duration once the element has one', async () => {
    const { player } = await harness({ sourceDurationMs: 180_000, trackDurationMs: 303_000 })
    await player.playNow([urn('a')])
    expect(player.state.durationMs).toBe(180_000)
  })

  it('seeks', async () => {
    const { player, audio, ctx } = await harness()
    let positionEmitted: number | undefined
    ctx.on('player/position', (pos) => {
      positionEmitted = pos
    })
    await player.playNow([urn('a')])
    await player.seek(90_000)
    expect(player.state.positionMs).toBe(90_000)
    expect(audio.playing?.positionMs).toBe(90_000)
    expect(positionEmitted).toBe(90_000)
  })

  it('advances to the next track and stops at the end of the queue', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a'), urn('b')])

    await player.next()
    expect(player.state.trackUrn).toBe(urn('b'))

    await player.next()
    expect(player.state.status, 'a queue that runs out goes idle').toBe('idle')
    expect(player.queue, 'and the queue itself survives').toHaveLength(2)
    expect(audio.sources.every((s) => !s.playing)).toBe(true)
  })

  it('previous restarts the track past the threshold and steps back before it', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a'), urn('b')])
    await player.next()

    audio.advance(4000)
    await player.refresh()
    await player.previous()
    expect(player.state.trackUrn, 'past 3s, previous restarts').toBe(urn('b'))
    expect(player.state.positionMs).toBe(0)

    await player.previous()
    expect(player.state.trackUrn, 'before 3s, previous goes back').toBe(urn('a'))
  })

  it('ends a track and moves on by itself', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a'), urn('b')])
    audio.finish()
    await tick()
    expect(player.state.trackUrn).toBe(urn('b'))
    expect(player.state.status).toBe('playing')
  })

  it('keeps playing under shuffle even when the shuffled order runs out', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a'), urn('b'), urn('c')])
    player.setShuffle(true)

    // Drive the whole permutation to its end and one wrap past it: shuffle
    // means the music continues, it does not stop at the last permuted track.
    for (let i = 0; i < 3; i++) {
      audio.finish()
      await tick()
    }
    expect(player.state.status, 'shuffle never runs dry').toBe('playing')
  })

  it('honours repeat one and repeat all', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a'), urn('b')])

    player.setRepeat('one')
    audio.finish()
    await tick()
    expect(player.state.trackUrn, 'repeat-one replays the same track').toBe(urn('a'))

    player.setRepeat('all')
    await player.next()
    await player.next()
    expect(player.state.trackUrn, 'repeat-all wraps to the start').toBe(urn('a'))
  })

  it('stops without clearing the queue', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('b')])
    player.stop()
    expect(player.state.status).toBe('idle')
    expect(player.queue).toHaveLength(2)
  })
})

describe('the queue', () => {
  it('enqueues next and last, in the right places', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('d')])
    player.enqueueNext([urn('b')])
    player.enqueueLast([urn('z')])

    expect(player.queue.map((i) => i.trackUrn)).toEqual([urn('a'), urn('b'), urn('d'), urn('z')])
  })

  it('reorders by writing exactly one row', async () => {
    // The point of a fractional index: dragging a track in a long queue must
    // not renumber the tail (docs/07 §4.6).
    const { player, db } = await harness()
    await player.playNow([urn('a'), urn('b'), urn('c')])
    await tick()

    const before = await db.query<{ id: string; position: string }>(
      'SELECT id, position FROM queue_items ORDER BY position',
    )
    const last = player.queue[2]!
    player.moveItem(last.id, 0)
    await tick()

    const after = await db.query<{ id: string; position: string }>(
      'SELECT id, position FROM queue_items ORDER BY position',
    )
    expect(after.map((r) => r.id)).toEqual([last.id, before[0]!.id, before[1]!.id])

    const changed = after.filter((row) => {
      const match = before.find((b) => b.id === row.id)
      return match?.position !== row.position
    })
    expect(changed.map((c) => c.id), 'only the moved row changes').toEqual([last.id])
  })

  it('removes items, and stops if the playing one goes', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('b')])
    const playing = player.queue.find((i) => i.id === player.state.currentItemId)!

    player.removeItems([playing.id])
    expect(player.queue).toHaveLength(1)
    expect(player.state.status).toBe('idle')
  })

  it('shuffles by a persisted seed, so the order survives a restart', async () => {
    // Not a dice roll per advance: a stable permutation is what makes the
    // upcoming queue displayable and `previous()` meaningful (docs/05 §2).
    const first = await harness()
    await first.player.playNow([urn('a'), urn('b'), urn('c'), urn('d'), urn('e')])
    first.player.setShuffle(true)
    await tick()
    const order = first.player.upcoming().map((i) => i.trackUrn)

    const second = await first.restart()
    expect(second.player.state.shuffle).toBe(true)
    expect(second.player.upcoming().map((i) => i.trackUrn)).toEqual(order)
  })
})

describe('playFromContext', () => {
  it('jumps to a track the queue already holds, and keeps the queue', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('b'), urn('c')])
    await player.next()

    await player.playFromContext(urn('a'))
    expect(player.state.trackUrn).toBe(urn('a'))
    expect(player.state.status).toBe('playing')
    expect(player.queue.map((i) => i.trackUrn), 'the queue the user had is untouched').toEqual([
      urn('a'),
      urn('b'),
      urn('c'),
    ])

    // The same from a paused transport: a tap is a play, wherever it lands.
    player.pause()
    await player.playFromContext(urn('c'))
    expect(player.state.trackUrn).toBe(urn('c'))
    expect(player.state.status).toBe('playing')
  })

  it('starts the tapped track inside its context when the queue does not hold it', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('b')])

    await player.playFromContext(urn('x'), [urn('y'), urn('x'), urn('z')])
    expect(player.state.trackUrn).toBe(urn('x'))
    expect(player.state.status).toBe('playing')
    expect(player.queue.map((i) => i.trackUrn), 'the tapped list becomes the queue').toEqual([
      urn('y'),
      urn('x'),
      urn('z'),
    ])
  })

  it('plays the track alone when there is no context for it', async () => {
    const { player } = await harness()
    await player.playFromContext(urn('a'))
    expect(player.state.trackUrn).toBe(urn('a'))
    expect(player.queue.map((i) => i.trackUrn)).toEqual([urn('a')])

    // A context the track is not actually in cannot start somewhere the user
    // did not point at, either.
    await player.playFromContext(urn('q'), [urn('b'), urn('c')])
    expect(player.queue.map((i) => i.trackUrn)).toEqual([urn('q')])
  })

  it('jumps under shuffle, where row order is not play order', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('b'), urn('c'), urn('d'), urn('e')])
    player.setShuffle(true)

    await player.playFromContext(urn('e'))
    expect(player.state.trackUrn).toBe(urn('e'))
    expect(player.queue, 'still the same five tracks').toHaveLength(5)
  })

  it('replaces queue with context even if the clicked track was already in the previous queue', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('b'), urn('c')])
    expect(player.queue.map((i) => i.trackUrn)).toEqual([urn('a'), urn('b'), urn('c')])

    // Track 'b' is already in queue, but tapped inside a new playlist [b, d, e]
    await player.playFromContext(urn('b'), [urn('b'), urn('d'), urn('e')])
    expect(player.state.trackUrn).toBe(urn('b'))
    expect(player.queue.map((i) => i.trackUrn)).toEqual([urn('b'), urn('d'), urn('e')])
  })

  it('plays the clicked track when tapping in context under shuffle mode', async () => {
    const { player } = await harness()
    player.setShuffle(true)

    // In shuffle mode, clicking track 'c' in playlist [a, b, c, d, e] must play track 'c'
    await player.playFromContext(urn('c'), [urn('a'), urn('b'), urn('c'), urn('d'), urn('e')])
    expect(player.state.trackUrn).toBe(urn('c'))
    expect(player.state.status).toBe('playing')
    // The upcoming queue should contain all other 4 tracks
    expect(player.upcoming().map((i) => i.trackUrn)).toHaveLength(4)
    expect(player.upcoming().map((i) => i.trackUrn)).not.toContain(urn('c'))
  })

  it('plays the specified track in playNow with startIndex under shuffle mode', async () => {
    const { player } = await harness()
    player.setShuffle(true)

    await player.playNow([urn('a'), urn('b'), urn('c'), urn('d')], { startIndex: 2 })
    expect(player.state.trackUrn).toBe(urn('c'))
  })
})

describe('queue deduplication', () => {
  it('deduplicates tracks in playNow while preserving start index', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('b'), urn('a'), urn('c'), urn('b')], { startIndex: 3 })
    expect(player.queue.map((i) => i.trackUrn)).toEqual([urn('a'), urn('b'), urn('c')])
    expect(player.state.trackUrn).toBe(urn('c'))
  })

  it('deduplicates tracks in enqueueNext against queue and incoming list', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('b')])
    player.enqueueNext([urn('b'), urn('c'), urn('c'), urn('d')])
    expect(player.queue.map((i) => i.trackUrn)).toEqual([urn('a'), urn('c'), urn('d'), urn('b')])
  })

  it('deduplicates tracks in enqueueLast against queue and incoming list', async () => {
    const { player } = await harness()
    await player.playNow([urn('a'), urn('b')])
    player.enqueueLast([urn('b'), urn('c'), urn('c'), urn('d')])
    expect(player.queue.map((i) => i.trackUrn)).toEqual([urn('a'), urn('b'), urn('c'), urn('d')])
  })
})

describe('persistence', () => {
  it('restores the queue and position across a restart, and does not auto-play', async () => {
    // M1 exit criterion. Resuming into playback on launch is startling,
    // particularly on a phone that just came out of a pocket.
    const first = await harness()
    await first.player.playNow([urn('a'), urn('b')])
    first.audio.advance(42_000)
    await first.player.refresh()
    first.player.pause()
    await tick()

    const second = await first.restart()
    expect(second.player.queue.map((i) => i.trackUrn)).toEqual([urn('a'), urn('b')])
    expect(second.player.state.trackUrn).toBe(urn('a'))
    expect(second.player.state.positionMs).toBe(42_000)
    expect(second.player.state.status, 'must not resume by itself').not.toBe('playing')
    expect(second.audio.loads, 'and must not even load audio').toHaveLength(0)

    // …and pressing play picks up where it left off.
    await second.player.play()
    expect(second.player.state.status).toBe('playing')
    expect(second.audio.playing?.positionMs).toBe(42_000)
  })

  it('survives a corrupted queue row instead of failing to start', async () => {
    // One bad `source_context_json` used to throw inside Player init, leaving
    // the user with no player at all.
    const first = await harness()
    await first.player.playNow([urn('a'), urn('b')])
    await tick()
    await first.db.exec("UPDATE queue_items SET source_context_json = '{oops' WHERE 1 = 1")

    const second = await first.restart()
    expect(second.player.queue).toHaveLength(2)
    expect(second.player.queue[0]!.sourceContext, 'the bad field is dropped').toBeUndefined()
  })

  it('writes a play record and its derived stats together', async () => {
    const { player, audio, db } = await harness()
    await player.playNow([urn('a'), urn('b')])
    audio.advance(120_000)
    await player.refresh()
    audio.finish()
    await tick()

    const history = await db.query<{ track_urn: string; completed: number; ms_played: number }>(
      'SELECT track_urn, completed, ms_played FROM play_history',
    )
    expect(history).toHaveLength(1)
    expect(history[0]!.track_urn).toBe(urn('a'))
    expect(history[0]!.completed).toBe(1)
    expect(history[0]!.ms_played).toBeGreaterThan(0)

    const stats = await db.query<{ urn: string; play_count: number }>(
      'SELECT urn, play_count FROM track_stats',
    )
    expect(stats[0]).toMatchObject({ urn: urn('a'), play_count: 1 })
  })
})

describe('interruptions and routes', () => {
  it('pauses on unplug and never resumes by itself', async () => {
    // M1 exit criterion, and the one audio behaviour users never forgive.
    const { player, audio } = await harness()
    await player.playNow([urn('a')])

    audio.routeChange({ reason: 'device-removed' })
    expect(player.state.status).toBe('paused')

    audio.routeChange({ reason: 'device-added' })
    expect(player.state.status, 'a new device must not start playback').toBe('paused')
  })

  it('pauses for an interruption and resumes only when told to', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a')])

    audio.interrupt({ type: 'began', shouldResume: false })
    expect(player.state.status).toBe('paused')

    audio.interrupt({ type: 'ended', shouldResume: true })
    await tick()
    expect(player.state.status).toBe('playing')
  })

  it('does not resume if the user paused in the meantime', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a')])

    audio.interrupt({ type: 'began', shouldResume: false })
    player.pause() // the user's own pause clears our claim on the resume
    audio.interrupt({ type: 'ended', shouldResume: true })
    await tick()
    expect(player.state.status).toBe('paused')
  })
})

describe('the wake lock', () => {
  it('holds the machine awake while playing and lets it sleep on pause', async () => {
    // MD-6's other half. Close-to-tray keeps the renderer and the audio graph
    // alive when the window goes; without this the machine still sleeps
    // mid-track, and "playback survives window-hide" needs both.
    const { player, wake } = await harness({ background: true })
    await player.playNow([urn('a')])
    await tick()

    expect(wake.taken, 'the lock names what it is for').toEqual(['playback'])
    expect(wake.held).toBe(1)

    player.pause()
    expect(wake.held, 'a paused player must not hold the machine awake').toBe(0)

    await player.play()
    await tick()
    expect(wake.held).toBe(1)
  })

  it('keeps holding it through a stall', async () => {
    // A lock dropped and re-taken on every buffer underrun is a lock the OS
    // sees flapping, and the track is still playing as far as anyone can tell.
    const { player, audio, wake } = await harness({ background: true })
    await player.playNow([urn('a')])
    await tick()

    audio.stall(true)
    expect(wake.held).toBe(1)
    expect(wake.taken, 'and not re-taken').toHaveLength(1)

    audio.stall(false)
    expect(wake.held).toBe(1)
  })

  it('releases it when the queue runs out', async () => {
    const { player, audio, wake } = await harness({ background: true })
    await player.playNow([urn('a')])
    await tick()

    audio.finish()
    await tick()

    expect(player.state.status).toBe('idle')
    expect(wake.held, 'nothing is playing, so nothing holds the machine awake').toBe(0)
  })

  it('does not strand a lock when playback stops while it is being acquired', async () => {
    /*
     * The acquire is async, so the transport can change under it. A lock that
     * arrives after the user pressed pause has to be released on arrival — not
     * held until something else happens to change the status, which is the
     * failure nobody notices until a laptop flattens itself in a bag.
     *
     * The gate holds the acquire open so the pause lands in the middle of it,
     * which is the only way to reach that branch deterministically.
     */
    let openGate!: () => void
    const gate = new Promise<void>((resolve) => {
      openGate = resolve
    })

    const h = await harness({ background: { gate: () => gate } })
    await h.player.playNow([urn('a')])
    expect(h.player.state.status, 'playing, with the acquire still in flight').toBe('playing')
    expect(h.wake.taken, 'nothing acquired yet').toEqual([])

    h.player.pause()
    openGate()
    await tick()

    expect(h.wake.taken, 'the lock did arrive').toEqual(['playback'])
    expect(h.wake.held, 'and was let go again immediately').toBe(0)
  })

  it('plays on when the host refuses a blocker', async () => {
    // A machine with no power-save blocker is a machine that may sleep. It is
    // not a reason to refuse to play.
    const { player, wake } = await harness({ background: { refuse: true } })
    await player.playNow([urn('a')])
    await tick()

    expect(player.state.status).toBe('playing')
    expect(wake.taken).toEqual([])
  })

  it('releases it when the plugin unloads mid-playback', async () => {
    const root = await tempDir('bbebee-player-wake')
    const audio = createMockAudio()
    const wake = wakeLog()
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(mockAudioPlugin(audio))
    await ctx.plugin(backgroundStub(wake))
    await ctx.plugin(sourcesStub(localProvider()))
    await tick()

    const fiber = await ctx.plugin(plugin, { tickMs: 3_600_000 })
    await tick()
    await (ctx.player as Player).playNow([urn('a')])
    await tick()
    expect(wake.held).toBe(1)

    await fiber.dispose()
    await tick()
    expect(wake.held, 'a disabled player leaves the machine free to sleep').toBe(0)
  })
})

describe('stalls', () => {
  it('reports stalled rather than paused, and recovers to playing', async () => {
    // Stage 5's demo, and the distinction docs/05 §2 exists to make: a buffer
    // underrun is not a user decision, so the UI shows a spinner and not a
    // play button.
    const { player, audio } = await harness()
    await player.playNow([urn('a')])
    expect(player.state.status).toBe('playing')

    audio.stall(true)
    expect(player.state.status).toBe('stalled')

    audio.stall(false)
    expect(player.state.status).toBe('playing')
  })

  it('keeps the lock screen reporting playing through a stall', async () => {
    // Otherwise every tunnel flickers the lock screen between playing and
    // paused, which is the visible half of the same distinction.
    const { player, audio, session } = await harness({ mediaSession: true })
    await player.playNow([urn('a')])
    session.states.length = 0

    audio.stall(true)
    audio.stall(false)

    expect(session.states.every((s) => s === 'playing')).toBe(true)
    expect(session.states, 'a stall still publishes, it just publishes playing').not.toHaveLength(0)
  })

  it('never publishes the track URN as the lock-screen title', async () => {
    // The position tick runs once a second and used to send `trackUrn` as the
    // title, overwriting whatever `publishNowPlaying` had set — so the OS
    // surface showed a track's key instead of its name.
    const { player, session } = await harness({ mediaSession: true })
    await player.playNow([urn('a')])
    session.updates.length = 0

    await player.refresh()

    expect(session.updates.length, 'a position tick published').toBeGreaterThan(0)
    for (const update of session.updates) {
      expect(update.title).not.toContain('BBeBee:')
    }
  })

  it('clears nowPlaying metadata immediately when changing track', async () => {
    const { player, ctx } = await harness()
    let observedNowPlayingDuringTrackChange: any = 'initial'
    ctx.on('player/track-changed', () => {
      observedNowPlayingDuringTrackChange = player.state.nowPlaying
    })

    await player.playNow([urn('a')])
    ;(player as any).transport.nowPlaying = { title: 'Track A', artist: 'Artist A' }

    await player.playNow([urn('b')])
    expect(observedNowPlayingDuringTrackChange).toBeUndefined()
  })

  it('hands over a network cover URL, and the local one separately', async () => {
    /*
     * The two OS surfaces need different things: Chromium's `MediaMetadata`
     * refuses `file:` and warns on every assignment, while an Android
     * notification can only read a local file. Both are published; each
     * media-session implementation renders the one it can (docs/04 §7).
     */
    const { player, session, db } = await harness({ mediaSession: true })
    await db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES (?, ?, 'p', '{}', 'h', 0, 0)`,
      [SOURCE, `bbebee://local/${SOURCE}`],
    )
    await db.exec(
      `INSERT INTO artworks (id, source_url, local_uri, fetched_at)
       VALUES ('aw1', 'https://cdn.test/a.jpg', 'file:///C:/artwork/a.jpg', 0)`,
    )
    await db.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, artwork_id, fetched_at)
       VALUES (?, ?, 'a', 'A', 'aw1', 0)`,
      [urn('a'), SOURCE],
    )

    await player.playNow([urn('a')])
    await tick()

    const update = session.updates.at(-1)
    expect(update?.artworkUrl, 'what a browser can load').toBe('https://cdn.test/a.jpg')
    expect(update?.artworkUri, 'what a phone notification can read').toBe(
      'file:///C:/artwork/a.jpg',
    )
  })

  it('does not advance position while stalled', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a')])
    audio.advance(5000)
    await player.refresh()
    const before = player.state.positionMs

    audio.stall(true)
    audio.advance(5000)
    await player.refresh()

    expect(player.state.positionMs).toBe(before)
  })

  it('a stall the user pauses out of becomes a pause, not a spinner', async () => {
    const { player, audio } = await harness()
    await player.playNow([urn('a')])
    audio.stall(true)

    player.pause()

    expect(player.state.status).toBe('paused')
    // And recovery must not drag it back: the user's intent outlives the
    // buffer's.
    audio.stall(false)
    expect(player.state.status).toBe('paused')
  })

  it('gives up on a stall that never recovers, with the queue intact', async () => {
    // `stalled --> error: timeout exceeded`. Without the bound the state is
    // absorbing and a dead stream spins for ever.
    const { player, audio } = await harness({ config: { stallTimeoutMs: 5 } })
    await player.playNow([urn('a'), urn('b')])

    audio.stall(true)
    await delay(25)

    expect(player.state.status).toBe('error')
    expect(player.state.error?.retryable, 'pressing play is all it takes').toBe(true)
    expect(player.queue, 'no failure path clears the queue').toHaveLength(2)
  })

  it('does not fail a stall that recovered before the timeout', async () => {
    const { player, audio } = await harness({ config: { stallTimeoutMs: 5 } })
    await player.playNow([urn('a')])

    audio.stall(true)
    audio.stall(false)
    await delay(25)

    expect(player.state.status).toBe('playing')
  })

  it('ignores a stall reported while the user has it paused', async () => {
    // An element still filling its buffer behind a paused track is not a
    // stall in any sense the transport cares about.
    const { player, audio } = await harness()
    await player.playNow([urn('a')])
    player.pause()

    audio.stall(true)

    expect(player.state.status).toBe('paused')
  })
})

describe('resolution', () => {
  it('asks the before-resolve waterfall, and honours a substitution', async () => {
    // The control arm for M3: with a listener, the player plays a local file
    // and behaves identically. It never learns downloads exist (docs/02 §5).
    const { ctx, player, audio } = await harness()
    ctx.on('player/before-resolve', ((): Promise<StreamHandle> =>
      Promise.resolve({
        kind: 'local',
        target: 'file:///downloads/substituted.flac',
        seekable: true,
      })) as never)

    await player.playNow([urn('a')])
    expect(audio.loads[0]!.src).toBe('file:///downloads/substituted.flac')
    expect(player.state.status).toBe('playing')
  })

  it('buffers local files and streams remote ones', async () => {
    const remote = localProvider({
      resolveStream: async (): Promise<StreamHandle> => ({
        kind: 'remote',
        target: 'https://example.org/a.mp3',
        seekable: true,
      }),
    })
    const { player, audio } = await harness({ provider: remote })
    await player.playNow([urn('a')])
    expect(audio.loads[0]!.opts.strategy).toBe('stream')

    const local = await harness()
    await local.player.playNow([urn('a')])
    expect(local.audio.loads[0]!.opts.strategy).toBe('buffer')
  })
})

describe('errors', () => {
  it('skips a missing track and marks it unavailable', async () => {
    const provider = localProvider({
      resolveStream: async (id: string) => {
        if (id === 'a') throw new NotFoundError('gone', SOURCE)
        return { kind: 'local', target: `file:///music/${id}.flac`, seekable: true } as StreamHandle
      },
    })
    const { player, db } = await harness({ provider })
    await db.exec(
      `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
       VALUES (?, ?, 'p', '{}', 'h', 0, 0)`,
      [SOURCE, `bbebee://local/${SOURCE}`],
    )
    await db.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, available, fetched_at)
       VALUES (?, ?, 'a', 'A', 1, 0)`,
      [urn('a'), SOURCE],
    )

    await player.playNow([urn('a'), urn('b')])
    await tick()

    expect(player.state.trackUrn, 'the queue moves on').toBe(urn('b'))
    const row = await db.get<{ available: number }>('SELECT available FROM tracks WHERE urn = ?', [
      urn('a'),
    ])
    expect(row?.available, 'greyed out in lists, not hidden').toBe(0)
  })

  it('retries a network failure, then pauses with the queue intact', async () => {
    let attempts = 0
    const provider = localProvider({
      resolveStream: async () => {
        attempts++
        throw new NetworkError('offline', SOURCE)
      },
    })
    const { player } = await harness({ provider, config: { retryBackoffMs: 1 } })
    await player.playNow([urn('a'), urn('b')])
    await tick()

    expect(attempts, 'three attempts before giving up').toBeGreaterThanOrEqual(3)
    expect(player.state.status).toBe('error')
    expect(player.state.error?.retryable).toBe(true)
    expect(player.queue, 'an error never clears the queue').toHaveLength(2)
  })

  it('stops on an auth error and tells the source', async () => {
    const provider = localProvider({
      resolveStream: async () => {
        throw new AuthError('expired', SOURCE)
      },
    })
    const { ctx, player } = await harness({ provider })
    const expired: string[] = []
    ctx.on('source/auth-expired', (id) => void expired.push(id))

    await player.playNow([urn('a')])
    await tick()

    expect(player.state.status).toBe('error')
    expect(expired, 'the provider gets first refusal').toEqual([SOURCE])
    expect(player.queue).toHaveLength(1)
  })
})

describe('failure loops and races', () => {
  it('gives up after a run of failures instead of skipping forever', async () => {
    // Under repeat-all the queue never runs out, so a queue where every track
    // fails used to skip for ever: an event storm, a write per track, and a UI
    // stuck on "skipping" until the battery went.
    const provider = localProvider({
      resolveStream: async () => {
        throw new NotFoundError('gone', SOURCE)
      },
    })
    const { player, ctx } = await harness({ provider, config: { maxSkipStreak: 4 } })
    let errors = 0
    ctx.on('player/error', () => void errors++)

    // Repeat first: it is the wrap that makes the queue infinite.
    player.setRepeat('all')
    await player.playNow([urn('a'), urn('b'), urn('c')])
    await tick()

    expect(player.state.status).toBe('error')
    expect(errors, 'bounded, not unbounded').toBeLessThanOrEqual(6)
    expect(player.queue, 'and the queue survives').toHaveLength(3)
  })

  it('resets the failure count once a track starts', async () => {
    let attempt = 0
    const provider = localProvider({
      resolveStream: async (id: string) => {
        attempt++
        if (id === 'a') throw new NotFoundError('gone', SOURCE)
        return { kind: 'local', target: `file:///music/${id}.flac`, seekable: true } as StreamHandle
      },
    })
    const { player } = await harness({ provider, config: { maxSkipStreak: 2 } })
    await player.playNow([urn('a'), urn('b')])
    await tick()

    expect(player.state.trackUrn).toBe(urn('b'))
    expect(player.state.status).toBe('playing')
    expect(attempt).toBe(2)
  })

  it('honours a pause that lands while a track is still loading', async () => {
    // Press play, press pause immediately: the load finishes later and used to
    // start playing anyway, because `attach` acted on the flag captured when
    // the load began.
    let release: (() => void) | undefined
    const provider = localProvider({
      resolveStream: async (id: string) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { kind: 'local', target: `file:///music/${id}.flac`, seekable: true } as StreamHandle
      },
    })
    const { player } = await harness({ provider })

    const started = player.playNow([urn('a')])
    await tick()
    player.pause()
    release?.()
    await started
    await tick()

    expect(player.state.status, 'the user asked for paused').toBe('paused')
  })

  it('honours a stop that lands while a track is still loading', async () => {
    let release: (() => void) | undefined
    const provider = localProvider({
      resolveStream: async (id: string) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { kind: 'local', target: `file:///music/${id}.flac`, seekable: true } as StreamHandle
      },
    })
    const { player, audio } = await harness({ provider })

    const started = player.playNow([urn('a')])
    await tick()
    player.stop()
    release?.()
    await started
    await tick()

    expect(player.state.status).toBe('idle')
    expect(audio.playing, 'nothing may be sounding after a stop').toBeUndefined()
  })
})

describe('memory', () => {
  it('streams a local file too large to decode', async () => {
    // Decoded PCM is roughly ten times the file: a two-hour FLAC is ~2.5 GB,
    // and the phone kills the app rather than the track.
    const provider = localProvider({
      resolveStream: async (id: string) =>
        ({
          kind: 'local',
          target: `file:///music/${id}.flac`,
          seekable: true,
          byteLength: 900 * 1024 * 1024,
        }) as StreamHandle,
    })
    const { player, audio } = await harness({ provider })
    await player.playNow([urn('long')])
    expect(audio.loads[0]!.opts.strategy).toBe('stream')
  })

  it('still buffers an ordinary local file', async () => {
    const provider = localProvider({
      resolveStream: async (id: string) =>
        ({
          kind: 'local',
          target: `file:///music/${id}.flac`,
          seekable: true,
          byteLength: 40 * 1024 * 1024,
        }) as StreamHandle,
    })
    const { player, audio } = await harness({ provider })
    await player.playNow([urn('album-track')])
    expect(audio.loads[0]!.opts.strategy).toBe('buffer')
  })
})

describe('prefetch', () => {
  it('decodes the next track before the current one ends', async () => {
    const { player, audio } = await harness()
    audio.setDuration(20_000)
    await player.playNow([urn('a'), urn('b')])

    expect(audio.loads).toHaveLength(1)
    audio.advance(10_000)
    await player.refresh()
    await tick()

    expect(audio.loads, 'the next track is loaded ahead of time').toHaveLength(2)
    expect(audio.loads[1]!.src).toBe('file:///music/b.flac')
    expect(audio.loads[1]!.opts.strategy, 'buffered, so the handoff waits on nothing').toBe('buffer')

    // …and the handoff itself does not load again.
    audio.finish()
    await tick()
    expect(player.state.trackUrn).toBe(urn('b'))
    expect(audio.loads, 'no second load for the track already in hand').toHaveLength(2)
  })

  it('drops the prefetch when the queue changes under it', async () => {
    const { player, audio } = await harness()
    audio.setDuration(20_000)
    await player.playNow([urn('a'), urn('b')])
    audio.advance(10_000)
    await player.refresh()
    await tick()
    expect(audio.loads).toHaveLength(2)

    player.enqueueNext([urn('c')])
    audio.finish()
    await tick()

    expect(player.state.trackUrn, 'the newly queued track plays next').toBe(urn('c'))
    expect(audio.loads[2]!.src).toBe('file:///music/c.flac')
  })

  it('does not prefetch when transitions are off', async () => {
    const { player, audio } = await harness({ config: { transition: 'neither' } })
    audio.setDuration(20_000)
    await player.playNow([urn('a'), urn('b')])
    audio.advance(15_000)
    await player.refresh()
    await tick()
    expect(audio.loads).toHaveLength(1)
  })

  it('hands the next uri to an engine that preloads its own playlist, and never loads a second source', async () => {
    // On a single-core engine (mpv) a second `load` for the next file is a
    // `loadfile replace`: it stops the track still sounding and leaves the
    // engine paused on a file nothing will ever start — the "skips 15 s
    // early, then sticks" failure. An engine advertising `preloadNext` owns
    // the playlist boundary; the player hands over the uri and stops.
    const preloadNext = vi.fn(async () => undefined)
    const { player, audio } = await harness({
      audio: (a) => {
        a.service.preloadNext = preloadNext
      },
    })
    audio.setDuration(20_000)
    await player.playNow([urn('a'), urn('b')])

    expect(audio.loads).toHaveLength(1)
    audio.advance(10_000)
    await player.refresh()
    await tick()

    expect(preloadNext, 'the engine was handed the next uri').toHaveBeenCalledWith(
      'file:///music/b.flac',
      undefined,
    )
    expect(audio.loads, 'no second load: on such an engine that load kills the playing track')
      .toHaveLength(1)

    // The handoff still works: the engine advances its own playlist and the
    // ended→load round-trip re-binds to the already-sounding file.
    audio.finish()
    await tick()
    expect(player.state.trackUrn).toBe(urn('b'))
  })

  it('appends once per track, not once per tick', async () => {
    // There is no `prefetched` handle in the engine-preload path to make the
    // re-entry guard; without the marker every tick inside the window would
    // append the same file again.
    const preloadNext = vi.fn(async () => undefined)
    const { player, audio } = await harness({
      audio: (a) => {
        a.service.preloadNext = preloadNext
      },
    })
    audio.setDuration(20_000)
    await player.playNow([urn('a'), urn('b')])
    audio.advance(10_000)
    await player.refresh()
    await player.refresh()
    await player.refresh()
    await tick()

    expect(preloadNext).toHaveBeenCalledTimes(1)
  })

  it('loses gapless quietly when the engine cannot take the append', async () => {
    // A failed append must not fall back to the handle prefetch — that load
    // is what kills the playing track. The transition just loses gapless;
    // the next track loads normally when it is its turn.
    const preloadNext = vi.fn(async () => {
      throw new Error('append failed')
    })
    const { player, audio } = await harness({
      audio: (a) => {
        a.service.preloadNext = preloadNext
      },
    })
    audio.setDuration(20_000)
    await player.playNow([urn('a'), urn('b')])
    audio.advance(10_000)
    await player.refresh()
    await tick()

    expect(preloadNext).toHaveBeenCalledTimes(1)
    expect(audio.loads, 'no fallback to the killing load').toHaveLength(1)
    expect(player.state.status, 'the current track keeps playing').toBe('playing')
  })
})

describe('crossfade', () => {
  it('keeps the outgoing source alive for the length of its fade', async () => {
    // Disposing it at the swap stops it instantly, so the ramp never sounds
    // and a "crossfade" is only ever a fade-in.
    const { ctx, player, audio } = await harness({
      config: { transition: 'crossfade', crossfadeMs: 200 },
    })
    audio.setDuration(20_000)
    const changed: (string | undefined)[] = []
    ctx.on('player/track-changed', (u) => void changed.push(u))
    await player.playNow([urn('a'), urn('b')])
    const outgoing = audio.sources[0]!

    audio.advance(15_000)
    await player.refresh()
    await tick()
    audio.advance(4900)
    await player.refresh()
    await tick()

    expect(player.state.trackUrn, 'the next track has taken over').toBe(urn('b'))
    expect(outgoing.disposed, 'and the old one is still fading, not stopped').toBe(false)
    expect(changed.at(-1), 'a crossfade is a track change like any other').toBe(urn('b'))

    await new Promise((resolve) => setTimeout(resolve, 260))
    expect(outgoing.disposed, 'disposed once the fade is done').toBe(true)
  })
})

describe('lifecycle', () => {
  it('leaves nothing behind when unloaded', async () => {
    const root = await tempDir('bbebee-player-leak')
    const audio = createMockAudio()
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(mockAudioPlugin(audio))
    await ctx.plugin(sourcesStub(localProvider()))
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin, { tickMs: 3_600_000 })
    await tick()
    await (ctx.player as Player).playNow([urn('a')])
    await fiber.dispose()
    await tick()

    expect(audio.sources.every((s) => s.disposed), 'every source is disposed').toBe(true)
    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })

  it('can be disabled mid-playback and enabled again, leaving no ghost behind', async () => {
    // M1's definition of done asks for a clean tree after disabling *and*
    // re-enabling during playback — the cycle, not just the teardown, because
    // a listener re-registered on the way back is a leak that only shows on
    // the second pass.
    const root = await tempDir('bbebee-player-cycle')
    const audio = createMockAudio()
    const session: SessionLog = { states: [], updates: [], cleared: 0 }
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: 'cycle.db' })
    await ctx.plugin(mockAudioPlugin(audio))
    await ctx.plugin(mediaSessionStub(session))
    await ctx.plugin(sourcesStub(localProvider()))
    await tick()

    const before = snapshotContext(ctx)

    for (const pass of [1, 2]) {
      const fiber = await ctx.plugin(plugin, { tickMs: 3_600_000, saveThrottleMs: 0 })
      await tick()
      const player = ctx.player as Player
      await player.playNow([urn('a')])
      expect(player.state.status, `pass ${pass}: playing`).toBe('playing')

      await fiber.dispose()
      await tick()

      expect(ctx.player, `pass ${pass}: the service is gone`).toBeUndefined()
      expect(audio.sources.every((s) => s.disposed), `pass ${pass}: no node left connected`).toBe(
        true,
      )
      expect(session.cleared, `pass ${pass}: no ghost lock screen`).toBeGreaterThanOrEqual(pass)
    }

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })

  it('safely queries device and codec services when registered in context', async () => {
    class DeviceStub extends Service {
      constructor(ctx: Context) {
        super(ctx, 'device')
      }
      async network() {
        return { online: true, type: 'wifi' as const, metered: false }
      }
    }
    class CodecStub extends Service {
      constructor(ctx: Context) {
        super(ctx, 'codec')
      }
      supportedFormats() {
        return ['flac', 'mp3']
      }
    }

    const { ctx, player } = await harness()
    await ctx.plugin(DeviceStub)
    await ctx.plugin(CodecStub)
    await tick()

    await player.playNow([urn('1')])
    expect(player.state.status).toBe('playing')
  })

  it('allows callers without audio capability (such as UI plugins) to trigger playback via Player', async () => {
    const { ctx } = await harness()
    const callerCtx = ctx.intercept('audio', {
      pluginId: '@BBeBee/plugin-queue-ui-desktop',
      scopeId: '@BBeBee/plugin-queue-ui-desktop',
      granted: [],
    })
    const callerPlayer = (callerCtx as unknown as { player: Player }).player
    await callerPlayer.playNow([urn('1')])
    expect(callerPlayer.state.status).toBe('playing')
  })

  it('records play history, computes stats and heatmap, and allows clearing', async () => {
    const { ctx, player } = await harness()
    const historyChanged = vi.fn()
    ctx.on('player/history-changed', historyChanged)

    const initialHistory = await player.getHistory()
    expect(initialHistory).toEqual([])
    const initialStats = await player.getHistoryStats()
    expect(initialStats.totalPlays).toBe(0)

    await player.playNow([urn('1'), urn('2')])
    await player.next()
    await tick()

    expect(historyChanged).toHaveBeenCalled()

    const history = await player.getHistory()
    expect(history.length).toBe(1)
    expect(history[0]?.trackUrn).toBe(urn('1'))

    const stats = await player.getHistoryStats()
    expect(stats.totalPlays).toBe(1)
    expect(stats.todayPlays).toBe(1)

    const heatmap = await player.getHistoryHeatmap(7)
    expect(heatmap.length).toBe(7)
    const todayEntry = heatmap[heatmap.length - 1]
    expect(todayEntry?.count).toBe(1)

    await player.clearHistory()
    const cleared = await player.getHistory()
    expect(cleared.length).toBe(0)
    const clearedStats = await player.getHistoryStats()
    expect(clearedStats.totalPlays).toBe(0)
  })

  describe('playback modes', () => {
    it('initializes in sequence mode and cycles through all 4 modes', async () => {
      const { player } = await harness()
      expect(player.state.playMode).toBe('sequence')
      expect(player.state.shuffle).toBe(false)
      expect(player.state.repeat).toBe('off')

      // cycle 1: sequence -> list-loop
      expect(player.cyclePlayMode()).toBe('list-loop')
      expect(player.state.playMode).toBe('list-loop')
      expect(player.state.shuffle).toBe(false)
      expect(player.state.repeat).toBe('all')

      // cycle 2: list-loop -> single-loop
      expect(player.cyclePlayMode()).toBe('single-loop')
      expect(player.state.playMode).toBe('single-loop')
      expect(player.state.shuffle).toBe(false)
      expect(player.state.repeat).toBe('one')

      // cycle 3: single-loop -> shuffle
      expect(player.cyclePlayMode()).toBe('shuffle')
      expect(player.state.playMode).toBe('shuffle')
      expect(player.state.shuffle).toBe(true)

      // cycle 4: shuffle -> sequence
      expect(player.cyclePlayMode()).toBe('sequence')
      expect(player.state.playMode).toBe('sequence')
      expect(player.state.shuffle).toBe(false)
      expect(player.state.repeat).toBe('off')
    })

    it('setPlayMode switches directly to target mode', async () => {
      const { player } = await harness()

      player.setPlayMode('single-loop')
      expect(player.state.playMode).toBe('single-loop')
      expect(player.state.repeat).toBe('one')
      expect(player.state.shuffle).toBe(false)

      player.setPlayMode('shuffle')
      expect(player.state.playMode).toBe('shuffle')
      expect(player.state.shuffle).toBe(true)

      player.setPlayMode('list-loop')
      expect(player.state.playMode).toBe('list-loop')
      expect(player.state.repeat).toBe('all')
      expect(player.state.shuffle).toBe(false)

      player.setPlayMode('sequence')
      expect(player.state.playMode).toBe('sequence')
      expect(player.state.repeat).toBe('off')
      expect(player.state.shuffle).toBe(false)
    })

    it('syncs playMode when setRepeat or setShuffle is called directly', async () => {
      const { player } = await harness()

      player.setRepeat('one')
      expect(player.state.playMode).toBe('single-loop')

      player.setRepeat('all')
      expect(player.state.playMode).toBe('list-loop')

      player.setShuffle(true)
      expect(player.state.playMode).toBe('shuffle')

      player.setShuffle(false)
      expect(player.state.playMode).toBe('list-loop')

      player.setRepeat('off')
      expect(player.state.playMode).toBe('sequence')
    })
  })

  describe('concurrency and race conditions', () => {
    it('cancels in-flight start when playNow is called concurrently and keeps only the latest track', async () => {
      const { player, audio } = await harness()
      // Fire two rapid playNow calls concurrently
      const p1 = player.playNow([urn('a')])
      const p2 = player.playNow([urn('b')])
      await Promise.all([p1, p2])

      expect(player.state.trackUrn).toBe(urn('b'))
      expect(player.state.status).toBe('playing')
      expect(audio.playing?.src).toBe('file:///music/b.flac')
    })

    it('does not duplicate playback when play is invoked while loading', async () => {
      const { player, audio } = await harness()
      await player.playNow([urn('a')])
      const p1 = player.play()
      const p2 = player.play()
      await Promise.all([p1, p2])
      expect(player.state.trackUrn).toBe(urn('a'))
      expect(player.state.status).toBe('playing')
      expect(audio.playing?.src).toBe('file:///music/a.flac')
    })
  })
})


