import { isValidElement, type ReactNode } from 'react'
import {
  createSvgIcon,
  TABLER_DEFINITIONS,
  type TablerIconProps,
} from './tabler.js'

export const ICON_ALIASES: Record<string, string> = {
  // Navigation
  home: 'home',
  '🏠': 'home',

  // Search
  search: 'search',
  '🔍': 'search',
  '🔎': 'search',

  // Playback transport
  play: 'play-filled',
  'play-outline': 'play',
  '▶': 'play-filled',
  pause: 'pause-filled',
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
  '🖤': 'heart-filled',
  '💚': 'heart-filled',

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
  '≣': 'list',
  sort: 'arrows-sort',
  'arrows-sort': 'arrows-sort',
  'playlist-add': 'playlist-add',
  'create-playlist': 'playlist-add',
  'music-plus': 'playlist-add',
  '≡': 'playlist-add',
  '♫+': 'playlist-add',

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

  // Status & UI
  check: 'check',
  checkmark: 'check',
  '✓': 'check',
  '✔': 'check',
  checkbox: 'checkbox',
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
  user: 'user',
  profile: 'user',
  avatar: 'user',
  '👤': 'user',
  settings: 'settings',
  gear: 'settings',
  '⚙': 'settings',
  adjustments: 'adjustments',
  tune: 'adjustments',
  dsp: 'adjustments',
  bug: 'bug',
  inspector: 'bug',

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
  'share-box': 'share-box',
  'external-link': 'share-box',
  'info-circle': 'info-circle',
  info: 'info-circle',
  'ℹ️': 'info-circle',
  'ℹ': 'info-circle',
}

/**
 * Renders a Tabler icon by name or legacy unicode glyph.
 * If input is already a ReactElement, returns it as-is.
 */
export function tablerIcon(
  nameOrGlyph: ReactNode,
  props: TablerIconProps = {},
): ReactNode {
  if (nameOrGlyph == null) return null
  if (isValidElement(nameOrGlyph)) return nameOrGlyph

  if (typeof nameOrGlyph === 'string') {
    const trimmed = nameOrGlyph.trim()
    const targetKey = ICON_ALIASES[trimmed] ?? ICON_ALIASES[nameOrGlyph] ?? trimmed
    const def = TABLER_DEFINITIONS[targetKey]

    if (def) {
      return createSvgIcon(targetKey, def, {
        'data-icon': targetKey,
        ...props,
      })
    }
  }

  return nameOrGlyph
}
