/**
 * The install/update confirmation dialog.
 *
 * Everything the user must see BEFORE confirming is on this screen: a music
 * or lyric source's egress allowlist is a security red line and gets the
 * most prominent spot; a plugin is third-party code and says so. The dialog
 * itself is the kit's `Sheet` — no bespoke modal chrome.
 */

import { createElement as h, useState, type ReactElement } from 'react'
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
  onConfirm: (options?: { overwrite?: boolean }) => void
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
  const { entry, allowedHosts, securityAudit, repoUrl, commit, commitDiff } = details
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false)
  const [blockOverrideConfirmed, setBlockOverrideConfirmed] = useState(false)
  const isLocallyModified = Boolean(details.isLocallyModified)
  const isUpdate = action === 'update'
  const verb = isUpdate ? 'Update' : 'Install'
  const isBlocked = securityAudit?.level === 'block'
  const canConfirm =
    !busy &&
    (!isLocallyModified || overwriteConfirmed) &&
    (!isBlocked || blockOverrideConfirmed)

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
                  ? 'Updating replaces the existing version; if this source was modified locally, overwriting requires confirmation again.'
                  : 'After the import, this source will be able to reach the hosts below — confirm you trust them.',
              ),
            ),
            h('div', { style: sectionTitleStyle }, 'Allowed hosts'),
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
                  'This document declares no allowed hosts (allowedHosts) — verify its origin carefully.',
                ),
            isBuiltinEntry(entry)
              ? h(
                  'div',
                  { style: bodyTextStyle },
                  'This updates a built-in lyric source: installing overwrites the built-in implementation with the registry version.',
                )
              : null,
            isLocallyModified
              ? h(
                  'div',
                  {
                    'data-testid': 'registry-locally-modified-warning',
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--color-error, #F43F5E)',
                      background: 'rgba(244, 63, 94, 0.08)',
                      color: 'var(--color-error, #F43F5E)',
                      fontSize: 13,
                      lineHeight: 1.5,
                    },
                  },
                  h(
                    'strong',
                    { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                    tablerIcon('alert', { size: 14 }),
                    'Confirm overwriting local changes',
                  ),
                  h(
                    'span',
                    null,
                    'Detected that this source was modified locally by hand. Continuing the update will overwrite those local changes.',
                  ),
                  h(
                    'label',
                    { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 } },
                    h('input', {
                      type: 'checkbox',
                      'data-testid': 'registry-overwrite-checkbox',
                      checked: overwriteConfirmed,
                      onChange: (e: { target: { checked: boolean } }) => setOverwriteConfirmed(e.target.checked),
                    }),
                    h('span', { style: { color: 'var(--text-primary, #F5F7FF)', fontSize: 13 } }, 'I confirm overwriting the local changes and updating'),
                  ),
                )
              : null,
          )
        : null,
      entry.kind === 'plugin'
        ? h(
            'div',
            {
              'data-testid': 'registry-plugin-confirm-details',
              style: { display: 'flex', flexDirection: 'column', gap: 8 },
            },
            h(
              'div',
              { style: warningStyle },
              tablerIcon('alert', { size: 16 }),
              h('span', null, 'This plugin will run third-party code — only install sources you trust.'),
            ),
            repoUrl || entry.repoUrl
              ? h(
                  'div',
                  {
                    'data-testid': 'registry-plugin-repo-url',
                    style: { display: 'flex', flexDirection: 'column', gap: 4 },
                  },
                  h('div', { style: sectionTitleStyle }, 'Repository'),
                  h(
                    'a',
                    {
                      href: repoUrl || entry.repoUrl,
                      target: '_blank',
                      rel: 'noreferrer noopener',
                      style: {
                        color: 'var(--color-primary, #4E88FF)',
                        fontSize: 12,
                        textDecoration: 'none',
                        wordBreak: 'break-all',
                      },
                    },
                    repoUrl || entry.repoUrl,
                  ),
                )
              : null,
            commitDiff
              ? h(
                  'div',
                  {
                    'data-testid': 'registry-commit-diff',
                    style: { display: 'flex', flexDirection: 'column', gap: 4 },
                  },
                  h('div', { style: sectionTitleStyle }, 'Commit diff'),
                  h(
                    'div',
                    { style: { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
                    h(
                      'span',
                      { style: { color: 'var(--text-muted, #7E859B)' } },
                      commitDiff.previousCommit ? commitDiff.previousCommit.slice(0, 7) : 'initial',
                    ),
                    ' → ',
                    h(
                      'span',
                      { style: { color: 'var(--color-primary, #4E88FF)', fontWeight: 600 } },
                      commitDiff.currentCommit.slice(0, 7),
                    ),
                  ),
                )
              : commit
                ? h(
                    'div',
                    {
                      'data-testid': 'registry-commit-info',
                      style: { display: 'flex', flexDirection: 'column', gap: 4 },
                    },
                    h('div', { style: sectionTitleStyle }, 'Commit'),
                    h(
                      'div',
                      { style: { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
                      commit.slice(0, 7),
                    ),
                  )
                : null,
            entry.sha256
              ? h(
                  'div',
                  {
                    'data-testid': 'registry-plugin-sha256',
                    style: { display: 'flex', flexDirection: 'column', gap: 4 },
                  },
                  h('div', { style: sectionTitleStyle }, 'Release hash (SHA-256)'),
                  h(
                    'div',
                    {
                      style: {
                        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                        fontSize: 11,
                        color: 'var(--text-muted, #7E859B)',
                        wordBreak: 'break-all',
                        background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
                        padding: '4px 8px',
                        borderRadius: 4,
                        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                      },
                    },
                    entry.sha256,
                  ),
                )
              : null,
            entry.capabilities?.length
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                  h('div', { style: sectionTitleStyle }, 'Requested capabilities'),
                  h(
                    'div',
                    {
                      'data-testid': 'registry-plugin-capabilities',
                      style: { display: 'flex', gap: 4, flexWrap: 'wrap' },
                    },
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
                  `Requires app version ≥ ${normalizeVersion(entry.minAppVersion)}`,
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
              `${isUpdate ? 'Update' : 'Import'} the theme "${entry.name}"${entry.author ? ` (by ${entry.author})` : ''}. Contrast is checked automatically on import; themes that fail are rejected.`,
            ),
            entry.version ? h('div', { style: bodyTextStyle }, `Version v${normalizeVersion(entry.version)}`) : null,
          )
        : null,
      // Security audit report
      securityAudit
        ? h(
            'div',
            {
              'data-testid': 'registry-security-audit-report',
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--surface-2, rgba(255, 255, 255, 0.04))',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
              },
            },
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              h('div', { style: sectionTitleStyle }, 'Security audit report'),
              h(
                'span',
                {
                  'data-testid': 'registry-security-badge',
                  style: {
                    display: 'inline-flex',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    background:
                      securityAudit.level === 'block'
                        ? 'rgba(244, 63, 94, 0.15)'
                        : securityAudit.level === 'warn'
                          ? 'rgba(245, 158, 11, 0.15)'
                          : 'rgba(16, 185, 129, 0.15)',
                    color:
                      securityAudit.level === 'block'
                        ? 'var(--color-error, #F43F5E)'
                        : securityAudit.level === 'warn'
                          ? 'var(--color-warning, #F59E0B)'
                          : 'var(--color-success, #10B981)',
                    border: `1px solid ${
                      securityAudit.level === 'block'
                        ? 'var(--color-error, #F43F5E)'
                        : securityAudit.level === 'warn'
                          ? 'var(--color-warning, #F59E0B)'
                          : 'var(--color-success, #10B981)'
                    }`,
                  },
                },
                securityAudit.level === 'block'
                  ? 'Block'
                  : securityAudit.level === 'warn'
                    ? 'Warn'
                    : 'Pass',
              ),
            ),
            securityAudit.findings.length
              ? h(
                  'div',
                  {
                    'data-testid': 'registry-security-findings',
                    style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 },
                  },
                  securityAudit.findings.map((finding, idx) =>
                    h(
                      'div',
                      {
                        key: idx,
                        style: {
                          fontSize: 12,
                          padding: '6px 8px',
                          borderRadius: 6,
                          background:
                            finding.level === 'block' ? 'rgba(244, 63, 94, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                          border: `1px solid ${
                            finding.level === 'block' ? 'rgba(244, 63, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)'
                          }`,
                          color:
                            finding.level === 'block'
                              ? 'var(--color-error, #F43F5E)'
                              : 'var(--color-warning, #F59E0B)',
                          lineHeight: 1.4,
                        },
                      },
                      h(
                        'div',
                        { style: { fontWeight: 600, display: 'flex', justifyContent: 'space-between' } },
                        h('span', null, `[${finding.category ?? finding.ruleId}] ${finding.level.toUpperCase()}`),
                        (finding.line ?? finding.loc?.line) ? h('span', null, `L${finding.line ?? finding.loc?.line}`) : null,
                      ),
                      h('div', null, finding.message),
                      finding.snippet
                        ? h(
                            'pre',
                            {
                              style: {
                                margin: '4px 0 0 0',
                                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                                fontSize: 11,
                                whiteSpace: 'pre-wrap',
                                opacity: 0.85,
                              },
                            },
                            finding.snippet,
                          )
                        : null,
                    ),
                  ),
                )
              : h(
                  'div',
                  { style: { fontSize: 12, color: 'var(--color-success, #10B981)' } },
                  'No known security risks or undeclared network calls detected.',
                ),
            isBlocked
              ? h(
                  'div',
                  {
                    'data-testid': 'registry-security-block-warning',
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'rgba(244, 63, 94, 0.1)',
                      border: '1px solid var(--color-error, #F43F5E)',
                      color: 'var(--color-error, #F43F5E)',
                      fontSize: 12,
                      marginTop: 4,
                    },
                  },
                  h(
                    'strong',
                    { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                    tablerIcon('alert', { size: 14 }),
                    'Blocked by a high-risk finding',
                  ),
                  h('span', null, 'Static code scanning found high-risk operations; installation is blocked by default to protect your device.'),
                  h(
                    'label',
                    { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 } },
                    h('input', {
                      type: 'checkbox',
                      'data-testid': 'registry-block-override-checkbox',
                      checked: blockOverrideConfirmed,
                      onChange: (e: { target: { checked: boolean } }) => setBlockOverrideConfirmed(e.target.checked),
                    }),
                    h(
                      'span',
                      { style: { color: 'var(--text-primary, #F5F7FF)', fontSize: 12 } },
                      'I understand the high-risk findings and confirm installing anyway',
                    ),
                  ),
                )
              : null,
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
          'Cancel',
        ),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'registry-confirm-accept',
            onClick: canConfirm
              ? () =>
                  onConfirm({
                    overwrite: isLocallyModified && overwriteConfirmed,
                    ...(isBlocked && blockOverrideConfirmed ? { overwrite: isLocallyModified && overwriteConfirmed } : {}),
                  })
              : undefined,
            disabled: !canConfirm,
            className: 'bbreg-btn bbreg-btn-primary',
            style: {
              padding: '6px 16px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--gradient-brand, linear-gradient(135deg, #5F87FF 0%, #A99CFF 100%))',
              color: 'var(--bb-accent-on, #FFFFFF)',
              fontWeight: 600,
              fontSize: 13,
              cursor: !canConfirm ? 'not-allowed' : 'pointer',
              opacity: !canConfirm ? 0.5 : 1,
            },
          },
          busy ? `${verb}ing…` : `Confirm ${verb.toLowerCase()}`,
        ),
      ),
    ),
  )
}
