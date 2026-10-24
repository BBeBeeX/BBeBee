import { createElement as h, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type {
  PlayerService,
  ShareAlbumData,
  ShareLyricsData,
  ShareMetadataEnvelope,
  SharePlaylistData,
  ShareService,
  ShareTarget,
  ShareTrackData,
} from '@BBeBee/protocol'
import { useShareModalState } from '@bbebee/plugin-share/hooks'
import { serviceOf } from '@BBeBee/ui-core'
import { Button, EmptyState, Sheet, TextField, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

/** Full-literal catalogue keys for the share type names — never built at runtime. */
const TYPE_LABEL_KEYS: Record<ShareTarget['type'], string> = {
  track: 'share:shareHost.typeLabel.song',
  playlist: 'share:shareHost.typeLabel.playlist',
  lyrics: 'share:shareHost.typeLabel.lyrics',
  album: 'share:shareHost.typeLabel.album',
}

/** One human line for an envelope, shared by the share and import panels. */
function describe(
  t: (key: string, params?: Record<string, string | number>) => string,
  envelope: ShareMetadataEnvelope,
): string {
  switch (envelope.type) {
    case 'track': {
      const d = envelope.data as ShareTrackData
      return t('share:shareHost.targetTrack', { title: d.title, artist: d.artist })
    }
    case 'playlist': {
      const d = envelope.data as SharePlaylistData
      return t('share:shareHost.targetPlaylist', { name: d.name, trackCount: d.trackCount })
    }
    case 'album': {
      const d = envelope.data as ShareAlbumData
      return d.artist
        ? t('share:shareHost.albumTitleWithArtist', { title: d.title, artist: d.artist, trackCount: d.trackCount })
        : t('share:shareHost.albumTitle', { title: d.title, trackCount: d.trackCount })
    }
    case 'lyrics': {
      const d = envelope.data as ShareLyricsData
      return t('share:shareHost.targetLyrics', { title: d.title, artist: d.artist })
    }
  }
}

function payloadOf(
  target: ShareTarget,
): ShareTrackData | SharePlaylistData | ShareLyricsData | ShareAlbumData {
  switch (target.type) {
    case 'track':
      return target.track
    case 'playlist':
      return target.playlist
    case 'lyrics':
      return target.lyrics
    case 'album':
      return target.album
  }
}

/** URNs a decoded envelope can start playing, mirroring the desktop importer. */
function urnsOf(envelope: ShareMetadataEnvelope): string[] {
  switch (envelope.type) {
    case 'track':
      return [(envelope.data as ShareTrackData).urn]
    case 'playlist': {
      const d = envelope.data as SharePlaylistData
      return d.tracks?.map((t) => t.urn) ?? [d.urn]
    }
    case 'album': {
      const d = envelope.data as ShareAlbumData
      return d.tracks?.map((t) => t.urn) ?? [d.urn]
    }
    case 'lyrics':
      return []
  }
}

/**
 * Global host for the share sheet on mobile — the twin of the desktop
 * `ShareHost`, listening on the same `share/open` / `share/import` events.
 */
export function ShareHost({ ctx }: { ctx: Context }): ReactElement | null {
  const { isOpen, mode, target, close } = useShareModalState(ctx)

  if (!isOpen) return null

  return mode === 'import'
    ? h(ImportPanel, { ctx, onClose: close })
    : target
      ? h(SharePanel, { ctx, target, onClose: close })
      : null
}

function SharePanel({
  ctx,
  target,
  onClose,
}: {
  ctx: Context
  target: ShareTarget
  onClose: () => void
}): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const share = serviceOf<ShareService>(ctx, 'share')

  // The code is derived once per target — encoding is cheap, but a field that
  // rewrites itself on every render would fight the user's long-press.
  const code = useMemo(
    () => (share ? share.encodeMetadata(target.type, payloadOf(target)) : ''),
    [share, target],
  )

  const summary =
    target.type === 'track'
      ? t('share:shareHost.targetTrack', { title: target.track.title, artist: target.track.artist })
      : target.type === 'playlist'
        ? t('share:shareHost.targetPlaylist', { name: target.playlist.name, trackCount: target.playlist.trackCount })
        : target.type === 'album'
          ? target.album.artist
            ? t('share:shareHost.targetAlbumWithArtist', { title: target.album.title, artist: target.album.artist })
            : t('share:shareHost.targetAlbum', { title: target.album.title })
          : t('share:shareHost.targetLyrics', { title: target.lyrics.title, artist: target.lyrics.artist })

  return h(
    Sheet,
    {
      open: true,
      onClose,
      title: t('share:shareHost.shareType', { type: t(TYPE_LABEL_KEYS[target.type]).toLowerCase() }),
    },
    h(
      native.View as never,
      { style: { gap: tokens.space[3], paddingBottom: tokens.space[4] } },
      h(Text, { variant: 'lg' }, summary),
      h(TextField, {
        value: code,
        onChange: () => {},
        multiline: true,
        rows: 4,
        disabled: true,
        placeholder: share ? undefined : t('share:shareHost.shareServiceNotReady'),
      }),
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        share ? t('share:shareHost.longPressHint') : t('share:shareHost.shareServiceNotReadyYet'),
      ),
    ),
  )
}

