import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SaveToPlaylistMenuController } from '@BBeBee/ui-menus'
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
  const filteredPlaylists = q
    ? menuProps.playlists.filter((p) => p.name.toLowerCase().includes(q))
    : menuProps.playlists

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
      { style: { gap: tokens.space[3], maxHeight: 420 } },
      // Liked songs quick toggle row
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
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            borderRadius: tokens.radius.sm,
          },
        },
        h(
          native.View as never,
          { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] } },
          tablerIcon(menuProps.liked ? 'heart-filled' : 'heart', {
            size: 20,
            color: menuProps.liked ? 'var(--bb-state-loved, #FF4D6D)' : c().text.muted,
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
        h(
          Text,
          { variant: 'md', tone: menuProps.liked ? 'accent' : 'muted' },
          menuProps.liked ? '✓' : '＋',
        ),
      ),
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
                placeholder: t('library:trackLibraryActionButton.findPlaylist'),
              }),
            ),
            h(Button, {
              variant: 'secondary',
              onPress: () => setIsCreating(true),
              children: t('library:trackLibraryActionButton.newPlaylist'),
            }),
          ),
      // Playlists list
      h(
        native.ScrollView as never,
        { style: { maxHeight: 260 } },
        filteredPlaylists.map((pl) => {
          const contains = pl.containsTrack === true
          return h(
            native.Pressable as never,
            {
              key: pl.urn,
              accessibilityRole: 'checkbox',
              accessibilityLabel: pl.name,
              disabled: pl.isSmart,
              onPress: () => {
                void menuProps.onTogglePlaylist(pl.urn, contains)
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
                t('library:playlistDetail.tracksOther', { count: pl.trackCount ?? 0 }),
              ),
            ),
            h(
              Text,
              { variant: 'md', tone: contains ? 'accent' : 'muted' },
              contains ? '✓' : '＋',
            ),
          )
        }),
      ),
    ),
  )
}
