/**
 * React Native views for `@BBeBee/plugin-now-playing`.
 *
 * The same two surfaces as the desktop twin — the full-screen player and the
 * mini-player that opens it — transcribed onto the phone. Moved here together
 * from `plugin-player-ui-mobile`, because a bar with no page behind it is a
 * dead control.
 *
 * Layout, gestures and event wiring only: every value comes from
 * `@BBeBee/plugin-player/hooks`, and anything that would also be true on
 * desktop belongs in the headless package instead (docs/08 §1).
 *
 * **Style templates** — four layout variants (classic, full-cover, vinyl,
 * compact) selectable via `useNowPlayingStyle`. On narrow screens `compact`
 * falls back to a vertical stack rather than side-by-side.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { NowPlayingStyleId, UiService } from '@BBeBee/protocol'
import { NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { formatDuration } from '@BBeBee/toolkit'
import { NOW_PLAYING_VIEWS } from '@BBeBee/plugin-now-playing/views'
import { useNowPlayingStyle } from '@BBeBee/plugin-now-playing/hooks'
import {
  useDuration,
  usePosition,
  useTransport,
  useTransportAvailability,
} from '@BBeBee/plugin-player/hooks'
import { Artwork, IconButton, Slider, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { useResolvedArtwork } from '@BBeBee/plugin-cache/hooks'
import { serviceOf, useServiceState, type ArtworkProps } from '@BBeBee/ui-core'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/**
 * `<Artwork>`, with the cover resolved through `ctx.cache` first.
 */
function CachedArtwork({ ctx, ...props }: ArtworkProps & { ctx: Context }): ReactElement {
  const artwork = useResolvedArtwork(ctx, props.artwork)
  return h(Artwork, { ...props, artwork })
}

/* ── Style-specific layout helpers ─────────────────────────────────────── */

/** Transport controls row — shared across all styles. */
function TransportRow({ ctx, can }: { ctx: Context; can: ReturnType<typeof useTransportAvailability> }): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[4] } },
    h(IconButton, {
      icon: '⏮',
      accessibilityLabel: 'Previous track',
      disabled: !can.canPrevious,
      onPress: () => void ctx.player.previous(),
    }),
    h(IconButton, {
      icon: can.canPause ? '⏸' : '▶',
      accessibilityLabel: can.canPause ? 'Pause' : 'Play',
      variant: 'primary',
      size: tokens.size.iconLarge,
      disabled: !can.canPlay && !can.canPause,
      onPress: () => ctx.player.togglePlay(),
    }),
    h(IconButton, {
      icon: '⏭',
      accessibilityLabel: 'Next track',
      disabled: !can.canNext,
      onPress: () => void ctx.player.next(),
    }),
  )
}

/** Seek bar + timestamps — shared across all styles. */
function SeekBar({ ctx, position, duration, can }: {
  ctx: Context; position: number; duration: number | undefined; can: ReturnType<typeof useTransportAvailability>
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    { style: { alignSelf: 'stretch', gap: tokens.space[1] } },
    h(Slider, {
      value: duration ? Math.min(position, duration) : position,
      max: duration ?? 0,
      disabled: !can.canSeek,
      accessibilityLabel: 'Seek',
      onCommit: (value: number) => void ctx.player.seek(value),
    }),
    h(
      native.View as never,
      { style: { flexDirection: 'row', justifyContent: 'space-between' } },
      h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(position) }),
      h(Text, { variant: 'sm', tone: 'muted', children: formatDuration(duration) }),
    ),
  )
}

/** Track info block — shared across all styles. */
function TrackInfo({ state, align = 'center' }: {
  state: ReturnType<typeof useTransport>; align?: 'center' | 'flex-start'
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    { style: { alignItems: align, gap: tokens.space[1], maxWidth: '90%' } },
    h(Text, {
      variant: 'xl',
      numberOfLines: 1,
      children: state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'Nothing playing'),
    }),
    state.nowPlaying?.artist
      ? h(Text, { variant: 'md', tone: 'muted', numberOfLines: 1, children: state.nowPlaying.artist })
      : null,
    state.nowPlaying?.album
      ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: state.nowPlaying.album })
      : null,
  )
}

/* ── Classic layout ────────────────────────────────────────────────────── */

