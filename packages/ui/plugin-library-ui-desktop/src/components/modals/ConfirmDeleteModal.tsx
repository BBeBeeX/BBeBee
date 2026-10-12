import { createElement as h, useEffect } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import { Button, Text, useI18n } from '@BBeBee/ui-kit-desktop'

export interface DeleteConfirmTarget {
  type: 'playlist' | 'album'
  urn: string
  name: string
  folderId?: string
}

export function ConfirmDeleteModal({
  ctx,
  target,
  onClose,
  onConfirm,
}: {
  ctx: Context
  target: DeleteConfirmTarget | null
  onClose: () => void
  onConfirm: () => Promise<void> | void
}): ReactElement | null {
  const { t } = useI18n(ctx)
  useEffect(() => {
    if (!target) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [target, onClose])

  if (!target) return null

  const isPlaylist = target.type === 'playlist'
  const title = isPlaylist ? t('library:confirmDelete.deletePlaylist') : t('library:confirmDelete.deleteAlbum')
  const message = isPlaylist
    ? t('library:confirmDelete.deletePlaylistThisCannotBe', { name: target.name })
    : t('library:confirmDelete.removeTheAlbumFromThe', { name: target.name })

  return h(
    'div',
    {
      'aria-label': title,
      style: {
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      onClick: (e: ReactMouseEvent) => {
        if (e.target === e.currentTarget) onClose()
      },
    },
    h(
      'div',
      {
        style: {
          width: 360,
          backgroundColor: 'var(--bb-bg-overlay, #282828)',
          borderRadius: 8,
          padding: 20,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        },
      },
      h('h3', { style: { margin: 0, fontSize: 16, color: 'var(--bb-text-primary, #FFFFFF)', fontWeight: 600 } }, title),
      h(Text, { variant: 'sm', tone: 'muted' }, message),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
        h(Button, {
          variant: 'ghost',
          onPress: onClose,
          testID: 'confirm-delete-cancel',
          children: t('app:common.cancel'),
        }),
        h(Button, {
          variant: 'danger',
          onPress: () => {
            void onConfirm()
          },
          testID: 'confirm-delete-button',
          children: t('library:localMusic.delete'),
        }),
      ),
    ),
  )
}
