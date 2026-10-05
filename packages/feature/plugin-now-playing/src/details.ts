/**
 * Track playback details — the headless aggregation behind the "查看播放内容"
 * modal.
 *
 * What used to be a ~150-line `loadData` inside the desktop modal component
 * (raw SQL against `media_bindings`/`scan_entries`, `fs.stat` fallbacks, codec
 * metadata reads, stream and binding fallbacks) is domain orchestration and
 * belongs here, next to the surface whose track it describes. A view now calls
 * {@link resolveTrackDetails} — via `useTrackDetails` — and renders the rows;
 * no view package touches `ctx.db` or `ctx.fs` for this any more.
 *
 * Every read is best-effort: an absent service (no db on this platform, codec
 * unloaded) or a failed read degrades to the next fallback, never throws.
 */

import type { Context } from 'cordis'
import type {
  AudioService,
  CodecService,
  DbService,
  FsService,
  PlayerService,
  Track,
} from '@BBeBee/protocol'
import { parseUrn } from '@BBeBee/protocol'
import { formatBytes, formatDuration } from '@BBeBee/toolkit'
import { serviceOf } from '@BBeBee/toolkit/hooks'

/** Everything the "查看播放内容" modal renders, display-ready. */
export interface TrackDetails {
  isLocal: boolean
  title: string
  artist: string
  album?: string
  fileName?: string
  filePath?: string
  /** Toolkit-formatted; `undefined` when no source could answer, shown as 未知. */
  fileSize?: string
  /** `undefined` when no source could answer, shown as 未知. */
  modifiedTime?: string
  sourceId: string
  sourceTrackId: string
  duration: string
  sampleRate: string
  channels: string
  bitrate: string
  codec: string
  tagType: string
  outputDevice: string
  outputEngine: string
  outputSampleRate: string
  outputChannels: string
  outputBitDepth: string
  outputBandwidth: string
  isWasapi: boolean
}

interface BindingRow {
  uri: string
  format?: string
  codec?: string
  bitrate_kbps?: number
  sample_rate?: number
  channels?: number
  bit_depth?: number
  size_bytes?: number
}

interface ScanRow {
  uri: string
  size?: number
  mtime?: number
}

function formatChannels(count: number): string {
  return count === 1 ? '1 (单声道 Mono)' : count === 2 ? '2 (立体声 Stereo)' : `${count} 声道`
}

function formatSampleRate(rate: number): string {
  return `${rate.toLocaleString()} Hz`
}

function formatBitrate(kbps: number): string {
  return `${kbps.toLocaleString()} kbps`
}

function formatMtime(mtime: number | undefined): string | undefined {
  if (!mtime) return undefined
  const ms = Number(mtime) > 1e11 ? Number(mtime) : Number(mtime) * 1000
  return new Date(ms).toLocaleString()
}

async function statSize(ctx: Context, rawUri: string): Promise<number | undefined> {
  const fs = serviceOf<FsService>(ctx, 'fs')
  if (!fs?.stat) return undefined
  try {
    const stat = await fs.stat(rawUri)
    return stat?.size !== undefined && stat.size !== null ? Number(stat.size) : undefined
  } catch {
    return undefined
  }
}

