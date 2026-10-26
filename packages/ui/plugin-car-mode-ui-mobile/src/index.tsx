/**
 * React Native views for `@bbebee/plugin-car-mode`.
 *
 * One screen: the driving surface. Glanceable track, two huge text lines,
 * three transport targets sized for a fingertip on a bumpy road, one exit —
 * and nothing else. Every value comes from `@bbebee/plugin-player/hooks`
 * and `ctx.carMode`; every rule that would also hold on a desktop twin
 * (the state machine, the triggers, the charging proxy) lives in the
 * headless `@bbebee/plugin-car-mode` instead (docs/08 §1).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { CAR_MODE_VIEWS } from '@bbebee/plugin-car-mode/views'
import { isPlayingLike, useTransport } from '@bbebee/plugin-player/hooks'
import { Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

/**
 * The driving-optimized screen.
 *
 * Hit targets are the whole design: ≥64dp where the platform asks for 44
 * (`tokens.size.touchTarget`), because a moving car is the one context where
 * a missed tap is not an inconvenience. The two transport sizes below are
 * the screen's own geometry, not tokens — nothing else in the app wants a
 * 120dp circle, so a token for it would be a one-consumer constant.
 */
export function CarModeScreen({ ctx }: { ctx: Context }): ReactElement {
  const native = nativePrimitives()
  const state = useTransport(ctx)
  const playing = isPlayingLike(state.status)

  const exit = () => {
    // Exit names the live trigger, falling back to 'manual': the state
    // machine only honours a matching trigger, so a literal 'manual' would
    // strand a charging-activated mode on a screen the driver asked to leave.
    ctx.carMode.deactivate(ctx.carMode.trigger ?? 'manual')
    ctx.ui.navigate('library.home')
  }

  return h(
    native.View as never,
    {
      accessibilityLabel: 'Car mode',
      style: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: tokens.space[5],
        backgroundColor: p().bg.base,
      },
    },
    h(
      native.View as never,
      { style: { alignSelf: 'stretch', alignItems: 'flex-start', paddingTop: tokens.space[4] } },
      h(
        native.Pressable as never,
        {
          accessibilityRole: 'button',
          accessibilityLabel: 'Exit car mode',
          onPress: exit,
          style: {
            minHeight: tokens.size.touchTarget + tokens.space[2],
            paddingHorizontal: tokens.space[5],
            borderRadius: tokens.radius.pill,
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          },
        },
        h(Text, { variant: 'lg', children: 'Exit car mode' }),
      ),
    ),
    h(
      native.View as never,
      { style: { alignItems: 'center', gap: tokens.space[2], maxWidth: '100%' } },
      h(
        Text,
        {
          variant: 'display',
          numberOfLines: 2,
          children:
            state.nowPlaying?.title ?? (state.trackUrn ? 'Loading…' : 'Nothing playing'),
        },
      ),
      state.nowPlaying?.artist
        ? h(Text, {
            variant: 'xl',
            tone: 'muted',
            numberOfLines: 1,
            children: state.nowPlaying.artist,
          })
        : null,
    ),
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens.space[6],
          paddingBottom: tokens.space[6],
        },
      },
      h(DriveButton, {
        label: 'Previous track',
        glyph: '⏮',
        size: 88,
        onPress: () => void ctx.player.previous(),
      }),
      h(DriveButton, {
        label: playing ? 'Pause' : 'Play',
        glyph: playing ? '⏸' : '▶',
        size: 120,
        accent: true,
        onPress: () => ctx.player.togglePlay(),
      }),
      h(DriveButton, {
        label: 'Next track',
        glyph: '⏭',
        size: 88,
        onPress: () => void ctx.player.next(),
      }),
    ),
  )
}

/* ── the transport target ───────────────────────────────────────────────── */

/**
 * One oversized circular control. The kit's `IconButton` is the right tool
 * up to `tokens.size.touchTarget` (44dp); the driving screen's ≥64dp targets
 * are past its ceiling, so this is the kit's same Pressable-plus-glyph
 * recipe drawn at driving scale.
 */
function DriveButton({ label, glyph, size, accent = false, onPress }: {
  label: string
  glyph: string
  /** Diameter in dp; ≥64 by contract of this screen. */
  size: number
  accent?: boolean
  onPress: () => void
}): ReactElement {
  const native = nativePrimitives()
  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel: label,
      onPress,
      style: {
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: accent ? p().accent.base : 'rgba(255, 255, 255, 0.12)',
      },
    },
    h(
      native.Text as never,
      {
        style: {
          color: accent ? p().accent.on : p().text.primary,
          fontSize: size / 2.2,
          lineHeight: size,
        },
      },
      glyph,
    ),
  )
}

/* ── the plugin entry ───────────────────────────────────────────────────── */

export const name = 'plugin-car-mode-ui-mobile'
export const inject = ['ui', 'carMode', 'player']

/**
 * Register a component bound to **this** context, not the shell's — the same
 * rule as the sibling view packages (docs/08 §3).
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
  ctx.logger.info('plugin-car-mode-ui-mobile: loaded')
  return ctx.effect(function* () {
    yield ctx.ui.registerView(CAR_MODE_VIEWS.carMode, bound(ctx, CarModeScreen))
    /*
     * The screen's mobile entrance, the same answer `plugin-history-ui-mobile`
     * found: the shell's tab bar is a fixed four, so the route's tray
     * placement (surfaced by the desktop shell) has no mobile slot, and a
     * settings link row is the surface the settings screen already knows how
     * to draw. A contribution with no `action` renders as a row whose button
     * hands the id to `ui.navigate`. Contributed here, not in the headless
     * plugin, because the desktop keeps its own entrances.
     */
    yield ctx.ui.contribute({
      kind: 'settings',
      id: CAR_MODE_VIEWS.carMode,
      section: 'general',
      title: 'Car mode',
      order: 71,
    })
    /*
     * Auto-activation opens the screen: the charging proxy flips car mode on
     * with no user gesture, and a mode that turns on behind the current page
     * is a mode nobody can see. Only `active` navigates — deactivation leaves
     * the stack alone so the Exit button (and Back) own the way out.
     */
    yield ctx.on('car-mode/changed', (active) => {
      if (active) ctx.ui.navigate(CAR_MODE_VIEWS.carMode)
    })
  }, 'car-mode-ui-mobile')
}

export default { name, inject, apply }
