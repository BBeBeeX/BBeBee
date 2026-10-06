import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  SettingsContribution,
  SettingsFieldDescriptor,
  SettingsFieldOption,
} from '@BBeBee/protocol'
import { useSettingsFields } from '@BBeBee/plugin-settings/hooks'
import { Button, Slider, Text } from '@BBeBee/ui-kit-mobile'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { nativePrimitives } from '@BBeBee/ui-kit-mobile'

const p = () => palettes.dark

/** Entries of a `switch-list` field, resolved from its descriptor. */
interface SwitchListEntry {
  id: string
  label: string
  description?: string
}

/** Mobile toggle switch, presentation-only. */
function SwitchRow({
  checked,
  onChange,
  accessibilityLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  accessibilityLabel: string
}) {
  const native = nativePrimitives()
  return h(
    native.Pressable as never,
    {
      onPress: () => onChange(!checked),
      accessibilityLabel,
      accessibilityRole: 'switch',
      accessibilityState: { checked },
      style: {
        width: 48,
        height: 26,
        borderRadius: 13,
        backgroundColor: checked ? p().accent.base : 'rgba(255, 255, 255, 0.15)',
        justifyContent: 'center',
        padding: 2,
      },
    },
    h(native.View as never, {
      style: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#ffffff',
        transform: [{ translateX: checked ? 22 : 0 }],
      },
    }),
  )
}

/**
 * One rendered field. Async data (dynamic options, switch-list entries,
 * notes) resolves here so the form itself stays a pure transform of the
 * contribution.
 */
