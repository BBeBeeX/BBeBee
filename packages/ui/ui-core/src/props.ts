/**
 * The props both kits accept.
 *
 * Written once, in the contract layer, so `Button` on desktop and `Button` on
 * mobile cannot drift into different shapes — the drift that would make every
 * plugin author pay twice, forever (docs/08 §6).
 *
 * These are *types only*: no React import, no platform import, so both kits
 * and the parity gate can read them.
 */

import type { ReactNode } from 'react'
import type { ArtworkRef, Track } from '@BBeBee/protocol'

/** On every component, so a caller never has to ask which ones take them. */
export interface CommonProps {
  /** One name for both platforms; each kit maps it to its own attribute. */
  testID?: string
  /**
   * The accessible name. Written once here and mapped to `aria-label` or
   * `accessibilityLabel` by the kit, because docs/08 §8 makes it mandatory on
   * every interactive element and a per-component decision gets forgotten.
   */
  accessibilityLabel?: string
  style?: unknown
}

export type Tone = 'default' | 'muted' | 'accent' | 'error' | 'warn' | 'ok'
export type TextVariant = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'display'
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends CommonProps {
  children: unknown
  /** Not `onClick`: one name across the kits, and a tap is not a click. */
  onPress: () => void
  variant?: ButtonVariant
  disabled?: boolean
  /** Shows progress *and* disables. Two props would drift apart. */
  loading?: boolean
}

export interface IconButtonProps extends CommonProps {
  icon: string
  onPress: () => void
  /** Required: an icon has no text to fall back on (docs/08 §8). */
  accessibilityLabel: string
  variant?: ButtonVariant
  disabled?: boolean
  size?: number
}

/** Where a context menu should appear. Desktop anchors to the pointer; mobile ignores it. */
export interface MenuAnchor {
  x: number
  y: number
}

/**
 * What an overflow handler receives.
 *
 * The anchor is optional because the two ways in are not the same gesture: a
 * right-click and a long-press carry a pointer position, a `⋯` button pressed
 * by keyboard carries none. A menu that got no anchor centres itself.
 */
export type MoreHandler = (anchor?: MenuAnchor) => void

/**
 * One row of a context menu.
 *
 * Deliberately serialisable and kit-shaped rather than a component: both kits
 * render the same list, and the *model* (which actions exist for this entity)
 * is built once, per shell, by `@BBeBee/ui-menus`.
 */
export interface MenuItemSpec {
  id: string
  label: string
  /** A leading glyph or element. The label is the accessible name. */
  icon?: string | ReactNode
  disabled?: boolean
  /**
   * Renders as a muted, flush-left section label rather than an action row:
   * no icon slot, no hover highlight, smaller type. Implies non-interactive.
   */
  heading?: boolean
  /** Destructive actions render in the error tone and sort last. */
  tone?: 'default' | 'danger'
  onSelect?: () => void | Promise<void>
  /** Opens a submenu instead of acting. */
  submenu?: SubmenuSpec
  /** Optional divider line after this item. */
  divider?: boolean
}

export interface SubmenuSpec {
  title?: string
  /** A filter field above the rows. Absent means the list is short enough. */
  searchPlaceholder?: string
  /**
   * A pinned row above the list that reveals an inline name field — "new
   * playlist". `onSelect` receives the trimmed name.
   */
  create?: {
    label: string
    placeholder: string
    /** When true, renders directly as an input field instead of requiring an expansion click. */
    alwaysVisible?: boolean
    /** Whether the create field sits above the list (default) or below it. */
    placement?: 'top' | 'bottom'
    /** Label for the confirm button (defaults to 'OK'). */
    buttonLabel?: string
    onSelect: (name: string) => void | Promise<void>
  }
  items: readonly MenuItemSpec[]
  /** Shown when the filter matches nothing. Owned by the model, not the kit. */
  emptyLabel?: string
}

export interface ContextMenuProps extends CommonProps {
  open: boolean
  onClose: () => void
  /** Pointer position. The mobile sheet ignores it; desktop clamps it on screen. */
  x: number
  y: number
  items: readonly MenuItemSpec[]
  /**
   * A heading — the entity's name. Without it a stack of open menus is
   * indistinguishable, and on mobile the sheet has no other context.
   */
  title?: string
  /**
   * Desktop only; the mobile sheet ignores it. Mounts the fixed overlay
   * through a portal on `document.body`. Needed when the menu lives inside
   * an ancestor whose `transform`/`overflow` would clip or re-anchor fixed
   * positioning — the fullscreen play page's hover bottom bar is one.
   */
  portal?: boolean
}

