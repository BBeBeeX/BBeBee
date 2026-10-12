/**
 * The mobile shell.
 *
 * Reads the same contributed routes as the desktop shell and renders them as a
 * tab bar. No feature knowledge here either.
 */

import { createElement as h, useCallback, useEffect, useState, type ComponentType } from 'react'
import { ActivityIndicator, BackHandler, Pressable, Text, View } from 'react-native'
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
import type { RouteContribution, SettingsContribution } from '@BBeBee/protocol'
import { useI18n } from '@BBeBee/ui-kit-mobile'
import { boot } from './boot'

/** What the tab bar can navigate to: a route, or a settings page. */
interface Tab {
  id: string
  title: string
}

interface HistoryItem {
  id: string
  params?: Record<string, unknown>
}

/**
 * Re-read the registry whenever a plugin contributes or unloads.
 *
 * ⚠️ **Settings pages are navigable, not just routes.** `ctx.ui.settings` was
 * contributed by `plugin-local-scanner` and `plugin-sources` from the start
 * and read by nobody, so "Music folders" — the screen with *Add folder* and
 * *Scan now* on it — existed, had a view registered, and could not be reached
 * from either shell. A contribution nothing renders is a feature nobody has.
 */
function useTabs(ctx: Context): Tab[] {
  const read = () => ({
    routes: [...ctx.ui.routes] as readonly RouteContribution[],
    settings: [...ctx.ui.settings] as readonly SettingsContribution[],
  })
  const [state, setState] = useState(read)
  useEffect(() => {
    // `read` is redefined per render but only ever closes over `ctx`, so
    // re-subscribing on `ctx` alone is correct and keeps one listener.
    const off = ctx.on('ui/changed', () =>
      setState({ routes: [...ctx.ui.routes], settings: [...ctx.ui.settings] }),
    )
    return () => void off()
  }, [ctx])

  return [
    ...state.routes
      .filter((r) => r.placement?.includes('tab-bar') === true)
      .map((r) => ({ id: r.id, title: r.title })),
    /*
     * Settings pages that actually have a view.
     *
     * ⚠️ A different rule from routes, deliberately. A *route* with no view on
     * this target renders "not available on this platform", which is true and
     * worth saying. A settings page with no view on *either* target is not a
     * platform gap, it is a page nobody has written yet (`sources.settings` is
     * one today), and listing it advertises a screen that does not exist.
     */
    ...state.settings
      .filter((s) => ctx.ui.viewFor(s.id) !== undefined)
      .map((s) => ({ id: s.id, title: s.title })),
  ]
}

function Shell({ ctx }: { ctx: Context }) {
  const { t } = useI18n(ctx)
  const translateTitle = (title: string): string => (title.includes(':') ? t(title) : title)
  const tabs = useTabs(ctx)
  const defaultTab = tabs[0]
  const [isFullscreenNowPlaying, setIsFullscreenNowPlaying] = useState(false)

  const [navState, setNavState] = useState<{ history: HistoryItem[]; index: number }>({
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

  const canGoBack = navState.index > 0

  const goBack = useCallback(() => {
    if (isFullscreenNowPlaying) {
      setIsFullscreenNowPlaying(false)
      return true
    }
    if (navState.index > 0) {
      setNavState((prev) => ({ ...prev, index: prev.index - 1 }))
      return true
    }
    return false
  }, [isFullscreenNowPlaying, navState.index])

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

  const activeTab = tabs.find((t) => t.id === currentId)
  const ViewComponent = currentId
    ? (ctx.ui.viewFor(currentId) as
        | ComponentType<{
            ctx: Context
            onBack?: () => void
            onOpenAlbum?: (urn: string) => void
            [key: string]: unknown
          }>
        | undefined)
    : undefined

  const BottomBar = ctx.ui.viewFor('now-playing.bar') as
    | ComponentType<{ ctx: Context; onOpenNowPlaying?: () => void }>
    | undefined
  const NowPlayingView = ctx.ui.viewFor('now-playing.view') as
    | ComponentType<{ ctx: Context; onClose?: () => void }>
    | undefined

  if (isFullscreenNowPlaying) {
    return h(
      SafeAreaView,
      { style: { flex: 1, backgroundColor: '#0B0B0F' } },
      NowPlayingView
        ? h(NowPlayingView, { ctx, onClose: () => setIsFullscreenNowPlaying(false) })
        : h(
            Text,
            { style: { padding: 24, color: '#A0A0AE' } },
            '"Now playing" has no mobile view.',
          ),
    )
  }

  return h(
    SafeAreaView,
    { style: { flex: 1, backgroundColor: '#0B0B0F' } },
    canGoBack
      ? h(
          View,
          {
            style: {
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderBottomColor: '#1E1E28',
              borderBottomWidth: 1,
            },
          },
          h(
            Pressable,
            {
              onPress: goBack,
              accessibilityRole: 'button',
              accessibilityLabel: 'Go back',
              style: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
            },
            h(Text, { style: { color: '#7C5CFF', fontSize: 16, fontWeight: '600' } }, '‹ Back'),
          ),
        )
      : null,
    h(
      View,
      { style: { flex: 1 } },
      ViewComponent
        ? h(ViewComponent, {
            ctx,
            ...currentParams,
            onBack: goBack,
            onOpenAlbum: (urn: string) => navigateTo('album.view', { urn }),
          })
        : h(
            Text,
            { style: { padding: 24, color: '#A0A0AE' } },
            currentId ? t('app:common.app.hasNoMobileView', { currentId }) : t('app:common.app.noPluginRoute'),
          ),
    ),
    BottomBar
      ? h(BottomBar, {
          ctx,
          onOpenNowPlaying: () => setIsFullscreenNowPlaying(true),
        })
      : null,
    h(
      View,
      { style: { flexDirection: 'row', borderTopColor: '#1E1E28', borderTopWidth: 1 } },
      ...tabs.map((tab) => {
        const isSelected =
          activeTab?.id === tab.id ||
          (currentId === 'album.view' && tab.id === 'library.home')
        const tabTitle = translateTitle(tab.title)
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
              style: { color: isSelected ? '#F5F5F7' : '#5A5A68' },
            },
            tabTitle,
          ),
        )
      }),
    ),
  )
}

export default function App() {
  const [ctx, setCtx] = useState<Context>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let disposed = false
    boot()
      .then((app) => app.ready(['ui'], { timeoutMs: 15_000 }))
      .then((ready) => { if (!disposed) setCtx(ready) })
      .catch((e: unknown) => setError(e instanceof Error ? (e.stack ?? e.message) : String(e)))
    return () => { disposed = true }
  }, [])

  if (error) {
    // Boot failed: the i18n service is unavailable, so the English source
    // string is rendered directly instead of going through t().
    return h(
      SafeAreaView,
      { style: { flex: 1, backgroundColor: '#0B0B0F' } },
      h(Text, { style: { padding: 24, color: '#FF5C5C' } }, `BBeBee failed to start:\n\n${error}`),
    )
  }
  if (!ctx) {
    return h(
      SafeAreaView,
      { style: { flex: 1, backgroundColor: '#0B0B0F', justifyContent: 'center' } },
      h(ActivityIndicator, { color: '#7C5CFF' }),
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
