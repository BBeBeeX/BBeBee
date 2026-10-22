/**
 * The local-import confirmation dialog.
 *
 * A package file picked from disk has no registry entry and no npm
 * provenance to vouch for it — its identity is whatever its own
 * `package.json` / `BBeBee.plugin.json` claim. Everything the user must
 * weigh before confirming is on this screen: the unreviewed-origin
 * warning (prominent, always first), the claimed identity, the SHA-256
 * the manager pinned during preview, the capabilities the manifest
 * declares (confirming is what grants them), and the preview's
 * warnings. The preview itself already ran the full install checklist
 * (bounded extraction, security scan, manifest re-checks), so a package
 * that reaches this dialog would pass — this screen is about trust,
 * not about validation.
 */

import { createElement as h, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { LocalPluginPreview } from '@BBeBee/protocol'
import { Sheet, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { useOptionalI18n } from '../utils/optional-i18n.js'

export interface LocalImportConfirmDialogProps {
  /** Read for the interface language; absent, copy degrades to catalogue keys. */
  ctx?: Context
  preview: LocalPluginPreview
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}

const sectionTitleStyle = {
  margin: 0,
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--text-primary, #F5F7FF)',
} as const

const bodyTextStyle = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--text-secondary, #C5CAD8)',
} as const

const warningStyle = {
  display: 'flex',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--color-warning, #F59E0B)',
  color: 'var(--color-warning, #F59E0B)',
  fontSize: 13,
  lineHeight: 1.5,
  alignItems: 'flex-start',
} as const

const monoStyle = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 12,
  color: 'var(--text-secondary, #C5CAD8)',
  wordBreak: 'break-all',
} as const

const chipStyle = {
  display: 'inline-flex',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
  color: 'var(--text-secondary, #C5CAD8)',
} as const

function fieldRow(label: string, value: ReactElement | string) {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    h('div', { style: sectionTitleStyle }, label),
    typeof value === 'string' ? h('div', { style: monoStyle }, value) : value,
  )
}

export function LocalImportConfirmDialog({
  ctx,
  preview,
  busy,
  error,
  onConfirm,
  onClose,
}: LocalImportConfirmDialogProps): ReactElement {
  const { t } = useOptionalI18n(ctx)
  const name = preview.displayName ?? preview.id
  const titleText = t('registry:localImport.title', { name })
  // The preview's first warning is the manager's own unreviewed-origin
  // note; the banner above already says it, so the notes list skips it.
  const notes = preview.warnings.filter((w) => !w.startsWith('本地导入：'))

  return h(
    Sheet,
    {
      open: true,
      onClose: busy ? () => {} : onClose,
      title: titleText,
      accessibilityLabel: titleText,
    },
    h(
      'div',
      {
        'data-testid': 'local-import-confirm-dialog',
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          maxHeight: 'min(70vh, 560px)',
          overflowY: 'auto',
          paddingRight: 6,
        },
      },
      h(
        'div',
        { style: warningStyle },
        tablerIcon('alert', { size: 16 }),
        h('span', null, t('registry:localImport.unreviewedWarning')),
      ),
      preview.installedVersion
        ? h(
            'div',
            { style: bodyTextStyle },
            t('registry:localImport.replacesInstalled', { version: preview.installedVersion }),
          )
        : null,
      fieldRow(t('registry:installConfirm.npmPackage'), preview.npm),
      fieldRow(
        t('registry:localImport.version'),
        h('div', { style: bodyTextStyle }, preview.version),
      ),
      preview.author ? fieldRow(t('registry:localImport.author'), preview.author) : null,
      fieldRow(
        t('registry:installConfirm.releaseHashSHA'),
        h(
          'div',
          {
            style: {
              ...monoStyle,
              fontSize: 11,
              color: 'var(--text-muted, #7E859B)',
              background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
            },
          },
          preview.sha256,
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { style: sectionTitleStyle }, t('registry:localImport.capabilities')),
        preview.capabilities.length
          ? h(
              'div',
              {
                'data-testid': 'local-import-capabilities',
                style: { display: 'flex', gap: 4, flexWrap: 'wrap' },
              },
              preview.capabilities.map((cap) => h('span', { key: cap, style: chipStyle }, cap)),
            )
          : h('div', { style: bodyTextStyle }, t('registry:localImport.noCapabilities')),
      ),
      h(
        'div',
        { style: bodyTextStyle },
        t('registry:localImport.filesCount', { count: preview.fileCount }),
      ),
      notes.length
        ? h(
            'div',
            {
              'data-testid': 'local-import-notes',
              style: { display: 'flex', flexDirection: 'column', gap: 6 },
            },
            h('div', { style: sectionTitleStyle }, t('registry:localImport.notes')),
            notes.map((note) => h('div', { key: note, style: bodyTextStyle }, note)),
          )
        : null,
      error
        ? h(
            'div',
            {
              'data-testid': 'local-import-confirm-error',
              style: {
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--color-error, #F43F5E)',
                color: 'var(--color-error, #F43F5E)',
                fontSize: 13,
                lineHeight: 1.5,
                wordBreak: 'break-word',
              },
            },
            error,
          )
        : null,
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 } },
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'local-import-confirm-cancel',
            onClick: onClose,
            disabled: busy,
            className: 'bbreg-btn bbreg-btn-ghost',
            style: {
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
              background: 'transparent',
              color: 'var(--text-secondary, #C5CAD8)',
              cursor: 'pointer',
              fontSize: 13,
            },
          },
          t('app:common.cancel'),
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'local-import-confirm-accept',
            onClick: busy ? undefined : onConfirm,
            disabled: busy,
            className: 'bbreg-btn bbreg-btn-primary',
            style: {
              padding: '6px 16px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
              color: 'var(--bb-accent-on, #FFFFFF)',
              fontWeight: 600,
              fontSize: 13,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            },
          },
          busy ? t('registry:localImport.importing') : t('registry:localImport.confirmImport'),
        ),
      ),
    ),
  )
}
