import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SettingsService } from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { useCollectionView, type CollectionMember } from '@bbebee/plugin-library/hooks'
import { ALBUM_VIEWS } from '@bbebee/plugin-album/views'
import { LIBRARY_VIEWS } from '@bbebee/plugin-library/views'
import { useTransport } from '@BBeBee/toolkit/hooks'
import { serviceOf, type MenuItemSpec } from '@BBeBee/ui-core'
import { useTrackMenu } from '@BBeBee/ui-menus'
import {
  Button,
  ContextMenu,
  EmptyState,
  List,
  Sheet,
  Text,
  TextField,
  c,
  nativePrimitives,
  tablerIcon,
  useI18n,
} from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { MobileLibraryTrackRow } from '../components/MobileLibraryTrackRow.js'
import { SaveToPlaylistSheet } from '../components/SaveToPlaylistSheet.js'
import { useTrackLibraryInfo } from '../hooks/useTrackLibraryInfo.js'

export function CollectionScreen({ ctx, id }: { ctx: Context; id?: string }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const transport = useTransport(ctx)
  const liquidGlass = resolveMobileLiquidGlassSettings(
    serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
  )
  const {
    detail,
    collectionName,
    sortedMembers,
    trackUrns,
    loading,
    error,
    sortKey,
    setSortKey,
    sortOrder,
    setSortOrder,
    renameCollection,
    deleteCollection,
    playTrack,
    playAll,
  } = useCollectionView(ctx, id)

  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'compact' | 'list'>('list')
  const [renamingOpen, setRenamingOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')

  useEffect(() => {
    const off = ctx.on('library/open-header-menu', (targetId?: string) => {
      if (!targetId || targetId === 'library.collection' || targetId === LIBRARY_VIEWS.collection) {
        setHeaderMenuOpen(true)
      }
    })
    return () => void off()
  }, [ctx])

  const menu = useTrackMenu(ctx)
  const {
    isTrackInLibrary,
    handleToggleFavorite,
    openAddToPlaylistMenu,
    saveToPlaylistMenuProps,
  } = useTrackLibraryInfo(ctx)

  const displayName = collectionName || t('library:collection.collectionFallback')

  const handleStartRename = useCallback(() => {
    setRenameDraft(displayName)
    setRenamingOpen(true)
  }, [displayName])

  const handleConfirmRename = useCallback(async () => {
    if (!id || !renameDraft.trim()) return
    try {
      await renameCollection(renameDraft.trim())
      setRenamingOpen(false)
    } catch {
      // ignore
    }
  }, [id, renameDraft, renameCollection])

  const handleDeleteCollection = useCallback(async () => {
    if (!id) return
    try {
      await deleteCollection()
      ctx.ui.navigate(LIBRARY_VIEWS.home)
    } catch {
      // ignore
    }
  }, [id, deleteCollection, ctx.ui])

  const unifiedMenuItems: MenuItemSpec[] = useMemo(() => {
    return [
      {
        id: 'collection-rename',
        label: t('app:common.menu.rename') || 'Rename',
        icon: 'pencil',
        onSelect: handleStartRename,
      },
      {
        id: 'collection-delete',
        label: t('app:common.menu.deleteFolder') || 'Delete folder',
        icon: 'trash',
        tone: 'danger' as const,
        divider: true,
        onSelect: () => void handleDeleteCollection(),
      },
      {
        id: 'menu-view-mode',
        label: t('app:common.viewMode.viewMode') || 'Display',
        icon: 'list',
        submenu: {
          title: t('app:common.viewMode.viewMode') || 'Display',
          items: [
            {
              id: 'view-compact',
              label: t('app:common.viewMode.compact') || 'Compact',
              icon: viewMode === 'compact' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setViewMode('compact'),
            },
            {
              id: 'view-list',
              label: t('app:common.viewMode.list') || 'List',
              icon: viewMode === 'list' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setViewMode('list'),
            },
          ],
        },
      },
      {
        id: 'menu-sort',
        label: t('library:favorites.sortBy') || 'Sort',
        icon: 'shuffle',
        submenu: {
          title: t('library:favorites.sortBy') || 'Sort',
          items: [
            {
              id: 'sort-default',
              label: t('library:favorites.defaultOrder') || 'Default',
              icon: sortKey === 'default' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setSortKey('default'),
            },
            {
              id: 'sort-title',
              label: t('library:favorites.title') || 'Title',
              icon: sortKey === 'title' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setSortKey('title'),
            },
            {
              id: 'sort-kind',
              label: t('library:collection.type') || 'Type',
              divider: true,
              icon: sortKey === 'kind' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setSortKey('kind'),
            },
            {
              id: 'sort-asc',
              label: t('app:common.menu.ascending') || 'Ascending',
              icon: sortOrder === 'asc' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setSortOrder('asc'),
            },
            {
              id: 'sort-desc',
              label: t('app:common.menu.descending') || 'Descending',
              icon: sortOrder === 'desc' ? (tablerIcon('check', { size: 18 }) ?? '✓') : undefined,
              onSelect: () => setSortOrder('desc'),
            },
          ],
        },
      },
    ]
  }, [t, handleStartRename, handleDeleteCollection, viewMode, sortKey, sortOrder])

  if (!id) return h(EmptyState, { title: t('library:collection.noCollectionChosen') })
  if (error) {
    return h(EmptyState, {
      title: t('library:collection.couldNotOpenTheCollection'),
      description: error,
    })
  }
  if (!detail || loading) return h(EmptyState, { title: t('library:collection.loading') })

  return h(
    native.View as never,
    {
      style: {
        flex: 1,
        backgroundColor: c().bg.base,
        paddingHorizontal: tokens.space[4],
        paddingTop: tokens.space[4],
        gap: tokens.space[3],
      },
      accessibilityLabel: collectionName,
    },
    // Header Hero: Eyebrow + 3-dots liquid glass, Title + Subtitle, Play Button
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space[2],
        },
      },
      h(
        native.View as never,
        { style: { flex: 1, minWidth: 0, gap: tokens.space[1] } },
        h(
          Text,
          { variant: 'xs', style: { letterSpacing: 1, opacity: 0.85, fontWeight: tokens.font.weight.bold } },
          t('library:collection.collectionFallback').toUpperCase(),
        ),
        h(Text, { variant: 'xl', numberOfLines: 1, style: { fontSize: 28, fontWeight: tokens.font.weight.heavy } }, collectionName),
        h(
          Text,
          { variant: 'sm', tone: 'muted' },
          sortedMembers.length === 1
            ? t('library:collection.itemsOne', { count: sortedMembers.length })
            : t('library:collection.itemsOther', { count: sortedMembers.length }),
        ),
      ),
      h(
        native.View as never,
        { style: { flexDirection: 'row', alignItems: 'center', gap: tokens.space[2] } },
        h(Button, {
          onPress: () => void playAll(),
          disabled: trackUrns.length === 0,
          testID: 'collection-play',
          children: t('library:playlistDetail.play'),
        }),
      ),
    ),
    // Members List
    h(
      native.View as never,
      { style: { flex: 1, minHeight: 0 } },
      h(List<CollectionMember>, {
        testID: 'collection-members',
        items: sortedMembers,
        keyExtractor: (member) => member.urn,
        empty: h(EmptyState, {
          icon: 'folder',
          title: t('library:collection.nothingInThisCollectionYet'),
          description: t('library:collection.addAlbumsOrPlaylistsFrom'),
        }),
        renderItem: (member, index) => {
          const track = member.track
          if (member.kind === 'track' && track) {
            return h(MobileLibraryTrackRow, {
              ctx,
              track,
              index,
              active: transport?.trackUrn === track.urn,
              isPlaying: transport?.trackUrn === track.urn && transport?.status === 'playing',
              compact: viewMode === 'compact',
              inLibrary: isTrackInLibrary(track, true),
              onPress: () => void playTrack(track.urn),
              onMore: (anchor) => menu.open({ track }, anchor),
              onAddToFavorites: () => handleToggleFavorite(track),
              onHeartPress: (t) => openAddToPlaylistMenu(t, { x: 0, y: 0 }),
            })
          }
          return h(MemberRow, {
            member,
            compact: viewMode === 'compact',
            onOpen: () => {
              if (member.kind === 'album') {
                ctx.ui.navigate(ALBUM_VIEWS.album, { urn: member.urn })
              } else if (member.kind === 'playlist') {
                ctx.ui.navigate(LIBRARY_VIEWS.playlist, { urn: member.urn })
              }
            },
          })
        },
      }),
    ),
    // Context Menus & Modals
    h(ContextMenu, { ctx, ...menu.menuProps }),
    h(SaveToPlaylistSheet, { ctx, menuProps: saveToPlaylistMenuProps }),
    h(ContextMenu, {
      ctx,
      open: headerMenuOpen,
      onClose: () => setHeaderMenuOpen(false),
      placement: 'top-right',
      liquid: liquidGlass,
      x: 0,
      y: 0,
      items: unifiedMenuItems,
      title: collectionName,
    }),
    // Rename Collection Sheet
    h(
      Sheet,
      {
        open: renamingOpen,
        onClose: () => setRenamingOpen(false),
        title: t('library:collections.rename') || 'Rename',
      },
      h(
        native.View as never,
        { style: { gap: tokens.space[3], padding: tokens.space[4] } },
        h(TextField, {
          value: renameDraft,
          onChange: setRenameDraft,
          placeholder: t('library:collections.rename') || 'Collection Name',
          testID: 'collection-rename-input',
        }),
        h(Button, {
          onPress: () => void handleConfirmRename(),
          disabled: !renameDraft.trim(),
          testID: 'collection-rename-submit',
          children: t('app:common.confirm') || 'Save',
        }),
      ),
    ),
  )
}

