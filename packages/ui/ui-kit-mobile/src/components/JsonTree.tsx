import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { tokens, type Palette } from '@BBeBee/ui-tokens'
import { serviceOf } from '@BBeBee/ui-core'
import type { I18nService } from '@BBeBee/protocol'
import { c, nativePrimitives } from '../primitives.js'
import { Button } from './Button.js'

let jsonEpoch = 0

/** Syntax colours for the tree, all from the palette. */
function jsonColor(value: unknown, palette: Palette): string | undefined {
  if (typeof value === 'string') return palette.state.ok
  if (typeof value === 'number') return palette.text.primary
  if (typeof value === 'boolean' || value === null) return palette.state.warn
  return undefined
}

/** Per-level indent. 16px — deep enough to read, shallow enough to stay narrow. */
const INDENT = tokens.space[4]

/** Long strings start clipped; tapping spreads them. A body can hold a URL no one needs all of. */
const STRING_CLIP = 300

/** One expand-all/collapse-all directive, shared by every branch. */
export interface JsonDirective {
  value: boolean
  /** Bumped on every press, so pressing the same button twice still re-applies. */
  epoch: number
}

interface JsonFrame {
  palette: Palette
  defaultExpandedDepth: number
  directive: JsonDirective | undefined
}

function JsonString(props: { value: string; palette: Palette }): ReactElement {
  const native = nativePrimitives()
  const [spread, setSpread] = useState(false)
  const clipped = !spread && props.value.length > STRING_CLIP
  const shown = clipped ? props.value.slice(0, STRING_CLIP) : props.value
  return h(
    native.Text as never,
    {
      onPress: clipped ? () => setSpread(true) : undefined,
      style: { color: props.palette.state.ok },
    },
    JSON.stringify(shown) + (clipped ? `… (+${props.value.length - STRING_CLIP})` : ''),
  )
}

function JsonBranch(props: {
  name: string | undefined
  value: Record<string, unknown> | readonly unknown[]
  depth: number
  frame: JsonFrame
}): ReactElement {
  const native = nativePrimitives()
  const { palette, directive } = props.frame
  // A branch mounted *after* a directive was issued (its parent was just
  // expanded) must honour that directive on arrival, not only on the next one
  // — hence the initial state, not an effect.
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

  return h(
    native.View as never,
    { style: { paddingLeft: props.depth === 0 ? 0 : INDENT } },
    h(
      native.Pressable as never,
      {
        onPress: () => setOpen(!open),
        accessibilityRole: 'button',
        style: { flexDirection: 'row', alignItems: 'baseline', gap: tokens.space[1] },
      },
      h(native.Text as never, { style: { color: palette.text.disabled } }, open ? '▼' : '▶'),
      props.name !== undefined
        ? h(native.Text as never, { style: { color: palette.text.secondary } }, props.name)
        : null,
      h(native.Text as never, { style: { color: palette.text.primary } }, brace[0]),
      !open
        ? h(
            native.Text as never,
            { style: { color: palette.text.disabled } },
            `…} ${entries.length} ${Array.isArray(props.value) ? 'items' : 'keys'}`,
          )
        : null,
      h(native.Text as never, { style: { color: palette.text.primary } }, open ? '' : brace[1]),
    ),
    open
      ? h(
          native.View as never,
          { style: { borderLeftWidth: 1, borderLeftColor: palette.border.subtle, marginLeft: tokens.space[1] } },
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
          native.Text as never,
          { style: { color: palette.text.primary, paddingLeft: INDENT } },
          brace[1],
        )
      : null,
  )
}

function JsonEntry(props: { name: string; value: unknown; depth: number; frame: JsonFrame }): ReactElement {
  const native = nativePrimitives()
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
  const rendered =
    typeof value === 'string'
      ? h(JsonString, { value, palette })
      : h(native.Text as never, { style: { color } }, value === undefined ? 'undefined' : String(value))

  return h(
    native.View as never,
    { style: { paddingLeft: INDENT, flexDirection: 'row', alignItems: 'baseline', gap: tokens.space[1] } },
    // The root entry has no name: the tree opens with the value itself.
    props.name !== '' ? h(native.Text as never, { style: { color: palette.text.secondary } }, props.name) : null,
    props.name !== '' ? h(native.Text as never, null, ':') : null,
    rendered,
  )
}

/**
 * A parsed JSON value as a collapsible tree.
 *
 * For *reading* a response — the test screen's output pane — not editing it.
 * Twin of the desktop kit's, down to the toolbar, the counts and the clip
 * behaviour; hover and arrow keys are the desktop half of that bargain.
 */
export function JsonTree(props: {
  value: unknown
  /** How many nesting levels start open. Default 2: the shape without the noise. */
  defaultExpandedDepth?: number
  /** Render the expand-all / collapse-all toolbar above the tree. */
  controls?: boolean
  testID?: string
  accessibilityLabel?: string
  /**
   * Optional Cordis context. When provided, the expand/collapse controls are
   * translated via `useI18n`; without it the built-in English copy renders.
   */
  ctx?: Context
}): ReactElement {
  const native = nativePrimitives()
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
    native.View as never,
    {
      testID: props.testID,
      accessibilityLabel: props.accessibilityLabel,
    },
    props.controls
      ? h(
          native.View as never,
          { style: { flexDirection: 'row', gap: tokens.space[3], marginBottom: tokens.space[1] } },
          h(Button, {
            variant: 'ghost',
            onPress: () => setDirective({ value: true, epoch: ++jsonEpoch }),
            children: t('app:common.jsonTree.expandAll', 'Expand all'),
          }),
          h(Button, {
            variant: 'ghost',
            onPress: () => setDirective({ value: false, epoch: ++jsonEpoch }),
            children: t('app:common.jsonTree.collapseAll', 'Collapse all'),
          }),
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