function ClassicMobileLayout({ ctx, state, position, duration, can, onClose }: {
  ctx: Context; state: ReturnType<typeof useTransport>
  position: number; duration: number | undefined
  can: ReturnType<typeof useTransportAvailability>; onClose?: () => void
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space[5],
        padding: tokens.space[5],
        backgroundColor: p().bg.base,
      },
    },
    onClose ? h(CloseButton, { onClose }) : null,
    h(CachedArtwork, { ctx, artwork: state.nowPlaying?.artwork, seed: state.trackUrn, size: 280, radius: tokens.radius.lg }),
    h(TrackInfo, { state }),
    state.status === 'stalled' ? h(Text, { variant: 'sm', tone: 'muted', children: 'Buffering…' }) : null,
    h(SeekBar, { ctx, position, duration, can }),
    h(TransportRow, { ctx, can }),
  )
}

/* ── Full-cover layout ─────────────────────────────────────────────────── */

function FullCoverMobileLayout({ ctx, state, position, duration, can, onClose }: {
  ctx: Context; state: ReturnType<typeof useTransport>
  position: number; duration: number | undefined
  can: ReturnType<typeof useTransportAvailability>; onClose?: () => void
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space[5],
        padding: tokens.space[5],
        backgroundColor: p().bg.base,
      },
    },
    /* background artwork (blurred via RN styles where supported) */
    h(
      native.View as never,
      {
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0.25,
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      h(CachedArtwork, {
        ctx,
        artwork: state.nowPlaying?.artwork,
        seed: state.trackUrn,
        size: 600,
        radius: 0,
      }),
    ),
    onClose ? h(CloseButton, { onClose }) : null,
    h(CachedArtwork, { ctx, artwork: state.nowPlaying?.artwork, seed: state.trackUrn, size: 240, radius: tokens.radius.lg }),
    h(TrackInfo, { state }),
    state.status === 'stalled' ? h(Text, { variant: 'sm', tone: 'muted', children: 'Buffering…' }) : null,
    h(SeekBar, { ctx, position, duration, can }),
    h(TransportRow, { ctx, can }),
  )
}

/* ── Vinyl layout ──────────────────────────────────────────────────────── */

function VinylMobileLayout({ ctx, state, position, duration, can, onClose }: {
  ctx: Context; state: ReturnType<typeof useTransport>
  position: number; duration: number | undefined
  can: ReturnType<typeof useTransportAvailability>; onClose?: () => void
}): ReactElement {
  const native = nativePrimitives()
  const discSize = 260
  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space[5],
        padding: tokens.space[5],
        backgroundColor: p().bg.base,
      },
    },
    onClose ? h(CloseButton, { onClose }) : null,
    /* vinyl disc: circular artwork */
    h(
      native.View as never,
      {
        accessibilityLabel: 'Vinyl disc',
        style: {
          width: discSize + 30,
          height: discSize + 30,
          borderRadius: (discSize + 30) / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1a1a1a',
          borderWidth: 8,
          borderColor: '#2a2a2a',
        },
      },
      h(CachedArtwork, {
        ctx,
        artwork: state.nowPlaying?.artwork,
        seed: state.trackUrn,
        size: discSize,
        radius: discSize / 2,
      }),
    ),
    h(TrackInfo, { state }),
    state.status === 'stalled' ? h(Text, { variant: 'sm', tone: 'muted', children: 'Buffering…' }) : null,
    h(SeekBar, { ctx, position, duration, can }),
    h(TransportRow, { ctx, can }),
  )
}

/* ── Compact layout ────────────────────────────────────────────────────── */

function CompactMobileLayout({ ctx, state, position, duration, can, onClose }: {
  ctx: Context; state: ReturnType<typeof useTransport>
  position: number; duration: number | undefined
  can: ReturnType<typeof useTransportAvailability>; onClose?: () => void
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        justifyContent: 'center',
        gap: tokens.space[4],
        padding: tokens.space[5],
        backgroundColor: p().bg.base,
      },
    },
    onClose ? h(CloseButton, { onClose }) : null,
    /* top row: artwork + info side-by-side */
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[4] } },
      h(CachedArtwork, { ctx, artwork: state.nowPlaying?.artwork, seed: state.trackUrn, size: 160, radius: tokens.radius.lg }),
      h(
        native.View as never,
        { style: { flex: 1, gap: tokens.space[1] } },
        h(Text, {
          variant: 'xl',
          numberOfLines: 2,
          children: state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'Nothing playing'),
        }),
        state.nowPlaying?.artist
          ? h(Text, { variant: 'md', tone: 'muted', numberOfLines: 1, children: state.nowPlaying.artist })
          : null,
        state.nowPlaying?.album
          ? h(Text, { variant: 'sm', tone: 'muted', numberOfLines: 1, children: state.nowPlaying.album })
          : null,
      ),
    ),
    state.status === 'stalled' ? h(Text, { variant: 'sm', tone: 'muted', children: 'Buffering…' }) : null,
    h(SeekBar, { ctx, position, duration, can }),
    h(TransportRow, { ctx, can }),
  )
}

