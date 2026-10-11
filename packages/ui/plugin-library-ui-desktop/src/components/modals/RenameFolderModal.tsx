import { createElement as h, useEffect, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Collection } from '@BBeBee/protocol'
import { Button, TextField } from '@BBeBee/ui-kit-desktop'

export function RenameFolderModal({
  collection,
  onClose,
  onRename,
}: {
  collection: Collection | null
  onClose: () => void
  onRename: (id: string, newName: string) => Promise<void>
}): ReactElement | null {
  const [name, setName] = useState(collection?.name ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (collection) setName(collection.name)
  }, [collection])

  if (!collection) return null

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onRename(collection.id, name.trim())
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return h(
    'div',
    {
      'aria-label': 'Rename folder',
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
      h('h3', { style: { margin: 0, fontSize: 16, color: 'var(--bb-text-primary, #FFFFFF)', fontWeight: 600 } }, 'Rename folder'),
      h(TextField, {
        value: name,
        onChange: setName,
        placeholder: 'Folder name',
        testID: 'rename-collection-name',
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
          onPress: handleSave,
          testID: 'rename-collection-save',
          children: saving ? 'Saving…' : 'Save',
        }),
      ),
    ),
  )
}
