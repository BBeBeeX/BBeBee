import { createElement as h, useCallback, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { TextField, useI18n } from '@BBeBee/ui-kit-desktop'

interface LibraryProfileApi {
  getProfile(): Promise<{ id: string; name: string }>
  updateProfile(patch: { name?: string }): Promise<{ id: string; name: string }>
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  rowGap: 10,
  gap: 16,
  padding: '14px 4px',
  borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
}

/**
 * The local user (UUID id, name defaulting to "Mine") — what created
 * playlists show as their creator. Owned by `plugin-library`; the settings
 * screen embeds this card wherever the profile contribution lands.
 */
export function UserProfileCard({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  // ⚠️ `serviceOf` returns a fresh proxy per call, so it must never sit in a
  // hook dependency array: an unstable identity there re-runs the effect on
  // every render, and this effect's `setName` then overwrites whatever the
  // user just typed — typed characters "immediately disappear / bounce back
  // to the old name". Read the service inside effects and handlers, keyed
  // on `ctx` only (the same discipline RegistryScreen follows).
  const getLibrary = useCallback(
    () => serviceOf<LibraryProfileApi>(ctx, 'library'),
    [ctx],
  )

  // Render-time read only (never a hook dependency): whether saving is possible.
  const canSave = Boolean(getLibrary()?.updateProfile)

  const [name, setName] = useState('Mine')
  const [userId, setUserId] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const library = getLibrary()
    if (!library?.getProfile) return
    let cancelled = false
    const read = () => {
      const svc = getLibrary()
      if (!svc?.getProfile) return
      void svc
        .getProfile()
        .then((p) => {
          if (cancelled) return
          setUserId(p.id)
          setName(p.name || 'Mine')
        })
        .catch(() => undefined)
    }
    read()
    const off = ctx.on('library/profile-changed', read)
    return () => {
      cancelled = true
      off()
    }
  }, [ctx, getLibrary])

  const handleSave = () => {
    const library = getLibrary()
    if (!library?.updateProfile) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('library:userProfile.usernameCannotBeEmpty'))
      return
    }
    void library
      .updateProfile({ name: trimmed })
      .then((p) => {
        setName(p.name)
        setError(null)
        setJustSaved(true)
        setTimeout(() => setJustSaved(false), 1500)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }

  return h(
    'section',
    { 'data-testid': 'user-profile-card', style: { marginBottom: 32 } },
    h(
      'header',
      {
        style: {
          paddingBottom: 4,
          marginBottom: 2,
        },
      },
      h(
        'h3',
        {
          style: {
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--bb-text-primary, #FFFFFF)',
            margin: 0,
            letterSpacing: '-0.01em',
          },
        },
        t('library:userProfile.title'),
      ),
      h(
        'p',
        {
          style: {
            fontSize: 12,
            color: 'var(--text-secondary, #8E8E93)',
            margin: '3px 0 0',
            lineHeight: 1.4,
          },
        },
        t('library:userProfile.description'),
      ),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--settings-card-bg, var(--card-bg, var(--surface-1, rgba(255, 255, 255, 0.03))))',
          border: '1px solid var(--settings-card-border, var(--border-subtle, rgba(255, 255, 255, 0.06)))',
          borderRadius: 10,
          padding: '16px 18px',
          marginTop: 8,
          boxShadow: 'var(--settings-card-shadow, none)',
        },
      },
      h(
        'div',
        { style: { ...rowStyle, paddingTop: 4 } },
        h(
          'div',
          { style: { flex: '1 1 200px', minWidth: 0 } },
          h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary, #F5F5F7)' } }, t('library:userProfile.username')),
          h(
            'div',
            { style: { fontSize: 12, color: 'var(--color-text-secondary, #8E8E93)', marginTop: 3 } },
            error ?? (justSaved ? t('library:userProfile.saved') : t('library:userProfile.shownAsTheCreatorWhen')),
          ),
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flex: '1 1 260px',
              minWidth: 0,
              maxWidth: '100%',
              marginLeft: 'auto',
            },
          },
          h(
            'div',
            { style: { flex: 1, minWidth: 120 } },
            h(TextField, {
              value: name,
              onChange: setName,
              placeholder: t('library:userProfile.mine'),
              testID: 'profile-name-input',
            }),
          ),
          h(
            'button',
            {
              type: 'button',
              'data-testid': 'profile-name-save',
              onClick: handleSave,
              disabled: !canSave,
              style: {
                padding: '6px 14px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
                color: '#FFFFFF',
                fontSize: 12,
                fontWeight: 600,
                cursor: canSave ? 'pointer' : 'not-allowed',
                flexShrink: 0,
              },
            },
            justSaved ? t('library:userProfile.saved') : t('library:userProfile.save'),
          ),
        ),
      ),
      h(
        'div',
        { style: { ...rowStyle, borderBottom: 'none' } },
        h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary, #F5F5F7)' } }, t('library:userProfile.userID')),
        h('div', { style: { fontSize: 12, color: 'var(--color-text-secondary, #8E8E93)' } }, userId || '—'),
      ),
    ),
  )
}
