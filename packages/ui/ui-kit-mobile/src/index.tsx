/**
 * `@BBeBee/ui-kit-mobile` - the parity component set, React Native.
 *
 * Twin of `ui-kit-desktop`: same names, same props, same tokens. `ui-parity`
 * fails the build if they diverge, because the moment `Button` takes
 * `onPress` on one and `onClick` on the other, every plugin author pays for
 * it twice, forever (docs/08 6).
 *
 * ⚠️ **`react-native` is injected, not imported.** The repo's existing mobile
 * view packages do the same, and the reason is worth stating: importing it
 * pulls in native modules, so the package could not be typechecked or
 * unit-tested anywhere but a device — and a check that only runs on one of two
 * platforms is most of the way to no check at all. The shell calls
 * `configureNative` once at boot with the real module.
 */

export * from './manifest.js'

export {
  type NativePrimitives,
  configureNative,
  setScheme,
  nativePrimitives,
} from './primitives.js'

export { Button, IconButton } from './components/Button.js'
export { useI18n, type UseI18nResult } from './hooks/use-i18n.js'
export { TextField } from './components/TextField.js'
export { Text } from './components/Text.js'
export { Artwork } from './components/Artwork.js'
export { TrackRow } from './components/TrackRow.js'
export { Slider } from './components/Slider.js'
export { Sheet } from './components/Sheet.js'
export { ContextMenu } from './components/ContextMenu.js'
export { List } from './components/List.js'
export { EmptyState } from './components/EmptyState.js'
export { JsonTree, type JsonDirective } from './components/JsonTree.js'
export { Toast } from './components/Toast.js'
