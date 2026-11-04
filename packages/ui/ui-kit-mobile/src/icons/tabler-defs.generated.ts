/**
 * Tabler icon geometry definitions for React Native.
 * Authoritative 24x24 SVG geometry matching official Tabler Icons specs.
 */

export interface IconSvgDefinition {
  elements: Array<{ tag: string; attrs: Record<string, string | number> }>
  filled?: boolean
}

export const TABLER_ICON_DEFS: Record<string, IconSvgDefinition> = {
  adjustments: {
    elements: [
      { tag: "path", attrs: {"d":"M4 10a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"} },
      { tag: "path", attrs: {"d":"M6 4v4"} },
      { tag: "path", attrs: {"d":"M6 12v8"} },
      { tag: "path", attrs: {"d":"M10 16a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"} },
      { tag: "path", attrs: {"d":"M12 4v10"} },
      { tag: "path", attrs: {"d":"M12 18v2"} },
      { tag: "path", attrs: {"d":"M16 7a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"} },
      { tag: "path", attrs: {"d":"M18 4v1"} },
      { tag: "path", attrs: {"d":"M18 9v11"} },
    ],
  },
  alarm: {
    elements: [
      { tag: "path", attrs: {"d":"M12 13m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"} },
      { tag: "path", attrs: {"d":"M12 10l0 3l2 0"} },
      { tag: "path", attrs: {"d":"M7 4l-2.75 2"} },
      { tag: "path", attrs: {"d":"M17 4l2.75 2"} },
    ],
  },
  alert: {
    elements: [
      { tag: "path", attrs: {"d":"M12 9v4"} },
      { tag: "path", attrs: {"d":"M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"} },
      { tag: "path", attrs: {"d":"M12 16h.01"} },
    ],
  },
  "arrow-down": {
    elements: [
      { tag: "path", attrs: {"d":"M12 5l0 14"} },
      { tag: "path", attrs: {"d":"M18 13l-6 6"} },
      { tag: "path", attrs: {"d":"M6 13l6 6"} },
    ],
  },
  "arrow-up": {
    elements: [
      { tag: "path", attrs: {"d":"M12 5l0 14"} },
      { tag: "path", attrs: {"d":"M18 11l-6 -6"} },
      { tag: "path", attrs: {"d":"M6 11l6 -6"} },
    ],
  },
  "arrows-exchange": {
    elements: [
      { tag: "path", attrs: {"d":"M7 10h14l-4 -4"} },
      { tag: "path", attrs: {"d":"M17 14h-14l4 4"} },
    ],
  },
  "arrows-sort": {
    elements: [
      { tag: "path", attrs: {"d":"M3 9l4 -4l4 4"} },
      { tag: "path", attrs: {"d":"M7 5v14"} },
      { tag: "path", attrs: {"d":"M21 15l-4 4l-4 -4"} },
      { tag: "path", attrs: {"d":"M17 19v-14"} },
    ],
  },
  ban: {
    elements: [
      { tag: "circle", attrs: {"cx":12,"cy":12,"r":9} },
      { tag: "path", attrs: {"d":"M5.7 5.7l12.6 12.6"} },
    ],
  },
  bookmark: {
    elements: [
      { tag: "path", attrs: {"d":"M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4z"} },
    ],
  },
  "bookmark-filled": {
    filled: true,
    elements: [
      { tag: "path", attrs: {"d":"M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4z"} },
    ],
  },
  books: {
    elements: [
      { tag: "path", attrs: {"d":"M5 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"} },
      { tag: "path", attrs: {"d":"M9 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"} },
      { tag: "path", attrs: {"d":"M5 8h4"} },
      { tag: "path", attrs: {"d":"M9 16h4"} },
      { tag: "path", attrs: {"d":"M13.803 4.56l2.184 -.53c.562 -.135 1.133 .19 1.282 .732l3.695 13.418a1.02 1.02 0 0 1 -.634 1.219l-.133 .041l-2.184 .53c-.562 .135 -1.133 -.19 -1.282 -.732l-3.695 -13.418a1.02 1.02 0 0 1 .634 -1.219l.133 -.041z"} },
      { tag: "path", attrs: {"d":"M14 9l4 -1"} },
      { tag: "path", attrs: {"d":"M16 16l3.923 -.98"} },
    ],
  },
  bug: {
    elements: [
      { tag: "path", attrs: {"d":"M9 9v-1a3 3 0 0 1 6 0v1"} },
      { tag: "path", attrs: {"d":"M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3"} },
      { tag: "path", attrs: {"d":"M3 13l4 0"} },
      { tag: "path", attrs: {"d":"M17 13l4 0"} },
      { tag: "path", attrs: {"d":"M12 20l0 -6"} },
      { tag: "path", attrs: {"d":"M4 19l3.35 -2"} },
      { tag: "path", attrs: {"d":"M20 19l-3.35 -2"} },
      { tag: "path", attrs: {"d":"M4 7l3.75 1.5"} },
      { tag: "path", attrs: {"d":"M20 7l-3.75 1.5"} },
    ],
  },
  camera: {
    elements: [
      { tag: "path", attrs: {"d":"M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2"} },
      { tag: "path", attrs: {"d":"M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"} },
    ],
  },
  check: {
    elements: [
      { tag: "path", attrs: {"d":"M5 12l5 5l10 -10"} },
    ],
  },
  checkbox: {
    elements: [
      { tag: "path", attrs: {"d":"M9 11l3 3l8 -8"} },
      { tag: "path", attrs: {"d":"M20 12v6a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h9"} },
    ],
  },
  "chevron-down": {
    elements: [
      { tag: "path", attrs: {"d":"M6 9l6 6l6 -6"} },
    ],
  },
  "chevron-left": {
    elements: [
      { tag: "path", attrs: {"d":"M15 6l-6 6l6 6"} },
    ],
  },
  "chevron-right": {
    elements: [
      { tag: "path", attrs: {"d":"M9 6l6 6l-6 6"} },
    ],
  },
  "chevron-up": {
    elements: [
      { tag: "path", attrs: {"d":"M6 15l6 -6l6 6"} },
    ],
  },
  clock: {
    elements: [
      { tag: "path", attrs: {"d":"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"} },
      { tag: "path", attrs: {"d":"M12 7v5l3 3"} },
    ],
  },
  cloud: {
    elements: [
      { tag: "path", attrs: {"d":"M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.708c2.113 -.57 4.378 .365 5.4 2.274c.952 -.488 2.08 -.583 3.097 -.26c2.034 .645 3.471 2.507 3.471 4.695c0 2.475 -2.085 4.482 -4.657 4.482z"} },
    ],
  },
  compass: {
    elements: [
      { tag: "path", attrs: {"d":"M8 16l2 -6l6 -2l-2 6l-6 2"} },
      { tag: "path", attrs: {"d":"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"} },
    ],
  },
  copy: {
    elements: [
      { tag: "path", attrs: {"d":"M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z"} },
      { tag: "path", attrs: {"d":"M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"} },
    ],
  },
  disc: {
    elements: [
      { tag: "path", attrs: {"d":"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"} },
      { tag: "path", attrs: {"d":"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
      { tag: "path", attrs: {"d":"M7 12a5 5 0 0 1 5 -5"} },
      { tag: "path", attrs: {"d":"M12 17a5 5 0 0 0 5 -5"} },
    ],
  },
  dots: {
    elements: [
      { tag: "path", attrs: {"d":"M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
      { tag: "path", attrs: {"d":"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
      { tag: "path", attrs: {"d":"M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
    ],
  },
  "dots-vertical": {
    elements: [
      { tag: "path", attrs: {"d":"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
      { tag: "path", attrs: {"d":"M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
      { tag: "path", attrs: {"d":"M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
    ],
  },
  download: {
    elements: [
      { tag: "path", attrs: {"d":"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"} },
      { tag: "path", attrs: {"d":"M7 11l5 5l5 -5"} },
      { tag: "path", attrs: {"d":"M12 4l0 12"} },
    ],
  },
  eye: {
    elements: [
      { tag: "path", attrs: {"d":"M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"} },
      { tag: "path", attrs: {"d":"M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"} },
    ],
  },
  "eye-off": {
    elements: [
      { tag: "path", attrs: {"d":"M10.585 10.587a2 2 0 0 0 2.829 2.828"} },
      { tag: "path", attrs: {"d":"M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87"} },
      { tag: "path", attrs: {"d":"M3 3l18 18"} },
    ],
  },
  folder: {
    elements: [
      { tag: "path", attrs: {"d":"M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2"} },
    ],
  },
  "folder-plus": {
    elements: [
      { tag: "path", attrs: {"d":"M12 19h-7a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v3.5"} },
      { tag: "path", attrs: {"d":"M16 19h6"} },
      { tag: "path", attrs: {"d":"M19 16v6"} },
    ],
  },
  "folder-share": {
    elements: [
      { tag: "path", attrs: {"d":"M13 19h-8a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v4"} },
      { tag: "path", attrs: {"d":"M16 22l5 -5"} },
      { tag: "path", attrs: {"d":"M21 21.5v-4.5h-4.5"} },
    ],
  },
  heart: {
    elements: [
      { tag: "path", attrs: {"d":"M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"} },
    ],
  },
  "heart-filled": {
    filled: true,
    elements: [
      { tag: "path", attrs: {"d":"M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"} },
    ],
  },
  history: {
    elements: [
      { tag: "path", attrs: {"d":"M12 8l0 4l2 2"} },
      { tag: "path", attrs: {"d":"M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"} },
    ],
  },
  home: {
    elements: [
      { tag: "path", attrs: {"d":"M5 12l-2 0l9 -9l9 9l-2 0"} },
      { tag: "path", attrs: {"d":"M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"} },
      { tag: "path", attrs: {"d":"M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"} },
    ],
  },
  info: {
    elements: [
      { tag: "path", attrs: {"d":"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"} },
      { tag: "path", attrs: {"d":"M12 9h.01"} },
      { tag: "path", attrs: {"d":"M11 12h1v4h1"} },
    ],
  },
  "info-circle": {
    elements: [
      { tag: "path", attrs: {"d":"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"} },
      { tag: "path", attrs: {"d":"M12 9h.01"} },
      { tag: "path", attrs: {"d":"M11 12h1v4h1"} },
    ],
  },
  "layout-sidebar": {
    elements: [
      { tag: "path", attrs: {"d":"M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"} },
      { tag: "path", attrs: {"d":"M9 4l0 16"} },
    ],
  },
  "layout-sidebar-left-collapse": {
    elements: [
      { tag: "path", attrs: {"d":"M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"} },
      { tag: "path", attrs: {"d":"M9 4v16"} },
      { tag: "path", attrs: {"d":"M15 10l-2 2l2 2"} },
    ],
  },
  "layout-sidebar-left-expand": {
    elements: [
      { tag: "path", attrs: {"d":"M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"} },
      { tag: "path", attrs: {"d":"M9 4v16"} },
      { tag: "path", attrs: {"d":"M13 10l2 2l-2 2"} },
    ],
  },
  list: {
    elements: [
      { tag: "path", attrs: {"d":"M9 6l11 0"} },
      { tag: "path", attrs: {"d":"M9 12l11 0"} },
      { tag: "path", attrs: {"d":"M9 18l11 0"} },
      { tag: "path", attrs: {"d":"M5 6l0 .01"} },
      { tag: "path", attrs: {"d":"M5 12l0 .01"} },
      { tag: "path", attrs: {"d":"M5 18l0 .01"} },
    ],
  },
  "list-check": {
    elements: [
      { tag: "path", attrs: {"d":"M3.5 5.5l1.5 1.5l2.5 -2.5"} },
      { tag: "path", attrs: {"d":"M3.5 11.5l1.5 1.5l2.5 -2.5"} },
      { tag: "path", attrs: {"d":"M3.5 17.5l1.5 1.5l2.5 -2.5"} },
      { tag: "path", attrs: {"d":"M11 6l9 0"} },
      { tag: "path", attrs: {"d":"M11 12l9 0"} },
      { tag: "path", attrs: {"d":"M11 18l9 0"} },
    ],
  },
  "list-numbers": {
    elements: [
      { tag: "path", attrs: {"d":"M11 6h9"} },
      { tag: "path", attrs: {"d":"M11 12h9"} },
      { tag: "path", attrs: {"d":"M11 18h9"} },
      { tag: "path", attrs: {"d":"M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4"} },
      { tag: "path", attrs: {"d":"M6 10v-6l-2 2"} },
    ],
  },
  lock: {
    elements: [
      { tag: "path", attrs: {"d":"M5 11m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"} },
      { tag: "path", attrs: {"d":"M8 11v-4a4 4 0 0 1 8 0v4"} },
      { tag: "path", attrs: {"d":"M12 16m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
    ],
  },
  "lock-open": {
    elements: [
      { tag: "path", attrs: {"d":"M5 11m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"} },
      { tag: "path", attrs: {"d":"M12 16m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
      { tag: "path", attrs: {"d":"M8 11v-5a4 4 0 0 1 8 0"} },
    ],
  },
  lyrics: {
    elements: [
      { tag: "path", attrs: {"d":"M4 7h10M4 12h10M4 17h6"} },
      { tag: "path", attrs: {"d":"M17 17a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"} },
      { tag: "path", attrs: {"d":"M21 17v-10h2"} },
    ],
  },
  maximize: {
    elements: [
      { tag: "path", attrs: {"d":"M4 8v-2a2 2 0 0 1 2 -2h2"} },
      { tag: "path", attrs: {"d":"M4 16v2a2 2 0 0 0 2 2h2"} },
      { tag: "path", attrs: {"d":"M16 4h2a2 2 0 0 1 2 2v2"} },
      { tag: "path", attrs: {"d":"M16 20h2a2 2 0 0 0 2 -2v-2"} },
    ],
  },
  "menu-2": {
    elements: [
      { tag: "path", attrs: {"d":"M4 6l16 0"} },
      { tag: "path", attrs: {"d":"M4 12l16 0"} },
      { tag: "path", attrs: {"d":"M4 18l16 0"} },
    ],
  },
  minimize: {
    elements: [
      { tag: "path", attrs: {"d":"M15 19v-2a2 2 0 0 1 2 -2h2"} },
      { tag: "path", attrs: {"d":"M15 5v2a2 2 0 0 0 2 2h2"} },
      { tag: "path", attrs: {"d":"M5 15h2a2 2 0 0 1 2 2v2"} },
      { tag: "path", attrs: {"d":"M5 9h2a2 2 0 0 0 2 -2v-2"} },
    ],
  },
  minus: {
    elements: [
      { tag: "path", attrs: {"d":"M5 12l14 0"} },
    ],
  },
  music: {
    elements: [
      { tag: "path", attrs: {"d":"M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"} },
      { tag: "path", attrs: {"d":"M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"} },
      { tag: "path", attrs: {"d":"M9 17v-13h10v13"} },
      { tag: "path", attrs: {"d":"M9 8h10"} },
    ],
  },
  palette: {
    elements: [
      { tag: "path", attrs: {"d":"M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -.818 2.25"} },
      { tag: "path", attrs: {"d":"M8.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
      { tag: "path", attrs: {"d":"M12.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
      { tag: "path", attrs: {"d":"M16.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"} },
    ],
  },
  pause: {
    elements: [
      { tag: "rect", attrs: {"x":6,"y":5,"width":4,"height":14,"rx":1} },
      { tag: "rect", attrs: {"x":14,"y":5,"width":4,"height":14,"rx":1} },
    ],
  },
  "pause-filled": {
    filled: true,
    elements: [
      { tag: "rect", attrs: {"x":6,"y":5,"width":4,"height":14,"rx":1} },
      { tag: "rect", attrs: {"x":14,"y":5,"width":4,"height":14,"rx":1} },
    ],
  },
  pencil: {
    elements: [
      { tag: "path", attrs: {"d":"M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"} },
      { tag: "path", attrs: {"d":"M13.5 6.5l4 4"} },
    ],
  },
  pin: {
    elements: [
      { tag: "path", attrs: {"d":"M9 4v6l-2 4v2h10v-2l-2 -4v-6"} },
      { tag: "path", attrs: {"d":"M12 16l0 5"} },
      { tag: "path", attrs: {"d":"M8 4l8 0"} },
    ],
  },
  play: {
    elements: [
      { tag: "path", attrs: {"d":"M7 4v16l13 -8z"} },
    ],
  },
  "play-filled": {
    filled: true,
    elements: [
      { tag: "path", attrs: {"d":"M7 4v16l13 -8z"} },
    ],
  },
  playlist: {
    elements: [
      { tag: "path", attrs: {"d":"M14 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"} },
      { tag: "path", attrs: {"d":"M17 17v-13h4"} },
      { tag: "path", attrs: {"d":"M13 5h-10"} },
      { tag: "path", attrs: {"d":"M3 9l10 0"} },
      { tag: "path", attrs: {"d":"M9 13h-6"} },
    ],
  },
  "playlist-add": {
    elements: [
      { tag: "path", attrs: {"d":"M19 8h-14"} },
      { tag: "path", attrs: {"d":"M5 12h9"} },
      { tag: "path", attrs: {"d":"M5 16h6"} },
      { tag: "path", attrs: {"d":"M15 16h6"} },
      { tag: "path", attrs: {"d":"M18 13v6"} },
    ],
  },
  plus: {
    elements: [
      { tag: "path", attrs: {"d":"M12 5l0 14"} },
      { tag: "path", attrs: {"d":"M5 12l14 0"} },
    ],
  },
  power: {
    elements: [
      { tag: "path", attrs: {"d":"M7 6a7.75 7.75 0 1 0 10 0"} },
      { tag: "path", attrs: {"d":"M12 4l0 8"} },
    ],
  },
  refresh: {
    elements: [
      { tag: "path", attrs: {"d":"M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -5v5h5"} },
      { tag: "path", attrs: {"d":"M4 13a8.1 8.1 0 0 0 15.5 2m.5 5v-5h-5"} },
    ],
  },
  repeat: {
    elements: [
      { tag: "path", attrs: {"d":"M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3"} },
      { tag: "path", attrs: {"d":"M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3"} },
    ],
  },
  "repeat-once": {
    elements: [
      { tag: "path", attrs: {"d":"M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3"} },
      { tag: "path", attrs: {"d":"M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3"} },
      { tag: "path", attrs: {"d":"M11 11l1 -1v4"} },
    ],
  },
  search: {
    elements: [
      { tag: "path", attrs: {"d":"M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"} },
      { tag: "path", attrs: {"d":"M21 21l-6 -6"} },
    ],
  },
  settings: {
    elements: [
      { tag: "path", attrs: {"d":"M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z"} },
      { tag: "path", attrs: {"d":"M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"} },
    ],
  },
  share: {
    elements: [
      { tag: "circle", attrs: {"cx":6,"cy":12,"r":3} },
      { tag: "circle", attrs: {"cx":18,"cy":6,"r":3} },
      { tag: "circle", attrs: {"cx":18,"cy":18,"r":3} },
      { tag: "path", attrs: {"d":"M8.7 10.7l6.6 -3.4"} },
      { tag: "path", attrs: {"d":"M8.7 13.3l6.6 3.4"} },
    ],
  },
  "share-box": {
    elements: [
      { tag: "path", attrs: {"d":"M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"} },
      { tag: "path", attrs: {"d":"M11 13l9 -9"} },
      { tag: "path", attrs: {"d":"M15 4h5v5"} },
    ],
  },
  shuffle: {
    elements: [
      { tag: "path", attrs: {"d":"M18 4l3 3l-3 3"} },
      { tag: "path", attrs: {"d":"M18 20l3 -3l-3 -3"} },
      { tag: "path", attrs: {"d":"M3 7h3a5 5 0 0 1 5 5a5 5 0 0 0 5 5h5"} },
      { tag: "path", attrs: {"d":"M21 7h-5a4.978 4.978 0 0 0 -3 1.8m-4 7.4a4.978 4.978 0 0 1 -3 1.8h-3"} },
    ],
  },
  "skip-back": {
    elements: [
      { tag: "path", attrs: {"d":"M20 5v14l-12 -7z"} },
      { tag: "path", attrs: {"d":"M4 5l0 14"} },
    ],
  },
  "skip-forward": {
    elements: [
      { tag: "path", attrs: {"d":"M4 5v14l12 -7z"} },
      { tag: "path", attrs: {"d":"M20 5l0 14"} },
    ],
  },
  square: {
    elements: [
      { tag: "path", attrs: {"d":"M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"} },
    ],
  },
  star: {
    elements: [
      { tag: "path", attrs: {"d":"M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z"} },
    ],
  },
  "star-filled": {
    filled: true,
    elements: [
      { tag: "path", attrs: {"d":"M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z"} },
    ],
  },
  transform: {
    elements: [
      { tag: "path", attrs: {"d":"M3 6a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"} },
      { tag: "path", attrs: {"d":"M21 11v-3a2 2 0 0 0 -2 -2h-6l3 3m0 -6l-3 3"} },
      { tag: "path", attrs: {"d":"M3 13v3a2 2 0 0 0 2 2h6l-3 -3m0 6l3 -3"} },
      { tag: "path", attrs: {"d":"M15 18a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"} },
    ],
  },
  trash: {
    elements: [
      { tag: "path", attrs: {"d":"M4 7l16 0"} },
      { tag: "path", attrs: {"d":"M10 11l0 6"} },
      { tag: "path", attrs: {"d":"M14 11l0 6"} },
      { tag: "path", attrs: {"d":"M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"} },
      { tag: "path", attrs: {"d":"M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"} },
    ],
  },
  upload: {
    elements: [
      { tag: "path", attrs: {"d":"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"} },
      { tag: "path", attrs: {"d":"M7 9l5 -5l5 5"} },
      { tag: "path", attrs: {"d":"M12 4l0 12"} },
    ],
  },
  user: {
    elements: [
      { tag: "path", attrs: {"d":"M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"} },
      { tag: "path", attrs: {"d":"M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"} },
    ],
  },
  volume: {
    elements: [
      { tag: "path", attrs: {"d":"M15 8a5 5 0 0 1 0 8"} },
      { tag: "path", attrs: {"d":"M17.7 5a9 9 0 0 1 0 14"} },
      { tag: "path", attrs: {"d":"M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v16a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"} },
    ],
  },
  "volume-2": {
    elements: [
      { tag: "path", attrs: {"d":"M15 8a5 5 0 0 1 0 8"} },
      { tag: "path", attrs: {"d":"M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v16a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"} },
    ],
  },
  "volume-3": {
    elements: [
      { tag: "path", attrs: {"d":"M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v16a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"} },
    ],
  },
  "volume-off": {
    elements: [
      { tag: "path", attrs: {"d":"M15 8a5 5 0 0 1 1.4 2.3m.6 3.7a5 5 0 0 1 -2 3"} },
      { tag: "path", attrs: {"d":"M17.7 5a9 9 0 0 1 2.3 4.6m.2 3.4a9 9 0 0 1 -2.5 6"} },
      { tag: "path", attrs: {"d":"M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v6m0 4v6a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"} },
      { tag: "path", attrs: {"d":"M3 3l18 18"} },
    ],
  },
  "wave-sine": {
    elements: [
      { tag: "path", attrs: {"d":"M4 12c0 -4.97 1.79 -9 4 -9c2.21 0 4 4.03 4 9s1.79 9 4 9c2.21 0 4 -4.03 4 -9"} },
    ],
  },
  world: {
    elements: [
      { tag: "path", attrs: {"d":"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"} },
      { tag: "path", attrs: {"d":"M3.6 9h16.8"} },
      { tag: "path", attrs: {"d":"M3.6 15h16.8"} },
      { tag: "path", attrs: {"d":"M11.5 3a17 17 0 0 0 0 18"} },
      { tag: "path", attrs: {"d":"M12.5 3a17 17 0 0 1 0 18"} },
    ],
  },
  x: {
    elements: [
      { tag: "path", attrs: {"d":"M18 6l-12 12"} },
      { tag: "path", attrs: {"d":"M6 6l12 12"} },
    ],
  },
}
