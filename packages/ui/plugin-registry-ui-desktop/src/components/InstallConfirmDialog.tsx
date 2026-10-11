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
  const verb = isUpdate ? '更新' : '安装'
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
                    '本地修改覆盖确认',
                  ),
                  h(
                    'span',
                    null,
                    '检测到此源在本地被手动修改过。继续更新将覆盖本地改动。',
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
                    h('span', { style: { color: 'var(--text-primary, #F5F7FF)', fontSize: 13 } }, '我确认覆盖本地修改并更新'),
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
              h('span', null, '此插件将执行第三方代码，请仅安装你信任的来源。'),
            ),
            repoUrl || entry.repoUrl
              ? h(
                  'div',
                  {
                    'data-testid': 'registry-plugin-repo-url',
                    style: { display: 'flex', flexDirection: 'column', gap: 4 },
                  },
                  h('div', { style: sectionTitleStyle }, '代码仓库'),
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
                  h('div', { style: sectionTitleStyle }, '提交差异 (Commit Diff)'),
                  h(
                    'div',
                    { style: { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12, color: 'var(--text-secondary, #C5CAD8)' } },
                    h(
                      'span',
                      { style: { color: 'var(--text-muted, #7E859B)' } },
                      commitDiff.previousCommit ? commitDiff.previousCommit.slice(0, 7) : '初始',
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
                    h('div', { style: sectionTitleStyle }, '版本提交 (Commit)'),
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
                  h('div', { style: sectionTitleStyle }, '发布哈希 (SHA-256)'),
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
                  h('div', { style: sectionTitleStyle }, '申请的能力'),
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
              h('div', { style: sectionTitleStyle }, '安全审计报告'),
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
                  ? '高危风险 (Block)'
                  : securityAudit.level === 'warn'
                    ? '警告 (Warn)'
                    : '通过 (Pass)',
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
                  '未检测到已知安全风险或违规外呼。',
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
                    '高危风险阻断',
                  ),
                  h('span', null, '静态代码扫描发现高危操作，默认禁止安装以保护你的设备安全。'),
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
                      '我已知晓高危风险并确认强制安装',
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
          '取消',
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
          busy ? `${verb}中…` : `确认${verb}`,
        ),
      ),
    ),
  )
}
