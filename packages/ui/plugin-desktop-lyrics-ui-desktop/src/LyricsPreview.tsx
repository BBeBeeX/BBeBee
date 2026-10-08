/**
 * Interactive live preview component for Desktop Lyrics configuration.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { DesktopLyricsSettings } from '@BBeBee/protocol'

export interface LyricsPreviewProps {
  settings: DesktopLyricsSettings
}

export function LyricsPreview({ settings }: LyricsPreviewProps): ReactElement {
  const {
    lineMode = 'double',
    align = 'center',
    fontFamily = 'system-ui',
    fontSize = 24,
    textColor = '#FFFFFF',
    opacity = 0.92,
  } = settings

  return h(
    'div',
    {
      'data-testid': 'desktop-lyrics-preview',
      style: {
        marginTop: 16,
        padding: '24px 28px',
        borderRadius: 12,
        background: 'var(--lyrics-preview-bg, linear-gradient(135deg, rgba(30, 30, 40, 0.7) 0%, rgba(15, 15, 20, 0.85) 100%))',
        border: '1px solid var(--lyrics-preview-border, rgba(255, 255, 255, 0.1))',
        boxShadow: 'var(--settings-card-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 24px rgba(0, 0, 0, 0.4))',
        position: 'relative',
        overflow: 'hidden',
      },
    },
    // Watermark / Badge
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
          paddingBottom: 10,
        },
      },
      h(
        'span',
        {
          style: {
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: '#8E8E93',
            fontWeight: 600,
          },
        },
        '桌面歌词实时预览效果',
      ),
      h(
        'span',
        {
          style: {
            fontSize: 11,
            color: 'var(--color-primary, #5F87FF)',
            background: 'var(--surface-selected, rgba(95, 135, 255, 0.15))',
            padding: '2px 8px',
            borderRadius: 999,
          },
        },
        `${lineMode === 'double' ? '双行' : '单行'} · ${fontSize}px · ${Math.round(opacity * 100)}%透明度`,
      ),
    ),
    // Floating lyrics container simulation
    h(
      'div',
      {
        style: {
          padding: '16px 20px',
          borderRadius: 8,
          background: 'var(--lyrics-preview-window-bg, rgba(0, 0, 0, 0.45))',
          backdropFilter: 'blur(8px)',
          textAlign: align,
          transition: 'all 0.2s ease',
        },
      },
      // Line 1 (Current playing line)
      h(
        'div',
        {
          style: {
            fontFamily,
            fontSize,
            lineHeight: 1.4,
            fontWeight: 700,
            color: textColor,
            opacity,
            textShadow: '0 2px 8px rgba(0, 0, 0, 0.8), 0 0 1px rgba(0,0,0,0.9)',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        },
        '♪ 哪怕生命如尘 也要绚烂如火',
      ),
      // Line 2 (Next line, shown only in double mode)
      lineMode === 'double'
        ? h(
            'div',
            {
              style: {
                fontFamily,
                fontSize: Math.round(fontSize * 0.82),
                lineHeight: 1.4,
                fontWeight: 500,
                color: textColor,
                opacity: Math.max(0.2, opacity * 0.65),
                marginTop: 6,
                textShadow: '0 2px 6px rgba(0, 0, 0, 0.7)',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            },
            '♫ 让热爱冲破现实的重重枷锁',
          )
        : null,
    ),
  )
}
