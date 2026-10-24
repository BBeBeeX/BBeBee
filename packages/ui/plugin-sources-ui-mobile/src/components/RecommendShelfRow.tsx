/**
 * A recommendation shelf: a title, an optional header action ("show all"),
 * and a horizontally scrolling card strip.
 *
 * The mobile twin of the desktop `RecommendShelfRow` under the same props
 * contract — same status/error/retry/configure states, same card zones —
 * minus the desktop-only chrome: the bent-ends 3D carousel, hover arrows and
 * hover-revealed action are pointer affordances with no meaning under a
 * thumb. Horizontal scrolling here is the injected FlashList laid on its
 * side, which recycles off-screen cards exactly as the vertical lists do.
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import type { BrowseEntry } from '@BBeBee/protocol'
import { Button, Text, nativePrimitives, useI18n } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { RecommendCard } from './RecommendCard.js'

export interface RecommendShelfRowProps {
  ctx: Context
  title: string
  action?: {
    label: string
    onPress: () => void
    testID?: string
  }
  entries: readonly BrowseEntry[]
  onOpenCard: (entry: BrowseEntry) => void
  /** Play action for a card's chip; card presses still open (see RecommendCard). */
  onPlayCard?: (entry: BrowseEntry) => void
  testID?: string
  status?: 'idle' | 'loading' | 'ready' | 'error'
  errorMessage?: string
  onRetry?: () => void
  onConfigure?: () => void
}

export function RecommendShelfRow({
  ctx,
  title,
  action,
  entries,
  onOpenCard,
  onPlayCard,
  testID,
  status = 'idle',
  errorMessage,
  onRetry,
  onConfigure,
}: RecommendShelfRowProps): ReactElement {
  const native = nativePrimitives()
  const { t } = useI18n(ctx)

  return h(
    native.View as never,
    {
      accessibilityLabel: title,
      testID,
      style: { gap: tokens.space[3] },
    },
    h(
      native.View as never,
      { style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } },
      h(Text, { variant: 'lg', numberOfLines: 1, children: title }),
      action
        ? h(Button, {
            variant: 'ghost',
            onPress: action.onPress,
            testID: action.testID,
            children: action.label,
          })
        : null,
    ),
    status === 'loading'
      ? h(Text, { variant: 'sm', tone: 'muted', children: t('sources:source.loading') })
      : status === 'error'
        ? h(
            native.View as never,
            { style: { gap: tokens.space[2] } },
            h(
              Text,
              { variant: 'sm', tone: 'error' },
              t('sources:source.failedToLoad', { message: errorMessage ?? '' }),
            ),
            h(
              native.View as never,
              { style: { flexDirection: 'row', gap: tokens.space[3] } },
              onRetry
                ? h(Button, {
                    variant: 'ghost',
                    onPress: onRetry,
                    testID: 'recommend-retry',
                    children: t('app:common.retry'),
                  })
                : null,
              onConfigure
                ? h(Button, {
                    variant: 'ghost',
                    onPress: onConfigure,
                    testID: 'recommend-configure',
                    children: t('sources:sourcesList.configure'),
                  })
                : null,
            ),
          )
        : h(
            native.FlashList as never,
            {
              horizontal: true,
              showsHorizontalScrollIndicator: false,
              data: entries,
              keyExtractor: (entry: BrowseEntry) => entry.id,
              renderItem: ({ item }: { item: BrowseEntry }) =>
                h(RecommendCard, {
                  ctx,
                  entry: item,
                  onPress: onOpenCard,
                  onPlay: onPlayCard,
                }),
              style: { flexGrow: 0 },
              contentContainerStyle: { gap: tokens.space[3] },
            },
          ),
  )
}
