import { Button, useI18n } from '@BBeBee/ui-kit-desktop'
import { createElement as h, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { SettingsRow } from './SettingsRow.js'

export interface ProxyPasswordRowProps {
  ctx: Context
  /** Whether a password is currently stored in the secrets service. */
  passwordSet: boolean
  onSave: (password: string) => Promise<void>
  onClear: () => Promise<void>
}

/**
 * Proxy authentication password editor.
 *
 * The password value never leaves this row except through `onSave`, which the
 * settings screen routes to `settings.setProxyPassword` (secrets service,
 * never the settings document). The row itself only ever renders the boolean
 * `passwordSet` state — the value is credential material and is not read back.
 */
export function ProxyPasswordRow({ ctx, passwordSet, onSave, onClear }: ProxyPasswordRowProps): ReactElement {
  const { t } = useI18n(ctx)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const failNotice = (err: unknown) =>
    t('settings:network.proxyPasswordSaveFailed', {
      error: err instanceof Error ? err.message : String(err),
    })

  const handleSave = () => {
    const password = draft.trim()
    if (!password || busy) return
    setBusy(true)
    setNotice(null)
    void onSave(password)
      .then(() => {
        setDraft('')
        setNotice(t('settings:network.proxyPasswordSaved'))
      })
      .catch((err: unknown) => setNotice(failNotice(err)))
      .finally(() => setBusy(false))
  }

  const handleClear = () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    void onClear()
      .then(() => setNotice(t('settings:network.proxyPasswordCleared')))
      .catch((err: unknown) => setNotice(failNotice(err)))
      .finally(() => setBusy(false))
  }

  return h(
    'div',
    null,
    h(SettingsRow, {
      ctx,
      title: t('settings:network.proxyPassword'),
      description: t('settings:network.proxyPasswordDesc'),
      action: h(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h('input', {
          type: 'password',
          value: draft,
          placeholder: t('settings:network.proxyPasswordPlaceholder'),
          'aria-label': t('settings:network.proxyPassword'),
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
          children: t('settings:network.saveProxyPassword'),
          onPress: handleSave,
        }),
        passwordSet
          ? h(Button, {
              variant: 'secondary',
              disabled: busy,
              children: t('settings:network.clearProxyPassword'),
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
        (passwordSet
          ? t('settings:network.proxyPasswordSet')
          : t('settings:network.proxyPasswordNotSet')),
    ),
  )
}
