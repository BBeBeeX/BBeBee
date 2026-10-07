import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Collection, Playlist } from '@BBeBee/protocol'
import { Button, TextField } from '@BBeBee/ui-kit-desktop'
import { EditPlaylistModal } from './modals/EditPlaylistModal.js'
import { RenameFolderModal } from './modals/RenameFolderModal.js'
import { CreateInFolderModal } from './modals/CreateInFolderModal.js'
import { ConfirmDeleteModal, type DeleteConfirmTarget } from './modals/ConfirmDeleteModal.js'

export interface LibraryModalsProps {
  ctx: Context
  showCreatePlaylistModal: boolean
  setShowCreatePlaylistModal: (show: boolean) => void
  draft: string
  setDraft: (val: string) => void
  onCreatePlaylist: () => void

  showCreateCollectionModal: boolean
  setShowCreateCollectionModal: (show: boolean) => void
  collectionDraft: string
  setCollectionDraft: (val: string) => void
  onCreateCollection: () => void

  editingPlaylist: (Playlist & { description?: string }) | null
  setEditingPlaylist: (playlist: (Playlist & { description?: string }) | null) => void
  onUpdatePlaylist: (patch: { name?: string; description?: string }) => Promise<void>

  renamingCollection: Collection | null
  setRenamingCollection: (collection: Collection | null) => void
  onRenameCollection: (id: string, newName: string) => Promise<void>

  createInFolderModal: { type: 'playlist' | 'folder'; folderId: string } | null
  setCreateInFolderModal: (target: { type: 'playlist' | 'folder'; folderId: string } | null) => void
  onCreateInFolder: (name: string) => Promise<void>

  confirmDeleteTarget: DeleteConfirmTarget | null
  setConfirmDeleteTarget: (target: DeleteConfirmTarget | null) => void
  onConfirmDelete: () => Promise<void>
}

export function LibraryModals({
  showCreatePlaylistModal,
  setShowCreatePlaylistModal,
  draft,
  setDraft,
  onCreatePlaylist,

  showCreateCollectionModal,
  setShowCreateCollectionModal,
  collectionDraft,
  setCollectionDraft,
  onCreateCollection,

  editingPlaylist,
  setEditingPlaylist,
  onUpdatePlaylist,

  renamingCollection,
  setRenamingCollection,
  onRenameCollection,

  createInFolderModal,
  setCreateInFolderModal,
  onCreateInFolder,

  confirmDeleteTarget,
  setConfirmDeleteTarget,
  onConfirmDelete,
}: LibraryModalsProps): ReactElement {
  return h(
    'div',
    null,
    // Create Playlist Modal
    h(
      'div',
      {
        style: {
          display: showCreatePlaylistModal ? 'flex' : 'none',
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          zIndex: 2000,
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      h(
        'div',
        {
          style: {
            width: 340,
            backgroundColor: 'var(--surface-overlay, var(--bb-bg-overlay, #282828))',
            borderRadius: 8,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
            boxShadow: 'var(--shadow-modal, 0 8px 32px rgba(0, 0, 0, 0.8))',
          },
        },
        h('h3', { style: { margin: 0, fontSize: 16, color: 'var(--bb-text-primary, #FFFFFF)', fontWeight: 600 } }, '创建歌单'),
        h(TextField, {
          value: draft,
          onChange: setDraft,
          placeholder: '新歌单名称',
          testID: 'playlists-new-name',
        }),
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
          h(Button, {
            variant: 'ghost',
            onPress: () => {
              setShowCreatePlaylistModal(false)
              setDraft('')
            },
            children: '取消',
          }),
          h(Button, {
            variant: 'primary',
            onPress: () => {
              onCreatePlaylist()
              setShowCreatePlaylistModal(false)
            },
            disabled: draft.trim().length === 0,
            testID: 'playlists-create',
            children: '创建',
          }),
        ),
      ),
    ),
    // Create Collection Modal
    h(
      'div',
      {
        style: {
          display: showCreateCollectionModal ? 'flex' : 'none',
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          zIndex: 2000,
          alignItems: 'center',
          justifyContent: 'center',
        },
      },
      h(
        'div',
        {
          style: {
            width: 340,
            backgroundColor: 'var(--surface-overlay, var(--bb-bg-overlay, #282828))',
            borderRadius: 8,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
            boxShadow: 'var(--shadow-modal, 0 8px 32px rgba(0, 0, 0, 0.8))',
          },
        },
        h('h3', { style: { margin: 0, fontSize: 16, color: 'var(--bb-text-primary, #FFFFFF)', fontWeight: 600 } }, '创建文件夹'),
        h(TextField, {
          value: collectionDraft,
          onChange: setCollectionDraft,
          placeholder: '新文件夹名称',
          testID: 'collections-new-name',
        }),
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', gap: 10 } },
          h(Button, {
            variant: 'ghost',
            onPress: () => {
              setShowCreateCollectionModal(false)
              setCollectionDraft('')
            },
            children: '取消',
          }),
          h(Button, {
            variant: 'primary',
            onPress: () => {
              onCreateCollection()
              setShowCreateCollectionModal(false)
            },
            disabled: collectionDraft.trim().length === 0,
            testID: 'collections-create',
            children: '创建',
          }),
        ),
      ),
    ),
    // Edit Playlist Modal
    h(EditPlaylistModal, {
      playlist: editingPlaylist,
      onClose: () => setEditingPlaylist(null),
      onSave: onUpdatePlaylist,
    }),
    // Rename Folder Modal
    h(RenameFolderModal, {
      collection: renamingCollection,
      onClose: () => setRenamingCollection(null),
      onRename: onRenameCollection,
    }),
    // Create in Folder Modal
    h(CreateInFolderModal, {
      target: createInFolderModal,
      onClose: () => setCreateInFolderModal(null),
      onCreate: onCreateInFolder,
    }),
    // Confirm Delete Modal
    h(ConfirmDeleteModal, {
      target: confirmDeleteTarget,
      onClose: () => setConfirmDeleteTarget(null),
      onConfirm: onConfirmDelete,
    }),
  )
}
