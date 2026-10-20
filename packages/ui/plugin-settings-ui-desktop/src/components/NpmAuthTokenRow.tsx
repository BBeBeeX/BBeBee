import { Button, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { SettingsRow } from './SettingsRow.js'

export interface NpmAuthTokenRowProps {
  ctx: Context
  /** Whether a token is currently stored in the secrets service. */
  tokenSet: boolean
  onSave: (token: string) => Promise<void>
  onClear: () => Promise<void>
}

/**
 * npm registry auth token editor.
 *
 * The token value itself never leaves this row except through `onSave`, which
 * the settings screen routes to `plugin-manager.setNpmAuthToken` (secrets
 * service, never the settings store). This component only ever renders the
 * boolean `tokenSet` state.
 */
export function NpmAuthTokenRow({ ctx, tokenSet, onSave, onClear }: NpmAuthTokenRowProps): ReactElement {
  const { t } = useI18n(ctx)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const failNotice = (err: unknown) =>
    t('settings:network.tokenSaveFailed', {
      error: err instanceof Error ? err.message : String(err),
    })

  const handleSave = () => {
    const token = draft.trim()
    if (!token || busy) return
    setBusy(true)
    setNotice(null)
    void onSave(token)
      .then(() => {
        setDraft('')
        setNotice(t('settings:network.tokenSaved'))
      })
      .catch((err: unknown) => setNotice(failNotice(err)))
      .finally(() => setBusy(false))
  }

  const handleClear = () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    void onClear()
      .then(() => setNotice(t('settings:network.tokenCleared')))
      .catch((err: unknown) => setNotice(failNotice(err)))
      .finally(() => setBusy(false))
  }

  return h(
    'div',
    null,
    h(SettingsRow, {
      ctx,
      title: t('settings:network.npmAuthToken'),
      description: t('settings:network.npmAuthTokenDesc'),
      action: h(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h('input', {
          type: 'password',
          value: draft,
          placeholder: t('settings:network.npmAuthTokenPlaceholder'),
          'aria-label': t('settings:network.npmAuthToken'),
          autoComplete: 'off',
          onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
          onKeyDown: (e: { key: string }) => {
            if (e.key === 'Enter') handleSave()
          },
          style: {
            width: 220,
            maxWidth: '100%',
            height: 32,
            borderRadius: 6,
            background: 'var(--bb-bg-overlay, rgba(255, 255, 255, 0.08))',
            border: '1px solid var(--bb-border-subtle, rgba(255, 255, 255, 0.15))',
            color: 'var(--bb-text-primary, #FFFFFF)',
            fontSize: 13,
            padding: '0 10px',
            outline: 'none',
          },
        }),
        h(Button, {
          variant: 'secondary',
          disabled: busy || !draft.trim(),
          loading: busy,
          children: t('settings:network.saveToken'),
          onPress: handleSave,
        }),
        tokenSet
          ? h(Button, {
              variant: 'secondary',
              disabled: busy,
              children: t('settings:network.clearToken'),
              onPress: handleClear,
            })
          : null,
      ),
    }),
    h(
      'div',
      {
        style: {
          fontSize: 12,
          padding: '2px 0 10px',
          color: notice
            ? 'var(--bb-text-secondary, #8E8E93)'
            : 'var(--bb-text-tertiary, #6B7280)',
        },
      },
      notice ??
        (tokenSet ? t('settings:network.npmAuthTokenSet') : t('settings:network.npmAuthTokenNotSet')),
    ),
  )
}
