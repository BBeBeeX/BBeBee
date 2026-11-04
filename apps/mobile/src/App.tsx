/**
 * The mobile shell.
 *
 * Renders contributed views behind a fixed four-tab bar — a product decision,
 * not a registry read: tabs are the four places people go on purpose, in an
 * order chosen for them, so a plugin adding a route must not reshuffle the
 * bottom of someone's screen. Everything above the tab bar (views, the
 * now-playing bar, toasts) is still contributed and discovered through
 * `ctx.ui`.
 */

import { createElement as h, useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
/*
 * ⚠️ `react-native-safe-area-context`, not React Native's own `SafeAreaView`.
 *
 * RN's is deprecated and warns on every launch: "SafeAreaView has been
 * deprecated and will be removed in a future release." It also only ever
 * worked on iOS, so the Android notch was never accounted for.
 *
 * This is a native module, so it needs a dev-client rebuild — which docs/11
 * §4.13 already expects for M1, and which FlashList requires anyway.
 */
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Context } from 'cordis'
import type {
  HapticsService,
  LifecycleService,
  QuickActionsService,
  SettingsService,
  StoreService,
  UiService,
} from '@BBeBee/protocol'
import { resolveMobileLiquidGlassSettings } from '@BBeBee/protocol'
import { serviceOf, useServiceState } from '@BBeBee/ui-core'
import { useI18n, usePalette, getScheme, GlassSurface, Sheet, Toast, tablerIcon } from '@BBeBee/ui-kit-mobile'
import { usePlayHistoryHeatmap } from '@bbebee/plugin-player/hooks'
// The stats page's heatmap chart, reused here for the drawer's three-month
// slice — one chart, one colour scale, two homes (docs/ui/architecture.md §7.4).
import { PlayHeatmap } from '@bbebee/plugin-history-ui-mobile'
import { renderBootErrorMessage } from './boot-error'
import { boot } from './boot'
import {
  MOBILE_LAYOUT_MODE_KEY,
  isMobileLayoutMode,
  resolveMobileLayout,
  type MobileLayoutMode,
} from './layout'
import {
  appearanceModeLabelKey,
  isAppearanceMode,
  nextAppearanceMode,
} from './appearance'
import { NavDrawerOverlay, collectDrawerPages, DRAWER_EXCLUDED_ROUTES } from './nav-drawer'
import { DEFERRED_PLUGIN_IDS } from './plugins'
// The brand mark on the tablet rail — the existing app icon, reused rather
// than a second asset shipped for one layout.
import brandIcon from '../assets/icon.png'

/**
 * The idle gate for the deferred plugin pass, mirroring desktop's
 * `main.tsx`: run when the platform yields, or 200 ms in — whichever the
 * runtime offers. Hermes carries no `requestIdleCallback`, so the timeout is
 * the branch a phone actually takes.
 */
function scheduleIdle(cb: () => void): void {
  const idle = (globalThis as {
    requestIdleCallback?: (callback: () => void) => void
  }).requestIdleCallback
  if (typeof idle === 'function') {
    idle.call(globalThis, cb)
  } else {
    setTimeout(cb, 200)
  }
}

/**
 * Load the deferred plugins after the first frame — the mobile mirror of the
 * desktop renderer's post-render idle pass. `boot()` starts the shell on
 * `INITIAL_ENABLED`; everything in `DEFERRED_PLUGIN_IDS` rides in here. A
 * plugin the user disabled stays off, read from plugin-manager's merged
 * view (`registerManifests` in `boot.ts` is what makes that list non-empty);
 * an individual failure is logged and skipped, never fatal.
 */
async function loadDeferredPlugins(app: Awaited<ReturnType<typeof boot>>, ctx: Context): Promise<void> {
  for (const id of DEFERRED_PLUGIN_IDS) {
    const pm = (
      app.ctx as unknown as {
        'plugin-manager'?: { list(): readonly { id: string; enabled: boolean }[] }
      }
    )['plugin-manager']
    if (pm) {
      const item = pm.list().find((p) => p.id === id)
      if (item && item.enabled === false) {
        continue
      }
    }
    try {
      await app.loadPlugin(id)
    } catch (error) {
      ctx.logger?.warn?.(`deferred plugin ${id} failed to load: ${String(error)}`)
    }
  }
}

/** What the tab bar can navigate to: a route id, its i18n title key, and its glyph. */
interface Tab {
  id: string
  titleKey: string
  /**
   * The icon above the label — Apple-Music chrome style puts a glyph over a
   * 10pt label per tab. The Tabler geometry (`tabler`) renders through
   * react-native-svg when the shell wired it; the unicode `icon` stays as the
   * fallback for that seam, and as the test host's answer.
   */
  icon: string
  tabler: string
}

/**
 * The four tabs, in the order the product fixed them — deliberately not
 * derived from `ctx.ui.routes` (whose `placement: ['tab-bar']` filter produced
 * an alphabetical, plugin-dependent set) and not from settings-page
 * contributions either.
 *
 * Titles come from i18n, not from each route's `title`: the contributed title
 * is the *route's* English name ("Recommend"), while the tab is the *place*
 * ("首页") — different words for different jobs, and only one of them should
 * follow the user's locale.
 */
const TABS: readonly Tab[] = [
  { id: 'sources.recommend', titleKey: 'app:common.app.tabs.home', icon: '⌂', tabler: 'home' },
  { id: 'library.home', titleKey: 'app:common.app.tabs.library', icon: '♫', tabler: 'books' },
  { id: 'settings.view', titleKey: 'app:common.app.tabs.settings', icon: '⚙︎', tabler: 'settings' },
  { id: 'sources.search', titleKey: 'app:common.app.tabs.search', icon: '⌕', tabler: 'search' },
]

const MAIN_TABS: readonly Tab[] = TABS.slice(0, 3)
const SEARCH_TAB: Tab = TABS[3]!

/**
 * Header titles for the detail routes the shell can push. The shell's own
 * chrome strings — the headless route contributions carry English literals
 * ('All recommendations'), and the header must speak the user's locale. A
 * route outside this map falls back to its contributed title.
 */
const DETAIL_TITLES: Readonly<Record<string, string>> = {
  'album.view': 'app:common.app.routeTitles.album',
  'library.playlist': 'app:common.app.routeTitles.playlist',
  'library.collection': 'app:common.app.routeTitles.collection',
  'library.favorites': 'app:common.app.routeTitles.favorites',
  'library.local': 'app:common.app.routeTitles.local',
  'library.profile': 'app:common.app.routeTitles.profile',
  'sources.settings': 'app:common.app.routeTitles.sources',
  'sources.import': 'app:common.app.routeTitles.import',
  'sources.test': 'app:common.app.routeTitles.sourceTest',
  'sources.recommend.all': 'app:common.app.routeTitles.recommendAll',
  'history.view': 'app:common.app.routeTitles.history',
  'scanner.settings': 'app:common.app.routeTitles.scannerSettings',
  'settings.appearance': 'settings:mobile.sectionAppearance',
  'settings.playback': 'settings:mobile.sectionPlayback',
  'settings.network': 'settings:settings.networkProxy',
  'settings.sources': 'settings:mobile.sectionSources',
  'settings.storage': 'settings:mobile.sectionStorage',
  'settings.about': 'settings:mobile.sectionAbout',
  'debug.view': 'settings:debug.title',
  'debug.logs': 'settings:logs.title',
  'debug.http-logs': 'settings:httpLogs.title',
  'debug.theme-palette': 'settings:debug.themeVariablePaletteThemePalette',
  'plugin-manager.screen': 'settings:settings.plugins',
  'audio-converter.view': 'converter:index.title',
  'dsp.view': 'dsp:dsp.audioEffectsEqualizerDSP',
}