function ImportPanel({ ctx, onClose }: { ctx: Context; onClose: () => void }): ReactElement {
  const { t } = useI18n(ctx)
  const native = nativePrimitives()
  const share = serviceOf<ShareService>(ctx, 'share')
  const [code, setCode] = useState('')
  const [decoded, setDecoded] = useState<ShareMetadataEnvelope | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decode = () => {
    if (!share) {
      setError(t('share:shareHost.shareServiceNotReady'))
      return
    }
    const trimmed = code.trim()
    if (!trimmed) {
      setDecoded(null)
      setError(t('share:shareHost.pasteAShareCodeFirst'))
      return
    }
    const envelope = share.decodeMetadata(trimmed)
    if (envelope) {
      setDecoded(envelope)
      setError(null)
    } else {
      setDecoded(null)
      setError(t('share:shareHost.canTParseTheShare'))
    }
  }

  const handlePlayNow = async () => {
    if (!decoded) return
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) {
      setError(t('share:shareHost.playerServiceNotReady'))
      return
    }
    try {
      await player.playNow(urnsOf(decoded))
      onClose()
    } catch (err) {
      ctx.logger.error(`plugin-share-ui-mobile: failed to play shared item: ${String(err)}`)
      setError(t('share:importShare.playbackFailed', { err: String(err) }))
    }
  }

  const handleEnqueue = async () => {
    if (!decoded) return
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) {
      setError(t('share:shareHost.playerServiceNotReady'))
      return
    }
    try {
      player.enqueueLast(urnsOf(decoded))
      onClose()
    } catch (err) {
      ctx.logger.error(`plugin-share-ui-mobile: failed to enqueue shared item: ${String(err)}`)
      setError(t('share:importShare.failedToAddToQueue', { err: String(err) }))
    }
  }

  return h(
    Sheet,
    { open: true, onClose, title: t('share:shareHost.readShareCard') },
    h(
      native.View as never,
      { style: { gap: tokens.space[3], paddingBottom: tokens.space[4] } },
      h(TextField, {
        value: code,
        onChange: (next) => {
          setCode(next)
          // A fresh paste invalidates the previous result; leaving it on
          // screen would let Play act on an envelope the user replaced.
          setDecoded(null)
        },
        multiline: true,
        rows: 4,
        placeholder: t('share:shareHost.pasteBase64ShareCode'),
        error: error ?? undefined,
      }),
      decoded
        ? h(
            Text,
            { variant: 'lg' },
            t('share:shareHost.recognizedType', {
              type: t(TYPE_LABEL_KEYS[decoded.type]).toLowerCase(),
              description: describe(t, decoded),
            }),
          )
        : h(EmptyState, {
            icon: '⇪',
            title: t('share:shareHost.pasteAShareCode'),
            description: t('share:shareHost.pasteAShareCodeCopied'),
          }),
      decoded && decoded.type !== 'lyrics'
        ? h(
            native.View as never,
            { style: { flexDirection: 'row', gap: tokens.space[3] } },
            h(
              native.View as never,
              { style: { flex: 1 } },
              h(Button, {
                variant: 'primary',
                onPress: handlePlayNow,
                testID: 'share-import-play',
                children: t('share:importShare.playNow'),
              }),
            ),
            h(
              native.View as never,
              { style: { flex: 1 } },
              h(Button, {
                variant: 'secondary',
                onPress: handleEnqueue,
                testID: 'share-import-enqueue',
                children: t('share:importShare.addToQueue'),
              }),
            ),
          )
        : null,
      h(Button, {
        variant: 'secondary',
        onPress: decode,
        testID: 'share-import-decode',
        children: t('share:shareHost.decodeShareCode'),
      }),
    ),
  )
}