/* ── Cinematic layout ──────────────────────────────────────────────────── */

function CinematicMobileLayout({ ctx, state, position, duration, can, onClose }: {
  ctx: Context; state: ReturnType<typeof useTransport>
  position: number; duration: number | undefined
  can: ReturnType<typeof useTransportAvailability>; onClose?: () => void
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space[4],
        padding: tokens.space[5],
        // Neutral dark base — blurred cover backdrop provides the theme color
        backgroundColor: '#0D1118',
      },
    },
    /* Blurred cover backdrop (cover theme color, slightly brighter) */
    h(
      native.View as never,
      {
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0.20,
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      h(CachedArtwork, {
        ctx,
        artwork: state.nowPlaying?.artwork,
        seed: state.trackUrn,
        size: 500,
        radius: 0,
      }),
    ),
    onClose ? h(CloseButton, { onClose }) : null,
    /* Square artwork with white border */
    h(
      native.View as never,
      {
        style: {
          borderWidth: 2,
          borderColor: 'rgba(255, 255, 255, 0.85)',
          borderRadius: 2,
          overflow: 'hidden',
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
        },
      },
      h(CachedArtwork, {
        ctx,
        artwork: state.nowPlaying?.artwork,
        seed: state.trackUrn,
        size: 240,
        radius: 0,
      }),
    ),
    h(TrackInfo, { state }),
    state.status === 'stalled' ? h(Text, { variant: 'sm', tone: 'muted', children: 'Buffering…' }) : null,
    h(SeekBar, { ctx, position, duration, can }),
    h(TransportRow, { ctx, can }),
  )
}

/* ── Close button ──────────────────────────────────────────────────────── */

function CloseButton({ onClose }: { onClose: () => void }): ReactElement {
  const native = nativePrimitives()
  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel: 'Close player',
      onPress: onClose,
      style: {
        alignSelf: 'flex-start',
        paddingVertical: tokens.space[1],
        paddingHorizontal: tokens.space[3],
        borderRadius: tokens.radius.pill,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
      },
    },
    h(Text, { variant: 'lg', children: '⌄' }),
  )
}

/* ── Style switcher button ─────────────────────────────────────────────── */

function StyleSwitcherButton({ styleId, setStyle }: {
  styleId: NowPlayingStyleId; setStyle: (id: NowPlayingStyleId) => void
}): ReactElement {
  const native = nativePrimitives()
  const styles = NOW_PLAYING_STYLES
  const currentIdx = styles.findIndex((s) => s.id === styleId)
  const nextIdx = (currentIdx + 1) % styles.length
  const next = styles[nextIdx]!

  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel: `切换播放页样式: ${next.name}`,
      onPress: () => setStyle(next.id),
      style: {
        alignSelf: 'flex-end',
        paddingVertical: tokens.space[1],
        paddingHorizontal: tokens.space[3],
        borderRadius: tokens.radius.pill,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
      },
    },
    h(Text, { variant: 'sm', children: `🎨 ${styles[currentIdx]?.name ?? '经典'}` }),
  )
}

/* ── Layout map ────────────────────────────────────────────────────────── */

const MOBILE_LAYOUT_MAP: Record<NowPlayingStyleId, typeof ClassicMobileLayout> = {
  classic: ClassicMobileLayout,
  cinematic: CinematicMobileLayout,
  'full-cover': FullCoverMobileLayout,
  vinyl: VinylMobileLayout,
  compact: CompactMobileLayout,
}

/* ── Main screen ───────────────────────────────────────────────────────── */

export interface NowPlayingScreenProps {
  ctx: Context
  onClose?: () => void
}

