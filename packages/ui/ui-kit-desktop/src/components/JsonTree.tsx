import { createElement as h, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import { tokens, type Palette } from '@BBeBee/ui-tokens'
import { serviceOf } from '@BBeBee/ui-core'
import type { I18nService } from '@BBeBee/protocol'
import { c } from '../theme.js'
import { tablerIcon } from '../icons/index.js'

let jsonEpoch = 0

function jsonColor(value: unknown, palette: Palette): string | undefined {
  if (typeof value === 'string') return palette.state.ok
  if (typeof value === 'number') return palette.text.primary
  if (typeof value === 'boolean' || value === null) return palette.state.warn
  return undefined
}

const INDENT = tokens.space[4]
const STRING_CLIP = 300

export interface JsonDirective {
  value: boolean
  epoch: number
}

interface JsonFrame {
  palette: Palette
  defaultExpandedDepth: number
  directive: JsonDirective | undefined
}

function JsonString(props: { value: string; palette: Palette }): ReactElement {
  const [spread, setSpread] = useState(false)
  const clipped = !spread && props.value.length > STRING_CLIP
  const shown = clipped ? props.value.slice(0, STRING_CLIP) : props.value
  return h(
    'span',
    {
      onClick: clipped ? () => setSpread(true) : undefined,
      style: {
        color: props.palette.state.ok,
        cursor: clipped ? 'pointer' : undefined,
        ...(clipped ? { textDecoration: 'underline dotted' } : {}),
      },
    },
    JSON.stringify(shown) + (clipped ? `… (+${props.value.length - STRING_CLIP})` : ''),
  )
}

function rowBehavior(
  frame: JsonFrame,
  opts: { onCollapse?: (open: boolean) => void } = {},
): Record<string, unknown> {
  return {
    tabIndex: -1,
    'data-json-row': true,
    onKeyDown: (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
      const container = event.currentTarget.closest('[data-json-tree]') as HTMLElement | null
      const rows = container
        ? Array.from(container.querySelectorAll<HTMLElement>('[data-json-row]'))
        : []
      const index = rows.indexOf(event.currentTarget)
      if (event.key === 'ArrowDown' && index >= 0 && index < rows.length - 1) {
        event.preventDefault()
        rows[index + 1]!.focus()
      } else if (event.key === 'ArrowUp' && index > 0) {
        event.preventDefault()
        rows[index - 1]!.focus()
      } else if (event.key === 'ArrowRight') {
        opts.onCollapse?.(true)
      } else if (event.key === 'ArrowLeft') {
        opts.onCollapse?.(false)
      }
    },
  }
}

function JsonBranch(props: {
  name: string | undefined
  value: Record<string, unknown> | readonly unknown[]
  depth: number
  frame: JsonFrame
}): ReactElement {
  const { palette, directive } = props.frame
  const [open, setOpen] = useState(
    directive ? directive.value : props.depth < props.frame.defaultExpandedDepth,
  )
  const appliedEpoch = useRef(directive?.epoch)
  useEffect(() => {
    if (directive && directive.epoch !== appliedEpoch.current) {
      appliedEpoch.current = directive.epoch
      setOpen(directive.value)
    }
  }, [directive])

  const entries: [string, unknown][] = Array.isArray(props.value)
    ? props.value.map((v, i) => [String(i), v])
    : Object.entries(props.value)
  const brace = Array.isArray(props.value) ? ['[', ']'] : ['{', '}']
  const [hovered, setHovered] = useState(false)

  const row = h(
    'div',
    {
      role: 'button',
      onClick: () => setOpen(!open),
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      ...rowBehavior(props.frame, { onCollapse: setOpen }),
      tabIndex: props.depth === 0 ? 0 : undefined,
      style: {
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'baseline',
        gap: tokens.space[1],
        borderRadius: tokens.radius.sm,
        background: hovered ? palette.bg.overlay : undefined,
        outline: 'none',
      },
    },
    h(
      'span',
      {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          userSelect: 'none',
          color: palette.text.disabled,
        },
      },
      tablerIcon(open ? 'chevron-down' : 'chevron-right', { size: 16 }),
    ),
    props.name !== undefined
      ? h('span', { style: { color: palette.text.secondary } }, props.name)
      : null,
    h('span', { style: { color: palette.text.primary } }, brace[0]),
    !open
      ? h(
          'span',
          { style: { color: palette.text.disabled } },
          `…} ${entries.length} ${Array.isArray(props.value) ? 'items' : 'keys'}`,
        )
      : null,
    h('span', { style: { color: palette.text.primary } }, open ? '' : brace[1]),
  )

  return h(
    'div',
    { style: { paddingLeft: props.depth === 0 ? 0 : INDENT } },
    row,
    open
      ? h(
          'div',
          { style: { borderLeft: `1px solid ${palette.border.subtle}`, marginLeft: tokens.space[1] } },
          ...entries.map(([key, child]) =>
            h(JsonEntry, {
              key,
              name: key,
              value: child,
              depth: props.depth + 1,
              frame: props.frame,
            }),
          ),
        )
      : null,
    open
      ? h(
          'div',
          { style: { color: palette.text.primary, paddingLeft: INDENT }, 'data-json-row': true, tabIndex: -1 },
          brace[1],
        )
      : null,
  )
}

