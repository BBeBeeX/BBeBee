/**
 * The local user profile — the mobile transcription of the desktop twin's
 * `UserProfileCard`. Same data and flow: the library service's profile (UUID
 * id, name defaulting to "Mine"), the name editable with save feedback, and
 * live refresh on `library/profile-changed` — what created playlists show as
 * their creator.
 */

import { createElement as h, useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { serviceOf } from '@BBeBee/ui-core'
import { Button, Text, TextField, c, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

interface LibraryProfileApi {
  getProfile(): Promise<{ id: string; name: string }>
  updateProfile(patch: { name?: string }): Promise<{ id: string; name: string }>
}

export function UserProfileCard({ ctx }: { ctx: Context }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()

  // ⚠️ `serviceOf` returns a fresh proxy per call, so it must never sit in a
  // hook dependency array — the same discipline the desktop card documents:
  // an unstable identity there re-runs the read effect every render and
  // overwrites whatever the user just typed. Read the service inside effects
  // and handlers, keyed on `ctx` only.
  const getLibrary = useCallback(() => serviceOf<LibraryProfileApi>(ctx, 'library'), [ctx])
  const canSave = Boolean(getLibrary()?.updateProfile)

  const [name, setName] = useState('Mine')
  const [userId, setUserId] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const read = () => {
      const library = serviceOf<LibraryProfileApi>(ctx, 'library')
      if (!library?.getProfile) return
      void library
        .getProfile()
        .then((profile) => {
          if (cancelled) return
          setUserId(profile.id)
          setName(profile.name || 'Mine')
        })
        .catch(() => undefined)
    }
    read()
    const off = ctx.on('library/profile-changed', read)
    return () => {
      cancelled = true
      off()
    }
  }, [ctx])

  const handleSave = () => {
    const library = serviceOf<LibraryProfileApi>(ctx, 'library')
    if (!library?.updateProfile) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('library:userProfile.usernameCannotBeEmpty'))
      return
    }
    void library
      .updateProfile({ name: trimmed })
      .then((profile) => {
        setName(profile.name)
        setError(undefined)
        setJustSaved(true)
        setTimeout(() => setJustSaved(false), 1500)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }

  return h(
    native.View as never,
    {
      testID: 'user-profile-card',
      style: {
        backgroundColor: c().bg.raised,
        borderRadius: tokens.radius.md,
        padding: tokens.space[3],
        gap: tokens.space[3],
      },
    },
    h(
      native.View as never,
      { style: { gap: 2 } },
      h(Text, { variant: 'md', style: { fontWeight: '600' }, children: t('library:userProfile.title') }),
      h(Text, { variant: 'xs', tone: 'muted', children: t('library:userProfile.shownAsTheCreatorWhen') }),
    ),
    h(TextField, {
      value: name,
      onChange: setName,
      placeholder: t('library:userProfile.username'),
      accessibilityLabel: t('library:userProfile.username'),
      testID: 'user-profile-name',
    }),
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space[3] } },
      h(
        native.View as never,
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 1 }, `${t('library:userProfile.userID')}: ${userId}`),
        error
          ? h(Text, { variant: 'xs', style: { color: c().state.error } }, error)
          : justSaved
            ? h(Text, { variant: 'xs', style: { color: c().state.ok } }, t('library:userProfile.saved'))
            : null,
      ),
      canSave
        ? h(Button, {
            variant: 'secondary',
            onPress: handleSave,
            testID: 'user-profile-save',
            children: t('library:userProfile.save'),
          })
        : null,
    ),
  )
}
