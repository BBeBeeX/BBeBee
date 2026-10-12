// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { useBridgeLocale } from './use-bridge-locale.js'

/*
 * The hook reads the locale through the preload bridge (`window.BBeBee.locale`):
 * `getLocale()` for the value at mount, `onLocaleChange` for pushes. The fake
 * below stands in for the preload side; `emitLocale` simulates main
 * rebroadcasting a change the main window's renderer reported.
 */
function installBridge(initial: string): { emitLocale: (next: string) => void } {
  const listeners = new Set<(locale: string) => void>()
  const bridge = {
    getLocale: vi.fn(async () => initial),
    onLocaleChange: vi.fn((cb: (locale: string) => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }),
  }
  Object.defineProperty(window, 'BBeBee', {
    value: { locale: bridge },
    configurable: true,
    writable: true,
  })
  return {
    emitLocale: (next: string) => {
      for (const listener of [...listeners]) listener(next)
    },
  }
}

afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>)['BBeBee']
})

describe('useBridgeLocale', () => {
  it('reads the initial locale through getLocale and resolves keys', async () => {
    installBridge('zh')
    const { result } = renderHook(() => useBridgeLocale())
    // getLocale() resolves on a microtask; flush it.
    await act(async () => {})
    expect(result.current.locale).toBe('zh')
    expect(result.current.t('app:common.desktopLyrics.play')).toBe('播放')
    expect(result.current.t('miniPlayer:miniPlayerControls.pause')).toBe('暂停')
  })

  it('re-renders on locale push without remount', async () => {
    const { emitLocale } = installBridge('en')
    const { result } = renderHook(() => useBridgeLocale())
    await act(async () => {})
    expect(result.current.t('app:common.desktopLyrics.play')).toBe('Play')
    act(() => emitLocale('zh'))
    expect(result.current.locale).toBe('zh')
    expect(result.current.t('app:common.desktopLyrics.play')).toBe('播放')
  })

  it('falls back per key: locale → en → the key itself', async () => {
    installBridge('zh')
    const { result } = renderHook(() => useBridgeLocale())
    await act(async () => {})
    // `app:common.confirm` exists in both locales; an unknown key degrades
    // to the key itself instead of rendering blank.
    expect(result.current.t('app:common.confirm')).toBe('确认')
    expect(result.current.t('app:common.noSuchKey')).toBe('app:common.noSuchKey')
    expect(result.current.t('no-namespace-form')).toBe('no-namespace-form')
  })

  it('renders English when the bridge is absent', () => {
    const { result } = renderHook(() => useBridgeLocale())
    expect(result.current.locale).toBe('en')
    // Same catalogue the service registers: identical to the old hardcoded copy.
    expect(result.current.t('app:common.desktopLyrics.play')).toBe('Play')
  })

  it('interpolates {name} params', async () => {
    installBridge('en')
    const { result } = renderHook(() => useBridgeLocale())
    await act(async () => {})
    expect(result.current.t('settings:plugins.disablingMayAffectTheFollowing', { displayName: 'X' })).toBe(
      'Disabling "X" may affect the following running dependents:',
    )
  })
})
