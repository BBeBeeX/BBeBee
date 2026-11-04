import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SaveToPlaylistMenuController, SaveToPlaylistOption } from '@BBeBee/ui-menus'
import { Button, Sheet, Text, TextField, c, nativePrimitives, tablerIcon, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

export interface SaveToPlaylistSheetProps {
  ctx: Context
  menuProps: SaveToPlaylistMenuController['menuProps']
}

export function SaveToPlaylistSheet({ ctx, menuProps }: SaveToPlaylistSheetProps): ReactElement | null {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const [filter, setFilter] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')

  if (!menuProps.open) return null

  const handleCreate = async () => {
    const name = newPlaylistName.trim()
    if (!name) return
    await menuProps.onCreatePlaylist(name)
    setNewPlaylistName('')
    setIsCreating(false)
  }

  const q = filter.trim().toLowerCase()
  const matches = (name: string) => !q || name.toLowerCase().includes(q)

  const directSavedPlaylists = menuProps.playlists.filter((p) => p.containsTrack === true && matches(p.name))
  const directUnsavedPlaylists = menuProps.playlists.filter((p) => !p.containsTrack && matches(p.name))

  const colSavedPlaylists = (menuProps.collections ?? []).flatMap((col) =>
    col.playlists
      .filter((p) => p.containsTrack === true && matches(p.name))
      .map((p) => ({ ...p, folderName: col.name })),
  )
  const colUnsavedPlaylists = (menuProps.collections ?? []).flatMap((col) =>
    col.playlists
      .filter((p) => !p.containsTrack && matches(p.name))
      .map((p) => ({ ...p, folderName: col.name })),
  )

  const allSaved = [...directSavedPlaylists, ...colSavedPlaylists]
  const allUnsaved = [...directUnsavedPlaylists, ...colUnsavedPlaylists]

  const renderPlaylistRow = (pl: SaveToPlaylistOption & { folderName?: string }, isSaved: boolean) =>
    h(
      native.Pressable as never,
      {
        key: pl.urn,
        accessibilityRole: 'checkbox',
        accessibilityLabel: pl.name,
        disabled: pl.isSmart,
        onPress: () => {
          void menuProps.onTogglePlaylist(pl.urn, isSaved)
        },
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: tokens.space[2],
          paddingHorizontal: tokens.space[3],
          borderRadius: tokens.radius.sm,
          opacity: pl.isSmart ? 0.5 : 1,
        },
      },
      h(
        native.View as never,
        { style: { flex: 1, minWidth: 0 } },
        h(Text, { numberOfLines: 1 }, pl.name),
        h(
          Text,
          { variant: 'sm', tone: 'muted' },
          pl.folderName
            ? `${pl.folderName} • ${t('library:playlistDetail.tracksOther', { count: pl.trackCount ?? 0 })}`
            : t('library:playlistDetail.tracksOther', { count: pl.trackCount ?? 0 }),
        ),
      ),
      isSaved
        ? (tablerIcon('check', { size: 18, color: c().accent.base }) ??
          h(Text, { variant: 'md', tone: 'accent' }, '✓'))
        : (tablerIcon('plus', { size: 18, color: c().text.muted }) ??
          h(Text, { variant: 'md', tone: 'muted' }, '＋')),
    )

  const renderLikedRow = (isSaved: boolean) =>
    h(
      native.Pressable as never,
      {
        accessibilityRole: 'button',
        accessibilityLabel: t('library:favorites.likedSongs'),
        onPress: () => {
          void menuProps.onToggleLiked()
        },
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: tokens.space[2],
          paddingHorizontal: tokens.space[3],
          backgroundColor: isSaved ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
          borderRadius: tokens.radius.sm,
        },
      },
      h(
        native.View as never,
        { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] } },
        tablerIcon(isSaved ? 'heart-filled' : 'heart', {
          size: 20,
          color: isSaved ? c().accent.base : c().text.muted,
        }),
        h(
          native.View as never,
          null,
          h(Text, { variant: 'md' }, t('library:favorites.likedSongs')),
          h(
            Text,
            { variant: 'sm', tone: 'muted' },
            t('library:favorites.savedOther', { count: menuProps.likedCount }),
          ),
        ),
      ),
      isSaved
        ? (tablerIcon('check', { size: 18, color: c().accent.base }) ??
          h(Text, { variant: 'md', tone: 'accent' }, '✓'))
        : (tablerIcon('plus', { size: 18, color: c().text.muted }) ??
          h(Text, { variant: 'md', tone: 'muted' }, '＋')),
    )

  return h(
    Sheet,
    {
      open: menuProps.open,
      onClose: () => {
        setIsCreating(false)
        setFilter('')
        setNewPlaylistName('')
        menuProps.onClose()
      },
      title: menuProps.title || t('library:trackLibraryActionButton.addToPlaylist2'),
    },
    h(
      native.View as never,
      { style: { gap: tokens.space[3], maxHeight: 460 } },
      // Search / Filter or New Playlist input
      isCreating
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
            h(
              native.View as never,
              { style: { flex: 1 } },
              h(TextField, {
                value: newPlaylistName,
                onChange: setNewPlaylistName,
                placeholder: t('library:trackLibraryActionButton.playlistNamePrompt'),
              }),
            ),
            h(Button, {
              variant: 'primary',
              disabled: newPlaylistName.trim().length === 0,
              onPress: handleCreate,
              children: t('app:common.confirm'),
            }),
            h(Button, {
              variant: 'ghost',
              onPress: () => {
                setIsCreating(false)
                setNewPlaylistName('')
              },
              children: t('app:common.cancel'),
            }),
          )
        : h(
            native.View as never,
            { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
            h(
              native.View as never,
              { style: { flex: 1 } },
              h(TextField, {
                value: filter,
                onChange: setFilter,
                placeholder: t('app:common.saveToPlaylist.findPlaylist'),
              }),
            ),
            h(Button, {
              variant: 'secondary',
              onPress: () => setIsCreating(true),
              children: t('library:trackLibraryActionButton.newPlaylist'),
            }),
          ),
      // Scrollable list with Upper saved section + Divider + Lower other section
      h(
        native.ScrollView as never,
        { style: { maxHeight: 340 } },
        // Upper section: Current saved locations
        menuProps.liked ? renderLikedRow(true) : null,
        allSaved.map((pl) => renderPlaylistRow(pl, true)),
        // Divider line (中间有分隔行)
        h(native.View as never, {
          style: {
            height: 1,
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            marginVertical: tokens.space[2],
          },
        }),
        // Lower section: Other locations (not containing this track)
        !menuProps.liked ? renderLikedRow(false) : null,
        allUnsaved.map((pl) => renderPlaylistRow(pl, false)),
      ),
    ),
  )
}
