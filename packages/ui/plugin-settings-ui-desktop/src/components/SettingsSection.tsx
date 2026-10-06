import { createElement as h } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'

export interface SettingsSectionProps {
  id?: string
  title: string
  description?: string
  children?: ReactNode
  style?: CSSProperties
}

export function SettingsSection({
  id,
  title,
  description,
  children,
  style,
}: SettingsSectionProps): ReactElement {
  return h(
    'section',
    {
      id,
      style: {
        display: 'flex',
        flexDirection: 'column',
        marginBottom: 48,
        scrollMarginTop: 24,
        ...style,
      },
    },
    h(
      'header',
      {
        style: {
          paddingBottom: 4,
          marginBottom: 2,
        },
      },
      h(
        'h3',
        {
          style: {
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--bb-text-primary, #FFFFFF)',
            margin: 0,
            letterSpacing: '-0.01em',
          },
        },
        title,
      ),
      description
        ? h(
            'p',
            {
              style: {
                fontSize: 12,
                color: '#8E8E93',
                margin: '3px 0 0',
                lineHeight: 1.4,
              },
            },
            description,
          )
        : null,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 10,
          padding: '2px 18px',
          marginTop: 8,
        },
      },
      children,
    ),
  )
}
