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
import { useShareModalState } from '@BBeBee/plugin-share/hooks'
import { serviceOf } from '@BBeBee/ui-core'
import { Button, EmptyState, Sheet, TextField, Text, nativePrimitives } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'

const TYPE_LABEL: Record<ShareTarget['type'], string> = {
  track: 'Song',
  playlist: 'Playlist',
  lyrics: 'Lyrics',
  album: 'Album',
}

/** One human line for an envelope, shared by the share and import panels. */
function describe(envelope: ShareMetadataEnvelope): string {
  switch (envelope.type) {
    case 'track': {
      const d = envelope.data as ShareTrackData
      return `${d.title} — ${d.artist}`
    }
    case 'playlist': {
      const d = envelope.data as SharePlaylistData
      return `${d.name} (${d.trackCount} songs)`
    }
    case 'album': {
      const d = envelope.data as ShareAlbumData
      return `${d.title}${d.artist ? ` — ${d.artist}` : ''} (${d.trackCount} songs)`
    }
    case 'lyrics': {
      const d = envelope.data as ShareLyricsData
      return `${d.title} — ${d.artist} (lyrics)`
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
      ? `${target.track.title} — ${target.track.artist}`
      : target.type === 'playlist'
        ? `${target.playlist.name} (${target.playlist.trackCount} songs)`
        : target.type === 'album'
          ? `${target.album.title}${target.album.artist ? ` — ${target.album.artist}` : ''}`
          : `${target.lyrics.title} — ${target.lyrics.artist} (lyrics)`

  return h(
    Sheet,
    { open: true, onClose, title: `Share ${TYPE_LABEL[target.type].toLowerCase()}` },
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
        placeholder: share ? undefined : 'Share service not ready',
      }),
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        share
          ? 'Long-press the share code to copy it; generate image cards on desktop. Any BBeBee client can paste-import via "Read share card".'
          : 'The share service is not ready yet — try again later.',
      ),
    ),
  )
}

function ImportPanel({ ctx, onClose }: { ctx: Context; onClose: () => void }): ReactElement {
  const native = nativePrimitives()
  const share = serviceOf<ShareService>(ctx, 'share')
  const [code, setCode] = useState('')
  const [decoded, setDecoded] = useState<ShareMetadataEnvelope | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decode = () => {
    if (!share) {
      setError('Share service not ready')
      return
    }
    const trimmed = code.trim()
    if (!trimmed) {
      setDecoded(null)
      setError('Paste a share code first')
      return
    }
    const envelope = share.decodeMetadata(trimmed)
    if (envelope) {
      setDecoded(envelope)
      setError(null)
    } else {
      setDecoded(null)
      setError("Can't parse the share code: not a valid BBeBee share package")
    }
  }

  const handlePlayNow = async () => {
    if (!decoded) return
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) {
      setError('Player service not ready')
      return
    }
    try {
      await player.playNow(urnsOf(decoded))
      onClose()
    } catch (err) {
      ctx.logger.error(`plugin-share-ui-mobile: failed to play shared item: ${String(err)}`)
      setError(`Playback failed: ${String(err)}`)
    }
  }

  const handleEnqueue = async () => {
    if (!decoded) return
    const player = serviceOf<PlayerService>(ctx, 'player')
    if (!player) {
      setError('Player service not ready')
      return
    }
    try {
      player.enqueueLast(urnsOf(decoded))
      onClose()
    } catch (err) {
      ctx.logger.error(`plugin-share-ui-mobile: failed to enqueue shared item: ${String(err)}`)
      setError(`Failed to add to queue: ${String(err)}`)
    }
  }

  return h(
    Sheet,
    { open: true, onClose, title: 'Read share card' },
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
        placeholder: 'Paste Base64 share code',
        error: error ?? undefined,
      }),
      decoded
        ? h(Text, { variant: 'lg' }, `Recognized ${TYPE_LABEL[decoded.type].toLowerCase()}: ${describe(decoded)}`)
        : h(EmptyState, {
            icon: '⇪',
            title: 'Paste a share code',
            description: 'Paste a share code copied from another BBeBee client above to import it.',
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
                children: 'Play now',
              }),
            ),
            h(
              native.View as never,
              { style: { flex: 1 } },
              h(Button, {
                variant: 'secondary',
                onPress: handleEnqueue,
                testID: 'share-import-enqueue',
                children: 'Add to queue',
              }),
            ),
          )
        : null,
      h(Button, {
        variant: 'secondary',
        onPress: decode,
        testID: 'share-import-decode',
        children: 'Decode share code',
      }),
    ),
  )
}
