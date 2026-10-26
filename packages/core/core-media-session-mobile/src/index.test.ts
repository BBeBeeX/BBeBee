/**
 * `ctx.mediaSession` on mobile, without a phone.
 *
 * The native surface is an injected seam, so what runs here is the whole of
 * what this package actually decides: which OS event becomes which
 * `TransportCommand`, which controls a `setSupportedCommands` turns on and —
 * just as importantly — off, and whether artwork that is not yet local is
 * dropped rather than held onto. Whether the lock screen draws it is the
 * device smoke test (docs/11 §6, criterion 3).
 *
 * The conformance suite runs here too, because "green against every
 * implementation" is an M1 definition-of-done item and this is the second
 * implementation.
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { mediaSessionConformance } from '@BBeBee/protocol/conformance'
import type { TransportCommand } from '@BBeBee/protocol'
import { tick } from '@BBeBee/kernel/testing'
import type { PlaybackControlName, PlaybackNotificationInfo } from 'react-native-audio-api'
import plugin, { type MediaSessionRn, type NotificationManagerLike } from './index.js'

/** A stand-in for the playback notification, recording what it was told. */
function fakeNotifications() {
  const listeners = new Map<string, (event: { value?: number }) => void>()
  const state = {
    shown: undefined as PlaybackNotificationInfo | undefined,
    visible: false,
    controls: new Map<PlaybackControlName, boolean>(),
    hideCalls: 0,
  }

  const manager: NotificationManagerLike = {
    async show(info) {
      state.shown = info
      state.visible = true
    },
    async hide() {
      state.hideCalls += 1
      state.visible = false
      state.shown = undefined
    },
    async enableControl(control, enabled) {
      state.controls.set(control, enabled)
    },
    addEventListener(name, callback) {
      listeners.set(name, callback)
      return { remove: () => void listeners.delete(name) }
    },
  }

  return {
    manager,
    state,
    /** Fire an OS event, as a lock-screen press would. */
    fire(name: string, value?: number) {
      listeners.get(name)?.(value === undefined ? {} : { value })
    },
    enabled(): PlaybackControlName[] {
      return [...state.controls].filter(([, on]) => on).map(([control]) => control)
    },
  }
}

async function harness() {
  const fake = fakeNotifications()
  const ctx = new Context()
  await ctx.plugin(plugin, { notifications: fake.manager })
  await tick()
  return { ctx, fake, service: ctx.mediaSession as MediaSessionRn }
}

describe('what reaches the OS', () => {
  it('publishes a track immediately', async () => {
    const h = await harness()
    h.service.update({ title: 'Jóga', artist: 'Björk', durationMs: 303_000, positionMs: 1000 })
    await tick()

    expect(h.fake.state.shown).toMatchObject({ title: 'Jóga', artist: 'Björk' })
    // Seconds, not milliseconds: the native side reads them as seconds, and a
    // 303,000-second track is a five-day progress bar.
    expect(h.fake.state.shown?.duration).toBe(303)
    expect(h.fake.state.shown?.elapsedTime).toBe(1)
  })

  it('drops artwork that is not yet local', async () => {
    const h = await harness()
    h.service.update({ title: 'Jóga', artworkUri: 'https://example.com/cover.jpg' })
    await tick()
    // Both platforms need a local file, and a remote URL is ignored natively —
    // which looks exactly like artwork that failed to load. Publishing without
    // it and updating when the cached copy lands is the honest order
    // (docs/11 §4.4).
    expect(h.fake.state.shown?.artwork).toBeUndefined()
    expect(h.fake.state.shown?.title, 'the rest was published anyway').toBe('Jóga')

    h.service.update({ title: 'Jóga', artworkUri: 'file:///cache/cover.jpg' })
    await tick()
    expect(h.fake.state.shown?.artwork).toEqual({ uri: 'file:///cache/cover.jpg' })
  })

  it('turns unsupported controls off rather than ignoring their presses', async () => {
    const h = await harness()
    h.service.setSupportedCommands(['play', 'pause', 'seek'])
    await tick()

    expect(h.fake.enabled().sort()).toEqual(['pause', 'play', 'seekTo'])
    // A button left over from the previous track presses into nothing, which
    // is worse than a button that is not there.
    expect(h.fake.state.controls.get('nextTrack')).toBe(false)
    expect(h.fake.state.controls.get('skipForward')).toBe(false)
  })

  it('records a rate command without inventing a heart button for it', async () => {
    const h = await harness()
    h.service.update({ title: 'Jóga' })
    h.service.setSupportedCommands(['play', 'pause', 'rate'])
    await tick()

    // `react-native-audio-api` (0.13.x) has no like control and no event for
    // one, so advertising the command must light nothing up — while the
    // contract still records what the app supports, for the surface that
    // grows a heart later.
    expect(h.fake.enabled().sort()).toEqual(['pause', 'play'])
    expect(h.service.published()?.commands?.slice().sort()).toEqual(['pause', 'play', 'rate'])
  })

  it('leaves no notification behind on clear', async () => {
    const h = await harness()
    h.service.update({ title: 'Jóga' })
    await tick()
    expect(h.fake.state.visible).toBe(true)

    h.service.clear()
    await tick()
    expect(h.fake.state.visible, 'a disabled player leaves no ghost lock screen').toBe(false)
  })

  it('keeps playing while stalled, so the surface does not flicker', async () => {
    const h = await harness()
    h.service.update({ title: 'Jóga' })
    h.service.setPlaybackState('playing')
    await tick()
    expect(h.fake.state.shown?.state).toBe('playing')
  })
})

