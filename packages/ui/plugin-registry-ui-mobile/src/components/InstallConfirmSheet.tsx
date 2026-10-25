/**
 * The install/update confirmation sheet — the mobile twin of the desktop
 * package's `InstallConfirmDialog`, on the kit's `Sheet` (a bottom modal).
 *
 * Everything the user must see BEFORE confirming is on this screen: a music
 * or lyric source's egress allowlist is a security red line and gets the most
 * prominent spot; a plugin is third-party code and says so; a blocked audit
 * requires an explicit override acknowledgement, and a locally-modified
 * source requires an explicit overwrite acknowledgement — the same gated
 * confirms as desktop, as press-to-toggle rows instead of checkboxes.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Context } from 'cordis'
import type { RegistryEntryDetails } from '@BBeBee/protocol'
import { normalizeVersion } from '@BBeBee/toolkit'
import { Button, nativePrimitives, Sheet, Text, useI18n, usePalette } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { isBuiltinEntry } from '../hooks/install-state.js'

export interface InstallConfirmSheetProps {
  /** The app context — read for the interface language. */
  ctx: Context
  details: RegistryEntryDetails
  /** What was clicked — the wording differs slightly for an update. */
  action: 'install' | 'update'
  busy: boolean
  error: string | null
  onConfirm: (options?: { overwrite?: boolean }) => void
  onClose: () => void
}

