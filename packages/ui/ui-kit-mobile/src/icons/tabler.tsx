import { createElement as h, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { SvgPrimitives } from '../primitives.js'
import { nativePrimitives } from '../primitives.js'
import { TABLER_ICON_DEFS, type IconSvgDefinition } from './tabler-defs.generated.js'

export interface TablerIconProps {
  size?: number
  color?: string
  stroke?: number
}

/** The desktop kit's standard stroke width (`ui-kit-desktop/src/icons/tabler.ts`). */
export const DEFAULT_STROKE_WIDTH = 1.25

export const ICON_ALIASES: Record<string, string> = {
  // Navigation & Shell
  home: 'home',
  '🏠': 'home',
  '⌂': 'home',
  menu: 'menu-2',
  'menu-2': 'menu-2',
  '☰': 'menu-2',

  // Search
  search: 'search',
  '🔍': 'search',
  '🔎': 'search',
  '⌕': 'search',

  // Playback transport
  play: 'play-filled',
  'play-filled': 'play-filled',
  'player-play': 'play',
  'player-play-filled': 'play-filled',
  'play-outline': 'play',
  '▶': 'play-filled',
  pause: 'pause-filled',
  'pause-filled': 'pause-filled',
  'player-pause': 'pause',
  'player-pause-filled': 'pause-filled',
  'pause-outline': 'pause',
  '⏸': 'pause-filled',
  previous: 'skip-back',
  'skip-back': 'skip-back',
  '⏮': 'skip-back',
  next: 'skip-forward',
  'skip-forward': 'skip-forward',
  '⏭': 'skip-forward',

  // Volume
  volume: 'volume',
  'volume-high': 'volume',
  high: 'volume',
  '🔊': 'volume',
  'volume-2': 'volume-2',
  'volume-medium': 'volume-2',
  'volume-low': 'volume-2',
  '🔉': 'volume-2',
  '🔈': 'volume-2',
  'volume-3': 'volume-3',
  'volume-zero': 'volume-3',
  mute: 'volume-off',
  'volume-off': 'volume-off',
  muted: 'volume-off',
  '🔇': 'volume-off',

  // Play modes
  shuffle: 'shuffle',
  '🔀': 'shuffle',
  repeat: 'repeat',
  'list-loop': 'repeat',
  '🔁': 'repeat',
  'repeat-once': 'repeat-once',
  'single-loop': 'repeat-once',
  '🔂': 'repeat-once',
  sequence: 'list-numbers',
  'list-numbers': 'list-numbers',

  // Heart / Favorite
  heart: 'heart',
  love: 'heart',
  '♡': 'heart',
  'heart-filled': 'heart-filled',
  loved: 'heart-filled',
  '♥': 'heart-filled',
  '❤': 'heart-filled',
  '🖤': 'heart-filled',
  '💚': 'heart-filled',
  bookmark: 'bookmark',
  'bookmark-filled': 'bookmark-filled',
  '🔖': 'bookmark-filled',

  // Plus / Add
  plus: 'plus',
  add: 'plus',
  '＋': 'plus',
  '+': 'plus',

  // Minus / Remove
  minus: 'minus',
  remove: 'minus',
  '－': 'minus',
  '-': 'minus',
  '⊝': 'minus',

  // Trash / Delete
  trash: 'trash',
  delete: 'trash',
  '🗑': 'trash',

  // Close / Dismiss
  x: 'x',
  close: 'x',
  dismiss: 'x',
  clear: 'x',
  '✕': 'x',
  '×': 'x',

  // Folders & Library
  folder: 'folder',
  '📁': 'folder',
  '🗂': 'folder',
  'folder-plus': 'folder-plus',
  'create-folder': 'folder-plus',
  'folder-share': 'folder-share',
  'move-folder': 'folder-share',
  books: 'books',
  library: 'books',

  // Music & Disc
  music: 'music',
  track: 'music',
  song: 'music',
  lyrics: 'lyrics',
  'lyrics-toggle': 'lyrics',
  '歌词': 'lyrics',
  '🎵': 'music',
  '♪': 'music',
  '♫': 'music',
  disc: 'disc',
  album: 'disc',
  '💿': 'disc',

  // Pin & Edit
  pin: 'pin',
  unpin: 'pin',
  '📌': 'pin',
  pencil: 'pencil',
  edit: 'pencil',
  rename: 'pencil',
  '✎': 'pencil',
  '✏': 'pencil',

  // Download & Clock
  download: 'download',
  '⬇': 'download',
  clock: 'clock',
  time: 'clock',
  duration: 'clock',
  '⏱': 'clock',
  '🕒': 'clock',
  alarm: 'alarm',
  'alarm-clock': 'alarm',
  history: 'history',

  // Playlist & Queue
  playlist: 'playlist',
  queue: 'playlist',
  list: 'list',
  'layout-list': 'list',
  layout: 'list',
  'view-mode': 'list',
  checkbox: 'list-check',
  '≣': 'list',
  sort: 'arrows-sort',
  'arrows-sort': 'arrows-sort',
  'playlist-add': 'playlist-add',
  'create-playlist': 'playlist-add',
  'music-plus': 'playlist-add',
  '≡': 'playlist-add',
  '♫+': 'playlist-add',
  '♫＋': 'playlist-add',
  '📁＋': 'folder-plus',

  // Dots / More
  dots: 'dots',
  more: 'dots',
  overflow: 'dots',
  '⋯': 'dots',
  '…': 'dots',
  '·': 'dots',
  'dots-vertical': 'dots-vertical',
  '⋮': 'dots-vertical',

  // Chevrons & Arrows
  'chevron-left': 'chevron-left',
  back: 'chevron-left',
  '←': 'chevron-left',
  '‹': 'chevron-left',
  '<': 'chevron-left',
  'chevron-right': 'chevron-right',
  forward: 'chevron-right',
  '→': 'chevron-right',
  '›': 'chevron-right',
  '>': 'chevron-right',
  '▸': 'chevron-right',
  'chevron-down': 'chevron-down',
  expand: 'chevron-down',
  '▼': 'chevron-down',
  'chevron-up': 'chevron-up',
  collapse: 'chevron-up',
  '▲': 'chevron-up',
  'arrow-up': 'arrow-up',
  '↑': 'arrow-up',
  'arrow-down': 'arrow-down',
  '↓': 'arrow-down',

  // Status & UI
  check: 'check',
  checkmark: 'check',
  '✓': 'check',
  '✔': 'check',
  'list-check': 'list-check',
  checklist: 'list-check',
  camera: 'camera',
  photo: 'camera',
  '📷': 'camera',
  lock: 'lock',
  '🔒': 'lock',
  'lock-open': 'lock-open',
  unlock: 'lock-open',
  '🔓': 'lock-open',
  alert: 'alert',
  warning: 'alert',
  '⚠': 'alert',
  '⚠️': 'alert',
  user: 'user',
  profile: 'user',
  avatar: 'user',
  '👤': 'user',
  settings: 'settings',
  gear: 'settings',
  '⚙': 'settings',
  '⚙︎': 'settings',
  adjustments: 'adjustments',
  tune: 'adjustments',
  dsp: 'adjustments',
  transform: 'transform',
  convert: 'transform',
  converter: 'transform',
  'audio-converter': 'transform',
  'arrows-exchange': 'arrows-exchange',
  exchange: 'arrows-exchange',
  '⇄': 'arrows-exchange',
  bug: 'bug',
  inspector: 'bug',
  cloud: 'cloud',
  '☁': 'cloud',
  '☁︎': 'cloud',
  palette: 'palette',
  '◐': 'palette',
  world: 'world',
  globe: 'world',
  network: 'world',
  '🌐': 'world',
  eye: 'eye',
  'eye-off': 'eye-off',
  refresh: 'refresh',
  upload: 'upload',

  // Layout & Windows
  'layout-sidebar': 'layout-sidebar',
  sidebar: 'layout-sidebar',
  'layout-sidebar-left-collapse': 'layout-sidebar-left-collapse',
  'sidebar-collapse': 'layout-sidebar-left-collapse',
  'layout-sidebar-left-expand': 'layout-sidebar-left-expand',
  'sidebar-expand': 'layout-sidebar-left-expand',
  maximize: 'maximize',
  fullscreen: 'maximize',
  minimize: 'minimize',
  square: 'square',
  copy: 'copy',
  restore: 'copy',
  'wave-sine': 'wave-sine',
  equalizer: 'wave-sine',
  share: 'share',
  '⇪': 'share',
  'share-box': 'share-box',
  'external-link': 'share-box',
  'info-circle': 'info-circle',
  info: 'info-circle',
  'ℹ️': 'info-circle',
  'ℹ': 'info-circle',
  'ⓘ': 'info-circle',
  compass: 'compass',
  discover: 'compass',
  '🧭': 'compass',
}

const TAG_TO_PRIMITIVE: Record<string, keyof SvgPrimitives> = {
  path: 'Path',
  circle: 'Circle',
  rect: 'Rect',
  line: 'Line',
  polyline: 'Polyline',
  polygon: 'Polygon',
  g: 'G',
}

/**
 * The Tabler icon, drawn through the injected `react-native-svg` primitives —
 * the same 24x24 geometry and the desktop kit's 1.25 stroke standard, so the
 * two platforms render identical icons (rules/ui.md §4.1). Returns `null` when
 * the shell configured no SVG primitives or the name is not in the vendored
 * subset; callers decide their own fallback (the kit's text-glyph maps).
 */
export function tablerIcon(nameOrGlyph: ReactNode, props: TablerIconProps = {}): ReactElement | null {
  if (nameOrGlyph == null) return null
  if (isValidElement(nameOrGlyph)) return nameOrGlyph as ReactElement

  if (typeof nameOrGlyph !== 'string') return null

  const svg = nativePrimitives().svg
  if (!svg) return null

  const trimmed = nameOrGlyph.trim()
  const targetKey = ICON_ALIASES[trimmed] ?? ICON_ALIASES[nameOrGlyph] ?? trimmed
  const def: IconSvgDefinition | undefined = TABLER_ICON_DEFS[targetKey]
  if (!def) return null

  const size = props.size ?? 24
  const stroke = props.stroke ?? DEFAULT_STROKE_WIDTH
  const color = props.color ?? 'currentColor'

  const children = [
    h(svg.Path as never, { key: 'bg', d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' }),
    ...def.elements.map((el, idx) => {
      const primitive = svg[TAG_TO_PRIMITIVE[el.tag] ?? 'Path'] as never
      return h(primitive, { key: idx, ...el.attrs })
    }),
  ]

  return h(
    svg.Svg as never,
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: def.filled ? color : 'none',
      stroke: def.filled ? 'none' : color,
      strokeWidth: def.filled ? undefined : stroke,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    ...children,
  )
}

/** Whether the shell wired SVG primitives — callers use this to pick a fallback. */
export function hasSvgIcons(): boolean {
  return nativePrimitives().svg !== undefined
}
