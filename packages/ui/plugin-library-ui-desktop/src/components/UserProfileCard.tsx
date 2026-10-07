import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { TextField } from '@BBeBee/ui-kit-desktop'

interface LibraryProfileApi {
  getProfile(): Promise<{ id: string; name: string }>
  updateProfile(patch: { name?: string }): Promise<{ id: string; name: string }>
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
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
  const library = serviceOf<LibraryProfileApi>(ctx, 'library')

  const [name, setName] = useState('')
  const [userId, setUserId] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!library?.getProfile) return
    let cancelled = false
    void library
      .getProfile()
      .then((p) => {
        if (cancelled) return
        setUserId(p.id)
        setName(p.name)
      })
      .catch(() => undefined)
    const off = ctx.on('library/profile-changed', () => {
      void library
        .getProfile()
        .then((p) => {
          if (cancelled) return
          setUserId(p.id)
          setName(p.name)
        })
        .catch(() => undefined)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [ctx, library])

  const handleSave = () => {
    if (!library?.updateProfile) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('用户名不能为空')
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
    'div',
    { 'data-testid': 'user-profile-card' },
    h(
      'div',
      { style: { padding: '4px 4px 8px' } },
      h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary, #F5F5F7)' } }, '用户'),
      h(
        'div',
        { style: { fontSize: 12, color: 'var(--color-text-secondary, #8E8E93)', marginTop: 2 } },
        '本地用户资料，歌单等内容的创建者将显示此名称',
      ),
    ),
    h(
      'div',
      { style: rowStyle },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary, #F5F5F7)' } }, '用户名'),
        h(
          'div',
          { style: { fontSize: 12, color: 'var(--color-text-secondary, #8E8E93)', marginTop: 3 } },
          error ?? (justSaved ? '已保存' : '创建歌单时作为创建者显示'),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h(TextField, {
          value: name,
          onChange: setName,
          placeholder: 'Mine',
          testID: 'profile-name-input',
        }),
        h(
          'button',
          {
            type: 'button',
            'data-testid': 'profile-name-save',
            onClick: handleSave,
            disabled: !library?.updateProfile,
            style: {
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--button-primary-bg, var(--color-primary, #5F87FF))',
              color: '#FFFFFF',
              fontSize: 12,
              fontWeight: 600,
              cursor: library?.updateProfile ? 'pointer' : 'not-allowed',
              flexShrink: 0,
            },
          },
          justSaved ? '已保存' : '保存',
        ),
      ),
    ),
    h(
      'div',
      { style: { ...rowStyle, borderBottom: 'none' } },
      h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary, #F5F5F7)' } }, '用户 ID'),
      h('div', { style: { fontSize: 12, color: 'var(--color-text-secondary, #8E8E93)' } }, userId || '—'),
    ),
  )
}
