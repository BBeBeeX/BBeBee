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
      title: menuProps.title || t('album:index.addToPlaylist2'),
    },
    h(
      native.View as never,
      { style: { gap: tokens.space[3], maxHeight: 420 } },
      // Liked songs quick toggle row
      h(
        native.Pressable as never,
        {
          accessibilityRole: 'button',
          accessibilityLabel: t('album:index.addToFavorites2'),
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
            h(Text, { variant: 'md' }, t('album:index.addToFavorites2')),
            h(
              Text,
              { variant: 'sm', tone: 'muted' },
              `${menuProps.likedCount} songs`,
            ),
          ),
        ),
        tablerIcon(menuProps.liked ? 'check' : 'plus', {
          size: 18,
          color: menuProps.liked ? c().accent.base : c().text.muted,
        }) ??
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
                placeholder: t('app:common.saveToPlaylist.playlistName'),
              }),
            ),
            h(Button, {
              variant: 'primary',
              disabled: !newPlaylistName.trim(),
              onPress: () => void handleCreate(),
              children: 'Create',
            }),
            h(Button, {
              variant: 'secondary',
              onPress: () => {
                setIsCreating(false)
                setNewPlaylistName('')
              },
              children: 'Cancel',
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
              children: '＋ New',
            }),
          ),
      // Playlists list
      h(
        native.ScrollView as never,
        { style: { maxHeight: 260 } },
        filteredPlaylists.map((playlist) =>
          h(
            native.Pressable as never,
            {
              key: playlist.urn,
              accessibilityRole: 'checkbox',
              accessibilityLabel: playlist.name,
              onPress: () => void menuProps.onTogglePlaylist(playlist.urn, playlist.containsTrack === true),
              style: {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: tokens.space[2],
                paddingHorizontal: tokens.space[2],
                borderRadius: tokens.radius.sm,
              },
            },
            h(
              native.View as never,
              { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[3] } },
              h(
                native.View as never,
                {
                  style: {
                    width: 32,
                    height: 32,
                    borderRadius: tokens.radius.sm,
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                },
                tablerIcon('music', { size: 16 }),
              ),
              h(
                native.View as never,
                null,
                h(Text, { variant: 'md' }, playlist.name),
                h(Text, { variant: 'sm', tone: 'muted' }, `${playlist.trackCount ?? 0} tracks`),
              ),
            ),
            h(
              Text,
              { variant: 'md', tone: playlist.containsTrack ? 'accent' : 'muted' },
              playlist.containsTrack ? '☑' : '☐',
            ),
          ),
        ),
      ),
    ),
  )
}