describe('what comes back from the OS', () => {
  it('maps every press onto the contract', async () => {
    const h = await harness()
    const seen: TransportCommand[] = []
    h.service.onCommand((c) => void seen.push(c))

    h.fake.fire('playbackNotificationPlay')
    h.fake.fire('playbackNotificationPause')
    h.fake.fire('playbackNotificationNextTrack')
    h.fake.fire('playbackNotificationPreviousTrack')

    expect(seen.map((c) => c.type)).toEqual(['play', 'pause', 'next', 'previous'])
  })

  it('converts seek positions from seconds', async () => {
    const h = await harness()
    const seen: TransportCommand[] = []
    h.service.onCommand((c) => void seen.push(c))

    h.fake.fire('playbackNotificationSeekTo', 42)
    expect(seen[0]).toEqual({ type: 'seek', positionMs: 42_000 })
  })

  it('signs a skip by which button was pressed', async () => {
    const h = await harness()
    const seen: TransportCommand[] = []
    h.service.onCommand((c) => void seen.push(c))

    h.fake.fire('playbackNotificationSkipForward', 15)
    h.fake.fire('playbackNotificationSkipBackward', 15)
    // Without the sign, "back 15 seconds" skips forward — the kind of bug that
    // is obvious on a device and invisible in a type.
    expect(seen).toEqual([
      { type: 'seek-relative', deltaMs: 15_000 },
      { type: 'seek-relative', deltaMs: -15_000 },
    ])
  })

  it('maps a dismissed notification to stop', async () => {
    const h = await harness()
    const seen: TransportCommand[] = []
    h.service.onCommand((c) => void seen.push(c))

    h.fake.fire('playbackNotificationDismissed')
    // Swiping the notification away removes the surface. Playing on into a
    // notification that no longer exists is the ghost surface arriving from
    // the one direction nobody looks.
    expect(seen).toEqual([{ type: 'stop' }])
  })

  it('stops delivering to a disposed listener', async () => {
    const h = await harness()
    const seen: TransportCommand[] = []
    const off = h.service.onCommand((c) => void seen.push(c))
    off()
    h.fake.fire('playbackNotificationPlay')
    expect(seen).toEqual([])
  })
})

describe(`${mediaSessionConformance.service} conformance — core-media-session-mobile`, () => {
  for (const check of mediaSessionConformance.checks) {
    it(`${check.name} — ${check.because}`, async () => {
      const h = await harness()
      await check.run({
        service: h.service,
        // The service's own intent, not the fake's confirmation: the native
        // calls are queued, and the contract is synchronous. `published()`
        // already answers in the conformance's shape.
        published: () => h.service.published(),
        press: (command) => {
          switch (command.type) {
            case 'seek':
              h.fake.fire('playbackNotificationSeekTo', command.positionMs / 1000)
              return
            case 'seek-relative':
              h.fake.fire(
                command.deltaMs < 0
                  ? 'playbackNotificationSkipBackward'
                  : 'playbackNotificationSkipForward',
                Math.abs(command.deltaMs) / 1000,
              )
              return
            case 'next':
              h.fake.fire('playbackNotificationNextTrack')
              return
            case 'previous':
              h.fake.fire('playbackNotificationPreviousTrack')
              return
            default:
              h.fake.fire(
                `playbackNotification${command.type[0]!.toUpperCase()}${command.type.slice(1)}`,
              )
          }
        },
      })
    })
  }
})
