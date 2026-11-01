/**
 * The library's bottom-sheet modals — the mobile transcription of the desktop
 * twin's `LibraryModals` (plus its ConfirmDeleteModal, EditPlaylistModal and
 * RenameFolderModal). Same five surfaces, same copy, same flows; the centered
 * dialog becomes the platform's bottom sheet.
 */

import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Collection, Playlist } from '@BBeBee/protocol'
import { Button, Sheet, Text, TextField, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import type { DeleteConfirmTarget } from '../hooks/useLibraryActions.js'

export interface LibraryModalsProps {
  ctx: Context
  showCreatePlaylistModal: boolean
  setShowCreatePlaylistModal: (open: boolean) => void
  onCreatePlaylist: (name: string) => void
  showCreateCollectionModal: boolean
  setShowCreateCollectionModal: (open: boolean) => void
  onCreateCollection: (name: string) => void
  editingPlaylist: (Playlist & { description?: string }) | null
  setEditingPlaylist: (playlist: (Playlist & { description?: string }) | null) => void
  onUpdatePlaylist: (patch: { name: string; description?: string; artworkUrl?: string }) => Promise<void>
  renamingCollection: Collection | null
  setRenamingCollection: (collection: Collection | null) => void
  onRenameCollection: (id: string, newName: string) => Promise<void>
  createInFolderModal: { type: 'playlist' | 'folder'; folderId: string } | null
  setCreateInFolderModal: (modal: { type: 'playlist' | 'folder'; folderId: string } | null) => void
  onCreateInFolder: (name: string) => Promise<void>
  confirmDeleteTarget: DeleteConfirmTarget | null
  setConfirmDeleteTarget: (target: DeleteConfirmTarget | null) => void
  onConfirmDelete: () => Promise<void> | void
}

/** One text field plus a confirm button — the shape every create sheet shares. */
function NameForm({
  placeholder,
  submitLabel,
  onSubmit,
  testID,
}: {
  placeholder: string
  submitLabel: string
  onSubmit: (name: string) => void
  testID: string
}): ReactElement {
  const native = nativePrimitives()
  const [draft, setDraft] = useState('')
  return h(
    native.View as never,
    { style: { gap: tokens.space[3] } },
    h(TextField, {
      value: draft,
      onChange: setDraft,
      placeholder,
      testID: `${testID}-name`,
    }),
    h(Button, {
      onPress: () => {
        const name = draft.trim()
        if (!name) return
        onSubmit(name)
        setDraft('')
      },
      disabled: draft.trim().length === 0,
      testID: `${testID}-confirm`,
      children: submitLabel,
    }),
  )
}

export function LibraryModals(props: LibraryModalsProps): ReactElement {
  const { ctx } = props
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  return h(
    native.View as never,
    null,
    // Create playlist
    h(
      Sheet,
      {
        open: props.showCreatePlaylistModal,
        onClose: () => props.setShowCreatePlaylistModal(false),
        title: t('library:libraryModals.createPlaylist'),
      },
      h(NameForm, {
        placeholder: t('library:libraryModals.newPlaylistName'),
        submitLabel: t('app:common.create'),
        onSubmit: (name) => {
          props.setShowCreatePlaylistModal(false)
          props.onCreatePlaylist(name)
        },
        testID: 'create-playlist',
      }),
    ),
    // Create folder (collection)
    h(
      Sheet,
      {
        open: props.showCreateCollectionModal,
        onClose: () => props.setShowCreateCollectionModal(false),
        title: t('library:libraryModals.createFolder'),
      },
      h(NameForm, {
        placeholder: t('library:libraryModals.newFolderName'),
        submitLabel: t('app:common.create'),
        onSubmit: (name) => {
          props.setShowCreateCollectionModal(false)
          props.onCreateCollection(name)
        },
        testID: 'create-collection',
      }),
    ),
    // Create inside a folder (from a folder row's menu)
    h(
      Sheet,
      {
        open: props.createInFolderModal !== null,
        onClose: () => props.setCreateInFolderModal(null),
        title:
          props.createInFolderModal?.type === 'playlist'
            ? t('library:createInFolder.createPlaylistInFolder')
            : t('library:createInFolder.createFolder'),
      },
      props.createInFolderModal
        ? h(NameForm, {
            placeholder:
              props.createInFolderModal.type === 'playlist'
                ? t('library:libraryModals.newPlaylistName')
                : t('library:libraryModals.newFolderName'),
            submitLabel: t('app:common.create'),
            onSubmit: (name) => {
              props.setCreateInFolderModal(null)
              void props.onCreateInFolder(name)
            },
            testID: 'create-in-folder',
          })
        : null,
    ),
    h(EditPlaylistSheet, {
      ctx,
      playlist: props.editingPlaylist,
      onClose: () => props.setEditingPlaylist(null),
      onSave: async (patch) => {
        await props.onUpdatePlaylist(patch)
        props.setEditingPlaylist(null)
      },
    }),
    h(RenameFolderSheet, {
      ctx,
      collection: props.renamingCollection,
      onClose: () => props.setRenamingCollection(null),
      onRename: async (id, newName) => {
        await props.onRenameCollection(id, newName)
        props.setRenamingCollection(null)
      },
    }),
    h(ConfirmDeleteSheet, {
      ctx,
      target: props.confirmDeleteTarget,
      onClose: () => props.setConfirmDeleteTarget(null),
      onConfirm: async () => {
        await props.onConfirmDelete()
        props.setConfirmDeleteTarget(null)
      },
    }),
  )
}

/** Edit a playlist's name, description and cover URL. */
function EditPlaylistSheet({
  ctx,
  playlist,
  onClose,
  onSave,
}: {
  ctx: Context
  playlist: (Playlist & { description?: string }) | null
  onClose: () => void
  onSave: (patch: { name: string; description?: string; artworkUrl?: string }) => Promise<void>
}): ReactElement | null {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [artworkUrl, setArtworkUrl] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (playlist) {
      setName(playlist.name ?? '')
      setDescription(playlist.description ?? '')
      setArtworkUrl(playlist.artwork?.sourceUrl ?? '')
    }
  }, [playlist])

  if (!playlist) return null

  return h(
    Sheet,
    { open: true, onClose, title: t('library:editPlaylist.editDetails') },
    h(
      native.View as never,
      { style: { gap: tokens.space[3] } },
      h(TextField, { value: name, onChange: setName, placeholder: t('library:editPlaylist.name'), testID: 'edit-playlist-name' }),
      h(TextField, {
        value: description,
        onChange: setDescription,
        placeholder: t('library:editPlaylist.addAnOptionalDescription'),
        multiline: true,
        rows: 3,
        testID: 'edit-playlist-description',
      }),
      h(TextField, {
        value: artworkUrl,
        onChange: setArtworkUrl,
        placeholder: t('library:editPlaylist.coverImageURLOptional'),
        testID: 'edit-playlist-artwork',
      }),
      h(Button, {
        onPress: () => {
          if (!name.trim()) return
          setSaving(true)
          void onSave({
            name: name.trim(),
            description: description.trim() || undefined,
            artworkUrl: artworkUrl.trim() || undefined,
          }).finally(() => setSaving(false))
        },
        disabled: name.trim().length === 0 || saving,
        loading: saving,
        testID: 'edit-playlist-save',
        children: t('userProfile.save'),
      }),
    ),
  )
}