export function InstallConfirmSheet({
  ctx,
  details,
  action,
  busy,
  error,
  onConfirm,
  onClose,
}: InstallConfirmSheetProps): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  // The palette snapshot: subscribe so a theme change repaints the sheet.
  const p = usePalette()
  const { entry, allowedHosts, securityAudit, repoUrl, commit, commitDiff, plan } = details
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false)
  const [blockOverrideConfirmed, setBlockOverrideConfirmed] = useState(false)
  const isLocallyModified = Boolean(details.isLocallyModified)
  const isUpdate = action === 'update'
  const isBlocked = securityAudit?.level === 'block'
  const canConfirm =
    !busy &&
    (!isLocallyModified || overwriteConfirmed) &&
    (!isBlocked || blockOverrideConfirmed)

  // The identity line has four decomposed catalogue keys — no runtime key assembly.
  const identityText = entry.version
    ? entry.author
      ? t('registry:installConfirm.identityFull', {
          name: entry.name,
          version: normalizeVersion(entry.version),
          author: entry.author,
        })
      : t('registry:installConfirm.identityVersion', {
          name: entry.name,
          version: normalizeVersion(entry.version),
        })
    : entry.author
      ? t('registry:installConfirm.identityAuthor', { name: entry.name, author: entry.author })
      : t('registry:installConfirm.identityName', { name: entry.name })
  const titleText = isUpdate
    ? t('registry:installConfirm.updateTitle', { name: entry.name })
    : t('registry:installConfirm.installTitle', { name: entry.name })
  const acceptText = busy
    ? isUpdate
      ? t('registry:installConfirm.updating')
      : t('registry:installConfirm.installing')
    : isUpdate
      ? t('registry:installConfirm.confirmUpdate')
      : t('registry:installConfirm.confirmInstall')
  const themeDisclosureText = isUpdate
    ? entry.author
      ? t('registry:installConfirm.updateThemeWithAuthor', { name: entry.name, author: entry.author })
      : t('registry:installConfirm.updateTheme', { name: entry.name })
    : entry.author
      ? t('registry:installConfirm.importThemeWithAuthor', { name: entry.name, author: entry.author })
      : t('registry:installConfirm.importTheme', { name: entry.name })

  return h(
    Sheet,
    {
      open: true,
      onClose: busy ? () => {} : onClose,
      title: titleText,
      accessibilityLabel: titleText,
    },
    h(
      native.View as never,
      {
        testID: 'registry-confirm-dialog',
        style: { gap: tokens.space[3], marginTop: tokens.space[2] },
      },
      h(Text, { variant: 'sm', tone: 'muted', children: identityText }),
      // Kind-specific disclosures.
      entry.kind === 'music-source' || entry.kind === 'lyric-source'
        ? h(
            native.View as never,
            { key: 'source-disclosure', style: { gap: tokens.space[2] } },
            h(Warning, { children: isUpdate
              ? t('registry:installConfirm.updatingReplacesTheExistingVersion')
              : t('registry:installConfirm.afterTheImportThisSource') }),
            h(Text, { variant: 'sm', children: t('registry:installConfirm.allowedHosts') }),
            allowedHosts?.length
              ? h(
                  native.View as never,
                  { testID: 'registry-hosts-list', style: { gap: tokens.space[1] } },
                  allowedHosts.map((host) =>
                    h(Text, { key: host, variant: 'xs', tone: 'accent', children: host }),
                  ),
                )
              : h(Text, { variant: 'sm', tone: 'muted', children: t('registry:installConfirm.thisDocumentDeclaresNoAllowedHosts') }),
            isBuiltinEntry(entry)
              ? h(Text, { variant: 'xs', tone: 'muted', children: t('registry:installConfirm.thisUpdatesABuiltInLyricSource') })
              : null,
            isLocallyModified
              ? h(
                  native.View as never,
                  {
                    testID: 'registry-locally-modified-warning',
                    style: { gap: tokens.space[1], padding: tokens.space[2], borderRadius: tokens.radius.sm, borderWidth: 1, borderColor: p.border.subtle },
                  },
                  h(Text, { variant: 'sm', tone: 'error', children: t('registry:installConfirm.confirmOverwritingLocalChanges') }),
                  h(Text, { variant: 'xs', tone: 'muted', children: t('registry:installConfirm.detectedThatThisSourceWasModifiedLocally') }),
                  h(CheckRow, {
                    testID: 'registry-overwrite-checkbox',
                    checked: overwriteConfirmed,
                    label: t('registry:installConfirm.iConfirmOverwritingTheLocal'),
                    onToggle: () => setOverwriteConfirmed((v) => !v),
                  }),
                )
              : null,
          )
        : null,
      entry.kind === 'plugin'
        ? h(
            native.View as never,
            {
              key: 'plugin-disclosure',
              testID: 'registry-plugin-confirm-details',
              style: { gap: tokens.space[2] },
            },
            h(Warning, { children: t('registry:installConfirm.thisPluginWillRunThird') }),
            repoUrl || entry.repoUrl
              ? h(
                  native.View as never,
                  { key: 'repo', testID: 'registry-plugin-repo-url', style: { gap: 2 } },
                  h(Text, { variant: 'sm', children: t('registry:installConfirm.repository') }),
                  h(Text, { variant: 'xs', tone: 'accent', children: repoUrl || entry.repoUrl }),
                )
              : null,
            entry.npm
              ? h(
                  native.View as never,
                  { key: 'npm', testID: 'registry-plugin-npm', style: { gap: 2 } },
                  h(Text, { variant: 'sm', children: t('registry:installConfirm.npmPackage') }),
                  h(Text, { variant: 'xs', tone: 'muted', children: entry.npm }),
                )
              : null,
            plan
              ? h(
                  native.View as never,
                  { key: 'plan', testID: 'registry-plugin-plan-version' },
                  h(Text, { variant: 'sm', tone: 'muted' }, t('registry:installConfirm.planVersion', { version: normalizeVersion(plan.target.version) })),
                )
              : null,
            plan?.target.unreviewed
              ? h(Warning, {
                  key: 'unreviewed',
                  testID: 'registry-plugin-unreviewed-warning',
                  children: t('registry:installConfirm.unreviewedVersionWarning', {
                    version: normalizeVersion(plan.target.version),
                    reviewed: entry.reviewedVersion
                      ? normalizeVersion(entry.reviewedVersion)
                      : t('registry:installConfirm.unreviewedVersionUnknown'),
                  }),
                })
              : null,
            commitDiff
              ? h(
                  native.View as never,
                  { key: 'commit-diff', testID: 'registry-commit-diff', style: { gap: 2 } },
                  h(Text, { variant: 'sm', children: t('registry:installConfirm.commitDiff') }),
                  h(
                    Text,
                    { variant: 'xs', tone: 'muted' },
                    `${commitDiff.previousCommit ? commitDiff.previousCommit.slice(0, 7) : t('registry:installConfirm.initialCommit')} → ${commitDiff.currentCommit.slice(0, 7)}`,
                  ),
                )
              : commit
                ? h(
                    native.View as never,
                    { key: 'commit', testID: 'registry-commit-info', style: { gap: 2 } },
                    h(Text, { variant: 'sm', children: t('registry:installConfirm.commit') }),
                    h(Text, { variant: 'xs', tone: 'muted', children: commit.slice(0, 7) }),
                  )
                : null,
            entry.sha256
              ? h(
                  native.View as never,
                  { key: 'sha', testID: 'registry-plugin-sha256', style: { gap: 2 } },
                  h(Text, { variant: 'sm', children: t('registry:installConfirm.releaseHashSHA') }),
                  h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 2, children: entry.sha256 }),
                )
              : null,
            entry.services?.length
              ? h(
                  native.View as never,
                  { key: 'services', style: { gap: tokens.space[1] } },
                  h(Text, { variant: 'sm', children: t('registry:installConfirm.requiredServices') }),
                  h(
                    native.View as never,
                    { testID: 'registry-plugin-services', style: { flexDirection: 'row', gap: tokens.space[1], flexWrap: 'wrap' } },
                    entry.services.map((service) =>
                      h(
                        native.View as never,
                        {
                          key: service,
                          style: {
                            paddingHorizontal: tokens.space[2],
                            paddingVertical: 2,
                            borderRadius: tokens.radius.pill,
                            backgroundColor: p.bg.overlay,
                          },
                        },
                        h(Text, { variant: 'xs', tone: 'muted', children: service }),
                      ),
                    ),
                  ),
                )
              : null,
            entry.platforms?.length
              ? h(
                  native.View as never,
                  { key: 'platforms', style: { gap: tokens.space[1] } },
                  h(Text, { variant: 'sm', children: t('registry:installConfirm.platforms') }),
                  h(
                    native.View as never,
                    { testID: 'registry-plugin-platforms', style: { flexDirection: 'row', gap: tokens.space[1], flexWrap: 'wrap' } },
                    entry.platforms.map((platform) =>
                      h(
                        native.View as never,
                        {
                          key: platform,
                          style: {
                            paddingHorizontal: tokens.space[2],
                            paddingVertical: 2,
                            borderRadius: tokens.radius.pill,
                            backgroundColor: p.bg.overlay,
                          },
                        },
                        h(Text, { variant: 'xs', tone: 'muted', children: platform }),
                      ),
                    ),
                  ),
                )
              : null,
            entry.minAppVersion
              ? h(
                  native.View as never,
                  { key: 'minapp' },
                  h(Text, { variant: 'sm', tone: 'muted' }, t('registry:installConfirm.requiresAppVersion', { version: normalizeVersion(entry.minAppVersion) })),
                )
              : null,
          )
        : null,
      entry.kind === 'theme'
        ? h(
            native.View as never,
            { key: 'theme-disclosure', style: { gap: tokens.space[1] } },
            h(Text, { variant: 'sm', tone: 'muted', children: themeDisclosureText }),
            entry.version
              ? h(Text, { variant: 'sm', tone: 'muted' }, t('registry:installConfirm.versionLine', { version: normalizeVersion(entry.version) }))
              : null,
          )
        : null,
      // Security audit report.
      securityAudit
        ? h(
            native.View as never,
            {
              key: 'audit',
              testID: 'registry-security-audit-report',
              style: { gap: tokens.space[2], padding: tokens.space[2], borderRadius: tokens.radius.sm, borderWidth: 1, borderColor: p.border.subtle },
            },
            h(
              native.View as never,
              { style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } },
              h(Text, { variant: 'sm', children: t('registry:installConfirm.securityAuditReport') }),
              h(
                native.View as never,
                {
                  testID: 'registry-security-badge',
                  style: {
                    paddingHorizontal: tokens.space[2],
                    paddingVertical: 2,
                    borderRadius: tokens.radius.pill,
                    backgroundColor:
                      securityAudit.level === 'block'
                        ? 'rgba(244, 63, 94, 0.15)'
                        : securityAudit.level === 'warn'
                          ? 'rgba(245, 158, 11, 0.15)'
                          : 'rgba(16, 185, 129, 0.15)',
                  },
                },
                h(Text, {
                  variant: 'xs',
                  tone: securityAudit.level === 'block' ? 'error' : securityAudit.level === 'warn' ? 'warn' : 'ok',
                  children:
                    securityAudit.level === 'block'
                      ? t('registry:installConfirm.securityBadgeBlock')
                      : securityAudit.level === 'warn'
                        ? t('registry:installConfirm.securityBadgeWarn')
                        : t('registry:installConfirm.securityBadgePass'),
                }),
              ),
            ),
            securityAudit.findings.length
              ? h(
                  native.View as never,
                  { testID: 'registry-security-findings', style: { gap: tokens.space[1] } },
                  securityAudit.findings.map((finding, idx) =>
                    h(
                      native.View as never,
                      { key: idx, style: { gap: 2 } },
                      h(Text, { variant: 'xs', tone: finding.level === 'block' ? 'error' : 'warn' }, `[${finding.category ?? finding.ruleId}] ${finding.level.toUpperCase()}`),
                      h(Text, { variant: 'xs', children: finding.message }),
                      finding.snippet
                        ? h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 4, children: finding.snippet })
                        : null,
                    ),
                  ),
                )
              : h(Text, { variant: 'xs', tone: 'ok', children: t('registry:installConfirm.noKnownSecurityRisks') }),
            isBlocked
              ? h(
                  native.View as never,
                  {
                    testID: 'registry-security-block-warning',
                    style: { gap: tokens.space[1], padding: tokens.space[2], borderRadius: tokens.radius.sm, borderWidth: 1, borderColor: p.border.subtle },
                  },
                  h(Text, { variant: 'sm', tone: 'error', children: t('registry:installConfirm.blockedByAHighRiskFinding') }),
                  h(Text, { variant: 'xs', tone: 'muted', children: t('registry:installConfirm.staticCodeScanningFoundHigh') }),
                  h(CheckRow, {
                    testID: 'registry-block-override-checkbox',
                    checked: blockOverrideConfirmed,
                    label: t('registry:installConfirm.iUnderstandTheHighRiskFindings'),
                    onToggle: () => setBlockOverrideConfirmed((v) => !v),
                  }),
                )
              : null,
          )
        : null,
      error
        ? h(
            native.View as never,
            { key: 'error', testID: 'registry-confirm-error', style: { padding: tokens.space[2], borderRadius: tokens.radius.sm, borderWidth: 1, borderColor: p.border.subtle } },
            h(Text, { variant: 'sm', tone: 'error', children: error }),
          )
        : null,
      h(
        native.View as never,
        { key: 'actions', style: { flexDirection: 'row', justifyContent: 'flex-end', gap: tokens.space[2], marginTop: tokens.space[1] } },
        h(Button, {
          testID: 'registry-confirm-cancel',
          variant: 'secondary',
          disabled: busy,
          onPress: onClose,
          children: t('app:common.cancel'),
        }),
        h(Button, {
          testID: 'registry-confirm-accept',
          variant: 'primary',
          disabled: !canConfirm,
          loading: busy,
          onPress: () =>
            onConfirm({
              overwrite: isLocallyModified && overwriteConfirmed,
            }),
          children: acceptText,
        }),
      ),
    ),
  )
}