/**
 * The foldable left pane is fixed to the library — the pane is a browsing
 * surface, not a mirror of the tabs, so its stack's root never moves.
 */
const LEFT_PANE_ROOT = 'library.home'

interface HistoryItem {
  id: string
  params?: Record<string, unknown>
}

/**
 * Bump a counter on every `ui/changed` so the shell re-renders.
 *
 * The tab list is fixed, but what a tab *renders* is not: `ctx.ui.viewFor()`
 * is read during render, and views can register after the shell mounted — a
 * plugin loading late (the P1 recommend view, say) must appear without a
 * restart. The counter also drives the layout-mode re-read: every writer of
 * `mobile.layoutMode` emits `ui/changed` after the store write, which is what
 * makes the Settings row apply live instead of on next launch.
 */
function useUiChangedTick(ctx: Context): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const off = ctx.on('ui/changed', () => setTick((t) => t + 1))
    return () => void off()
  }, [ctx])
  return tick
}

/* ── the left navigation drawer (docs/ui/architecture.md §7.4) ─────────── */

/**
 * The display-mode button at the drawer header's right: cycles
 * dark → light → auto and shows the mode it is in. The write goes through
 * the settings service — the same `AppSettings.theme` field the palette
 * drive reads and repaints from — so this button carries no palette logic
 * of its own, and auto ("跟随系统") follows the system scheme because the
 * drive resolves it natively.
 */
function DisplayModeButton({ ctx }: { ctx: Context }) {
  const { t } = useI18n(ctx)
  const palette = usePalette()
  const mode = useServiceState(ctx, ['settings/changed'], () => {
    const theme = serviceOf<SettingsService>(ctx, 'settings')?.getSync().theme
    return isAppearanceMode(theme) ? theme : 'dark'
  })
  return h(
    Pressable,
    {
      accessibilityRole: 'button',
      accessibilityLabel: t('theme:themeManagement.appearanceMode'),
      testID: 'drawer-display-mode',
      onPress: () => {
        void serviceOf<SettingsService>(ctx, 'settings')
          ?.update({ theme: nextAppearanceMode(mode) })
          .catch(() => {})
      },
      style: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 999,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
      },
    },
    h(Text, { style: { color: palette.text.primary, fontSize: 13 } }, t(appearanceModeLabelKey(mode))),
  )
}

/**
 * The drawer's body, top to bottom: the logo with the display-mode button on
 * its right, the stats page's play-count heatmap for the most recent three
 * months, then the page list the registration API reports: every contributed
 * route with a view registered on this shell, in contribution order — the
 * shell curates nothing. A tap navigates (and the shell closes the drawer).
 */
function NavDrawerContents({ ctx, currentPageId, translate, onSelectPage }: {
  ctx: Context
  currentPageId: string | undefined
  /** The shell's title resolution: tab place-names and chrome keys, then the contribution's own. */
  translate: (id: string, contributed: string) => string
  onSelectPage: (id: string) => void
}) {
  const { t } = useI18n(ctx)
  const palette = usePalette()
  // Three months only — the stats page mounts the same chart with a year.
  const { heatmap, loading } = usePlayHistoryHeatmap(ctx, 90)
  // Live re-read on `ui/changed`: a view registering late (the deferred
  // plugin pass) joins the list without a restart.
  const pages = useServiceState(
    ctx,
    ['ui/changed'],
    () => {
      const ui = serviceOf<UiService>(ctx, 'ui')
      return collectDrawerPages(
        ui?.routes ?? [],
        (id) => Boolean(ui?.viewFor?.(id)),
        translate,
        DRAWER_EXCLUDED_ROUTES,
      )
    },
    {
      isEqual: (a, b) =>
        a.length === b.length && a.every((page, i) => page.id === b[i]?.id && page.title === b[i]?.title),
    },
  )

  return h(
    View,
    { style: { flex: 1 } },
    h(
      View,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 8,
        },
      },
      h(Image, { source: brandIcon, style: { width: 28, height: 28, borderRadius: 6 } }),
      h(View, { style: { flex: 1 } }),
      h(DisplayModeButton, { ctx }),
    ),
    h(
      ScrollView,
      { style: { flex: 1 }, contentContainerStyle: { paddingBottom: 60 } },
      h(
        Pressable,
        {
          onPress: () => onSelectPage('history.view'),
          accessibilityRole: 'button',
          accessibilityLabel: t('history:history.playHistory'),
          style: { paddingHorizontal: 12 },
        },
        loading
          ? null
          : heatmap.length > 0
            ? // The bare edition: grid only — no title, weekday labels, or
              // legend; the drawer's surface already says what this is.
              h(PlayHeatmap, { heatmap, t, variant: 'bare' })
            : h(
                Text,
                { style: { color: palette.text.secondary, fontSize: 13, paddingVertical: 8 } },
                t('history:index.noPlayRecordsYet'),
              ),
      ),
      ...pages.map((page) => {
        const isSelected = page.id === currentPageId
        return h(
          Pressable,
          {
            key: page.id,
            onPress: () => onSelectPage(page.id),
            accessibilityRole: 'tab',
            accessibilityLabel: page.title,
            accessibilityState: { selected: isSelected },
            testID: `nav-drawer-page-${page.id}`,
            style: { paddingVertical: 12, paddingHorizontal: 20 },
          },
          h(
            Text,
            {
              numberOfLines: 1,
              style: {
                color: isSelected ? palette.text.primary : palette.text.secondary,
                fontWeight: isSelected ? '600' : '400',
                fontSize: 15,
              },
            },
            page.title,
          ),
        )
      }),
    ),
  )
}

/**
 * iOS 26 Apple Music animated tab bar item:
 * Features tactile spring bounce on press (`scale: 0.92`), selection haptic feedback,
 * active accent glow, and long-press deep glass highlight ring.
 */
function AnimatedTabButton({
  tab,
  isSelected,
  palette,
  isLight,
  t,
  ctx,
  onPress,
}: {
  tab: Tab
  isSelected: boolean
  palette: ReturnType<typeof usePalette>
  isLight: boolean
  t: (key: string) => string
  ctx: Context
  onPress: () => void
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current
  const [isLongPressed, setIsLongPressed] = useState(false)
  const tabTitle = t(tab.titleKey)
  const tint = isSelected ? palette.accent.base : palette.text.secondary

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.92,
      useNativeDriver: false,
      friction: 7,
      tension: 100,
    }).start()
  }

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: false,
      friction: 6,
      tension: 80,
    }).start()
    setIsLongPressed(false)
  }

  const handleLongPress = () => {
    setIsLongPressed(true)
    serviceOf<HapticsService>(ctx, 'haptics')?.impact?.('medium')
  }

  return h(
    Animated.View,
    {
      style: {
        flex: 1,
        alignItems: 'center',
        transform: [{ scale: scaleAnim }],
      },
    },
    h(
      Pressable,
      {
        key: tab.id,
        onPress: () => {
          serviceOf<HapticsService>(ctx, 'haptics')?.selection?.()
          onPress()
        },
        onPressIn: handlePressIn,
        onPressOut: handlePressOut,
        onLongPress: handleLongPress,
        accessibilityRole: 'tab',
        accessibilityLabel: tabTitle,
        accessibilityState: { selected: isSelected },
        testID: `tab-${tab.id}`,
        style: [
          {
            alignItems: 'center',
            paddingTop: 6,
            paddingBottom: 8,
            width: '100%',
            gap: 1,
            borderRadius: 16,
          },
          isLongPressed && {
            backgroundColor: isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.14)',
          },
        ],
      },
      tablerIcon(tab.tabler, { size: 24, color: tint }) ??
        h(Text, { style: { color: tint, fontSize: 22, lineHeight: 26 } }, tab.icon),
      h(
        Text,
        {
          numberOfLines: 1,
          style: {
            color: tint,
            fontSize: 10,
            fontWeight: isSelected ? '600' : '400',
            letterSpacing: -0.2,
          },
        },
        tabTitle,
      ),
    ),
  )
}