function FieldRow({
  ctx,
  contribution,
  field,
}: {
  ctx: Context
  contribution: SettingsContribution
  field: SettingsFieldDescriptor
}): ReactElement | null {
  const native = nativePrimitives()
  const { values, change } = useSettingsFields(ctx, contribution)
  const [options, setOptions] = useState<readonly SettingsFieldOption[] | undefined>(field.options)
  const [entries, setEntries] = useState<readonly SwitchListEntry[]>([])
  const [note, setNote] = useState<string | undefined>(undefined)
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const resolve = () => {
      void field
        .optionsAsync?.()
        .then((o) => {
          if (mountedRef.current && o) setOptions(o)
        })
        .catch(() => {})
      void field
        .entriesAsync?.()
        .then((e) => {
          if (mountedRef.current && e) setEntries(e)
        })
        .catch(() => {})
      void field
        .noteAsync?.()
        .then((n) => {
          if (mountedRef.current) setNote(n)
        })
        .catch(() => {})
    }
    resolve()
    const onAny = ctx.on as unknown as (event: string, cb: () => void) => () => void
    const offs = (contribution.refreshEvents ?? []).map((event) => onAny(event, resolve))
    return () => {
      for (const off of offs) off?.()
    }
  }, [ctx, contribution, field])

  const runAction = useCallback(async () => {
    if (!field.onAction) return
    setBusy(true)
    try {
      const result = await field.onAction()
      if (mountedRef.current && result) {
        setOutcome(result)
        setTimeout(() => {
          if (mountedRef.current) setOutcome(null)
        }, 2500)
      }
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [field])

  if (field.when && !field.when()) return null

  const value = values[field.key]
  const optionButtons = (opts: readonly SettingsFieldOption[], current: unknown) =>
    h(
      native.View as never,
      { style: { flexDirection: 'row', gap: tokens.space[1], flexWrap: 'wrap' } },
      opts.map((o) =>
        h(Button, {
          key: String(o.value),
          variant: String(current) === String(o.value) ? 'primary' : 'secondary',
          onPress: () => void change(field.key, o.value),
          children: o.label,
        }),
      ),
    )

  const parts: ReactElement[] = []

  switch (field.type) {
    case 'switch':
      parts.push(
        h(
          native.View as never,
          {
            key: 'row',
            style: {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: tokens.space[3],
            },
          },
          h(
            native.View as never,
            { style: { flex: 1 } },
            h(Text, { variant: 'md', children: field.label }),
            field.description
              ? h(Text, { variant: 'xs', tone: 'muted', children: field.description })
              : null,
          ),
          h(SwitchRow, {
            checked: Boolean(value),
            accessibilityLabel: field.label,
            onChange: (checked: boolean) => void change(field.key, checked),
          }),
        ),
      )
      break
    case 'select': {
      const opts = options ?? []
      parts.push(
        h(
          native.View as never,
          { key: 'row', style: { gap: tokens.space[1] } },
          h(Text, { variant: 'md', children: field.label }),
          ...(field.description
            ? [h(Text, { variant: 'xs', tone: 'muted', children: field.description })]
            : []),
          optionButtons(opts, value),
        ),
      )
      break
    }
    case 'slider': {
      const numeric = Number(value ?? field.min ?? 0)
      parts.push(
        h(
          native.View as never,
          { key: 'row', style: { gap: tokens.space[1] } },
          h(Text, {
            variant: 'md',
            children: field.label,
          }),
          h(Text, {
            variant: 'xs',
            tone: 'muted',
            children: [field.description, `${numeric}${field.unit ?? ''}`].filter(Boolean).join(' · '),
          }),
          h(Slider, {
            value: numeric,
            max: field.max ?? 100,
            accessibilityLabel: field.label,
            onChange: (v: number) => void change(field.key, Math.round(v)),
          }),
        ),
      )
      break
    }
    case 'text':
    case 'number':
      parts.push(
        h(
          native.View as never,
          { key: 'row', style: { gap: tokens.space[1] } },
          h(Text, { variant: 'md', children: field.label }),
          ...(field.description
            ? [h(Text, { variant: 'xs', tone: 'muted', children: field.description })]
            : []),
          h(native.TextInput as never, {
            value: value == null ? '' : String(value),
            onChangeText: (v: string) =>
              void change(field.key, field.type === 'number' ? Number(v) || 0 : v),
            placeholder: field.placeholder,
            accessibilityLabel: field.label,
            style: {
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              borderRadius: tokens.radius.sm,
              color: '#FFFFFF',
              paddingHorizontal: tokens.space[2],
              paddingVertical: tokens.space[1],
              fontSize: 13,
            },
          }),
        ),
      )
      break
    case 'action':
      parts.push(
        h(
          native.View as never,
          { key: 'row', style: { gap: tokens.space[1] } },
          h(Text, { variant: 'md', children: field.label }),
          ...(field.description
            ? [h(Text, { variant: 'xs', tone: 'muted', children: field.description })]
            : []),
          h(Button, {
            variant: 'secondary',
            children: field.actionText ?? '执行',
            disabled: busy,
            onPress: () => void runAction(),
          }),
        ),
      )
      break
    case 'switch-list': {
      const record =
        typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
      parts.push(
        h(Text, { key: 'head', variant: 'md', children: field.label }),
        ...(field.description
          ? [h(Text, { key: 'desc', variant: 'xs', tone: 'muted', children: field.description })]
          : []),
        ...entries.map((entry) =>
          h(
            native.View as never,
            {
              key: entry.id,
              style: {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: tokens.space[3],
              },
            },
            h(
              native.View as never,
              { style: { flex: 1 } },
              h(Text, { variant: 'sm', children: entry.label }),
              entry.description
                ? h(Text, { variant: 'xs', tone: 'muted', children: entry.description })
                : null,
            ),
            h(SwitchRow, {
              checked: Boolean(record[entry.id]),
              accessibilityLabel: `${entry.label} 开关`,
              onChange: (checked: boolean) => void change(`${field.key}.${entry.id}`, checked),
            }),
          ),
        ),
      )
      break
    }
    default:
      // 'directory' and 'color' have no mobile control in this shell yet; the
      // row degrades to a read-only value line instead of pretending.
      parts.push(
        h(
          native.View as never,
          { key: 'row', style: { gap: tokens.space[1] } },
          h(Text, { variant: 'md', children: field.label }),
          h(Text, {
            variant: 'xs',
            tone: 'muted',
            children: value ? String(value) : (field.description ?? '在此平台不可用'),
          }),
        ),
      )
  }

  if (note)
    parts.push(h(Text, { key: 'note', variant: 'xs', tone: 'muted', children: note }))
  if (outcome)
    parts.push(
      h(Text, {
        key: 'outcome',
        variant: 'xs',
        tone: outcome.ok ? 'ok' : 'error',
        children: outcome.message,
      }),
    )

  return h(native.View as never, { style: { gap: tokens.space[1] } }, ...parts)
}

export interface SchemaFormProps {
  ctx: Context
  contribution: SettingsContribution
}

/**
 * Renders one schema-driven settings contribution. No per-plugin form
 * components live anywhere: a plugin declares `fields`, this renders them.
 */
export function SchemaForm({ ctx, contribution }: SchemaFormProps): ReactElement {
  const fields = contribution.fields ?? []
  return h(
    nativePrimitives().View as never,
    { style: { gap: tokens.space[3] } },
    h(Text, { variant: 'sm', tone: 'accent', children: contribution.title }),
    contribution.description
      ? h(Text, { variant: 'xs', tone: 'muted', children: contribution.description })
      : null,
    ...fields.map((field) => h(FieldRow, { key: field.key, ctx, contribution, field })),
  )
}
