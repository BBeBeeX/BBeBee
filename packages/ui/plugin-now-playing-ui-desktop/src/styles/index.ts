/**
 * Now-playing layout style infrastructure.
 *
 * Every layout receives the same props — the data the full-screen player
 * needs — and arranges it differently on screen.  The mapping from style id
 * to component lives here so the screen can switch with a single lookup.
 */

import type { ComponentType } from 'react'
import type { Context } from 'cordis'
import type { NowPlayingStyleId, TransportState } from '@BBeBee/protocol'

import { ClassicLayout } from './ClassicLayout.js'
import { FullCoverLayout } from './FullCoverLayout.js'
import { VinylLayout } from './VinylLayout.js'
import { CompactLayout } from './CompactLayout.js'
import { CinematicLayout } from './CinematicLayout.js'
import { SandboxedLayout, type SandboxedLayoutProps } from './SandboxedLayout.js'

export { SandboxedLayout, type SandboxedLayoutProps }

export interface NowPlayingLayoutProps {
  ctx: Context
  onClose?: () => void

  /* transport state */
  state: TransportState
  position: number
  displayPosition: number
  duration: number | undefined
  can: {
    canPlay: boolean
    canPause: boolean
    canSeek: boolean
    canNext: boolean
    canPrevious: boolean
  }

  /* seeking */
  seekingPosition: number | undefined
  onSeekChange: (value: number) => void
  onSeekCommit: (value: number) => void

  /* optional slot components */
  PanelComponent: ComponentType<{ ctx: Context }> | null
  VisualizerComponent: ComponentType<{ ctx: Context }> | null

  /* lyrics visibility toggle */
  showLyrics?: boolean
  onToggleLyrics?: () => void
}

export const NOW_PLAYING_LAYOUT_MAP: Record<NowPlayingStyleId, ComponentType<NowPlayingLayoutProps>> = {
  cinematic: CinematicLayout,
  classic: ClassicLayout,
  'full-cover': FullCoverLayout,
  vinyl: VinylLayout,
  compact: CompactLayout,
}
