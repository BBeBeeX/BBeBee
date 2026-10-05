import { createElement as h, useCallback, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Track } from '@BBeBee/protocol'
import { useTrackDetails } from '@BBeBee/plugin-now-playing/hooks'
import { Sheet, tablerIcon } from '@BBeBee/ui-kit-desktop'

export interface TrackInfoModalProps {
  ctx: Context
  track: Track | null
  open: boolean
  onClose: () => void
}

export function TrackInfoModal({
  ctx,
  track,
  open,
  onClose,
}: TrackInfoModalProps): ReactElement | null {
  // The aggregation — db bindings, fs stat, codec metadata, stream and output
  // specs — lives in the headless feature (`resolveTrackDetails`); this modal
  // only renders the rows it returns.
  const { details, loading } = useTrackDetails(ctx, track, open)
  const [copiedPath, setCopiedPath] = useState(false)

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