function Shell({ ctx }: { ctx: Context }) {
  const { t } = useI18n(ctx)
  /*
   * The status-bar inset, for the surfaces that escape the SafeAreaView's
   * padding: absolutely positioned overlays (the drawer, the fullscreen
   * player) position against the window edge, not the padded box, so they
   * have to carry the inset themselves.
   */
  const insets = useSafeAreaInsets()
  /*
   * The shell paints from the same palette the kit's components read. Every
   * colour below comes off this object — a hardcoded hex here would outlive
   * a theme switch and paint the chrome in a scheme the screens no longer
   * speak. The hook is what makes the repaint happen: it subscribes to the
   * palette store, so a theme (or scheme) change re-renders the shell and
   * everything it renders with it.
   */
  const palette = usePalette()
  // Liquid Glass settings for the tab bar, resolved on every settings
  // change. `GlassSurface` decides which tier renders (liquid > blur >
  // translucent); the shell only hands it the resolved values.
  const liquidGlass = useServiceState(ctx, ['settings/changed'], () =>
    resolveMobileLiquidGlassSettings(
      serviceOf<SettingsService>(ctx, 'settings')?.getSync().liquidGlass,
    ),
  )
  const uiTick = useUiChangedTick(ctx)
  const defaultTab = TABS[0]
  /*
   * The queue drawer's open state. Shell-owned by design: the drawer layers
   * above the fullscreen player (Android Back closes it first, and reopening
   * the drawer while the player is up must not disturb either surface), so
   * no single page or bar can own it without reaching across the others.
   */
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  /*
   * The left navigation drawer's open state — shell-owned for the same
   * reason the queue drawer's is: it overlays pages and panes alike (on a
   * foldable it covers the left pane, not the right), and Back must close it
   * before any stack pops. The hamburger that opens it lives in the main
   * header, so only the shell can reach every trigger.
   */
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  /*
   * The user's persisted layout choice, read from `ctx.store` on mount and
   * re-read on every `ui/changed` (the signal every writer of the key emits
   * — the shell's own buttons and the Settings row both). `ctx.store` on this
   * context is the root store: namespacing is opt-in per plugin, so the key
   * the Settings row writes and the key read here are one and the same.
   */
  const [layoutMode, setLayoutModeState] = useState<MobileLayoutMode>('auto')
  useEffect(() => {
    let cancelled = false
    void serviceOf<StoreService>(ctx, 'store')
      ?.get<MobileLayoutMode>(MOBILE_LAYOUT_MODE_KEY)
      .then((stored) => {
        if (!cancelled && isMobileLayoutMode(stored)) setLayoutModeState(stored)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ctx, uiTick])
  const setLayoutMode = useCallback(
    (mode: MobileLayoutMode) => {
      setLayoutModeState(mode)
      void serviceOf<StoreService>(ctx, 'store')
        ?.set(MOBILE_LAYOUT_MODE_KEY, mode)
        .then(() => {
          ctx.emit('ui/changed')
        })
        .catch(() => {})
    },
    [ctx],
  )

  /*
   * Window classification. `useWindowDimensions` is a shell-only API: a view
   * package reading the window directly would fork its layout from the
   * shell's and the two would disagree on rotation — views receive the
   * resolved layout from above instead. The tablet branch is geometric
   * (wide, landscape, tall); the foldable branch is the explicit user choice
   * only, never inferred from width, and folding the device (width < 600)
   * silently returns to the phone layout while the choice itself survives.
   */
  const { width, height } = useWindowDimensions()
  const layout = resolveMobileLayout({ width, height, layoutMode })

  /* ── iOS 26 Apple Music animated sheets & scroll-linked morphing ────────── */

  const [isFullscreenNowPlaying, setIsFullscreenNowPlayingState] = useState(false)
  const [isSheetMounted, setIsSheetMounted] = useState(false)
  const sheetAnim = useRef(new Animated.Value(height || 800)).current

  const openFullscreenNowPlaying = useCallback(() => {
    setIsFullscreenNowPlayingState(true)
    setIsSheetMounted(true)
    sheetAnim.setValue(height || 800)
    Animated.spring(sheetAnim, {
      toValue: 0,
      useNativeDriver: false,
      friction: 9,
      tension: 65,
    }).start()
  }, [height, sheetAnim])

  const closeFullscreenNowPlaying = useCallback(() => {
    Animated.timing(sheetAnim, {
      toValue: height || 800,
      duration: 250,
      useNativeDriver: false,
    }).start(() => {
      setIsFullscreenNowPlayingState(false)
      setIsSheetMounted(false)
    })
  }, [height, sheetAnim])

  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 10,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          sheetAnim.setValue(gestureState.dy)
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 100 || gestureState.vy > 0.5) {
          closeFullscreenNowPlaying()
        } else {
          Animated.spring(sheetAnim, {
            toValue: 0,
            useNativeDriver: false,
            friction: 9,
            tension: 65,
          }).start()
        }
      },
    }),
  ).current

  const collapseAnim = useRef(new Animated.Value(0)).current // 0 = expanded (Phase A), 1 = collapsed (Phase C)
  const [isCollapsed, setIsCollapsed] = useState(false)
  useEffect(() => {
    const id = collapseAnim.addListener(({ value }) => {
      setIsCollapsed(value > 0.35)
    })
    return () => collapseAnim.removeListener(id)
  }, [collapseAnim])

  const isDraggingPage = useRef(false)
  const touchStartY = useRef(0)

  const handlePageTouchStart = (e: { nativeEvent?: { pageY?: number } }) => {
    touchStartY.current = e.nativeEvent?.pageY ?? 0
    isDraggingPage.current = true
  }

  const handlePageTouchMove = (e: { nativeEvent?: { pageY?: number } }) => {
    if (!isDraggingPage.current) return
    const currentY = e.nativeEvent?.pageY ?? 0
    const dy = currentY - touchStartY.current
    // User scrolling down into content (finger moves up) -> collapse Tab Bar to compact button & lower Mini Player
    if (dy < -20 && !isCollapsed) {
      serviceOf<HapticsService>(ctx, 'haptics')?.selection?.()
      Animated.spring(collapseAnim, {
        toValue: 1,
        useNativeDriver: false,
        friction: 8,
        tension: 60,
      }).start()
      touchStartY.current = currentY
    }
    // User scrolling up towards top (finger moves down) -> re-expand Tab Bar
    else if (dy > 20 && isCollapsed) {
      serviceOf<HapticsService>(ctx, 'haptics')?.selection?.()
      Animated.spring(collapseAnim, {
        toValue: 0,
        useNativeDriver: false,
        friction: 8,
        tension: 60,
      }).start()
      touchStartY.current = currentY
    }
  }

  const handlePageTouchEnd = () => {
    isDraggingPage.current = false
  }

  const expandTabBar = useCallback(() => {
    serviceOf<HapticsService>(ctx, 'haptics')?.selection?.()
    Animated.spring(collapseAnim, {
      toValue: 0,
      useNativeDriver: false,
      friction: 8,
      tension: 60,
    }).start()
  }, [collapseAnim, ctx])

  const [navState, setNavState] = useState<{ history: HistoryItem[]; index: number }>({
    history: [],
    index: 0,
  })
  /*
   * The foldable left pane's own stack, rooted at the library. Independent of
   * the right pane's `navState` by design: the panes are two surfaces over
   * one context, and a detail opened on the left must never push the right
   * pane's history (and vice versa). Survives folding — collapsing to the
   * phone layout unmounts the pane, not its state.
   */
  const [leftNavState, setLeftNavState] = useState<{ history: HistoryItem[]; index: number }>({
    history: [],
    index: 0,
  })

  const navigateTo = useCallback(
    (id: string, params?: Record<string, unknown>) => {
      if (id === 'now-playing.view') {
        openFullscreenNowPlaying()
        return
      }
      closeFullscreenNowPlaying()
      Animated.spring(collapseAnim, {
        toValue: 0,
        useNativeDriver: false,
        friction: 8,
        tension: 60,
      }).start()
      setNavState((prev) => {
        const base =
          prev.history.length === 0 && defaultTab ? [{ id: defaultTab.id }] : prev.history
        const current = base[prev.index]
        if (
          current &&
          current.id === id &&
          JSON.stringify(current.params) === JSON.stringify(params)
        ) {
          return prev
        }
        const nextHistory = base.slice(0, prev.index + 1)
        nextHistory.push({ id, params })
        return {
          history: nextHistory,
          index: nextHistory.length - 1,
        }
      })
    },
    [defaultTab, collapseAnim],
  )

  const [activeToast, setActiveToast] = useState<{
    id: number
    message: string
    tone?: 'info' | 'ok' | 'warn' | 'error'
  } | null>(null)
  useEffect(() => {
    let nextId = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = ctx.on('ui/toast', (toast) => {
      const id = ++nextId
      setActiveToast({ id, message: toast.message, tone: toast.tone })
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setActiveToast((cur) => (cur?.id === id ? null : cur))
      }, toast.durationMs ?? 3000)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [ctx])

  /** Push onto the left pane's stack — the foldable pane's own history. */
  const leftNavigate = useCallback((id: string, params?: Record<string, unknown>) => {
    setLeftNavState((prev) => {
      const base = prev.history.length === 0 ? [{ id: LEFT_PANE_ROOT }] : prev.history
      const current = base[prev.index]
      if (
        current &&
        current.id === id &&
        JSON.stringify(current.params) === JSON.stringify(params)
      ) {
        return prev
      }
      const nextHistory = base.slice(0, prev.index + 1)
      nextHistory.push({ id, params })
      return { history: nextHistory, index: nextHistory.length - 1 }
    })
  }, [])

  const leftGoBack = useCallback(() => {
    if (leftNavState.index > 0) {
      setLeftNavState((prev) => ({ ...prev, index: prev.index - 1 }))
      return true
    }
    return false
  }, [leftNavState.index])

  const goBack = useCallback(() => {
    // Drawer before queue before player before stacks: each surface unwinds
    // in the order it covered the one beneath. (The sheet's own Modal also
    // intercepts Back via `onRequestClose`; this guard is the same promise
    // held by the shell.)
    if (isDrawerOpen) {
      setIsDrawerOpen(false)
      return true
    }
    if (isQueueOpen) {
      setIsQueueOpen(false)
      return true
    }
    if (isFullscreenNowPlaying) {
      closeFullscreenNowPlaying()
      return true
    }
    if (navState.index > 0) {
      setNavState((prev) => ({ ...prev, index: prev.index - 1 }))
      return true
    }
    // Dual pane: the right stack unwound first, the left pane's follows —
    // hardware Back exits only when both panes are at their roots.
    if (layout === 'foldable' && leftNavState.index > 0) {
      setLeftNavState((prev) => ({ ...prev, index: prev.index - 1 }))
      return true
    }
    return false
  }, [isDrawerOpen, isQueueOpen, isFullscreenNowPlaying, navState.index, layout, leftNavState.index])

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      return goBack()
    })
    return () => subscription.remove()
  }, [goBack])

  useEffect(() => {
    const off = ctx.on('ui/navigate', (routeId: string, params?: Record<string, unknown>) => {
      navigateTo(routeId, params)
    })
    return () => void off()
  }, [ctx, navigateTo])

  /*
   * The first-frame system handoffs, in one effect that runs after the
   * navigate subscription above: reveal the app under the splash now that
   * there is something to show, and replay the home-screen quick action that
   * launched the app (a cold start via long-press → Recently Played). The
   * service emits `ui/navigate` for known action ids, so ordering the two is
   * what makes a cold-launch shortcut land on its screen instead of vanishing
   * with the splash.
   */
  useEffect(() => {
    void serviceOf<LifecycleService>(ctx, 'lifecycle')?.hideSplash().catch(() => {})
    try {
      serviceOf<QuickActionsService>(ctx, 'quickActions')?.consumeInitial()
    } catch {
      // The service is absent or degraded; nothing to replay.
    }
    // First frame only: the splash reveals once, and a consumed quick action
    // must not re-fire its events on later renders.
  }, [])

  const currentItem: HistoryItem | undefined =
    navState.history[navState.index] ?? (defaultTab ? { id: defaultTab.id } : undefined)
  const currentId = currentItem?.id
  const currentParams = currentItem?.params

  const activeTab = TABS.find((tab) => tab.id === currentId)

  const isTablet = layout === 'tablet'

  /**
   * The tab a route belongs to, everywhere the four tabs are drawn — the
   * bottom bar, the tablet rail and the drawer list must never disagree on
   * which entry is lit. Detail routes ride their parent tab: an album page
   * keeps the library entry selected.
   */
  const isTabSelected = (tab: Tab): boolean =>
    activeTab?.id === tab.id || (currentId === 'album.view' && tab.id === 'library.home')

  const BottomBar = ctx.ui.viewFor('now-playing.bar') as
    | ComponentType<{
        ctx: Context
        isCompact?: boolean
        onOpenNowPlaying?: () => void
        onOpenQueue?: () => void
        hideQueueButton?: boolean
      }>
    | undefined
  const NowPlayingView = ctx.ui.viewFor('now-playing.view') as
    | ComponentType<{ ctx: Context; onClose?: () => void }>
    | undefined
  const QueueView = ctx.ui.viewFor('queue.view') as
    | ComponentType<{
        ctx: Context
        onClose?: () => void
        [key: string]: unknown
      }>
    | undefined

  /* ── the page surface, shared by every layout ─────────────────────────── */

  /*
   * The page surface comes as two plain factories, not components: the right
   * pane and the foldable left pane render the *same* surface with different
   * navigation closures, and a shared component would have to thread those
   * through props — remounting the page on every shell render the moment a
   * closure identity changes. The factories take everything as arguments and
   * hold no hooks, so a call is ordinary createElement within the shell's
   * single render.
   */
  const pageBodyFor = (
    id: string | undefined,
    params: Record<string, unknown> | undefined,
    onBack: () => void,
    onOpenAlbum: (urn: string) => void,
  ) => {
    // Resolved per pane rather than once in the shell: the two panes sit on
    // different ids, and a late-registered view must be found for either.
    const PageView = id
      ? (ctx.ui.viewFor(id) as
          | ComponentType<{
              ctx: Context
              onBack?: () => void
              onOpenAlbum?: (urn: string) => void
              [key: string]: unknown
            }>
          | undefined)
      : undefined
    return h(
      View,
      { style: { flex: 1 } },
      PageView
        ? h(PageView, { ctx, ...params, onBack, onOpenAlbum })
        : h(
            Text,
            { style: { padding: 24, color: palette.text.secondary } },
            id
              ? t('app:common.app.hasNoMobileView', { currentId: id })
              : t('app:common.app.noPluginRoute'),
          ),
    )
  }

  /*
   * The display title for a page id: the tab's place-name on tab roots, a
   * chrome-owned localized string on the shell's detail routes, then the
   * contribution's own title — which may be an i18n key (translated) or a
   * literal (passed through). Shared by the header title and the drawer's
   * page list, so the two can never disagree.
   */
  const resolvePageTitle = (id: string, contributed: string): string => {
    const tab = TABS.find((tab) => tab.id === id)
    if (tab) return t(tab.titleKey)
    const key = DETAIL_TITLES[id]
    if (key) return t(key)
    if (contributed.includes(':')) {
      const translated = t(contributed)
      if (translated !== contributed) return translated
    }
    return contributed
  }

  const pageTitleFor = (id: string | undefined): string => {
    if (!id) return ''
    const route = serviceOf<UiService>(ctx, 'ui')?.routes?.find((route) => route.id === id)
    return resolvePageTitle(id, route?.title ?? '')
  }

  const isSettingsSubpage = (id?: string): boolean => {
    if (!id) return false
    return (
      (id.startsWith('settings.') && id !== 'settings.view') ||
      id.startsWith('debug.') ||
      id === 'plugin-manager.screen' ||
      id === 'sources.test' ||
      id === 'audio-converter.view' ||
      id === 'dsp.view'
    )
  }

  /*
   * A header button as a 40pt glass circle: the same `GlassSurface` tier
   * the tab bar and mini-player use (liquid > blur > translucent), fed by
   * the shell's resolved liquid-glass settings. Accessibility stays on
   * the inner Pressable only — the glass wrapper carries no role, so a
   * screen reader meets one button, not a button inside a button.
   */
  const headerGlassButton = (
    props: { onPress: () => void; accessibilityLabel: string; testID: string },
    glyph: ReactNode,
  ) =>
    h(
      GlassSurface,
      {
        liquid: liquidGlass,
        intensity: 85,
        tint: getScheme() === 'light' ? 'light' : 'dark',
        borderRadius: 20,
        style: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
      },
      h(
        Pressable,
        {
          onPress: props.onPress,
          accessibilityRole: 'button',
          accessibilityLabel: props.accessibilityLabel,
          testID: props.testID,
          style: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
        },
        glyph,
      ),
    )

  /*
   * Every page's header: on sub-pages within a stack, a back chevron returns
   * to the parent; otherwise the drawer's hamburger lives on the left, with the
   * page's title centered. Both left icons — and the library's right-hand
   * menu button below — are glass circles, so every page's chrome matches
   * the tab bar and mini-player. The 40pt slots on both sides keep the
   * centered title centered when a side has no button.
   */
  const pageHeaderFor = (
    title: string,
    onOpenDrawer: (() => void) | undefined,
    onBack?: (() => void) | undefined,
    rightAction?: ReactNode,
    headerStyle?: StyleProp<ViewStyle>,
  ) =>
    h(
      View,
      {
        style: [
          {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            // Extra breathing room above the title, on top of the
            // SafeAreaView's status-bar inset.
            paddingTop: 16,
            paddingBottom: 10,
            borderBottomColor: palette.border.subtle,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
          headerStyle,
        ],
      },
      onBack
        ? headerGlassButton(
            { onPress: onBack, accessibilityLabel: t('app:common.back'), testID: 'nav-back-button' },
            tablerIcon('chevron-left', { size: 24, color: palette.text.primary }) ??
              h(Text, { style: { color: palette.text.primary, fontSize: 24, fontWeight: '600' } }, '‹'),
          )
        : onOpenDrawer
          ? headerGlassButton(
              { onPress: onOpenDrawer, accessibilityLabel: t('app:common.app.openNavDrawer'), testID: 'nav-drawer-open' },
              tablerIcon('menu-2', { size: 22, color: palette.text.primary }) ??
                h(Text, { style: { color: palette.text.primary, fontSize: 20 } }, '☰'),
            )
          : h(View, { style: { minWidth: 40 } }),

      h(
        View,
        { style: { flex: 1, alignItems: 'center' } },
        h(
          Text,
          {
            numberOfLines: 1,
            style: { color: palette.text.primary, fontSize: 17, fontWeight: '600' },
          },
          title,
        ),
      ),
      rightAction ?? h(View, { style: { minWidth: 40 } }),
    )

  const libraryHeaderMenuButton = headerGlassButton(
    {
      onPress: () => {
        ctx.emit('library/open-header-menu')
      },
      accessibilityLabel: t('library:library.actions') || 'More options',
      testID: 'library-header-menu',
    },
    tablerIcon('dots', { size: 22, color: palette.text.primary }) ??
      h(Text, { style: { color: palette.text.primary, fontSize: 22, fontWeight: '700' } }, '⋯'),
  )

  const getRouteHeaderStyle = (id?: string): ViewStyle | undefined => {
    if (id === 'library.favorites') {
      return {
        backgroundColor: 'rgba(69, 10, 245, 0.5)',
        borderBottomWidth: 0,
      }
    }
    if (id === 'library.local') {
      return {
        backgroundColor: 'rgba(95, 135, 255, 0.15)',
        borderBottomWidth: 0,
      }
    }
    if (id === 'library.collection') {
      return {
        backgroundColor: palette.bg.base,
        borderBottomWidth: 0,
      }
    }
    if (id === 'album.view') {
      return {
        backgroundColor: 'rgba(95, 135, 255, 0.25)',
        borderBottomWidth: 0,
      }
    }
    return undefined
  }

  const isLibraryRouteWithMenu = (id?: string): boolean =>
    id === 'library.home' ||
    id === 'library.local' ||
    id === 'library.favorites' ||
    id === 'library.collection' ||
    id === 'album.view'

  const canGoBack = navState.index > 0 && !MAIN_TABS.some((tab) => tab.id === currentId)
  const pageHeader = pageHeaderFor(
    pageTitleFor(currentId),
    () => setIsDrawerOpen(true),
    canGoBack ? () => void goBack() : undefined,
    isLibraryRouteWithMenu(currentId) ? libraryHeaderMenuButton : undefined,
    getRouteHeaderStyle(currentId),
  )
  const pageBody = pageBodyFor(currentId, currentParams, goBack, (urn) =>
    navigateTo('album.view', { urn }),
  )

  /*
   * The foldable left pane's current page — the same factories fed the left
   * stack's own navigation. An empty left history resolves to the fixed root
   * rather than to "no route": the pane exists precisely to show the library,
   * so before anything is pushed it shows its root, never the fallback text.
   */
  const leftCurrentItem: HistoryItem =
    leftNavState.history[leftNavState.index] ?? { id: LEFT_PANE_ROOT }
  const leftCurrentId = leftCurrentItem.id
  const leftCurrentParams = leftCurrentItem.params
  const leftCanGoBack =
    leftNavState.index > 0 && !MAIN_TABS.some((tab) => tab.id === leftCurrentId)
  const leftPageHeader = pageHeaderFor(
    pageTitleFor(leftCurrentId),
    () => setIsDrawerOpen(true),
    leftCanGoBack ? () => void leftGoBack() : undefined,
    isLibraryRouteWithMenu(leftCurrentId) ? libraryHeaderMenuButton : undefined,
    getRouteHeaderStyle(leftCurrentId),
  )
  const leftPageBody = pageBodyFor(
    leftCurrentId,
    leftCurrentParams,
    leftGoBack,
    (urn) => leftNavigate('album.view', { urn }),
  )

  /*
   * The left navigation drawer overlay. The panel-left / backdrop-right
   * arrangement lives in `nav-drawer.tsx`, on the kit's configureNative seam
   * — the one part of the drawer a render test can pin, where the shell
   * itself never loads (App.tsx imports react-native at module scope).
   * Closing: a backdrop tap, a tab selection (the shell closes on select),
   * or Android Back — Back unwinds the drawer before any stack pops (goBack
   * above).
   */
  const drawerOverlay = h(
    NavDrawerOverlay,
    {
      palette,
      width,
      closeLabel: t('app:common.close'),
      onClose: () => setIsDrawerOpen(false),
      children: h(NavDrawerContents, {
        ctx,
        // The exact current page — the list carries every page, so the
        // highlight is exact, not the parent-tab approximation the tab bar
        // uses for detail routes.
        currentPageId: currentId,
        translate: resolvePageTitle,
        onSelectPage: (id: string) => {
          setIsDrawerOpen(false)
          navigateTo(id)
        },
      }),
      topInset: insets.top,
    },
  )

  /* ── phone chrome: page, bar, bottom tabs ──────────────────────────────── */

  const isLight = getScheme() === 'light'
  const marginH = 12
  const gap = 8
  const bottomOffset = insets.bottom > 0 ? insets.bottom : 12
  const expandedBarHeight = 60
  const collapsedBarHeight = 52
  const expandedBarRadius = 30
  const collapsedBarRadius = 26
  const miniPlayerHeight = 52
  const maxLeftWidth = width - 2 * marginH - expandedBarHeight - gap

  const activeMainTab = MAIN_TABS.find((tab) => isTabSelected(tab))
  const lastActiveMainTabRef = useRef(MAIN_TABS[0]!)
  if (activeMainTab) {
    lastActiveMainTabRef.current = activeMainTab
  }
  const displayedLeftTab = activeMainTab ?? lastActiveMainTabRef.current ?? MAIN_TABS[0]!
  const isSearchSelected = isTabSelected(SEARCH_TAB)

  const animTabBarRadius = collapseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [expandedBarRadius, collapsedBarRadius],
  })
  const animTabBarHeight = collapseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [expandedBarHeight, collapsedBarHeight],
  })
  const animLeftWidth = collapseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [maxLeftWidth, collapsedBarHeight],
  })
  const animRightWidth = collapseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [expandedBarHeight, collapsedBarHeight],
  })
  const animExpandedOpacity = collapseAnim.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [1, 0, 0],
  })
  const animCollapsedOpacity = collapseAnim.interpolate({
    inputRange: [0, 0.65, 1],
    outputRange: [0, 0, 1],
  })

  // Mini player positions:
  // Expanded (0): above the bottom dock (bottom: bottomOffset + expandedBarHeight + gap), full width (marginH to width - marginH)
  // Collapsed (1): docked between left and right buttons (bottom: bottomOffset), left: marginH + collapsedBarHeight + gap, right: marginH + collapsedBarHeight + gap
  const animMiniPlayerLeft = collapseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [marginH, marginH + collapsedBarHeight + gap],
  })
  const animMiniPlayerRight = collapseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [marginH, marginH + collapsedBarHeight + gap],
  })
  const animMiniPlayerBottom = collapseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [bottomOffset + expandedBarHeight + gap, bottomOffset],
  })

  const phoneChrome = h(
    View,
    {
      style: { flex: 1, position: 'relative' },
      onTouchStart: handlePageTouchStart,
      onTouchMove: handlePageTouchMove,
      onTouchEnd: handlePageTouchEnd,
    },
    // 1. The page surface, covering the whole screen
    h(
      View,
      { style: { flex: 1 } },
      pageHeader,
      pageBody,
    ),
    // 2. The floating chrome container (Mini Player + TabBar), anchored to the bottom
    h(
      View,
      {
        pointerEvents: 'box-none',
        style: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: bottomOffset + expandedBarHeight + gap + miniPlayerHeight + 10,
          zIndex: 20,
        },
      },
      // 2a. Mini Player: animates from top shelf to docked between left and right buttons
      BottomBar
        ? h(
            Animated.View,
            {
              pointerEvents: 'box-none',
              style: {
                position: 'absolute',
                left: animMiniPlayerLeft,
                right: animMiniPlayerRight,
                bottom: animMiniPlayerBottom,
                height: 52,
                zIndex: 25,
              },
            },
            h(BottomBar, {
              ctx,
              isCompact: isCollapsed,
              onOpenNowPlaying: openFullscreenNowPlaying,
              onOpenQueue: () => setIsQueueOpen(true),
            }),
          )
        : null,
      // 2b. Left Group: 3-tab capsule in expanded mode -> compact active-tab circle in collapsed mode
      h(
        Animated.View,
        {
          style: {
            position: 'absolute',
            left: marginH,
            bottom: bottomOffset,
            width: animLeftWidth,
            height: animTabBarHeight,
            borderRadius: animTabBarRadius,
            overflow: 'hidden',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.14)',
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: isLight ? 0.1 : 0.3,
            shadowRadius: 10,
            elevation: 6,
            zIndex: 20,
          },
        },
        h(
          GlassSurface,
          {
            intensity: 85,
            tint: isLight ? 'light' : 'dark',
            liquid: liquidGlass,
            borderRadius: isCollapsed ? collapsedBarRadius : expandedBarRadius,
            style: {
              flex: 1,
              width: '100%',
              height: '100%',
            },
          },
          // 1. Expanded contents (left 3 tabs: Home, Library, Settings)
          h(
            Animated.View,
            {
              pointerEvents: isCollapsed ? 'none' : 'auto',
              style: {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-around',
                opacity: animExpandedOpacity,
              },
            },
            ...MAIN_TABS.map((tab) =>
              h(AnimatedTabButton, {
                key: tab.id,
                tab,
                isSelected: isTabSelected(tab),
                palette,
                isLight,
                t,
                ctx,
                onPress: () => navigateTo(tab.id),
              }),
            ),
          ),
          // 2. Collapsed compact button content (current active tab icon)
          h(
            Animated.View,
            {
              pointerEvents: isCollapsed ? 'auto' : 'none',
              style: {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: animCollapsedOpacity,
              },
            },
            h(
              Pressable,
              {
                accessibilityRole: 'button',
                accessibilityLabel: t('app:common.app.expandNavigation') || 'Expand navigation',
                testID: 'tab-bar-collapsed-button',
                onPress: expandTabBar,
                style: {
                  width: '100%',
                  height: '100%',
                  alignItems: 'center',
                  justifyContent: 'center',
                },
              },
              tablerIcon(displayedLeftTab.tabler ?? 'home', {
                size: 24,
                color: activeMainTab ? palette.accent.base : palette.text.secondary,
              }) ??
                h(
                  Text,
                  {
                    style: {
                      color: activeMainTab ? palette.accent.base : palette.text.secondary,
                      fontSize: 22,
                    },
                  },
                  displayedLeftTab.icon ?? '⌂',
                ),
            ),
          ),
        ),
      ),
      // 2c. Right standalone Search button (circular button with search icon)
      h(
        Animated.View,
        {
          style: {
            position: 'absolute',
            right: marginH,
            bottom: bottomOffset,
            width: animRightWidth,
            height: animTabBarHeight,
            borderRadius: animTabBarRadius,
            overflow: 'hidden',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.14)',
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: isLight ? 0.1 : 0.3,
            shadowRadius: 10,
            elevation: 6,
            zIndex: 20,
          },
        },
        h(
          GlassSurface,
          {
            intensity: 85,
            tint: isLight ? 'light' : 'dark',
            liquid: liquidGlass,
            borderRadius: isCollapsed ? collapsedBarRadius : expandedBarRadius,
            style: {
              flex: 1,
              width: '100%',
              height: '100%',
            },
          },
          h(
            Pressable,
            {
              accessibilityRole: 'tab',
              accessibilityLabel: t(SEARCH_TAB.titleKey),
              accessibilityState: { selected: isSearchSelected },
              testID: 'tab-sources.search',
              onPress: () => {
                serviceOf<HapticsService>(ctx, 'haptics')?.selection?.()
                navigateTo(SEARCH_TAB.id)
              },
              style: {
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
              },
            },
            tablerIcon(SEARCH_TAB.tabler, {
              size: 22,
              color: isSearchSelected ? palette.accent.base : palette.text.secondary,
            }) ??
              h(
                Text,
                {
                  style: {
                    color: isSearchSelected ? palette.accent.base : palette.text.secondary,
                    fontSize: 20,
                  },
                },
                SEARCH_TAB.icon,
              ),
          ),
        ),
      ),
    ),
  )

  /* ── tablet chrome: 240dp rail + content pane ──────────────────────────── */

  /*
   * The rail's now-playing card is the same `now-playing.bar` view the phone
   * renders — one player surface, two homes. It is mounted at the rail's
   * bottom with the same callbacks, so a control written once behaves
   * identically in both layouts (including the idle placeholder). One
   * deliberate exception: the bar's queue button is hidden in the rail and
   * the queue lives in its own row underneath, because at 240dp a fourth
   * button would squeeze the card's title to nothing.
   */
  const tabletChrome = h(
    View,
    { style: { flex: 1, flexDirection: 'row' } },
    h(
      View,
      { style: { width: 240, borderRightWidth: 1, borderRightColor: palette.border.subtle } },
      h(
        View,
        {
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 12,
          },
        },
        h(Image, { source: brandIcon, style: { width: 28, height: 28, borderRadius: 6 } }),
        h(Text, { style: { color: palette.text.primary, fontSize: 18, fontWeight: '700' } }, 'B Be Bee'),
      ),
      h(
        View,
        { style: { flex: 1 } },
        ...TABS.map((tab) => {
          const isSelected = isTabSelected(tab)
          const tabTitle = t(tab.titleKey)
          return h(
            Pressable,
            {
              key: tab.id,
              onPress: () => navigateTo(tab.id),
              accessibilityRole: 'tab',
              accessibilityLabel: tabTitle,
              accessibilityState: { selected: isSelected },
              style: {
                paddingVertical: 14,
                paddingHorizontal: 20,
                borderLeftWidth: 3,
                borderLeftColor: isSelected ? palette.accent.base : 'transparent',
              },
            },
            h(
              Text,
              {
                numberOfLines: 1,
                style: {
                  color: isSelected ? palette.text.primary : palette.text.secondary,
                  fontWeight: isSelected ? '600' : '400',
                },
              },
              tabTitle,
            ),
          )
        }),
      ),
      BottomBar
        ? h(BottomBar, {
            ctx,
            onOpenNowPlaying: openFullscreenNowPlaying,
            onOpenQueue: () => setIsQueueOpen(true),
            // The rail is 240dp wide: the bar's own queue button would
            // squeeze its title to nothing, so the button is hidden here
            // and the queue gets its own row directly underneath the bar.
            hideQueueButton: true,
          })
        : null,
      h(
        Pressable,
        {
          onPress: () => setIsQueueOpen(true),
          accessibilityRole: 'button',
          accessibilityLabel: t('nowPlaying:nowPlaying.playQueue'),
          testID: 'rail-queue-row',
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            borderTopWidth: 1,
            borderTopColor: palette.border.subtle,
            paddingVertical: 12,
            paddingHorizontal: 20,
          },
        },
        tablerIcon('list', { size: 18, color: palette.accent.base }) ??
          h(Text, { style: { color: palette.accent.base, fontSize: 14 } }, '☰'),
        h(Text, { style: { color: palette.accent.base, fontSize: 14, fontWeight: '600' } }, t('nowPlaying:nowPlaying.playQueue')),
      ),
      /*
       * The way into the dual-pane layout lives at the bottom of the rail the
       * user is already looking at, under the now-playing card. The rail only
       * mounts on a window at least 600dp wide — exactly the window foldable
       * requires — so the entry needs no width check of its own.
       */
      h(
        Pressable,
        {
          onPress: () => setLayoutMode('foldable'),
          accessibilityLabel: t('app:common.app.dualScreen'),
          testID: 'rail-dual-screen',
          style: {
            borderTopWidth: 1,
            borderTopColor: palette.border.subtle,
            paddingVertical: 12,
            paddingHorizontal: 20,
          },
        },
        h(
          Text,
          { style: { color: palette.accent.base, fontSize: 14, fontWeight: '600' } },
          t('app:common.app.dualScreen'),
        ),
      ),
    ),
    h(
      View,
      { style: { flex: 1 } },
      pageHeaderFor(
        pageTitleFor(currentId),
        undefined,
        isSettingsSubpage(currentId) ? () => void goBack() : undefined,
        isLibraryRouteWithMenu(currentId) ? libraryHeaderMenuButton : undefined,
      ),
      pageBody,
    ),
  )

  /* ── foldable chrome: library pane beside a whole phone ────────────────── */

  /*
   * The dual-pane layout is two complete surfaces, not one page split in
   * half. The left pane is the library browser — its own stack, no tabs, and
   * deliberately no now-playing bar: one player surface per window, and the
   * right pane already carries it. The right pane is the entire phone layout
   * (`phoneChrome`, tabs and all) rather than a bare content pane, so the
   * two-pane posture behaves exactly like the phone it replaces — same tab
   * navigation, same back stack, same sheet triggers — with the library
   * pinned open beside it.
   *
   * The right pane's hamburger opens the drawer into the LEFT pane: within
   * the left pane's bounds, overlaying the library temporarily — never over
   * the phone layout. A drawer tab navigates the right pane (`navigateTo`
   * only ever touches the right stack) and closes; the left pane stays the
   * library afterwards.
   */
  const foldableChrome = h(
    View,
    { style: { flex: 1, flexDirection: 'row' } },
    h(
      View,
      {
        style: { flex: 1, borderRightWidth: 1, borderRightColor: palette.border.subtle },
        testID: 'foldable-left-pane',
      },
      h(
        View,
        {
          style: {
            flexDirection: 'row',
            justifyContent: 'flex-end',
            paddingHorizontal: 12,
            paddingTop: 8,
          },
        },
        h(
          Pressable,
          {
            onPress: () => setLayoutMode('auto'),
            accessibilityRole: 'button',
            accessibilityLabel: t('app:common.app.exitDualScreen'),
            testID: 'foldable-exit-dual-screen',
            style: { paddingVertical: 6, paddingHorizontal: 10 },
          },
          h(
            Text,
            { style: { color: palette.accent.base, fontSize: 13, fontWeight: '600' } },
            t('app:common.app.exitDualScreen'),
          ),
        ),
      ),
      leftPageHeader,
      leftPageBody,
      isDrawerOpen ? drawerOverlay : null,
    ),
    h(View, { style: { flex: 1 }, testID: 'foldable-right-pane' }, phoneChrome),
  )

  /* ── overlays: fullscreen player, then the queue above it ─────────────── */

  /*
   * The fullscreen player is an overlay stacked on the shell, not a branch
   * swap — the same rule as the desktop shell (docs/ui/architecture.md
   * §7.1-5): the shell and every cached page in it stay mounted underneath,
   * so returning finds each page exactly as it was left, and on the tablet
   * the overlay covers the whole window, rail included.
   */
  const fullscreenOverlay = isSheetMounted
    ? h(
        Animated.View,
        {
          style: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            // Absolute children escape the SafeAreaView's padding — the
            // player's own top controls (close, style switcher) need the
            // status-bar inset carried here.
            paddingTop: insets.top,
            backgroundColor: palette.bg.base,
            transform: [{ translateY: sheetAnim }],
            zIndex: 100,
          },
          testID: 'now-playing-overlay',
        },
        // Apple Music top drag handle indicator with PanResponder for pull-down dismiss
        h(
          View,
          {
            ...sheetPanResponder.panHandlers,
            style: {
              alignItems: 'center',
              paddingVertical: 10,
              width: '100%',
            },
          },
          h(View, {
            style: {
              width: 36,
              height: 5,
              borderRadius: 2.5,
              backgroundColor: isLight ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.35)',
            },
          }),
        ),
        NowPlayingView
          ? h(NowPlayingView, { ctx, onClose: closeFullscreenNowPlaying })
          : h(
              Text,
              { style: { padding: 24, color: palette.text.secondary } },
              t('app:common.app.nowPlayingNoMobileView'),
            ),
      )
    : null

  /*
   * The phone's queue bottom sheet. A React Native Modal floats above
   * whatever is beneath it, so mounting it alongside the fullscreen player
   * puts the drawer above the player. The content cap keeps a long queue
   * from eating the whole screen: 70% of the window, list scrolling inside —
   * the sheet's own semantics stay untouched.
   */
  const queueSheet = !isTablet && QueueView
    ? h(
        Sheet,
        {
          open: isQueueOpen,
          onClose: () => setIsQueueOpen(false),
          liquid: liquidGlass,
        },
        h(
          View,
          { style: { height: Math.round(height * 0.7) } },
          h(QueueView, { ctx, onClose: () => setIsQueueOpen(false) }),
        ),
      )
    : null

  /*
   * The tablet's queue drawer: right-anchored, above the fullscreen player
   * (zIndex 120 over the overlay's 100) — the same layering as the desktop
   * shell's queue drawer over its play page.
   */
  const queueDrawer =
    isTablet && isQueueOpen && QueueView
      ? h(
          View,
          {
            style: {
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: Math.min(360, Math.round(width * 0.45)),
              backgroundColor: palette.bg.overlay,
              borderLeftWidth: 1,
              borderLeftColor: palette.border.subtle,
              zIndex: 120,
            },
            testID: 'queue-drawer',
          },
          h(
            View,
            {
              style: {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 16,
                borderBottomWidth: 1,
                borderBottomColor: palette.border.subtle,
              },
            },
            h(Text, { style: { color: palette.text.primary, fontSize: 16, fontWeight: '600' } }, t('queue:index.queue')),
            h(
              Pressable,
              {
                onPress: () => setIsQueueOpen(false),
                accessibilityRole: 'button',
                accessibilityLabel: t('app:common.close'),
                style: { padding: 6 },
              },
              tablerIcon('x', { size: 20, color: palette.text.secondary }) ??
                h(Text, { style: { color: palette.text.secondary, fontSize: 16 } }, '✕'),
            ),
          ),
          h(View, { style: { flex: 1 } }, h(QueueView, { ctx })),
        )
      : null

  return h(
    SafeAreaView,
    // `shell-<layout>` lets a manual rotation check (and later an e2e tap
    // through) see which branch the classifier picked without a debugger.
    // The shell root paints the theme's base surface: the transparent top
    // bar and every page that does not paint its own background (the
    // recommend page) sit on it, and the page family reads the same token
    // through the kit's palette, so all of them follow theme switches
    // together.
    { style: { flex: 1, backgroundColor: palette.bg.base }, testID: `shell-${layout}` },
    layout === 'tablet'
      ? tabletChrome
      : layout === 'foldable'
        ? foldableChrome
        : phoneChrome,
    fullscreenOverlay,
    queueSheet,
    queueDrawer,
    // The drawer over the whole window is the phone host only — the foldable
    // mounts the same element inside its left pane, and the tablet has no
    // drawer (the rail is its navigation).
    layout === 'phone' && isDrawerOpen ? drawerOverlay : null,
    activeToast
      ? h(
          View,
          {
            pointerEvents: 'box-none',
            style: {
              position: 'absolute',
              top: 54,
              left: 20,
              right: 20,
              alignItems: 'center',
              zIndex: 9999,
            },
          },
          h(Toast, {
            message: activeToast.message,
            tone: activeToast.tone,
            onDismiss: () => setActiveToast(null),
            liquid: liquidGlass,
          }),
        )
      : null,
  )
}

