import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { useShareModalState } from '@bbebee/plugin-share/hooks'
import { ShareTrackModal } from './ShareTrackModal.js'
import { SharePlaylistModal } from './SharePlaylistModal.js'
import { ShareLyricsModal } from './ShareLyricsModal.js'
import { ShareAlbumModal } from './ShareAlbumModal.js'
import { ImportShareModal } from './ImportShareModal.js'

export interface ShareHostProps {
  ctx: Context
}

/**
 * Global host component for all share dialogs and steganography import modals.
 */
export function ShareHost({ ctx }: ShareHostProps): ReactElement | null {
  const { isOpen, mode, target, close } = useShareModalState(ctx)

  if (!isOpen) return null

  if (mode === 'import') {
    return h(ImportShareModal, {
      ctx,
      open: true,
      onClose: close,
    })
  }

  if (mode === 'share' && target) {
    if (target.type === 'track') {
      return h(ShareTrackModal, {
        ctx,
        track: target.track,
        open: true,
        onClose: close,
      })
    }

    if (target.type === 'playlist') {
      return h(SharePlaylistModal, {
        ctx,
        playlist: target.playlist,
        open: true,
        onClose: close,
      })
    }

    if (target.type === 'lyrics') {
      return h(ShareLyricsModal, {
        ctx,
        lyrics: target.lyrics,
        open: true,
        onClose: close,
      })
    }

    if (target.type === 'album') {
      return h(ShareAlbumModal, {
        ctx,
        album: target.album,
        open: true,
        onClose: close,
      })
    }
  }

  return null
}
