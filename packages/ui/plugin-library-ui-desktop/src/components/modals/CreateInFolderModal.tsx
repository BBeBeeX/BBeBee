import { createElement as h, useEffect, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { Button, TextField } from '@BBeBee/ui-kit-desktop'

export function CreateInFolderModal({
  target,
  onClose,
  onCreate,
}: {
  target: { type: 'playlist' | 'folder'; folderId: string } | null
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}): ReactElement | null {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName('')
  }, [target])

  if (!target) return null

  const isPlaylist = target.type === 'playlist'

  const handleCreate = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onCreate(name.trim())
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return h(
    'div',
    {
      'aria-label': isPlaylist ? 'Create playlist in folder' : 'Create folder',
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
      h('h3', { style: { margin: 0, fontSize: 16, color: 'var(--bb-text-primary, #FFFFFF)', fontWeight: 600 } }, isPlaylist ? 'Create playlist in folder' : 'Create folder'),
      h(TextField, {
        value: name,
        onChange: setName,
        placeholder: isPlaylist ? 'New playlist name' : 'New folder name',
        testID: isPlaylist ? 'folder-create-playlist-name' : 'folder-create-subfolder-name',
      }),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
        h(Button, {
          variant: 'ghost',
          onPress: onClose,
          children: 'Cancel',
        }),
        h(Button, {
          variant: 'primary',
          disabled: !name.trim() || saving,
          onPress: handleCreate,
          testID: 'folder-create-submit',
          children: saving ? 'Creating…' : 'Create',
        }),
      ),
    ),
  )
}