export default function App() {
  const [ctx, setCtx] = useState<Context>()
  const [error, setError] = useState<string>()
  // The pre-shell screens paint from the palette too: a light-scheme theme
  // must not flash a dark loading screen at every launch.
  const palette = usePalette()

  /*
   * The `App` instance from `boot()`, kept only to hand the deferred pass its
   * `loadPlugin`. A ref rather than state: the ready chain below is the
   * single source of truth for when loading begins.
   */
  const bootAppRef = useRef<Awaited<ReturnType<typeof boot>> | null>(null)

  useEffect(() => {
    let disposed = false
    boot()
      .then((app) => {
        bootAppRef.current = app
        return app.ready(['ui'], { timeoutMs: 15_000 })
      })
      .then((ready) => {
        if (disposed) return
        setCtx(ready)
        // First frame is about to paint — bring the deferred plugins in
        // during idle, exactly as the desktop renderer does.
        scheduleIdle(() => {
          const app = bootAppRef.current
          if (app) void loadDeferredPlugins(app, ready).catch(() => {})
        })
      })
      .catch((e: unknown) => setError(e instanceof Error ? (e.stack ?? e.message) : String(e)))
    return () => { disposed = true }
  }, [])

  if (error) {
    return h(
      SafeAreaView,
      { style: { flex: 1, backgroundColor: palette.bg.base } },
      h(Text, { style: { padding: 24, color: palette.state.error } }, renderBootErrorMessage(error)),
    )
  }
  if (!ctx) {
    return h(
      SafeAreaView,
      { style: { flex: 1, backgroundColor: palette.bg.base, justifyContent: 'center' } },
      h(ActivityIndicator, { color: palette.accent.base }),
    )
  }
  return h(Shell, { ctx })
}

/**
 * The root component: the safe-area provider, then the app.
 *
 * The provider has to be above every `SafeAreaView`, and `App` is the only
 * thing `registerRootComponent` mounts — so it goes here rather than in the
 * shell, where a second screen could forget it.
 */
export function Root() {
  return h(SafeAreaProvider, null, h(App))
}
