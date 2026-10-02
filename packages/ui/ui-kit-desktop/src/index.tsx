/**
 * `@BBeBee/ui-kit-desktop` - the parity component set, React DOM.
 *
 * Every component here has a twin in `ui-kit-mobile` with the same name and
 * the same props; `ui-parity` fails the build if they diverge. A plugin author
 * writing both view packages should be transcribing, not redesigning.
 *
 * Colours and scales come from `ui-tokens` and are never written inline: the
 * two kits look like one product because they read the same numbers, not
 * because someone matched them by eye.
 *
 * ⚠️ This package may import `react-dom`; it may not touch a platform
 * capability (docs/02 1). If a component here needs the filesystem, the
 * component is at the wrong altitude.
 */

export * from './manifest.js'

export { setScheme } from './theme.js'
export { Button, IconButton } from './components/Button.js'
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
export {
  SaveToPlaylistPopover,
  type SaveToPlaylistPopoverProps,
  type PlaylistSaveOption,
  type CollectionSaveOption,
} from './components/SaveToPlaylistPopover.js'
export { useImageColor, headerGradient, tintRgba, extractVibrantColor } from './components/coverTheme.js'
export { StickyDetailBar, type StickyDetailBarProps } from './components/StickyDetailBar.js'
export { useDetailBarCollapse, type DetailBarCollapse } from './components/useDetailBarCollapse.js'
export { DetailTableHeader, type DetailColumnSpec, type DetailTableHeaderProps } from './components/DetailTableHeader.js'
export { DetailPlayButton, type DetailPlayButtonProps } from './components/DetailPlayButton.js'
export { DetailHero, type DetailHeroProps } from './components/DetailHero.js'
export { HoverLabel, type HoverLabelProps } from './components/HoverLabel.js'
export { MarqueeText, type MarqueeTextProps } from './components/MarqueeText.js'
export { viewModeMenuItems, useViewMode, type TrackViewMode, type AlbumViewMode } from './components/ViewMode.js'
export { tablerIcon } from './icons/index.js'