export async function resolveTrackDetails(ctx: Context, track: Track): Promise<TrackDetails> {
  const { sourceId, id: sourceTrackId } = parseUrn(track.urn)
  const isLocal = sourceId === 'local'

  let fileName: string | undefined
  let filePath: string | undefined
  let fileSize: string | undefined
  let modifiedTime: string | undefined
  let codec: string | undefined
  let bitrate: string | undefined
  let sampleRate: string | undefined
  let channels: string | undefined
  let tagType: string | undefined

  const player = serviceOf<PlayerService>(ctx, 'player') ?? ctx.player
  const durationMs = track.durationMs ?? player?.state?.durationMs ?? 0
  const duration = formatDuration(durationMs)
  const stream = player?.currentStream

  // Check if track is local by sourceId or by stream target URI
  const isLocalTrack = isLocal || Boolean(stream?.target && /^(file|bbebee-file):\/\//.test(stream.target))

  if (isLocalTrack) {
    let binding: BindingRow | undefined
    let scanEntry: ScanRow | undefined

    const db = serviceOf<DbService>(ctx, 'db')
    if (db) {
      try {
        binding = (await db.get('SELECT * FROM media_bindings WHERE track_urn = ? LIMIT 1', [
          track.urn,
        ])) as BindingRow | undefined
      } catch {
        // Ignore db read error
      }
      try {
        scanEntry = (await db.get('SELECT * FROM scan_entries WHERE track_urn = ? OR uri = ? LIMIT 1', [
          track.urn,
          binding?.uri ?? '',
        ])) as ScanRow | undefined
      } catch {
        // Ignore db read error
      }
    }

    let rawUri = binding?.uri ?? scanEntry?.uri
    if (!rawUri && stream?.target && /^(file|bbebee-file):\/\//.test(stream.target)) {
      rawUri = stream.target
    }
    if (!rawUri && track.urn && /^(file|bbebee-file):\/\//.test(track.urn)) {
      rawUri = track.urn
    }

    if (rawUri) {
      const decoded = decodeURIComponent(rawUri.replace(/^(file|bbebee-file):\/\//, ''))
      const normalizedPath = decoded.replace(/^\/([a-zA-Z]:)/, '$1')
      filePath = normalizedPath
      fileName = normalizedPath.split(/[/\\]/).pop() || normalizedPath
    }

    const sizeBytes = binding?.size_bytes ?? scanEntry?.size ?? stream?.byteLength
    if (sizeBytes !== undefined && sizeBytes !== null) {
      fileSize = formatBytes(Number(sizeBytes))
    }

    modifiedTime = formatMtime(scanEntry?.mtime)

    // Real filesystem fallback via FsService
    if (rawUri && (!fileSize || !modifiedTime)) {
      const stat = await statSize(ctx, rawUri)
      if (!fileSize && stat !== undefined) fileSize = formatBytes(stat)
      if (!modifiedTime) {
        const fs = serviceOf<FsService>(ctx, 'fs')
        if (fs?.stat) {
          try {
            const st = await fs.stat(rawUri)
            if (st?.mtime) modifiedTime = formatMtime(Number(st.mtime))
          } catch {
            // Ignore fs.stat failure
          }
        }
      }
    }

    // Try codec service for detailed tags & specs
    const codecService = serviceOf<CodecService>(ctx, 'codec')
    if (rawUri && codecService?.readMetadata) {
      try {
        const meta = await codecService.readMetadata(rawUri)
        if (meta) {
          if (meta.codec) codec = meta.codec.toUpperCase()
          if (meta.sampleRate) sampleRate = formatSampleRate(meta.sampleRate)
          if (meta.channels) channels = formatChannels(meta.channels)
          if (meta.bitrateKbps) bitrate = `${meta.bitrateKbps} kbps`
          if (meta.tagTypes?.length) tagType = meta.tagTypes.join(', ')
        }
      } catch {
        // Ignore codec metadata read error
      }
    }

    // Stream handle fallbacks
    if (!codec && stream?.codec) {
      codec = stream.codec.toUpperCase()
    }
    if (!sampleRate && stream?.sampleRate) {
      sampleRate = formatSampleRate(stream.sampleRate)
    }
    if (!bitrate && stream?.bitrateKbps) {
      bitrate = `${stream.bitrateKbps} kbps`
    }

    // Fallbacks from media_bindings
    if (!codec && (binding?.codec || binding?.format)) {
      codec = (binding.codec || binding.format)!.toUpperCase()
    }
    if (!sampleRate && binding?.sample_rate) {
      sampleRate = formatSampleRate(Number(binding.sample_rate))
    }
    if (!channels && binding?.channels) {
      channels = formatChannels(Number(binding.channels))
    }
    if (!bitrate && binding?.bitrate_kbps) {
      bitrate = `${binding.bitrate_kbps} kbps`
    }

    // Fallback from filename extension for codec
    if (!codec && fileName && fileName.includes('.')) {
      const ext = fileName.split('.').pop()?.toUpperCase()
      if (ext) codec = ext
    }

    if (!tagType) {
      const fmt = (codec || binding?.format || '').toLowerCase()
      if (fmt.includes('mp3')) tagType = 'ID3v2'
      else if (fmt.includes('flac')) tagType = 'Vorbis Comments'
      else if (fmt.includes('ogg')) tagType = 'Vorbis Comments'
      else if (fmt.includes('m4a') || fmt.includes('alac') || fmt.includes('aac')) tagType = 'MP4 / iTunes'
      else if (fmt.includes('ape')) tagType = 'APEv2'
      else if (fmt.includes('wav')) tagType = 'RIFF INFO / ID3'
      else tagType = '内置音频标签'
    }

    // Physical calculation fallback: if bitrate is missing or abnormal (< 32 kbps)
    const currentKbps = bitrate ? parseInt(bitrate.replace(/[^0-9]/g, ''), 10) : 0
    if ((!bitrate || currentKbps < 32) && durationMs > 0) {
      const rawBytes = binding?.size_bytes ?? scanEntry?.size ?? stream?.byteLength
      let bytesNum = rawBytes ? Number(rawBytes) : 0
      if (!bytesNum && rawUri) {
        bytesNum = (await statSize(ctx, rawUri)) ?? 0
      }
      if (bytesNum > 0) {
        const calcKbps = Math.round((bytesNum * 8) / durationMs)
        if (calcKbps >= 32) {
          bitrate = formatBitrate(calcKbps)
        }
      }
    }
  } else {
    // Third-party source
    if (stream) {
      const streamFormat = (stream as unknown as { format?: string }).format
      const streamCodec = stream.codec || streamFormat || stream.mimeType
      if (streamCodec) codec = streamCodec.toUpperCase()
      if (stream.sampleRate) sampleRate = formatSampleRate(stream.sampleRate)
      if (stream.byteLength) fileSize = formatBytes(stream.byteLength)

      // Bitrate calculation
      if (stream.bitrateKbps && stream.bitrateKbps >= 32) {
        bitrate = `${stream.bitrateKbps} kbps`
      } else if (stream.byteLength && durationMs > 0) {
        const calcKbps = Math.round((stream.byteLength * 8) / durationMs)
        if (calcKbps >= 32 && calcKbps < 100000) {
          bitrate = formatBitrate(calcKbps)
        }
      } else if (stream.quality) {
        const qualityMap: Record<string, string> = {
          lossless: '920 kbps (无损)',
          'hi-res': '1,411 kbps (Hi-Res)',
          high: '320 kbps (高品质)',
          medium: '192 kbps (标准)',
          standard: '192 kbps (标准)',
          low: '128 kbps (省流)',
        }
        bitrate = qualityMap[stream.quality] ?? '320 kbps'
      }
    }
    if (!channels) channels = '2 (立体声 Stereo)'
    tagType = '在线流媒体 (无独立元数据标签)'
  }

  // Audio output device & WASAPI / MPV specs
  const audio = serviceOf<AudioService>(ctx, 'audio')
  const activeEngine = audio?.activeEngineName ?? (audio as unknown as { engine?: string })?.engine
  const isMpv = activeEngine === 'mpv'
  const isWasapi = activeEngine === 'wasapi'

  let outputDevice = audio?.currentDeviceLabel
  if (!outputDevice && audio?.listOutputDevices) {
    try {
      const devs = await audio.listOutputDevices()
      const activeDev = devs.find((d) => d.isDefault) ?? devs[0]
      if (activeDev) outputDevice = activeDev.label
    } catch {
      // ignore
    }
  }
  if (!outputDevice) {
    outputDevice = (isMpv || isWasapi) ? '默认音频输出终端 (WASAPI)' : '默认系统音频输出终端'
  }

  const outputEngine = isMpv
    ? 'MPV Hi-Fi (原生崩溃隔离 & WASAPI 直通)'
    : isWasapi
      ? 'WASAPI (系统共享混音)'
      : 'Web Audio (系统共享混音)'

  const parsedSourceRate = sampleRate ? parseInt(sampleRate.replace(/[^0-9]/g, ''), 10) : 44100
  const hwSampleRateNum = audio?.sampleRate && audio.sampleRate > 0 ? audio.sampleRate : parsedSourceRate
  const outputSampleRate = formatSampleRate(hwSampleRateNum)

  const hwChannelsNum = audio?.hardwareChannels ?? (channels?.startsWith('1') ? 1 : 2)
  const outputChannels = formatChannels(hwChannelsNum)

  const hwBitDepthNum = audio?.hardwareBitDepth ?? ((isMpv || isWasapi) ? 24 : 16)
  const outputBitDepth = `${hwBitDepthNum}-bit Float`

  const pcmBandwidth = Math.round((hwSampleRateNum * hwChannelsNum * hwBitDepthNum) / 1000)
  const outputBandwidth = `${pcmBandwidth.toLocaleString()} kbps (未压缩 PCM 带宽)`

  const fallbackArtist = (track as unknown as { artist?: string }).artist
  const artistDisplay =
    track.artists?.map((a) => a.name).filter(Boolean).join(', ') || fallbackArtist || '未知艺人'
  const fallbackAlbum = (track as unknown as { album?: string }).album
  const albumDisplay = track.albumTitle || fallbackAlbum

  return {
    isLocal: isLocalTrack,
    title: track.title,
    artist: artistDisplay,
    album: albumDisplay,
    fileName,
    filePath,
    fileSize,
    modifiedTime,
    sourceId,
    sourceTrackId,
    duration,
    sampleRate: sampleRate ?? '44,100 Hz',
    channels: channels ?? '2 (立体声 Stereo)',
    bitrate: bitrate ?? (isLocalTrack ? '未知' : '320 kbps'),
    codec: codec ?? (isLocalTrack ? '未知' : 'AAC / MP3'),
    tagType: tagType ?? '未知',
    outputDevice,
    outputEngine,
    outputSampleRate,
    outputChannels,
    outputBitDepth,
    outputBandwidth,
    isWasapi,
  }
}
