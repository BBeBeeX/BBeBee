import { createElement as h } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { HoverLabel } from './HoverLabel.js'

export interface DetailHeroProps {
  /** The small uppercase category line above the title (歌单 / 专辑 / 本地音乐). */
  eyebrow: string
  title: string
  /** Title font size; pages with long names compute their own (default 56). */
  titleSize?: number
  /** Makes the title clickable (the playlist's click-to-edit). */
  onTitleClick?: () => void
  /** A plain one-line subtitle under the title (本地/收藏 pages). */
  subtitle?: string
  /** An optional free-form description paragraph (the playlist's description). */
  description?: ReactNode
  /** The meta row under the title — avatar + owner + counts (歌单/专辑 pages). */
  meta?: ReactNode
  /** Left cover slot (collage/artwork); presence switches the layout to a row. */
  cover?: ReactNode
  testID?: string
}

/**
 * The detail page's hero.
 *
 * Without a cover it stacks eyebrow / title / subtitle in a column; with a
 * cover slot it becomes a row aligned to the bottom, cover left. The title
 * line-clamps at two lines — a long album or playlist name truncates instead
 * of breaking the layout — and resting the pointer on it for 2s floats a
 * label with the full name.
 */
export function DetailHero(props: DetailHeroProps): ReactElement {
  const hasCover = props.cover !== undefined && props.cover !== null
  const titleStyle: CSSProperties = {
    fontSize: props.titleSize ?? 56,
    fontWeight: 900,
    margin: '2px 0 6px 0',
    lineHeight: 1.1,
    color: 'var(--bb-text-primary, #FFFFFF)',
    letterSpacing: '-0.03em',
    wordBreak: 'break-word',
    // 超长标题最多两行，超出省略——不撑破布局。
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
    ...(props.onTitleClick ? { cursor: 'pointer' } : {}),
  }
  return h(
    'header',
    {
      'data-testid': props.testID,
      style: {
        display: 'flex',
        flexDirection: hasCover ? 'row' : 'column',
        gap: hasCover ? 24 : 6,
        padding: hasCover ? '36px 32px 24px 32px' : '36px 32px 18px 32px',
        alignItems: hasCover ? 'flex-end' : undefined,
        flexShrink: 0,
      },
    },
    hasCover ? h('div', { style: { flexShrink: 0, minWidth: 0 } }, props.cover) : null,
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          minWidth: 0,
          flex: hasCover ? 1 : undefined,
        },
      },
      h(
        'span',
        {
          style: {
            fontSize: 13,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--bb-text-secondary, #FFFFFF)',
          },
        },
        props.eyebrow,
      ),
      h(
        HoverLabel,
        { label: props.title, style: { display: 'block' } },
        h(
          'h1',
          {
            onClick: props.onTitleClick,
            style: titleStyle,
          },
          props.title,
        ),
      ),
      props.description
        ? h('p', { style: { margin: '0 0 4px 0', fontSize: 14, color: 'var(--bb-text-secondary, #b3b3b3)' } }, props.description)
        : null,
      props.subtitle
        ? h('p', { style: { margin: 0, fontSize: 14, color: 'var(--bb-text-secondary, #b3b3b3)' } }, props.subtitle)
        : null,
      props.meta ?? null,
    ),
  )
}