/** The full-screen player with switchable layout styles. */
export function NowPlayingScreen({ ctx, onClose }: NowPlayingScreenProps): ReactElement {
  const native = nativePrimitives()
  const state = useTransport(ctx)
  const position = usePosition(ctx)
  const duration = useDuration(ctx)
  const can = useTransportAvailability(ctx)
  const { styleId, setStyle } = useNowPlayingStyle(ctx)

  const Layout = MOBILE_LAYOUT_MAP[styleId] ?? MOBILE_LAYOUT_MAP.classic

  return h(
    native.View as never,
    {
      accessibilityLabel: 'Now playing',
      style: { flex: 1, backgroundColor: p().bg.base },
    },
    h(StyleSwitcherButton, { styleId, setStyle }),
    h(Layout, { ctx, state, position, duration, can, onClose }),
  )
}


export interface NowPlayingBarProps {
  ctx: Context
  onOpenNowPlaying?: () => void
}

/** The persistent transport bar on mobile. */
export function NowPlayingBar({ ctx, onOpenNowPlaying }: NowPlayingBarProps): ReactElement {
  const native = nativePrimitives()
  const state = useTransport(ctx)
  const can = useTransportAvailability(ctx)
  const actionSlots = useServiceState(
    ctx,
    ['ui/changed'],
    () => {
      const ui = serviceOf<UiService>(ctx, 'ui')
      return ui?.slotsFor?.('now-playing.actions') ?? []
    },
    { isEqual: (a, b) => a.length === b.length && a.every((item, i) => item.id === b[i]?.id) },
  )

  const handleOpen = () => {
    onOpenNowPlaying?.()
    ctx.ui?.navigate?.(NOW_PLAYING_VIEWS.nowPlaying)
  }

  if (!state.trackUrn && state.status === 'idle') {
    return h(native.View as never, { style: { display: 'none' } })
  }

  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel: 'Open now playing',
      onPress: handleOpen,
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: tokens.space[3],
        paddingVertical: tokens.space[2],
        backgroundColor: '#181822',
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.08)',
      },
    },
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens.space[3],
          flex: 1,
          minWidth: 0,
          marginRight: tokens.space[2],
        },
      },
      h(CachedArtwork, { ctx,
        artwork: state.nowPlaying?.artwork,
        seed: state.trackUrn,
        size: tokens.size.artworkThumb,
        radius: tokens.radius.sm,
      }),
      h(
        native.View as never,
        { style: { flex: 1, minWidth: 0 } },
        h(Text, {
          variant: 'sm',
          numberOfLines: 1,
          children: state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'Nothing playing'),
        }),
        state.nowPlaying?.artist
          ? h(Text, {
              variant: 'xs',
              tone: 'muted',
              numberOfLines: 1,
              children: state.nowPlaying.artist,
            })
          : null,
      ),
    ),
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
      ...(() => {
        const ui = serviceOf<UiService>(ctx, 'ui')
        return actionSlots
          .filter((slot) => !slot.when || slot.when({ ctx }))
          .map((slot) => {
            const Component = ui?.viewFor?.(slot.id) as
              | React.ComponentType<{ ctx: Context }>
              | undefined
            return Component ? h(Component, { key: slot.id, ctx }) : null
          })
          .filter(Boolean)
      })(),
      h(IconButton, {
        icon: can.canPause ? '⏸' : '▶',
        accessibilityLabel: can.canPause ? 'Pause' : 'Play',
        variant: 'ghost',
        size: tokens.size.icon,
        disabled: !can.canPlay && !can.canPause,
        onPress: () => ctx.player.togglePlay(),
      }),
    ),
  )
}

/* ── the plugin entry ──────────────────────────────────────────────────── */

export const name = 'plugin-now-playing-ui-mobile'

export const inject = ['ui', 'player', 'nowPlaying']

/**
 * Register a component bound to **this** context, not the shell's — the same
 * rule as the desktop twin, and the reason this closure exists (docs/08 §3).
 */
function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-now-playing-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(NOW_PLAYING_VIEWS.nowPlaying, bound(ctx, NowPlayingScreen))
    yield ctx.ui.registerView(NOW_PLAYING_VIEWS.bar, bound(ctx, NowPlayingBar))
  }, 'now-playing-ui-mobile')
}

export default { name, inject, apply }