/** The warning callout used across the sheet's disclosures. */
function Warning(props: { children: ReactNode; testID?: string }): ReactElement {
  const native = nativePrimitives()
  const p = usePalette()
  return h(
    native.View as never,
    {
      ...(props.testID ? { testID: props.testID } : {}),
      style: { padding: tokens.space[2], borderRadius: tokens.radius.sm, borderWidth: 1, borderColor: p.border.subtle },
    },
    h(Text, { variant: 'sm', tone: 'warn', children: props.children }),
  )
}

/**
 * A press-to-toggle confirmation row — the mobile spelling of the desktop
 * dialog's checkboxes. A whole-row press target, because a 20px square is
 * below the minimum tap target on a phone.
 */
function CheckRow(props: {
  testID?: string
  checked: boolean
  label: string
  onToggle: () => void
}): ReactElement {
  const native = nativePrimitives()
  const p = usePalette()
  return h(
    native.Pressable as never,
    {
      ...(props.testID ? { testID: props.testID } : {}),
      accessibilityRole: 'checkbox',
      accessibilityState: { checked: props.checked },
      accessibilityLabel: props.label,
      onPress: props.onToggle,
      style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2], paddingVertical: tokens.space[1] },
    },
    h(native.View as never, {
      style: {
        width: 18,
        height: 18,
        borderRadius: 4,
        borderWidth: 1.5,
        // The checked state is the fill: one glance says "this is armed".
        backgroundColor: props.checked ? p.accent.base : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      },
    }),
    h(Text, { variant: 'xs', children: props.label }),
  )
}
