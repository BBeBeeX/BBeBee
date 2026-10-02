import { createElement as h, type CSSProperties, type ReactElement } from 'react'

export interface TablerIconProps {
  size?: number | string
  color?: string
  stroke?: number | string
  className?: string
  style?: CSSProperties
  'data-icon'?: string
  'aria-hidden'?: boolean | 'true' | 'false'
}

export type IconSvgDefinition = {
  elements: Array<{ tag: string; attrs: Record<string, string | number> }>
  filled?: boolean
}

export const DEFAULT_STROKE_WIDTH = 1.25

export function createSvgIcon(
  iconName: string,
  def: IconSvgDefinition,
  props: TablerIconProps = {},
): ReactElement {
  const size = props.size ?? 28
  const stroke = props.stroke ?? DEFAULT_STROKE_WIDTH
  const color = props.color ?? 'currentColor'

  const svgProps: Record<string, unknown> = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: def.filled ? color : 'none',
    stroke: def.filled ? 'none' : color,
    strokeWidth: def.filled ? undefined : stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'data-icon': props['data-icon'] ?? iconName,
    'aria-hidden': props['aria-hidden'] ?? true,
    className: props.className,
    style: {
      flexShrink: 0,
      display: 'inline-block',
      verticalAlign: 'middle',
      ...props.style,
    },
  }

  const children = [
    h('path', { key: 'bg', stroke: 'none', d: 'M0 0h24v24H0z', fill: 'none' }),
    ...def.elements.map((el, idx) => h(el.tag, { key: idx, ...el.attrs })),
  ]

  return h('svg', svgProps, ...children)
}

/**
 * Tabler Icons definitions with exact 24x24 geometry matching official Tabler Icons specs.
 */
