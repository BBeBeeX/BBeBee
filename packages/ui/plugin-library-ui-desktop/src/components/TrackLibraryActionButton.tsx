import { createElement as h, useEffect, useState } from 'react'
import type { MouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import type { MenuAnchor } from '@BBeBee/ui-core'
import { tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'

export function TrackLibraryActionButton({
  ctx,
  track,
  hovered,
  inLibrary: initialInLibrary,
  onAddToFavorites,
  onOpenPlaylistMenu,
}: {
  ctx: Context
  track: Track
  hovered: boolean
  inLibrary: boolean
  onAddToFavorites?: () => void
  onOpenPlaylistMenu: (track: Track, anchor: MenuAnchor) => void
}): ReactElement {
  const { t } = useI18n(ctx)
  const [inLibrary, setInLibrary] = useState(initialInLibrary)
  useEffect(() => {
    setInLibrary(initialInLibrary)
  }, [initialInLibrary])

  return h(
    'button',
    {
      type: 'button',
      'aria-label': inLibrary
        ? t('library:trackLibraryActionButton.addToPlaylist', { title: track.title })
        : t('library:trackLibraryActionButton.addToFavorites', { title: track.title }),
      title: inLibrary ? t('library:trackLibraryActionButton.addToPlaylist2') : t('library:trackLibraryActionButton.addToFavorites2'),
      onClick: (e: MouseEvent) => {
        e.stopPropagation()
        if (inLibrary) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          onOpenPlaylistMenu(track, { x: rect.left, y: rect.bottom + 4 })
        } else {
          setInLibrary(true)
          onAddToFavorites?.()
        }
      },
      style: {
        background: 'none',
        border: 'none',
        color: inLibrary ? 'var(--color-primary, #5F87FF)' : 'var(--text-tertiary, #8B95B0)',
        fontSize: inLibrary ? 16 : 18,
        fontWeight: 700,
        cursor: 'pointer',
        padding: '2px 4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: hovered ? 1 : 0,
        transition: 'opacity 0.15s ease',
      },
    },
    inLibrary ? tablerIcon('heart-filled', { size: 20 }) : tablerIcon('plus', { size: 20 }),
  )
}
