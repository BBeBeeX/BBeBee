import { createElement as h, useEffect } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { Button, Text } from '@BBeBee/ui-kit-desktop'

export interface DeleteConfirmTarget {
  type: 'playlist' | 'album'
  urn: string
  name: string
  folderId?: string
}

export function ConfirmDeleteModal({
  target,
  onClose,
  onConfirm,
}: {
  target: DeleteConfirmTarget | null
  onClose: () => void
  onConfirm: () => Promise<void> | void
}): ReactElement | null {
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
  const title = isPlaylist ? 'Delete playlist' : 'Delete album'
  const message = isPlaylist
    ? `Delete playlist "${target.name}"? This cannot be undone.`
    : `Remove the album "${target.name}" from the music library?`

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
          children: 'Cancel',
        }),
        h(Button, {
          variant: 'danger',
          onPress: () => {
            void onConfirm()
          },
          testID: 'confirm-delete-button',
          children: 'Delete',
        }),
      ),
    ),
  )
}
