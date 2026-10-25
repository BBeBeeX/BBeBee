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

import { createElement as h, useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { ActivityIndicator, BackHandler, Image, Pressable, Text, useWindowDimensions, View } from 'react-native'
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
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import type { Context } from 'cordis'
import type { StoreService } from '@BBeBee/protocol'
import { serviceOf } from '@BBeBee/ui-core'
import { useI18n, usePalette, Sheet, Toast } from '@BBeBee/ui-kit-mobile'
import { renderBootErrorMessage } from './boot-error'
import { boot } from './boot'
import {
  MOBILE_LAYOUT_MODE_KEY,
  isMobileLayoutMode,
  resolveMobileLayout,
  type MobileLayoutMode,
} from './layout'
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

/** What the tab bar can navigate to: a route id plus its i18n title key. */
interface Tab {
  id: string
  titleKey: string
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
  { id: 'sources.recommend', titleKey: 'app:common.app.tabs.home' },
  { id: 'library.home', titleKey: 'app:common.app.tabs.library' },
  { id: 'settings.view', titleKey: 'app:common.app.tabs.settings' },
  { id: 'sources.search', titleKey: 'app:common.app.tabs.search' },
]

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

function Shell({ ctx }: { ctx: Context }) {
  const { t } = useI18n(ctx)
  /*
   * The shell paints from the same palette the kit's components read. Every
   * colour below comes off this object — a hardcoded hex here would outlive
   * a theme switch and paint the chrome in a scheme the screens no longer
   * speak. The hook is what makes the repaint happen: it subscribes to the
   * palette store, so a theme (or scheme) change re-renders the shell and
   * everything it renders with it.
   */
  const palette = usePalette()
  const uiTick = useUiChangedTick(ctx)
  const defaultTab = TABS[0]
  const [isFullscreenNowPlaying, setIsFullscreenNowPlaying] = useState(false)
  /*
   * The queue drawer's open state. Shell-owned by design: the drawer layers
   * above the fullscreen player (Android Back closes it first, and reopening
   * the drawer while the player is up must not disturb either surface), so
   * no single page or bar can own it without reaching across the others.
   */
  const [isQueueOpen, setIsQueueOpen] = useState(false)

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
        setIsFullscreenNowPlaying(true)
        return
      }
      setIsFullscreenNowPlaying(false)
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
    [defaultTab],
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

  const canGoBack = navState.index > 0
  const leftCanGoBack = leftNavState.index > 0

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
    // Drawer before player before stacks: each surface unwinds in the order
    // it covered the one beneath. (The sheet's own Modal also intercepts Back
    // via `onRequestClose`; this guard is the same promise held by the shell.)
    if (isQueueOpen) {
      setIsQueueOpen(false)
      return true
    }
    if (isFullscreenNowPlaying) {
      setIsFullscreenNowPlaying(false)
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
  }, [isQueueOpen, isFullscreenNowPlaying, navState.index, layout, leftNavState.index])

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

  const currentItem: HistoryItem | undefined =
    navState.history[navState.index] ?? (defaultTab ? { id: defaultTab.id } : undefined)
  const currentId = currentItem?.id
  const currentParams = currentItem?.params

  const activeTab = TABS.find((tab) => tab.id === currentId)

  const isTablet = layout === 'tablet'

  const BottomBar = ctx.ui.viewFor('now-playing.bar') as
    | ComponentType<{ ctx: Context; onOpenNowPlaying?: () => void; onOpenQueue?: () => void }>
    | undefined
  const NowPlayingView = ctx.ui.viewFor('now-playing.view') as
    | ComponentType<{ ctx: Context; onClose?: () => void }>
    | undefined
  const QueueView = ctx.ui.viewFor('queue.view') as
    | ComponentType<{ ctx: Context }>
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
  const backHeaderFor = (show: boolean, onBack: () => void) =>
    show
      ? h(
          View,
          {
            style: {
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderBottomColor: palette.border.subtle,
              borderBottomWidth: 1,
            },
          },
          h(
            Pressable,
            {
              onPress: onBack,
              accessibilityRole: 'button',
              accessibilityLabel: t('app:common.app.goBack'),
              style: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
            },
            h(
              Text,
              { style: { color: palette.accent.base, fontSize: 16, fontWeight: '600' } },
              t('app:common.app.backPill'),
            ),
          ),
        )
      : null

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

  const backHeader = backHeaderFor(canGoBack, goBack)
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
  const leftBackHeader = backHeaderFor(leftCanGoBack, leftGoBack)
  const leftPageBody = pageBodyFor(
    leftCurrentId,
    leftCurrentParams,
    leftGoBack,
    (urn) => leftNavigate('album.view', { urn }),
  )

  /* ── phone chrome: page, bar, bottom tabs ──────────────────────────────── */

  const phoneChrome = h(
    View,
    { style: { flex: 1 } },
    backHeader,
    pageBody,
    BottomBar
      ? h(BottomBar, {
          ctx,
          onOpenNowPlaying: () => setIsFullscreenNowPlaying(true),
          onOpenQueue: () => setIsQueueOpen(true),
        })
      : null,
    h(
      View,
      { style: { flexDirection: 'row', borderTopColor: palette.border.subtle, borderTopWidth: 1 } },
      ...TABS.map((tab) => {
        const isSelected =
          activeTab?.id === tab.id ||
          (currentId === 'album.view' && tab.id === 'library.home')
        const tabTitle = t(tab.titleKey)
        return h(
          Pressable,
          {
            key: tab.id,
            onPress: () => navigateTo(tab.id),
            accessibilityRole: 'tab',
            accessibilityLabel: tabTitle,
            accessibilityState: { selected: isSelected },
            style: { flex: 1, padding: 14, alignItems: 'center' },
          },
          h(
            Text,
            {
              numberOfLines: 1,
              style: { color: isSelected ? palette.text.primary : palette.text.secondary },
            },
            tabTitle,
          ),
        )
      }),
    ),
  )

  /* ── tablet chrome: 240dp rail + content pane ──────────────────────────── */

  /*
   * The rail's now-playing card is the same `now-playing.bar` view the phone
   * renders — one player surface, two homes. It is mounted at the rail's
   * bottom with the same callbacks, so a control written once behaves
   * identically in both layouts (including the idle placeholder).
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
          const isSelected =
            activeTab?.id === tab.id ||
            (currentId === 'album.view' && tab.id === 'library.home')
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
            onOpenNowPlaying: () => setIsFullscreenNowPlaying(true),
            onOpenQueue: () => setIsQueueOpen(true),
          })
        : null,
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
    h(View, { style: { flex: 1 } }, backHeader, pageBody),
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
      leftBackHeader,
      leftPageBody,
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
  const fullscreenOverlay = isFullscreenNowPlaying
    ? h(
        View,
        {
          style: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: palette.bg.base,
            zIndex: 100,
          },
          testID: 'now-playing-overlay',
        },
        NowPlayingView
          ? h(NowPlayingView, { ctx, onClose: () => setIsFullscreenNowPlaying(false) })
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
          title: t('queue:index.queue'),
        },
        h(
          View,
          { style: { maxHeight: Math.round(height * 0.7) } },
          h(QueueView, { ctx }),
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
    { style: { flex: 1, backgroundColor: palette.bg.base }, testID: `shell-${layout}` },
    layout === 'tablet'
      ? tabletChrome
      : layout === 'foldable'
        ? foldableChrome
        : phoneChrome,
    fullscreenOverlay,
    queueSheet,
    queueDrawer,
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
