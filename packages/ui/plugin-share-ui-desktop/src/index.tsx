/**
 * Desktop UI views for @bbebee/plugin-share.
 *
 * Implements track, playlist, and lyric sharing with
 * LSB steganography in PNG images and an import reader.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { SHARE_VIEWS } from '@BBeBee/plugin-share/views'
import { ShareHost, type ShareHostProps } from './components/ShareHost.js'
import { ShareTrackModal, type ShareTrackModalProps } from './components/ShareTrackModal.js'
import { SharePlaylistModal, type SharePlaylistModalProps } from './components/SharePlaylistModal.js'
import { ShareLyricsModal, type ShareLyricsModalProps } from './components/ShareLyricsModal.js'
import { ShareAlbumModal, type ShareAlbumModalProps } from './components/ShareAlbumModal.js'
import { ImportShareModal, type ImportShareModalProps } from './components/ImportShareModal.js'
import { ShareCardPreview, type ShareCardPreviewProps } from './components/ShareCardPreview.js'

export {
  ShareHost,
  ShareTrackModal,
  SharePlaylistModal,
  ShareLyricsModal,
  ShareAlbumModal,
  ImportShareModal,
  ShareCardPreview,
  type ShareHostProps,
  type ShareTrackModalProps,
  type SharePlaylistModalProps,
  type ShareLyricsModalProps,
  type ShareAlbumModalProps,
  type ImportShareModalProps,
  type ShareCardPreviewProps,
}

export const name = 'plugin-share-ui-desktop'
export const inject = ['ui', 'share']

function bound<P extends { ctx: Context }>(
  ctx: Context,
  Screen: (props: P) => ReactElement | null,
): (props: Omit<P, 'ctx'>) => ReactElement | null {
  return function Bound(props) {
    return h(Screen, { ...props, ctx } as P)
  }
}

export async function apply(ctx: Context) {
  ctx.logger.info('plugin-share-ui-desktop: loaded')

  return ctx.effect(function* () {
    yield ctx.ui.registerView(SHARE_VIEWS.host, bound(ctx, ShareHost))
  }, 'share-ui-desktop')
}

export default { name, inject, apply }
