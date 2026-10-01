import { createElement as h, useEffect, useState, useCallback } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { AudioService, CodecService, DbService, FsService, PlayerService, Track } from '@BBeBee/protocol'
import { parseUrn } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { formatDuration } from '@BBeBee/toolkit'
import { Sheet, tablerIcon } from '@BBeBee/ui-kit-desktop'

export interface TrackInfoModalProps {
  ctx: Context
  track: Track | null
  open: boolean
  onClose: () => void
}

interface TrackDetails {
  isLocal: boolean
  title: string
  artist: string
  album?: string
  fileName?: string
  filePath?: string
  fileSize?: string
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

function formatBytes(bytes?: number): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '未知'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let val = bytes
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024
    i++
  }
  return `${val.toFixed(2)} ${units[i]}`
}

export function TrackInfoModal({
  ctx,
  track,
  open,
  onClose,
}: TrackInfoModalProps): ReactElement | null {
  const [details, setDetails] = useState<TrackDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [copiedPath, setCopiedPath] = useState(false)

  useEffect(() => {
    if (!open || !track) {
      setDetails(null)
      return
    }

    let active = true

    async function loadData() {
      setLoading(true)
      try {
        const { sourceId, id: sourceTrackId } = parseUrn(track!.urn)
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
        const durationMs = track!.durationMs ?? player?.state?.durationMs ?? 0
        const duration = formatDuration(durationMs)
        const stream = player?.currentStream

        // Check if track is local by sourceId or by stream target URI
        const isLocalTrack = isLocal || Boolean(stream?.target && /^(file|bbebee-file):\/\//.test(stream.target))

        if (isLocalTrack) {
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

          let binding: BindingRow | undefined
          let scanEntry: ScanRow | undefined

          const db = serviceOf<DbService>(ctx, 'db')
          if (db) {
            try {
              binding = (await db.get(
                'SELECT * FROM media_bindings WHERE track_urn = ? LIMIT 1',
                [track!.urn],
              )) as BindingRow | undefined
            } catch {
              // Ignore db read error
            }
            try {
              scanEntry = (await db.get(
                'SELECT * FROM scan_entries WHERE track_urn = ? OR uri = ? LIMIT 1',
                [track!.urn, binding?.uri ?? ''],
              )) as ScanRow | undefined
            } catch {
              // Ignore db read error
            }
          }

          let rawUri = binding?.uri ?? scanEntry?.uri
          if (!rawUri && stream?.target && /^(file|bbebee-file):\/\//.test(stream.target)) {
            rawUri = stream.target
          }
          if (!rawUri && track?.urn && /^(file|bbebee-file):\/\//.test(track.urn)) {
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

          const mtime = scanEntry?.mtime
          if (mtime) {
            const ms = Number(mtime) > 1e11 ? Number(mtime) : Number(mtime) * 1000
            const d = new Date(ms)
            modifiedTime = d.toLocaleString()
          }

          // Real filesystem fallback via FsService
          if (rawUri && (!fileSize || fileSize === '未知' || !modifiedTime || modifiedTime === '未知')) {
            const fs = serviceOf<FsService>(ctx, 'fs')
            if (fs?.stat) {
              try {
                const stat = await fs.stat(rawUri)
                if (stat) {
                  if ((!fileSize || fileSize === '未知') && stat.size !== undefined && stat.size !== null) {
                    fileSize = formatBytes(Number(stat.size))
                  }
                  if ((!modifiedTime || modifiedTime === '未知') && stat.mtime) {
                    const ms = Number(stat.mtime) > 1e11 ? Number(stat.mtime) : Number(stat.mtime) * 1000
                    modifiedTime = new Date(ms).toLocaleString()
                  }
                }
              } catch {
                // Ignore fs.stat failure
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
                if (meta.sampleRate) sampleRate = `${meta.sampleRate.toLocaleString()} Hz`
                if (meta.channels) {
                  channels =
                    meta.channels === 1
                      ? '1 (单声道 Mono)'
                      : meta.channels === 2
                        ? '2 (立体声 Stereo)'
                        : `${meta.channels} 声道`
                }
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
            sampleRate = `${stream.sampleRate.toLocaleString()} Hz`
          }
          if (!bitrate && stream?.bitrateKbps) {
            bitrate = `${stream.bitrateKbps} kbps`
          }

          // Fallbacks from media_bindings
          if (!codec && (binding?.codec || binding?.format)) {
            codec = (binding.codec || binding.format)!.toUpperCase()
          }
          if (!sampleRate && binding?.sample_rate) {
            sampleRate = `${Number(binding.sample_rate).toLocaleString()} Hz`
          }
          if (!channels && binding?.channels) {
            const ch = Number(binding.channels)
            channels = ch === 1 ? '1 (单声道 Mono)' : ch === 2 ? '2 (立体声 Stereo)' : `${ch} 声道`
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
              const fs = serviceOf<FsService>(ctx, 'fs')
              if (fs?.stat) {
                try {
                  const st = await fs.stat(rawUri)
                  if (st?.size) bytesNum = Number(st.size)
                } catch {
                  // ignore
                }
              }
            }
            if (bytesNum > 0) {
              const calcKbps = Math.round((bytesNum * 8) / durationMs)
              if (calcKbps >= 32) {
                bitrate = `${calcKbps.toLocaleString()} kbps`
              }
            }
          }
        } else {
          // Third-party source
          if (stream) {
            const streamFormat = (stream as unknown as { format?: string }).format
            const streamCodec = stream.codec || streamFormat || stream.mimeType
            if (streamCodec) codec = streamCodec.toUpperCase()
            if (stream.sampleRate) sampleRate = `${stream.sampleRate.toLocaleString()} Hz`
            if (stream.byteLength) fileSize = formatBytes(stream.byteLength)

            // Bitrate calculation
            if (stream.bitrateKbps && stream.bitrateKbps >= 32) {
              bitrate = `${stream.bitrateKbps} kbps`
            } else if (stream.byteLength && durationMs > 0) {
              const calcKbps = Math.round((stream.byteLength * 8) / durationMs)
              if (calcKbps >= 32 && calcKbps < 100000) {
                bitrate = `${calcKbps.toLocaleString()} kbps`
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
        const outputSampleRate = `${hwSampleRateNum.toLocaleString()} Hz`

        const hwChannelsNum = audio?.hardwareChannels ?? (channels?.startsWith('1') ? 1 : 2)
        const outputChannels =
          hwChannelsNum === 1
            ? '1 (单声道 Mono)'
            : hwChannelsNum === 2
              ? '2 (立体声 Stereo)'
              : `${hwChannelsNum} 声道`

        const hwBitDepthNum = audio?.hardwareBitDepth ?? ((isMpv || isWasapi) ? 24 : 16)
        const outputBitDepth = `${hwBitDepthNum}-bit Float`

        const pcmBandwidth = Math.round((hwSampleRateNum * hwChannelsNum * hwBitDepthNum) / 1000)
        const outputBandwidth = `${pcmBandwidth.toLocaleString()} kbps (未压缩 PCM 带宽)`

        if (!active) return

        const fallbackArtist = (track as unknown as { artist?: string }).artist
        const artistDisplay =
          track!.artists?.map((a) => a.name).filter(Boolean).join(', ') ||
          fallbackArtist ||
          '未知艺人'
        const fallbackAlbum = (track as unknown as { album?: string }).album
        const albumDisplay = track!.albumTitle || fallbackAlbum

        setDetails({
          isLocal: isLocalTrack,
          title: track!.title,
          artist: artistDisplay,
          album: albumDisplay,
          fileName,
          filePath,
          fileSize: fileSize ?? '未知',
          modifiedTime: modifiedTime ?? '未知',
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
        })
      } catch (err) {
        ctx.logger?.error('Failed to load track details: %o', err)
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadData()
    return () => {
      active = false
    }
  }, [open, track, ctx])

  const handleCopyPath = useCallback(async () => {
    if (!details?.filePath) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(details.filePath)
        setCopiedPath(true)
        setTimeout(() => setCopiedPath(false), 2000)
      }
    } catch {
      // Ignore clipboard write errors (e.g. unfocused window or permissions)
    }
  }, [details?.filePath])

  if (!open || !track) return null

  const renderRow = (label: string, value?: string, onCopy?: () => void, isCopied = false) => {
    return h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          padding: '6px 0',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          fontSize: 13,
          lineHeight: '1.5',
        },
      },
      h(
        'span',
        {
          style: {
            width: 110,
            flexShrink: 0,
            color: 'var(--text-muted, #8B95B0)',
            userSelect: 'none',
          },
        },
        label,
      ),
      h(
        'span',
        {
          style: {
            flex: 1,
            color: 'var(--text-primary, #FFFFFF)',
            wordBreak: 'break-all',
            userSelect: 'text',
          },
        },
        value ?? '未知',
      ),
      onCopy && value
        ? h(
            'button',
            {
              type: 'button',
              onClick: onCopy,
              title: isCopied ? '已复制' : '复制',
              style: {
                background: 'transparent',
                border: 'none',
                color: isCopied ? 'var(--color-primary, #5F87FF)' : 'var(--text-muted, #8B95B0)',
                cursor: 'pointer',
                padding: '0 4px',
                display: 'inline-flex',
                alignItems: 'center',
                flexShrink: 0,
                outline: 'none',
              },
            },
            tablerIcon(isCopied ? 'check' : 'copy', { size: 14 }),
          )
        : null,
    )
  }

  return h(
    Sheet,
    { open, onClose },
    h(
      'div',
      {
        style: {
          width: 480,
          maxWidth: '90vw',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxSizing: 'border-box',
        },
      },
      // Header
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            paddingBottom: 12,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          tablerIcon('info-circle', { size: 22, color: 'var(--color-primary, #5F87FF)' }),
          h(
            'span',
            { style: { fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #FFFFFF)' } },
            '播放内容详情',
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: onClose,
            'aria-label': 'Close',
            style: {
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted, #8B95B0)',
              cursor: 'pointer',
              display: 'flex',
              padding: 4,
            },
          },
          tablerIcon('x', { size: 18 }),
        ),
      ),
      loading
        ? h(
            'div',
            {
              style: {
                padding: '36px 0',
                textAlign: 'center',
                color: 'var(--text-secondary, #8B95B0)',
                fontSize: 14,
              },
            },
            '正在读取音轨技术参数…',
          )
        : details
          ? h(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  maxHeight: '65vh',
                  overflowY: 'auto',
                  paddingRight: 4,
                },
              },
              // Section 1: Source & File
              h(
                'div',
                null,
                h(
                  'div',
                  {
                    style: {
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--color-primary, #5F87FF)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 6,
                    },
                  },
                  details.isLocal ? '本地音乐属性' : '歌曲源属性',
                ),
                renderRow('歌曲标题', details.title),
                renderRow('艺人', details.artist),
                details.album ? renderRow('唱片专辑', details.album) : null,
                renderRow('存储类型', details.isLocal ? '本地音乐文件' : '第三方网络音乐源'),
                details.isLocal
                  ? h(
                      'div',
                      null,
                      renderRow('文件名', details.fileName),
                      renderRow('文件路径', details.filePath, handleCopyPath, copiedPath),
                      renderRow('文件大小', details.fileSize),
                      renderRow('最后修改时间', details.modifiedTime),
                    )
                  : h(
                      'div',
                      null,
                      renderRow('第三方源 ID', details.sourceId),
                      renderRow('当前歌曲源 ID', details.sourceTrackId),
                    ),
              ),
              // Section 2: Audio Technical Specs
              h(
                'div',
                null,
                h(
                  'div',
                  {
                    style: {
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--color-primary, #5F87FF)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 6,
                    },
                  },
                  '音频规格与元数据',
                ),
                renderRow('曲目时长', details.duration),
                renderRow('采样率 (Sample Rate)', details.sampleRate),
                renderRow('声道数 (Channels)', details.channels),
                renderRow('比特率 (Bitrate)', details.bitrate),
                renderRow('编码格式 (Codec)', details.codec),
                renderRow('标签类型 (Tag Type)', details.tagType),
              ),
              // Section 3: Audio Output & WASAPI Specs
              h(
                'div',
                null,
                h(
                  'div',
                  {
                    style: {
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--color-primary, #5F87FF)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 6,
                    },
                  },
                  '音频输出终端 (Audio Output)',
                ),
                renderRow('输出音频设备', details.outputDevice),
                renderRow('输出驱动引擎', details.outputEngine),
                renderRow('DAC 硬件采样率', details.outputSampleRate),
                renderRow('硬件输出声道', details.outputChannels),
                renderRow('量化位深与格式', details.outputBitDepth),
                renderRow('PCM 输出带宽', details.outputBandwidth),
              ),
            )
          : null,
    ),
  )
}
