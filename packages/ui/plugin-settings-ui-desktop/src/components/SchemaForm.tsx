import { Button, ColorPicker, Select, Slider, Switch, TextField } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  SettingsContribution,
  SettingsFieldDescriptor,
  SettingsFieldOption,
} from '@BBeBee/protocol'
import { useSettingsFields } from '@BBeBee/plugin-settings/hooks'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'

/** Entries of a `switch-list` field, resolved from its descriptor. */
interface SwitchListEntry {
  id: string
  label: string
  description?: string
}

const noteStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: '#8E8E93',
  padding: '0 4px 8px',
}

/**
 * Bridge helpers for `directory` fields. Present only on the desktop shell —
 * the field hides itself elsewhere via its `when` predicate, and this module
 * degrades to a read-only path display when the bridge is absent (tests).
 */
function desktopBridge(): {
  pick: () => Promise<string | undefined>
  open: (path: string) => Promise<void>
} | undefined {
  const bridge = (
    globalThis as unknown as {
      BBeBee?: {
        dialog?: { pickDirectory: () => Promise<string | undefined> }
        shell?: { openPath: (p: string) => Promise<string> }
      }
    }
  ).BBeBee
  if (!bridge) return undefined
  return {
    pick: () => bridge.dialog?.pickDirectory?.() ?? Promise.resolve(undefined),
    open: async (path: string) => {
      if (bridge.shell?.openPath) await bridge.shell.openPath(cleanDisplayPath(path))
    },
  }
}

function cleanDisplayPath(rawPath?: string): string {
  if (!rawPath) return ''
  let p = rawPath
  if (p.startsWith('file://')) {
    p = decodeURIComponent(p.replace(/^file:\/\//, ''))
    if (/^\/[a-zA-Z]:/.test(p)) {
      p = p.slice(1)
    }
  }
  return p
}

interface FieldRowProps {
  ctx: Context
  contribution: SettingsContribution
  field: SettingsFieldDescriptor
}

/**
 * One rendered field. Async data (dynamic options, switch-list entries,
 * notes) resolves here so the form itself stays a pure transform of the
 * contribution.
 */
function FieldRow({ ctx, contribution, field }: FieldRowProps): ReactElement | null {
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
  const noteEls: ReactElement[] = []
  if (note) noteEls.push(h('div', { key: 'note', style: noteStyle }, note))
  if (outcome)
    noteEls.push(
      h(
        'div',
        {
          key: 'outcome',
          style: {
            ...noteStyle,
            color: outcome.ok ? 'var(--state-success, #22C55E)' : 'var(--state-error, #EF4444)',
          },
        },
        outcome.message,
      ),
    )

  let row: ReactElement
  switch (field.type) {
    case 'switch':
      row = h(SettingsRow, {
        title: field.label,
        description: field.description,
        borderBottom: false,
        action: h(Switch, {
          checked: Boolean(value),
          accessibilityLabel: field.label,
          onChange: (checked: boolean) => void change(field.key, checked),
        }),
      })
      break
    case 'select': {
      const opts = options ?? []
      row = h(SettingsRow, {
        title: field.label,
        description: field.description,
        borderBottom: false,
        action: h(Select<string>, {
          value: String(value ?? ''),
          options: opts.map((o) => ({ value: String(o.value), label: o.label })),
          accessibilityLabel: field.label,
          onChange: (v: string) => {
            const match = opts.find((o) => String(o.value) === v)
            void change(field.key, match ? match.value : v)
          },
        }),
      })
      break
    }
    case 'slider': {
      const numeric = Number(value ?? field.min ?? 0)
      row = h(SettingsRow, {
        title: field.label,
        description: [field.description, `${numeric}${field.unit ?? ''}`].filter(Boolean).join(' · '),
        borderBottom: false,
        action: h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, width: 220 } },
          h(
            'div',
            { style: { flex: 1 } },
            h(Slider, {
              value: numeric,
              max: field.max ?? 100,
              accessibilityLabel: field.label,
              onChange: (v: number) => void change(field.key, Math.round(v)),
            }),
          ),
        ),
      })
      break
    }
    case 'text':
    case 'number':
      row = h(SettingsRow, {
        title: field.label,
        description: field.description,
        borderBottom: false,
        action: h(TextField, {
          value: value == null ? '' : String(value),
          onChange: (v: string) =>
            void change(field.key, field.type === 'number' ? Number(v) || 0 : v),
          placeholder: field.placeholder,
          accessibilityLabel: field.label,
        }),
      })
      break
    case 'color':
      row = h(SettingsRow, {
        title: field.label,
        description: field.description,
        borderBottom: false,
        action: h(ColorPicker, {
          value: String(value ?? '#FFFFFF'),
          accessibilityLabel: field.label,
          onChange: (v: string) => void change(field.key, v),
        }),
      })
      break
    case 'directory': {
      const bridge = desktopBridge()
      row = h(SettingsRow, {
        title: field.label,
        description: value ? cleanDisplayPath(String(value)) : field.description,
        borderBottom: false,
        action: bridge
          ? h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h(Button, {
                variant: 'secondary',
                children: field.actionText ?? '更改目录',
                onPress: async () => {
                  const picked = await bridge.pick()
                  if (picked) void change(field.key, picked)
                },
              }),
              h(Button, {
                variant: 'secondary',
                children: '打开文件夹',
                disabled: !value,
                onPress: () => bridge.open(String(value ?? '')),
              }),
            )
          : h(
              'span',
              { style: { fontSize: 12, color: '#8E8E93' } },
              cleanDisplayPath(String(value ?? '')) || '—',
            ),
      })
      break
    }
    case 'action':
      row = h(SettingsRow, {
        title: field.label,
        description: field.description,
        borderBottom: false,
        action: h(Button, {
          variant: 'secondary',
          children: field.actionText ?? '执行',
          loading: busy,
          onPress: () => void runAction(),
        }),
      })
      break
    case 'switch-list': {
      const record =
        typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
      row = h(
        'div',
        null,
        h(SettingsRow, {
          title: field.label,
          description: field.description,
          borderBottom: entries.length === 0,
        }),
        entries.map((entry, index) =>
          h(SettingsRow, {
            key: entry.id,
            isNested: true,
            title: entry.label,
            description: entry.description,
            borderBottom: index < entries.length - 1,
            action: h(Switch, {
              checked: Boolean(record[entry.id]),
              accessibilityLabel: `${entry.label} 开关`,
              onChange: (checked: boolean) => void change(`${field.key}.${entry.id}`, checked),
            }),
          }),
        ),
      )
      break
    }
    default:
      row = h(SettingsRow, {
        title: field.label,
        description: field.description,
        borderBottom: false,
        action: h('span', { style: { fontSize: 12, color: '#8E8E93' } }, String(value ?? '')),
      })
  }

  return noteEls.length > 0 ? h('div', { key: field.key }, row, noteEls) : row
}

export interface SchemaFormProps {
  ctx: Context
  contribution: SettingsContribution
}

/**
 * Renders one schema-driven settings contribution as a titled section of
 * generic rows. No per-plugin form components live anywhere: a plugin
 * declares `fields`, this renders them.
 */
export function SchemaForm({ ctx, contribution }: SchemaFormProps): ReactElement {
  const fields = contribution.fields ?? []
  return h(
    SettingsSection,
    {
      title: contribution.title,
      description: contribution.description,
    },
    fields.map((field) => h(FieldRow, { key: field.key, ctx, contribution, field })),
  )
}
