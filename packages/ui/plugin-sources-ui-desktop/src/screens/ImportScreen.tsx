import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { I18nService, ImportReport } from '@BBeBee/protocol'
import { useSourceImport } from '@bbebee/plugin-sources/hooks'
import { Button, Text, TextField, useI18n } from '@BBeBee/ui-kit-desktop'
import { palettes, tokens } from '@BBeBee/ui-tokens'

const p = () => palettes.dark

export function ImportScreen({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const state = useSourceImport(ctx)
  const scheme = p()

  return h(
    'section',
    { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[4], padding: tokens.space[4] } },
    h(Text, { variant: 'lg' }, t('sources:import.importASource')),
    h(
      Text,
      { variant: 'sm', tone: 'muted' },
      t('sources:import.pasteInstructions'),
    ),
    h(TextField, {
      value: state.text,
      onChange: state.setText,
      multiline: true,
      rows: 14,
      placeholder: t('sources:import.sourceUrlHttpsSourceNameRuleStream'),
      accessibilityLabel: t('sources:import.sourceStringLabel'),
      testID: 'source-import-input',
      ...(state.issues.length > 0
        ? { error: state.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n') }
        : {}),
    }),
    state.preview
      ? h(
          'ul',
          {
            style: {
              margin: 0,
              padding: tokens.space[3],
              borderRadius: tokens.radius.sm,
              background: scheme.bg.raised,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[1],
            },
            'aria-label': t('sources:import.whatWillBeImported'),
          },
          h(
            Text,
            { variant: 'sm', tone: 'muted' },
            state.preview.count === 1
              ? t('sources:index.previewOne', { count: state.preview.count })
              : t('sources:index.previewOther', { count: state.preview.count }),
          ),
          ...state.preview.names.map((name) => h('li', { key: name }, h(Text, { variant: 'sm' }, name))),
        )
      : null,
    h(
      'div',
      { style: { display: 'flex', gap: tokens.space[2] } },
      h(Button, {
        onPress: state.submit,
        disabled: state.busy || !state.preview,
        loading: state.busy,
        testID: 'source-import-submit',
        children: t('sources:import.importButton'),
      }),
      h(Button, {
        variant: 'ghost',
        onPress: state.reset,
        disabled: state.busy,
        children: t('app:common.clear'),
      }),
    ),
    state.report
      ? h(
          Text,
          { variant: 'sm', tone: state.report.added.length + state.report.updated.length > 0 ? 'accent' : 'muted' },
          summariseImport(state.report, t),
        )
      : null,
  )
}

function summariseImport(report: ImportReport, t: I18nService['t']): string {
  const parts: string[] = []
  if (report.added.length) parts.push(t('sources:import.summaryAdded', { count: report.added.length }))
  if (report.updated.length) parts.push(t('sources:import.summaryUpdated', { count: report.updated.length }))
  if (report.unchanged.length) parts.push(t('sources:import.summaryUnchanged', { count: report.unchanged.length }))
  if (report.rejected.length) parts.push(t('sources:import.summaryRejected', { count: report.rejected.length }))
  return parts.length > 0 ? parts.join(', ') : t('sources:import.summaryNothing')
}
