/**
 * The install/update confirmation dialog.
 *
 * Everything the user must see BEFORE confirming is on this screen: a music
 * or lyric source's egress allowlist is a security red line and gets the
 * most prominent spot; a plugin is third-party code and says so. The dialog
 * itself is the kit's `Sheet` — no bespoke modal chrome.
 */

import { createElement as h, type ReactElement } from 'react'
import type { RegistryEntryDetails } from '@BBeBee/protocol'
import { normalizeVersion } from '@BBeBee/toolkit'
import { Sheet, tablerIcon } from '@BBeBee/ui-kit-desktop'
import { isBuiltinEntry } from '../hooks/install-state.js'

export interface InstallConfirmDialogProps {
  details: RegistryEntryDetails
  /** What was clicked — the dialog's wording differs slightly for an update. */
  action: 'install' | 'update'
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

export function InstallConfirmDialog({
  details,
  action,
  busy,
  error,
  onConfirm,
  onClose,
}: InstallConfirmDialogProps): ReactElement {
  const { entry, allowedHosts } = details
  const isUpdate = action === 'update'
  const verb = isUpdate ? '更新' : '安装'

  return h(
    Sheet,
    {
      open: true,
      onClose: busy ? () => {} : onClose,
      title: `${verb} ${entry.name}`,
      accessibilityLabel: `${verb} ${entry.name}`,
    },
    h(
      'div',
      { 'data-testid': 'registry-confirm-dialog', style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      // Identity line
      h(
        'div',
        { style: bodyTextStyle },
        `${entry.name}${entry.version ? ` v${normalizeVersion(entry.version)}` : ''}${entry.author ? ` · ${entry.author}` : ''}`,
      ),
      // Kind-specific disclosures
      entry.kind === 'music-source' || entry.kind === 'lyric-source'
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h(
              'div',
              { style: warningStyle },
              tablerIcon('alert', { size: 16 }),
              h(
                'span',
                null,
                isUpdate
                  ? '更新后将替换现有版本；若该源在本地被修改过，覆盖时需要再次确认。'
                  : '导入后，此源将能够访问下列主机，请确认你信任它们。',
              ),
            ),
            h('div', { style: sectionTitleStyle }, '允许访问的主机'),
            allowedHosts?.length
              ? h(
                  'ul',
                  {
                    'data-testid': 'registry-hosts-list',
                    style: {
                      margin: 0,
                      paddingLeft: 20,
                      fontSize: 13,
                      lineHeight: 1.6,
                      color: 'var(--text-primary, #F5F7FF)',
                      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    },
                  },
                  allowedHosts.map((host) => h('li', { key: host }, host)),
                )
              : h(
                  'div',
                  { style: bodyTextStyle },
                  '该文档未声明允许访问的主机（allowedHosts），请谨慎确认来源。',
                ),
            isBuiltinEntry(entry)
              ? h(
                  'div',
                  { style: bodyTextStyle },
                  '这是内置歌词源的更新：安装会用注册表版本覆盖内置实现。',
                )
              : null,
          )
        : null,
      entry.kind === 'plugin'
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h(
              'div',
              { style: warningStyle },
              tablerIcon('alert', { size: 16 }),
              h('span', null, '此插件将执行第三方代码，请仅安装你信任的来源。'),
            ),
            entry.capabilities?.length
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                  h('div', { style: sectionTitleStyle }, '申请的能力'),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                    entry.capabilities.map((capability) =>
                      h(
                        'span',
                        {
                          key: capability,
                          style: {
                            display: 'inline-flex',
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
                            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                            color: 'var(--text-secondary, #C5CAD8)',
                          },
                        },
                        capability,
                      ),
                    ),
                  ),
                )
              : null,
            entry.minAppVersion
              ? h(
                  'div',
                  { style: bodyTextStyle },
                  `需要应用版本 ≥ ${normalizeVersion(entry.minAppVersion)}`,
                )
              : null,
          )
        : null,
      entry.kind === 'theme'
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h(
              'div',
              { style: bodyTextStyle },
              `${isUpdate ? '更新' : '导入'}主题「${entry.name}」${entry.author ? `（作者 ${entry.author}）` : ''}。导入后会自动通过对比度检查，未通过的主题会被拒绝。`,
            ),
            entry.version ? h('div', { style: bodyTextStyle }, `版本 v${normalizeVersion(entry.version)}`) : null,
          )
        : null,
      error
        ? h(
            'div',
            {
              'data-testid': 'registry-confirm-error',
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
            'data-testid': 'registry-confirm-cancel',
            onClick: onClose,
            disabled: busy,
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
          '取消',
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'registry-confirm-accept',
            onClick: busy ? undefined : onConfirm,
            disabled: busy,
            style: {
              padding: '6px 16px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
              color: 'var(--bb-accent-on, #FFFFFF)',
              fontWeight: 600,
              fontSize: 13,
              cursor: busy ? 'default' : 'pointer',
            },
          },
          busy ? `${verb}中…` : `确认${verb}`,
        ),
      ),
    ),
  )
}