export interface TrackRowProps extends CommonProps {
  track: Track
  onPress?: () => void
  /** Overflow. Desktop also binds right-click; mobile a long-press. */
  onMore?: MoreHandler
  /** Toggle loved/favorite status. */
  onToggleLoved?: () => void
  /**
   * Queue this track for download.
   *
   * Absent when the build has no `ctx.downloads`, which is a normal state —
   * the button is simply not drawn rather than drawn and failing.
   */
  onDownload?: () => void
  /** This is the *playing* track, which is not the same as selected. */
  active?: boolean
  showArtwork?: boolean
  showAlbum?: boolean
}

export interface SliderProps extends CommonProps {
  value: number
  max: number
  /** While dragging. */
  onChange?: (value: number) => void
  /**
   * On release. Seeking on every frame of a drag is what makes a scrubber
   * unusable, so the two are separate and callers seek here.
   */
  onCommit?: (value: number) => void
  disabled?: boolean
}

export interface SheetProps extends CommonProps {
  open: boolean
  onClose: () => void
  title?: string
  children?: unknown
}

export interface ListProps<T> extends CommonProps {
  items: readonly T[]
  renderItem: (item: T, index: number) => unknown
  /** A 100k-track library needs stable keys or every scroll re-mounts rows. */
  keyExtractor: (item: T, index: number) => string
  /**
   * Row height hint for the desktop virtualiser, which windows by arithmetic
   * and should not have to guess. FlashList measures rows itself and ignores
   * it; one prop that one kit ignores is cheaper than two contracts.
   */
  estimatedItemSize?: number
  onEndReached?: () => void
  /** Page size for threshold calculation when scrolling past halfway of the last page. */
  pageSize?: number
  /** What to show instead of nothing. */
  empty?: unknown
  /**
   * Desktop only. Content scrolled inside the scroller above the rows — a
   * detail page's hero and toolbar scroll away with the list (the Spotify
   * layout). The virtualiser is offset by the header's measured height
   * automatically.
   */
  header?: ReactNode
  /**
   * Desktop only. The bar that stays while the header scrolls away — a
   * `position: sticky` element the scroller owns directly, because a sticky
   * element only sticks within its parent's box. Net-zero flow height
   * (`marginBottom: -height`) keeps it out of the virtualiser's offset.
   */
  sticky?: ReactNode
  /**
   * Desktop only. The table header that pins just below the sticky bar once
   * scrolled past (`position: sticky; top: <bar height>` in the caller's
   * styles). Rendered as the scroller's direct child too — nested inside the
   * header it would stick only within the header's box, i.e. not at all.
   */
  stickyHeader?: ReactNode
  /**
   * Desktop only. The scroller's scroll position, on every scroll event.
   * Drives collapsing headers: the bar's opacity is a function of this.
   */
  onScroll?: (scrollTop: number) => void
}

export interface EmptyStateProps extends CommonProps {
  title: string
  description?: string
  action?: unknown
  icon?: string
}

export interface ToastProps extends CommonProps {
  message: string
  tone?: 'info' | 'ok' | 'warn' | 'error'
  action?: unknown
  onDismiss?: () => void
}

export interface TextProps extends CommonProps {
  children?: unknown
  /** Names a scale entry; a raw pixel size is never passed. */
  variant?: TextVariant
  tone?: Tone
  numberOfLines?: number
}

/**
 * A text input.
 *
 * `multiline` exists because the two things users type into this app are a
 * pasted source document — hundreds of lines of JSON — and a one-line rule.
 * A single-line box for the first is unusable, and a text area for the second
 * is a rule editor that swallows the Enter key.
 *
 * Controlled only: an uncontrolled input on one platform and a controlled one
 * on the other is exactly the divergence the parity gate exists to prevent.
 */
export interface TextFieldProps extends CommonProps {
  value: string
  onChange(next: string): void
  placeholder?: string
  multiline?: boolean
  /** Rows when `multiline`. Ignored otherwise. */
  rows?: number
  /** Hides the value. A password field, not a styling choice. */
  secure?: boolean
  disabled?: boolean
  /** Shown beneath, in the danger tone. Absent means valid. */
  error?: string
  /** Off by default: a rule and a URL are both case- and spelling-sensitive. */
  autoCorrect?: boolean
}

export interface ArtworkProps extends CommonProps {
  artwork?: ArtworkRef
  size: number
  radius?: number
  seed?: string
}