/** An album/playlist/collection member row */
function MemberRow({
  member,
  onOpen,
  compact,
}: {
  member: CollectionMember
  onOpen: () => void
  compact?: boolean
}): ReactElement {
  const native = nativePrimitives()
  const openable = member.kind === 'album' || member.kind === 'playlist'
  return h(
    native.Pressable as never,
    {
      accessibilityRole: openable ? 'button' : undefined,
      accessibilityLabel: member.title,
      disabled: !openable,
      onPress: openable ? onOpen : undefined,
      style: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: compact ? 4 : tokens.space[2],
        paddingHorizontal: tokens.space[3],
        gap: tokens.space[3],
        minHeight: compact ? 42 : tokens.size.touchTarget,
        borderRadius: tokens.radius.sm,
      },
    },
    member.kind === 'album'
      ? tablerIcon('disc', { size: compact ? 18 : 22, color: c().text.muted })
      : member.kind === 'playlist'
        ? tablerIcon('playlist-add', { size: compact ? 18 : 22, color: c().text.muted })
        : tablerIcon('folder', { size: compact ? 18 : 22, color: c().text.muted }),
    h(
      native.View as never,
      { style: { flex: 1, minWidth: 0 } },
      h(Text, { variant: compact ? 'sm' : 'md', numberOfLines: 1 }, member.title),
      member.subtitle
        ? h(Text, { variant: 'xs', tone: 'muted', numberOfLines: 1 }, member.subtitle)
        : null,
    ),
    openable ? tablerIcon('chevron-right', { size: 20, color: c().text.muted }) : null,
  )
}