export const TABLER_DEFINITIONS: Record<string, IconSvgDefinition> = {
  home: {
    elements: [
      { tag: 'path', attrs: { d: 'M5 12l-2 0l9 -9l9 9l-2 0' } },
      { tag: 'path', attrs: { d: 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7' } },
      { tag: 'path', attrs: { d: 'M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6' } },
    ],
  },
  search: {
    elements: [
      { tag: 'path', attrs: { d: 'M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0' } },
      { tag: 'path', attrs: { d: 'M21 21l-6 -6' } },
    ],
  },
  play: {
    elements: [{ tag: 'path', attrs: { d: 'M7 4v16l13 -8z' } }],
  },
  'play-filled': {
    filled: true,
    elements: [{ tag: 'path', attrs: { d: 'M7 4v16l13 -8z' } }],
  },
  pause: {
    elements: [
      { tag: 'rect', attrs: { x: 6, y: 5, width: 4, height: 14, rx: 1 } },
      { tag: 'rect', attrs: { x: 14, y: 5, width: 4, height: 14, rx: 1 } },
    ],
  },
  'pause-filled': {
    filled: true,
    elements: [
      { tag: 'rect', attrs: { x: 6, y: 5, width: 4, height: 14, rx: 1 } },
      { tag: 'rect', attrs: { x: 14, y: 5, width: 4, height: 14, rx: 1 } },
    ],
  },
  'skip-back': {
    elements: [
      { tag: 'path', attrs: { d: 'M20 5v14l-12 -7z' } },
      { tag: 'path', attrs: { d: 'M4 5l0 14' } },
    ],
  },
  'skip-forward': {
    elements: [
      { tag: 'path', attrs: { d: 'M4 5v14l12 -7z' } },
      { tag: 'path', attrs: { d: 'M20 5l0 14' } },
    ],
  },
  volume: {
    elements: [
      { tag: 'path', attrs: { d: 'M15 8a5 5 0 0 1 0 8' } },
      { tag: 'path', attrs: { d: 'M17.7 5a9 9 0 0 1 0 14' } },
      {
        tag: 'path',
        attrs: {
          d: 'M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v16a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5',
        },
      },
    ],
  },
  'volume-2': {
    elements: [
      { tag: 'path', attrs: { d: 'M15 8a5 5 0 0 1 0 8' } },
      {
        tag: 'path',
        attrs: {
          d: 'M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v16a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5',
        },
      },
    ],
  },
  'volume-3': {
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v16a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5',
        },
      },
    ],
  },
  'volume-off': {
    elements: [
      { tag: 'path', attrs: { d: 'M15 8a5 5 0 0 1 1.4 2.3m.6 3.7a5 5 0 0 1 -2 3' } },
      { tag: 'path', attrs: { d: 'M17.7 5a9 9 0 0 1 2.3 4.6m.2 3.4a9 9 0 0 1 -2.5 6' } },
      {
        tag: 'path',
        attrs: {
          d: 'M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v6m0 4v6a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5',
        },
      },
      { tag: 'path', attrs: { d: 'M3 3l18 18' } },
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
  repeat: {
    elements: [
      { tag: 'path', attrs: { d: 'M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3' } },
      { tag: 'path', attrs: { d: 'M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3' } },
    ],
  },
  'repeat-once': {
    elements: [
      { tag: 'path', attrs: { d: 'M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3' } },
      { tag: 'path', attrs: { d: 'M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3' } },
      { tag: 'path', attrs: { d: 'M11 11l1 -1v4' } },
    ],
  },
  'list-numbers': {
    elements: [
      { tag: 'path', attrs: { d: 'M11 6h9' } },
      { tag: 'path', attrs: { d: 'M11 12h9' } },
      { tag: 'path', attrs: { d: 'M11 18h9' } },
      { tag: 'path', attrs: { d: 'M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4' } },
      { tag: 'path', attrs: { d: 'M6 10v-6l-2 2' } },
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
  plus: {
    elements: [
      { tag: 'path', attrs: { d: 'M12 5l0 14' } },
      { tag: 'path', attrs: { d: 'M5 12l14 0' } },
    ],
  },
  minus: {
    elements: [{ tag: 'path', attrs: { d: 'M5 12l14 0' } }],
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
  x: {
    elements: [
      { tag: 'path', attrs: { d: 'M18 6l-12 12' } },
      { tag: 'path', attrs: { d: 'M6 6l12 12' } },
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
  'folder-plus': {
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M12 19h-7a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v3.5',
        },
      },
      { tag: 'path', attrs: { d: 'M16 19h6' } },
      { tag: 'path', attrs: { d: 'M19 16v6' } },
    ],
  },
  'folder-share': {
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M13 19h-8a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v4',
        },
      },
      { tag: 'path', attrs: { d: 'M16 22l5 -5' } },
      { tag: 'path', attrs: { d: 'M21 21.5v-4.5h-4.5' } },
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
  music: {
    elements: [
      { tag: 'path', attrs: { d: 'M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0' } },
      { tag: 'path', attrs: { d: 'M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0' } },
      { tag: 'path', attrs: { d: 'M9 17v-13h10v13' } },
      { tag: 'path', attrs: { d: 'M9 8h10' } },
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
  pin: {
    elements: [
      { tag: 'path', attrs: { d: 'M9 4v6l-2 4v2h10v-2l-2 -4v-6' } },
      { tag: 'path', attrs: { d: 'M12 16l0 5' } },
      { tag: 'path', attrs: { d: 'M8 4l8 0' } },
    ],
  },
  pencil: {
    elements: [
      { tag: 'path', attrs: { d: 'M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4' } },
      { tag: 'path', attrs: { d: 'M13.5 6.5l4 4' } },
    ],
  },
  download: {
    elements: [
      { tag: 'path', attrs: { d: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2' } },
      { tag: 'path', attrs: { d: 'M7 11l5 5l5 -5' } },
      { tag: 'path', attrs: { d: 'M12 4l0 12' } },
    ],
  },
  clock: {
    elements: [
      { tag: 'path', attrs: { d: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0' } },
      { tag: 'path', attrs: { d: 'M12 7v5l3 3' } },
    ],
  },
  alarm: {
    elements: [
      { tag: 'path', attrs: { d: 'M12 13m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0' } },
      { tag: 'path', attrs: { d: 'M12 10l0 3l2 0' } },
      { tag: 'path', attrs: { d: 'M7 4l-2.75 2' } },
      { tag: 'path', attrs: { d: 'M17 4l2.75 2' } },
    ],
  },
  history: {
    elements: [
      { tag: 'path', attrs: { d: 'M12 8l0 4l2 2' } },
      { tag: 'path', attrs: { d: 'M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5' } },
    ],
  },
  playlist: {
    elements: [
      { tag: 'path', attrs: { d: 'M14 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0' } },
      { tag: 'path', attrs: { d: 'M17 17v-13h4' } },
      { tag: 'path', attrs: { d: 'M13 5h-10' } },
      { tag: 'path', attrs: { d: 'M3 9l10 0' } },
      { tag: 'path', attrs: { d: 'M9 13h-6' } },
    ],
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
  'arrows-sort': {
    elements: [
      { tag: 'path', attrs: { d: 'M3 9l4 -4l4 4' } },
      { tag: 'path', attrs: { d: 'M7 5v14' } },
      { tag: 'path', attrs: { d: 'M21 15l-4 4l-4 -4' } },
      { tag: 'path', attrs: { d: 'M17 19v-14' } },
    ],
  },
  dots: {
    elements: [
      { tag: 'path', attrs: { d: 'M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
      { tag: 'path', attrs: { d: 'M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
      { tag: 'path', attrs: { d: 'M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
    ],
  },
  'dots-vertical': {
    elements: [
      { tag: 'path', attrs: { d: 'M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
      { tag: 'path', attrs: { d: 'M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
      { tag: 'path', attrs: { d: 'M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
    ],
  },
  'chevron-left': {
    elements: [{ tag: 'path', attrs: { d: 'M15 6l-6 6l6 6' } }],
  },
  'chevron-right': {
    elements: [{ tag: 'path', attrs: { d: 'M9 6l6 6l-6 6' } }],
  },
  'chevron-down': {
    elements: [{ tag: 'path', attrs: { d: 'M6 9l6 6l6 -6' } }],
  },
  'chevron-up': {
    elements: [{ tag: 'path', attrs: { d: 'M6 15l6 -6l6 6' } }],
  },
  check: {
    elements: [{ tag: 'path', attrs: { d: 'M5 12l5 5l10 -10' } }],
  },
  checkbox: {
    elements: [
      { tag: 'path', attrs: { d: 'M9 11l3 3l8 -8' } },
      { tag: 'path', attrs: { d: 'M20 12v6a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h9' } },
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
  camera: {
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2',
        },
      },
      { tag: 'path', attrs: { d: 'M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0' } },
    ],
  },
  share: {
    elements: [
      { tag: 'circle', attrs: { cx: 6, cy: 12, r: 3 } },
      { tag: 'circle', attrs: { cx: 18, cy: 6, r: 3 } },
      { tag: 'circle', attrs: { cx: 18, cy: 18, r: 3 } },
      { tag: 'path', attrs: { d: 'M8.7 10.7l6.6 -3.4' } },
      { tag: 'path', attrs: { d: 'M8.7 13.3l6.6 3.4' } },
    ],
  },
  'share-box': {
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6',
        },
      },
      { tag: 'path', attrs: { d: 'M11 13l9 -9' } },
      { tag: 'path', attrs: { d: 'M15 4h5v5' } },
    ],
  },
  alert: {
    elements: [
      { tag: 'path', attrs: { d: 'M12 9v4' } },
      {
        tag: 'path',
        attrs: {
          d: 'M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z',
        },
      },
      { tag: 'path', attrs: { d: 'M12 16h.01' } },
    ],
  },
  user: {
    elements: [
      { tag: 'path', attrs: { d: 'M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0' } },
      { tag: 'path', attrs: { d: 'M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2' } },
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
  adjustments: {
    elements: [
      { tag: 'path', attrs: { d: 'M4 10a2 2 0 1 0 4 0a2 2 0 0 0 -4 0' } },
      { tag: 'path', attrs: { d: 'M6 4v4' } },
      { tag: 'path', attrs: { d: 'M6 12v8' } },
      { tag: 'path', attrs: { d: 'M10 16a2 2 0 1 0 4 0a2 2 0 0 0 -4 0' } },
      { tag: 'path', attrs: { d: 'M12 4v10' } },
      { tag: 'path', attrs: { d: 'M12 18v2' } },
      { tag: 'path', attrs: { d: 'M16 7a2 2 0 1 0 4 0a2 2 0 0 0 -4 0' } },
      { tag: 'path', attrs: { d: 'M18 4v1' } },
      { tag: 'path', attrs: { d: 'M18 9v11' } },
    ],
  },
  bug: {
    elements: [
      { tag: 'path', attrs: { d: 'M9 9v-1a3 3 0 0 1 6 0v1' } },
      { tag: 'path', attrs: { d: 'M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3' } },
      { tag: 'path', attrs: { d: 'M3 13l4 0' } },
      { tag: 'path', attrs: { d: 'M17 13l4 0' } },
      { tag: 'path', attrs: { d: 'M12 20l0 -6' } },
      { tag: 'path', attrs: { d: 'M4 19l3.35 -2' } },
      { tag: 'path', attrs: { d: 'M20 19l-3.35 -2' } },
      { tag: 'path', attrs: { d: 'M4 7l3.75 1.5' } },
      { tag: 'path', attrs: { d: 'M20 7l-3.75 1.5' } },
    ],
  },
  'layout-sidebar': {
    elements: [
      { tag: 'path', attrs: { d: 'M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z' } },
      { tag: 'path', attrs: { d: 'M9 4l0 16' } },
    ],
  },
  'layout-sidebar-left-collapse': {
    elements: [
      { tag: 'path', attrs: { d: 'M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z' } },
      { tag: 'path', attrs: { d: 'M9 4v16' } },
      { tag: 'path', attrs: { d: 'M15 10l-2 2l2 2' } },
    ],
  },
  'layout-sidebar-left-expand': {
    elements: [
      { tag: 'path', attrs: { d: 'M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z' } },
      { tag: 'path', attrs: { d: 'M9 4v16' } },
      { tag: 'path', attrs: { d: 'M13 10l2 2l-2 2' } },
    ],
  },
  maximize: {
    elements: [
      { tag: 'path', attrs: { d: 'M4 8v-2a2 2 0 0 1 2 -2h2' } },
      { tag: 'path', attrs: { d: 'M4 16v2a2 2 0 0 0 2 2h2' } },
      { tag: 'path', attrs: { d: 'M16 4h2a2 2 0 0 1 2 2v2' } },
      { tag: 'path', attrs: { d: 'M16 20h2a2 2 0 0 0 2 -2v-2' } },
    ],
  },
  minimize: {
    elements: [
      { tag: 'path', attrs: { d: 'M15 19v-2a2 2 0 0 1 2 -2h2' } },
      { tag: 'path', attrs: { d: 'M15 5v2a2 2 0 0 0 2 2h2' } },
      { tag: 'path', attrs: { d: 'M5 15h2a2 2 0 0 1 2 2v2' } },
      { tag: 'path', attrs: { d: 'M5 9h2a2 2 0 0 0 2 -2v-2' } },
    ],
  },
  lock: {
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M5 11m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z',
        },
      },
      { tag: 'path', attrs: { d: 'M8 11v-4a4 4 0 0 1 8 0v4' } },
      { tag: 'path', attrs: { d: 'M12 16m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
    ],
  },
  'lock-open': {
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M5 11m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z',
        },
      },
      { tag: 'path', attrs: { d: 'M12 16m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' } },
      { tag: 'path', attrs: { d: 'M8 11v-5a4 4 0 0 1 8 0' } },
    ],
  },
  square: {
    elements: [
      { tag: 'path', attrs: { d: 'M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z' } },
    ],
  },
  copy: {
    elements: [
      { tag: 'path', attrs: { d: 'M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z' } },
      { tag: 'path', attrs: { d: 'M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2' } },
    ],
  },
  'wave-sine': {
    elements: [
      {
        tag: 'path',
        attrs: {
          d: 'M4 12c0 -4.97 1.79 -9 4 -9c2.21 0 4 4.03 4 9s1.79 9 4 9c2.21 0 4 -4.03 4 -9',
        },
      },
    ],
  },
  'info-circle': {
    elements: [
      { tag: 'path', attrs: { d: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0' } },
      { tag: 'path', attrs: { d: 'M12 9h.01' } },
      { tag: 'path', attrs: { d: 'M11 12h1v4h1' } },
    ],
  },
  info: {
    elements: [
      { tag: 'path', attrs: { d: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0' } },
      { tag: 'path', attrs: { d: 'M12 9h.01' } },
      { tag: 'path', attrs: { d: 'M11 12h1v4h1' } },
    ],
  },
}
