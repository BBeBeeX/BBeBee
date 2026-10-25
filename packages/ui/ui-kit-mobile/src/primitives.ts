import { palettes, type Palette, type Scheme } from '@BBeBee/ui-tokens'
import type { Tone } from '@BBeBee/ui-core'

/**
 * The React Native primitives this kit builds on.
 *
 * Deliberately the smallest set that covers the component contract. Adding one
 * is a decision: it is another thing the shell must provide and another thing
 * a test must fake.
 */
export interface NativePrimitives {
  View: unknown
  Text: unknown
  Pressable: unknown
  Image: unknown
  Modal: unknown
  /**
   * `FlashList` from `@shopify/flash-list`, not `FlatList`.
   *
   * Recycling rather than mounting is what keeps a 100k-track library
   * scrolling on a low-end Android phone, and it is the mobile half of docs/11
   * §4.11. Injected like everything else here so this package still typechecks
   * and unit-tests without a device.
   */
  FlashList: unknown
  ActivityIndicator: unknown
  TextInput: unknown
  /**
   * React Native's `Appearance` module, injected like everything else native.
   *
   * Optional — and the only optional member: a shell that does not wire it
   * still boots, and `system` appearance mode degrades to dark, which is the
   * same answer the headless theme service gives when `matchMedia` is absent.
   * `plugin-theme-ui-mobile` reads it to resolve `system` mode natively.
   */
  Appearance?: AppearanceLike
}

/**
 * A stand-in used before `configureNative` runs.
 *
 * Renders host elements named after the primitive rather than throwing, so a
 * component tree can be inspected in a test without React Native present —
 * and so a shell that forgot to configure gets an obviously wrong screen
 * rather than a crash in a render pass nobody can read.
 */
const PLACEHOLDER: NativePrimitives = {
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  Image: 'Image',
  Modal: 'Modal',
  FlashList: 'FlashList',
  ActivityIndicator: 'ActivityIndicator',
  TextInput: 'TextInput',
}

/**
 * The subset of React Native's `Appearance` module the theme layer needs.
 *
 * Declared here rather than imported for the same reason every other native
 * touch in this kit is injected: importing `react-native` would make the kit
 * untestable off-device. Optional so a shell that never wires it still
 * typechecks — `system` appearance mode then resolves to dark, exactly the
 * degradation the headless theme service's `matchMedia` guard has.
 */
export interface AppearanceLike {
  getColorScheme(): 'light' | 'dark' | null
  addChangeListener(
    listener: (prefs: { colorScheme: 'light' | 'dark' | null }) => void,
  ): { remove(): void }
}

let native: NativePrimitives = PLACEHOLDER
let scheme: Scheme = 'dark'

/**
 * The theme-driven palette override, or `null` for the static design tokens.
 *
 * `plugin-theme-ui-mobile` sets this whenever the active theme (or the
 * effective scheme under it) changes; `c()` then hands every consumer the
 * theme's colours instead of the hardcoded dark set. `null` — the state
 * before any theme plugin has run — is byte-for-byte the old behaviour.
 */
let paletteOverride: Palette | null = null

type PaletteListener = (palette: Palette, scheme: Scheme) => void
const paletteListeners = new Set<PaletteListener>()

function notifyPalette(): void {
  const palette = activePalette()
  for (const listener of paletteListeners) listener(palette, scheme)
}

/** Called once by `apps/mobile` at boot, with the real `react-native` module. */
export function configureNative(primitives: NativePrimitives): void {
  native = primitives
}

export function setScheme(next: Scheme): void {
  if (next === scheme) return
  scheme = next
  notifyPalette()
}

/**
 * Installs (or, with `null`, removes) the theme-driven palette.
 *
 * Setting the currently-installed palette is a no-op, so a theme event that
 * re-fires with unchanged colours cannot churn subscribers.
 */
export function setPalette(next: Palette | null): void {
  if (next === paletteOverride) return
  paletteOverride = next
  notifyPalette()
}

/** The palette every `c()` call resolves to right now. */
export function activePalette(): Palette {
  return paletteOverride ?? palettes[scheme]
}

/** The scheme the static fallback resolves against (theme-independent). */
export function getScheme(): Scheme {
  return scheme
}

/**
 * Subscribes to palette (and scheme) changes. Returns the unsubscriber.
 *
 * This is the re-render mechanism: components that need to track the theme
 * call {@link usePalette}, which is a thin `useSyncExternalStore` over this —
 * and a shell that wants one global re-render on theme change subscribes its
 * root the same way.
 */
export function onPaletteChange(listener: PaletteListener): () => void {
  paletteListeners.add(listener)
  return () => {
    paletteListeners.delete(listener)
  }
}

/** The primitives currently in use. For the shell's own assertions and tests. */
export function nativePrimitives(): NativePrimitives {
  return native
}

export const c = (): Palette => activePalette()

/** Common attributes. React Native spells both of these its own way. */
export function common(props: { testID?: string; accessibilityLabel?: string }): {
  testID?: string
  accessibilityLabel?: string
} {
  return { testID: props.testID, accessibilityLabel: props.accessibilityLabel }
}

export const toneColor = (tone: Tone | undefined): string => {
  const p = c()
  switch (tone) {
    case 'muted':
      return p.text.secondary
    case 'accent':
      return p.accent.base
    case 'error':
      return p.state.error
    case 'warn':
      return p.state.warn
    case 'ok':
      return p.state.ok
    default:
      return p.text.primary
  }
}