function JsonEntry(props: { name: string; value: unknown; depth: number; frame: JsonFrame }): ReactElement {
  const { palette } = props.frame
  const value = props.value
  const isBranch = value !== null && typeof value === 'object'

  if (isBranch) {
    return h(JsonBranch, {
      name: props.name,
      value: value as Record<string, unknown>,
      depth: props.depth,
      frame: props.frame,
    })
  }

  const color = jsonColor(value, palette)
  const [hovered, setHovered] = useState(false)
  const rendered =
    typeof value === 'string'
      ? h(JsonString, { value, palette })
      : h('span', { style: { color } }, value === undefined ? 'undefined' : String(value))

  return h(
    'div',
    {
      ...rowBehavior(props.frame),
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      style: {
        paddingLeft: INDENT,
        display: 'flex',
        alignItems: 'baseline',
        gap: tokens.space[1],
        borderRadius: tokens.radius.sm,
        background: hovered ? palette.bg.overlay : undefined,
        outline: 'none',
      },
    },
    props.name !== '' ? h('span', { style: { color: palette.text.secondary } }, props.name) : null,
    props.name !== '' ? h('span', null, ':') : null,
    rendered,
  )
}

export function JsonTree(props: {
  value: unknown
  defaultExpandedDepth?: number
  controls?: boolean
  testID?: string
  accessibilityLabel?: string
  /**
   * Optional Cordis context. When provided, the expand/collapse controls are
   * translated via `useI18n`; without it the built-in English copy renders.
   */
  ctx?: Context
}): ReactElement {
  // Deliberately hook-free: the kit's tree() tests invoke components as plain
  // functions. Locale changes reach this component because its
  // useI18n-subscribed ancestors re-render it.
  const i18n = props.ctx ? serviceOf<I18nService>(props.ctx, 'i18n') : undefined
  // English copy stays verbatim until a caller threads `ctx` (i18n sweep).
  const t = (key: string, fallback: string): string => i18n?.t(key) ?? fallback
  const palette = c()
  const [directive, setDirective] = useState<JsonDirective | undefined>(undefined)
  const frame: JsonFrame = {
    palette,
    defaultExpandedDepth: props.defaultExpandedDepth ?? 2,
    directive,
  }

  return h(
    'div',
    {
      'data-testid': props.testID,
      'aria-label': props.accessibilityLabel,
      'data-json-tree': true,
      style: {
        fontFamily: tokens.font.family.mono,
        fontSize: tokens.font.size.sm,
        lineHeight: 1.6,
        overflowWrap: 'anywhere',
        color: palette.text.primary,
      },
    },
    h('style', null, `[data-json-tree] [data-json-row]:hover { background: ${palette.bg.overlay}; }`),
    props.controls
      ? h(
          'div',
          { style: { display: 'flex', gap: tokens.space[2], marginBottom: tokens.space[1] } },
          h(
            'button',
            {
              onClick: () => setDirective({ value: true, epoch: ++jsonEpoch }),
              style: {
                background: 'none',
                border: 'none',
                color: palette.text.secondary,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: tokens.font.size.sm,
                padding: 0,
              },
            },
            t('app:common.jsonTree.expandAll', 'Expand all'),
          ),
          h(
            'button',
            {
              onClick: () => setDirective({ value: false, epoch: ++jsonEpoch }),
              style: {
                background: 'none',
                border: 'none',
                color: palette.text.secondary,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: tokens.font.size.sm,
                padding: 0,
              },
            },
            t('app:common.jsonTree.collapseAll', 'Collapse all'),
          ),
        )
      : null,
    h(JsonEntry, {
      name: '',
      value: props.value,
      depth: 0,
      frame,
    }),
  )
}
