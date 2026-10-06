// @vitest-environment jsdom
/**
 * Desktop now-playing styles settings card tests — the card the settings
 * screen embeds for `plugin-now-playing`'s `now-playing.styles` contribution.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { fireEvent, render, cleanup, waitFor } from '@testing-library/react'
import { Context, Service } from 'cordis'
import type { AppSettings, NowPlayingStyleMeta, SettingsService } from '@BBeBee/protocol'
import { DEFAULT_APP_SETTINGS, NOW_PLAYING_STYLES } from '@BBeBee/protocol'
import { NowPlayingStylesSection } from './components/NowPlayingStylesSection.js'

afterEach(() => {
  cleanup()
})

async function npHarness() {
  const calls: string[] = []
  let currentSettings: AppSettings = { ...DEFAULT_APP_SETTINGS }

  class SettingsStub extends Service implements Partial<SettingsService> {
    private appCtx: Context
    public calls = calls
    constructor(ctx: Context) {
      super(ctx, 'settings')
      this.appCtx = ctx
    }
    getSync = (): AppSettings => currentSettings
    update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
      calls.push(`update:${JSON.stringify(patch)}`)
      currentSettings = { ...currentSettings, ...patch }
      this.appCtx.emit('settings/changed', currentSettings)
      return currentSettings
    }
  }

  class NowPlayingStub extends Service {
    public styles: NowPlayingStyleMeta[] = [...NOW_PLAYING_STYLES]
    public currentStyle: string = currentSettings.nowPlayingStyle || 'classic'
    private appCtx: Context
    constructor(ctx: Context) {
      super(ctx, 'nowPlaying')
      this.appCtx = ctx
    }
    getStyle = () => this.currentStyle
    getStyles = () => this.styles
    setStyle = (id: string) => {
      calls.push(`nowPlaying:setStyle:${id}`)
      this.currentStyle = id
      this.appCtx.emit('now-playing/style-changed', id)
    }
    registerStyle = (meta: NowPlayingStyleMeta) => {
      calls.push(`nowPlaying:register:${meta.id}`)
      this.styles.push(meta)
      this.appCtx.emit('now-playing/registry-changed', this.styles)
      return () => this.removeStyle(meta.id)
    }
    removeStyle = (id: string) => {
      calls.push(`nowPlaying:remove:${id}`)
      this.styles = this.styles.filter((s) => s.id !== id)
      this.appCtx.emit('now-playing/registry-changed', this.styles)
      return true
    }
  }

  const root = new Context()
  await root.plugin(SettingsStub)
  await root.plugin(NowPlayingStub)

  let scoped: Context | undefined
  root.inject(['settings', 'nowPlaying'], (s) => void (scoped = s))
  await new Promise((r) => setTimeout(r, 0))
  if (!scoped) throw new Error('failed to scope')

  return { ctx: scoped, calls, settings: scoped.get('settings') as unknown as SettingsStub }
}

describe('NowPlayingStylesSection', () => {
  it('renders styles and allows switching the active one', async () => {
    const { ctx, calls, settings } = await npHarness()
    const { getByText, getByTestId } = render(h(NowPlayingStylesSection, { ctx }))

    expect(getByText('播放页样式模板 (Now Playing Layout Styles)')).toBeTruthy()
    expect(getByText('经典')).toBeTruthy()
    expect(getByText('映画歌词')).toBeTruthy()
    expect(getByText('沉浸封面')).toBeTruthy()
    expect(getByText('黑胶唱片')).toBeTruthy()
    expect(getByText('左右分栏')).toBeTruthy()

    // Select cinematic style
    const cinematicCard = getByTestId('now-playing-style-cinematic')
    expect(cinematicCard).toBeTruthy()
    fireEvent.click(cinematicCard)

    await waitFor(() => {
      expect(settings.calls.some((c) => c.includes('"nowPlayingStyle":"cinematic"'))).toBe(true)
      expect(calls.includes('nowPlaying:setStyle:cinematic')).toBe(true)
    })
  })

  it('imports a sandboxed player plugin and deletes it', async () => {
    const { ctx, calls, settings } = await npHarness()
    const { getByText, getByTestId } = render(h(NowPlayingStylesSection, { ctx }))

    // Open import modal
    const importBtn = getByTestId('import-style-button')
    fireEvent.click(importBtn)
    expect(getByText('导入外部播放页样式插件')).toBeTruthy()
    expect(getByText('沙箱隔离保障：')).toBeTruthy()

    // Try submitting empty JSON -> error
    const submitBtn = getByTestId('submit-import-style')
    fireEvent.click(submitBtn)
    expect(getByTestId('import-style-error')).toBeTruthy()
    expect(getByTestId('import-style-error').textContent).toContain('请输入或选择播放页模板插件 JSON 清单')

    // Click load sample template button
    const loadSampleBtn = getByTestId('load-sample-template-button')
    fireEvent.click(loadSampleBtn)

    const textarea = getByTestId('style-manifest-textarea') as HTMLTextAreaElement
    expect(textarea.value).toContain('sample-neon-player')
    expect(textarea.value).toContain('霓虹沙箱播放器')

    // Submit valid sample template
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(calls.some((c) => c.includes('nowPlaying:register:sample-neon-player'))).toBe(true)
      expect(settings.calls.some((c) => c.includes('"nowPlayingStyle":"sample-neon-player"'))).toBe(true)
      expect(calls.includes('nowPlaying:setStyle:sample-neon-player')).toBe(true)
    })

    // Verify imported style card rendered with sandboxed badge
    expect(getByText('霓虹沙箱播放器')).toBeTruthy()
    expect(getByText('沙箱 🛡️')).toBeTruthy()

    // Delete custom style
    const deleteBtn = getByTestId('delete-style-sample-neon-player')
    expect(deleteBtn).toBeTruthy()
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(calls.includes('nowPlaying:remove:sample-neon-player')).toBe(true)
    })
  })
})