/** Rename a folder. */
function RenameFolderSheet({
  ctx,
  collection,
  onClose,
  onRename,
}: {
  ctx: Context
  collection: Collection | null
  onClose: () => void
  onRename: (id: string, newName: string) => Promise<void>
}): ReactElement | null {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (collection) setName(collection.name)
  }, [collection])

  if (!collection) return null

  return h(
    Sheet,
    { open: true, onClose, title: t('library:renameFolder.renameFolder') },
    h(
      native.View as never,
      { style: { gap: tokens.space[3] } },
      h(TextField, { value: name, onChange: setName, placeholder: t('library:renameFolder.folderName'), testID: 'rename-folder-name' }),
      h(Button, {
        onPress: () => {
          if (!name.trim()) return
          setSaving(true)
          void onRename(collection.id, name.trim()).finally(() => setSaving(false))
        },
        disabled: name.trim().length === 0 || saving,
        loading: saving,
        testID: 'rename-folder-save',
        children: t('userProfile.save'),
      }),
    ),
  )
}

/** Deleting a playlist or unsaving an album — named, and confirmed. */
function ConfirmDeleteSheet({
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
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  if (!target) return null

  const isPlaylist = target.type === 'playlist'
  const title = isPlaylist ? t('library:confirmDelete.deletePlaylist') : t('library:confirmDelete.deleteAlbum')
  const message = isPlaylist
    ? t('library:confirmDelete.deletePlaylistThisCannotBe', { name: target.name })
    : t('library:confirmDelete.removeTheAlbumFromThe', { name: target.name })

  return h(
    Sheet,
    { open: true, onClose, title },
    h(
      native.View as never,
      { style: { gap: tokens.space[3] } },
      h(Text, { variant: 'sm', tone: 'muted', children: message }),
      h(
        native.View as never,
        { style: { flexDirection: 'row', justifyContent: 'flex-end', gap: tokens.space[2] } },
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
