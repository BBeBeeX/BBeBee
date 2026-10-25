/**
 * LyricsPanel — the synchronized lyrics view for the mobile full-screen player.
 *
 * The phone-side twin of the desktop `plugin-lyrics-ui-desktop` panel, adapted
 * to the injected React Native primitives (no DOM, no `react-native` import —
 * the same seam every mobile view package builds on):
 *
 * - Auto-follow: the active line stays centred via `FlashList.scrollToIndex`.
 * - Active-line highlight with played / upcoming visual hierarchy.
 * - Tap-to-seek: a timed line seeks the transport to its timestamp.
 * - Manual-scroll pause: a touch that browses suspends auto-follow for a few
 *   seconds and offers a "back to current lyric" pill.
 * - Clean loading, error and empty states.
 *
 * All state comes from `@bbebbe/plugin-lyrics/hooks`; layout and gestures only.
 */

import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { formatDuration, type LyricLine } from '@BBeBee/toolkit'
import { Button, EmptyState, Text, nativePrimitives, useI18n, usePalette } from '@BBeBee/ui-kit-mobile'
import { tokens } from '@BBeBee/ui-tokens'
import { useActiveLyricIndex, useLyrics } from '@bbebee/plugin-lyrics/hooks'

/** How long a manual scroll pauses auto-follow before it resumes. Same as the desktop panel. */
const MANUAL_SCROLL_RESUME_MS = 5000

/**
 * The sliver of the real `FlashList` ref this panel drives. Declared here
 * rather than imported: the primitive arrives injected at boot, and the panel
 * must typecheck and test without a device.
 */
interface ScrollTarget {
  scrollToIndex(options: { index: number; animated?: boolean; viewPosition?: number }): void
}

export interface LyricsPanelProps {
  ctx: Context
}

/** One lyric row's typography: the active line carries the accent and the large size. */
function LyricLineText({ line, isActive, isPlayed, synced }: {
  line: LyricLine
  isActive: boolean
  isPlayed: boolean
  synced: boolean
}): ReactElement {
  const native = nativePrimitives()
  const p = usePalette()
  const color = !synced
    ? p.text.secondary
    : isActive
      ? p.accent.base
      : isPlayed
        ? p.text.disabled
        : p.text.secondary

  return h(
    native.Text as never,
    {
      allowFontScaling: true,
      style: {
        fontSize: synced && isActive ? tokens.font.size.lg : tokens.font.size.md,
        fontWeight: synced && isActive ? tokens.font.weight.bold : tokens.font.weight.regular,
        lineHeight:
          (synced && isActive ? tokens.font.size.lg : tokens.font.size.md) *
          tokens.font.lineHeight.normal,
        color,
      },
    },
    line.text,
  )
}

/** A synced row is tappable and seeks; an unsynced row is plain text. */
function LyricLineRow({ line, index, activeIndex, synced, onSeek }: {
  line: LyricLine
  index: number
  activeIndex: number
  synced: boolean
  onSeek: (line: LyricLine) => void
}): ReactElement {
  const native = nativePrimitives()
  const isActive = synced && index === activeIndex
  const isPlayed = synced && activeIndex !== -1 && index < activeIndex

  const text = h(LyricLineText, { line, isActive, isPlayed, synced })

  if (!synced || line.timeMs === undefined) {
    return h(
      native.View as never,
      { style: { paddingVertical: tokens.space[2], paddingHorizontal: tokens.space[2] } },
      text,
      line.translation
        ? h(Text, { variant: 'sm', tone: 'muted', children: line.translation })
        : null,
    )
  }

  return h(
    native.Pressable as never,
    {
      accessibilityRole: 'button',
      accessibilityLabel: `${line.text} (${formatDuration(line.timeMs)})`,
      accessibilityState: { selected: isActive },
      onPress: () => onSeek(line),
      style: { paddingVertical: tokens.space[2], paddingHorizontal: tokens.space[2] },
    },
    text,
    line.translation
      ? h(Text, { variant: 'sm', tone: 'muted', children: line.translation })
      : null,
  )
}

