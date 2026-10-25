/**
 * `usePalette()` — the React binding for the mobile palette resolver.
 *
 * The kit's components read `c()` inside their render bodies, so a palette
 * change repaints whatever re-renders. This hook is what makes something
 * re-render: it subscribes to `onPaletteChange` through
 * `useSyncExternalStore`, and any component (a screen, a card, or the
 * shell's root) that calls it repaints its subtree on the next theme or
 * scheme change. The snapshot is the palette object itself, which is
 * referentially stable between changes — the static design tokens are
 * module constants and `setPalette` installs one object at a time — so the
 * store never loops.
 *
 * Mirrors `useI18n` next door: no React context machinery, no provider; the
 * state lives in the kit module and the hook only observes it.
 */

import { useSyncExternalStore } from 'react'
import type { Palette } from '@BBeBee/ui-tokens'
import { activePalette, onPaletteChange } from '../primitives.js'

const subscribe = (listener: () => void): (() => void) => onPaletteChange(listener)

export function usePalette(): Palette {
  return useSyncExternalStore(subscribe, activePalette, activePalette)
}
