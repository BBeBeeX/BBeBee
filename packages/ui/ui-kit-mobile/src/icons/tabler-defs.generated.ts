/**
 * Tabler icon geometry subset for React Native — generated once from the
 * desktop kit's authoritative definitions (`ui-kit-desktop/src/icons/tabler.ts`),
 * which transcribe the official Tabler 24x24 specs. Only the names the mobile
 * shells and view packages actually render are vendored here; when a screen
 * needs another icon, add its name to the generator's list and re-extract —
 * never hand-draw geometry, or the two platforms' icons drift apart.
 *
 * Rendered through the injected `react-native-svg` primitives (see
 * `NativePrimitives.svg`); with no SVG primitives configured the kit falls
 * back to text glyphs, which is what the unit tests exercise.
 */

export interface IconSvgDefinition {
  elements: Array<{ tag: string; attrs: Record<string, string | number> }>
  filled?: boolean
}

export const TABLER_ICON_DEFS: Record<string, IconSvgDefinition> = {
  'arrows-sort': {
    elements: [
      { tag: 'path', attrs: { d: 'M3 9l4 -4l4 4' } },
      { tag: 'path', attrs: { d: 'M7 5v14' } },
      { tag: 'path', attrs: { d: 'M21 15l-4 4l-4 -4' } },
      { tag: 'path', attrs: { d: 'M17 19v-14' } },
    ],
  },
  books: {
    elements: [
      { tag: 'path', attrs: { d: 'M5 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z' } },
      { tag: 'path', attrs: { d: 'M9 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z' } },
      { tag: 'path', attrs: { d: 'M5 8h4' } },
      { tag: 'path', attrs: { d: 'M9 16h4' } },
      {
        tag: 'path',
        attrs: {
          d: 'M13.803 4.56l2.184 -.53c.562 -.135 1.133 .19 1.282 .732l3.695 13.418a1.02 1.02 0 0 1 -.634 1.219l-.133 .041l-2.184 .53c-.562 .135 -1.133 -.19 -1.282 -.732l-3.695 -13.418a1.02 1.02 0 0 1 .634 -1.219l.133 -.041z',
        },
      },
      { tag: 'path', attrs: { d: 'M14 9l4 -1' } },
      { tag: 'path', attrs: { d: 'M16 16l3.923 -.98' } },
    ],
  },
  check: {
    elements: [{ tag: 'path', attrs: { d: 'M5 12l5 5l10 -10' } }],
  },
  'chevron-down': {
    elements: [{ tag: 'path', attrs: { d: 'M6 9l6 6l6 -6' } }],
  },
  'chevron-right': {
    elements: [{ tag: 'path', attrs: { d: 'M9 6l6 6l-6 6' } }],
  },
  clock: {
    elements: [
      { tag: 'path', attrs: { d: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0' } },
      { tag: 'path', attrs: { d: 'M12 7v5l3 3' } },
    ],
  },
  disc: {
    elements: [
      { tag: 'path', attrs: { d: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0' } },
      { tag: 'path', attrs: { d: 'M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
      { tag: 'path', attrs: { d: 'M7 12a5 5 0 0 1 5 -5' } },
      { tag: 'path', attrs: { d: 'M12 17a5 5 0 0 0 5 -5' } },
    ],
  },
  dots: {
    elements: [
      { tag: 'path', attrs: { d: 'M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
      { tag: 'path', attrs: { d: 'M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
      { tag: 'path', attrs: { d: 'M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
    ],
  },
  download: {
    elements: [
      { tag: 'path', attrs: { d: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2' } },
      { tag: 'path', attrs: { d: 'M7 11l5 5l5 -5' } },
      { tag: 'path', attrs: { d: 'M12 4l0 12' } },
    ],
  },
  folder: {
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2',
        },
      },
    ],
  },
  heart: {
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572',
        },
      },
    ],
  },
  'heart-filled': {
    filled: true,
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572',
        },
      },
    ],
  },
  history: {
    elements: [
      { tag: 'path', attrs: { d: 'M12 8l0 4l2 2' } },
      { tag: 'path', attrs: { d: 'M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5' } },
    ],
  },
  home: {
    elements: [
      { tag: 'path', attrs: { d: 'M5 12l-2 0l9 -9l9 9l-2 0' } },
      { tag: 'path', attrs: { d: 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7' } },
      { tag: 'path', attrs: { d: 'M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6' } },
    ],
  },
  list: {
    elements: [
      { tag: 'path', attrs: { d: 'M9 6l11 0' } },
      { tag: 'path', attrs: { d: 'M9 12l11 0' } },
      { tag: 'path', attrs: { d: 'M9 18l11 0' } },
      { tag: 'path', attrs: { d: 'M5 6l0 .01' } },
      { tag: 'path', attrs: { d: 'M5 12l0 .01' } },
      { tag: 'path', attrs: { d: 'M5 18l0 .01' } },
    ],
  },
  'list-check': {
    elements: [
      { tag: 'path', attrs: { d: 'M3.5 5.5l1.5 1.5l2.5 -2.5' } },
      { tag: 'path', attrs: { d: 'M3.5 11.5l1.5 1.5l2.5 -2.5' } },
      { tag: 'path', attrs: { d: 'M3.5 17.5l1.5 1.5l2.5 -2.5' } },
      { tag: 'path', attrs: { d: 'M11 6l9 0' } },
      { tag: 'path', attrs: { d: 'M11 12l9 0' } },
      { tag: 'path', attrs: { d: 'M11 18l9 0' } },
    ],
  },
  minus: {
    elements: [{ tag: 'path', attrs: { d: 'M5 12l14 0' } }],
  },
  music: {
    elements: [
      { tag: 'path', attrs: { d: 'M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0' } },
      { tag: 'path', attrs: { d: 'M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0' } },
      { tag: 'path', attrs: { d: 'M9 17v-13h10v13' } },
      { tag: 'path', attrs: { d: 'M9 8h10' } },
    ],
  },
  pencil: {
    elements: [
      { tag: 'path', attrs: { d: 'M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4' } },
      { tag: 'path', attrs: { d: 'M13.5 6.5l4 4' } },
    ],
  },
  pin: {
    elements: [
      { tag: 'path', attrs: { d: 'M9 4v6l-2 4v2h10v-2l-2 -4v-6' } },
      { tag: 'path', attrs: { d: 'M12 16l0 5' } },
      { tag: 'path', attrs: { d: 'M8 4l8 0' } },
    ],
  },
  play: {
    elements: [{ tag: 'path', attrs: { d: 'M7 4v16l13 -8z' } }],
  },
  'playlist-add': {
    elements: [
      { tag: 'path', attrs: { d: 'M19 8h-14' } },
      { tag: 'path', attrs: { d: 'M5 12h9' } },
      { tag: 'path', attrs: { d: 'M5 16h6' } },
      { tag: 'path', attrs: { d: 'M15 16h6' } },
      { tag: 'path', attrs: { d: 'M18 13v6' } },
    ],
  },
  plus: {
    elements: [
      { tag: 'path', attrs: { d: 'M12 5l0 14' } },
      { tag: 'path', attrs: { d: 'M5 12l14 0' } },
    ],
  },
  search: {
    elements: [
      { tag: 'path', attrs: { d: 'M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0' } },
      { tag: 'path', attrs: { d: 'M21 21l-6 -6' } },
    ],
  },
  settings: {
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z',
        },
      },
      { tag: 'path', attrs: { d: 'M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0' } },
    ],
  },
  shuffle: {
    elements: [
      { tag: 'path', attrs: { d: 'M18 4l3 3l-3 3' } },
      { tag: 'path', attrs: { d: 'M18 20l3 -3l-3 -3' } },
      { tag: 'path', attrs: { d: 'M3 7h3a5 5 0 0 1 5 5a5 5 0 0 0 5 5h5' } },
      { tag: 'path', attrs: { d: 'M21 7h-5a4.978 4.978 0 0 0 -3 1.8m-4 7.4a4.978 4.978 0 0 1 -3 1.8h-3' } },
    ],
  },
  trash: {
    elements: [
      { tag: 'path', attrs: { d: 'M4 7l16 0' } },
      { tag: 'path', attrs: { d: 'M10 11l0 6' } },
      { tag: 'path', attrs: { d: 'M14 11l0 6' } },
      { tag: 'path', attrs: { d: 'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12' } },
      { tag: 'path', attrs: { d: 'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3' } },
    ],
  },
  user: {
    elements: [
      { tag: 'path', attrs: { d: 'M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0' } },
      { tag: 'path', attrs: { d: 'M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2' } },
    ],
  },
  x: {
    elements: [
      { tag: 'path', attrs: { d: 'M18 6l-12 12' } },
      { tag: 'path', attrs: { d: 'M6 6l12 12' } },
    ],
  },
}