export function LyricsPanel({ ctx }: LyricsPanelProps): ReactElement {
  const native = nativePrimitives()
  const p = usePalette()
  const { t } = useI18n(ctx)
  const { status, trackUrn, parsed, error, offsetMs, supportsLyricSource, retry } = useLyrics(ctx)
  const activeIndex = useActiveLyricIndex(ctx, parsed.lines, offsetMs)

  // Manual scroll tracking. A drag suspends auto-follow; it resumes on its own
  // after a pause, or immediately from the floating pill.
  const [userScrolling, setUserScrolling] = useState(false)
  const userScrollingRef = useRef(false)
  userScrollingRef.current = userScrolling
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<ScrollTarget | null>(null)

  useEffect(() => {
    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current)
    }
  }, [])

  const follow = useCallback((index: number, animated: boolean) => {
    listRef.current?.scrollToIndex?.({ index: Math.max(0, index), animated, viewPosition: 0.5 })
  }, [])

  // A new track reads from the top again, and any manual browsing is over.
  useEffect(() => {
    setUserScrolling(false)
    if (resumeTimer.current) clearTimeout(resumeTimer.current)
    listRef.current?.scrollToIndex?.({ index: 0, animated: false, viewPosition: 0.5 })
  }, [trackUrn])

  // Auto-follow: keep the active line centred — skipped while the user browses.
  useEffect(() => {
    if (userScrolling) return
    follow(activeIndex >= 0 ? activeIndex : 0, true)
  }, [activeIndex, userScrolling, follow])

  const armResume = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => setUserScrolling(false), MANUAL_SCROLL_RESUME_MS)
  }, [])

  const beginManualScroll = useCallback(() => {
    setUserScrolling(true)
    armResume()
  }, [armResume])

  /** Momentum keeps the drag alive past the finger; each tail re-arms the timer. */
  const extendManualScroll = useCallback(() => {
    if (!userScrollingRef.current) return
    armResume()
  }, [armResume])

  /** Tap-to-seek — the same transport command the desktop panel calls. */
  const handleSeek = useCallback(
    (line: LyricLine) => {
      if (line.timeMs === undefined) return
      void ctx.player.seek(line.timeMs)
      setUserScrolling(false)
    },
    [ctx],
  )

  const hasLines = parsed.lines.length > 0
  const synced = parsed.synced

  const keyExtractor = useCallback(
    (line: LyricLine, index: number) => `${line.timeMs ?? 'untimed'}-${index}`,
    [],
  )
  const renderItem = useCallback(
    ({ item, index }: { item: LyricLine; index: number }) =>
      h(LyricLineRow, { line: item, index, activeIndex, synced, onSeek: handleSeek }),
    [activeIndex, synced, handleSeek],
  )

  /* ── state content ─────────────────────────────────────────────────────── */

  let content: ReactElement | null

  if (status === 'loading-lyrics' || status === 'loading-song') {
    content = h(
      native.View as never,
      { style: { alignItems: 'center', justifyContent: 'center', gap: tokens.space[3], padding: tokens.space[6], flex: 1 } },
      h(native.ActivityIndicator as never, { size: 'small', color: p.accent.base }),
      h(Text, { variant: 'sm', tone: 'muted', children: t('lyrics:lyrics.loadingLyrics') }),
    )
  } else if (status === 'error') {
    content = h(
      native.View as never,
      { style: { alignItems: 'center', justifyContent: 'center', gap: tokens.space[3], padding: tokens.space[6], flex: 1 } },
      h(Text, {
        variant: 'md',
        tone: 'error',
        children: error ?? t('lyrics:lyrics.failedToLoadLyrics'),
      }),
      h(Button, {
        variant: 'secondary',
        accessibilityLabel: t('app:common.retry'),
        onPress: () => void retry(),
        children: t('app:common.retry'),
      }),
    )
  } else if (status === 'idle' || status === 'no-lyrics' || (status === 'ready' && !hasLines)) {
    content = h(EmptyState, {
      icon: '🎵',
      testID: 'lyrics-panel-empty',
      title:
        status === 'idle'
          ? t('lyrics:lyrics.nothingPlaying')
          : supportsLyricSource === false
            ? t('lyrics:lyrics.externalSourcesNotEnabled')
            : t('lyrics:lyrics.noLyrics'),
      description:
        status === 'no-lyrics' && supportsLyricSource === false
          ? t('lyrics:lyrics.enableExternalSourceHint')
          : undefined,
      action:
        status === 'no-lyrics' && supportsLyricSource !== false
          ? h(Button, {
              variant: 'secondary',
              accessibilityLabel: t('lyrics:lyrics.searchLyricsAgain'),
              onPress: () => void retry(),
              children: t('lyrics:lyrics.searchLyricsAgain'),
            })
          : undefined,
    })
  } else {
    content = h(native.FlashList as never, {
      ref: listRef,
      testID: 'lyrics-panel-list',
      data: parsed.lines,
      keyExtractor,
      renderItem,
      onScrollBeginDrag: beginManualScroll,
      onScrollEndDrag: extendManualScroll,
      onMomentumScrollEnd: extendManualScroll,
      contentContainerStyle: { paddingVertical: tokens.space[7] },
    })
  }

  return h(
    native.View as never,
    {
      accessibilityLabel: t('lyrics:lyrics.lyricsPanel'),
      testID: 'lyrics-panel',
      style: { flex: 1, alignSelf: 'stretch' },
    },
    content,
    userScrolling && synced && activeIndex >= 0
      ? h(
          native.Pressable as never,
          {
            accessibilityRole: 'button',
            accessibilityLabel: t('lyrics:lyrics.backToCurrentLyric'),
            testID: 'lyrics-panel-back-to-current',
            onPress: () => {
              setUserScrolling(false)
              follow(activeIndex, true)
            },
            style: {
              position: 'absolute',
              bottom: tokens.space[4],
              alignSelf: 'center',
              paddingHorizontal: tokens.space[4],
              paddingVertical: tokens.space[2],
              borderRadius: tokens.radius.pill,
              backgroundColor: p.bg.overlay,
              borderWidth: 1,
              borderColor: p.border.subtle,
            },
          },
          h(
            native.Text as never,
            {
              allowFontScaling: true,
              style: {
                fontSize: tokens.font.size.sm,
                fontWeight: tokens.font.weight.medium,
                lineHeight: tokens.font.size.sm * tokens.font.lineHeight.normal,
                color: p.text.primary,
              },
            },
            t('lyrics:lyrics.backToCurrentLyric'),
          ),
        )
      : null,
  )
}
