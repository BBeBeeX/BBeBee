import { tablerIcon } from '@BBeBee/ui-kit-desktop'
import { createElement as h } from 'react'
import type { ReactElement, ReactNode } from 'react'

export interface SettingsRowProps {
  title: string
  description?: string
  action?: ReactNode
  isNested?: boolean
  expandable?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  children?: ReactNode
  borderBottom?: boolean
}

export function SettingsRow({
  title,
  description,
  action,
  isNested = false,
  expandable = false,
  expanded = false,
  onToggleExpand,
  children,
  borderBottom = true,
}: SettingsRowProps): ReactElement {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        borderBottom: borderBottom ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
      },
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isNested ? '12px 16px 12px 28px' : '14px 4px',
          gap: 16,
          background: isNested ? 'rgba(255, 255, 255, 0.015)' : 'transparent',
          borderLeft: isNested ? '2px solid rgba(255, 255, 255, 0.15)' : 'none',
          transition: 'background-color 0.15s ease',
        },
      },
      // Left side: Chevron (if expandable) + Title + Description
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flex: 1,
            minWidth: 0,
          },
        },
        expandable
          ? h(
              'button',
              {
                type: 'button',
                'aria-label': expanded ? `收起 ${title}` : `展开 ${title}`,
                onClick: onToggleExpand,
                style: {
                  background: 'none',
                  border: 'none',
                  padding: 2,
                  cursor: 'pointer',
                  color: '#8E8E93',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  outline: 'none',
                  transition: 'transform 0.15s ease, color 0.15s ease',
                },
                onMouseEnter: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.color = '#FFFFFF'
                },
                onMouseLeave: (e: { currentTarget: HTMLElement }) => {
                  e.currentTarget.style.color = '#8E8E93'
                },
              },
              tablerIcon('chevron-right', {
                size: 18,
                style: {
                  transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease',
                },
              }),
            )
          : null,
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h(
            'div',
            {
              style: {
                fontSize: 13,
                fontWeight: 500,
                color: '#F5F5F7',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              },
            },
            title,
          ),
          description
            ? h(
                'div',
                {
                  style: {
                    fontSize: 12,
                    color: '#8E8E93',
                    marginTop: 3,
                    lineHeight: 1.45,
                  },
                },
                description,
              )
            : null,
        ),
      ),
      // Right side: Control action
      action
        ? h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              },
            },
            action,
          )
        : null,
    ),
    // Expandable nested children
    expandable && expanded && children
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              background: 'rgba(0, 0, 0, 0.15)',
            },
          },
          children,
        )
      : null,
  )
}
