/**
 * Theme variable palette — the mobile transcription of the desktop twin's
 * `ThemePaletteScreen`. The desktop inspects `themeToCssVariables` output;
 * on a phone there is no CSS variable layer, so the same inventory renders
 * from the kit's live palette (`activePalette()`), grouped by the same
 * categories (background / surface / text / brand / border / semantic), with
 * the same scheme toggle — which on mobile switches the running scheme,
 * since a phone has no separate preview window.
 */

import { createElement as h, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import {
  activePalette,
  Button,
  c,
  getScheme,
  nativePrimitives,
  setScheme,
  Text,
  TextField,
  useI18n,
} from '@BBeBee/ui-kit-mobile'
import type { Scheme } from '@BBeBee/ui-tokens'
import { tokens } from '@BBeBee/ui-tokens'

interface SwatchRow {
  key: string
  value: string
}

export function ThemePaletteScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const [searchTerm, setSearchTerm] = useState('')
  const [, forceRender] = useState(0)

  const scheme = getScheme()
  const palette = activePalette()

  const groups = useMemo(() => {
    const all: { groupKey: string; rows: SwatchRow[] }[] = [
      {
        groupKey: 'settings:themePalette.background',
        rows: Object.entries(palette.bg).map(([key, value]) => ({ key: `bg.${key}`, value })),
      },
      {
        groupKey: 'settings:themePalette.text',
        rows: Object.entries(palette.text).map(([key, value]) => ({ key: `text.${key}`, value })),
      },
      {
        groupKey: 'settings:themePalette.brandAccent',
        rows: Object.entries(palette.accent).map(([key, value]) => ({ key: `accent.${key}`, value })),
      },
      {
        groupKey: 'settings:themePalette.semanticMusic',
        rows: Object.entries(palette.state).map(([key, value]) => ({ key: `state.${key}`, value })),
      },
      {
        groupKey: 'settings:themePalette.border',
        rows: Object.entries(palette.border).map(([key, value]) => ({ key: `border.${key}`, value })),
      },
    ]
    const needle = searchTerm.trim().toLowerCase()
    if (!needle) return all.filter((group) => group.rows.length > 0)
    return all
      .map((group) => ({
        groupKey: group.groupKey,
        rows: group.rows.filter((row) => row.key.toLowerCase().includes(needle) || row.value.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.rows.length > 0)
  }, [palette, searchTerm])

  const total = groups.reduce((sum, group) => sum + group.rows.length, 0)

  return h(
    native.ScrollView as never,
    {
      style: { flex: 1, backgroundColor: c().bg.base },
      contentContainerStyle: { padding: tokens.space[4], gap: tokens.space[3] },
      accessibilityLabel: t('settings:debug.themeVariablePaletteThemePalette'),
    },
    h(Text, {
      variant: 'sm',
      tone: 'muted',
      children: t('settings:themePalette.currentTheme', { name: 'default', id: 'default', scheme, count: total }),
    }),
    // The scheme toggle: on the desktop this drives a preview window; on a
    // phone it switches the running scheme live.
    h(
      native.View as never,
      { style: { flexDirection: 'row', gap: tokens.space[2] } },
      ...(['dark', 'light'] as Scheme[]).map((next) =>
        h(Button, {
          key: next,
          variant: scheme === next ? 'primary' : 'secondary',
          testID: `theme-palette-scheme-${next}`,
          onPress: () => {
            setScheme(next)
            forceRender((n) => n + 1)
          },
          children: next,
        }),
      ),
    ),
    h(TextField, {
      value: searchTerm,
      onChange: setSearchTerm,
      placeholder: t('settings:themePalette.searchVariableNamesOrValues'),
      testID: 'theme-palette-search',
    }),
    ...groups.map((group) =>
      h(
        native.View as never,
        { key: group.groupKey, style: cardStyle },
        h(Text, { variant: 'md', style: { fontWeight: '600' }, children: t(group.groupKey) }),
        ...group.rows.map((row) =>
          h(
            native.View as never,
            { key: row.key, style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] } },
            h(native.View as never, {
              style: {
                width: 32,
                height: 32,
                borderRadius: tokens.radius.sm,
                backgroundColor: row.value,
                borderWidth: 1,
                borderColor: c().border.subtle,
              },
            }),
            h(
              native.View as never,
              { style: { flex: 1, minWidth: 0 } },
              h(Text, { variant: 'xs', tone: 'muted', children: row.key }),
              h(Text, { style: { fontSize: 13, fontFamily: 'monospace' }, children: row.value }),
            ),
          ),
        ),
      ),
    ),
  )
}

const cardStyle = {
  padding: tokens.space[3],
  borderRadius: tokens.radius.sm,
  backgroundColor: 'rgba(255, 255, 255, 0.02)',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.04)',
  gap: tokens.space[2],
} as const
