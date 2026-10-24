// @vitest-environment jsdom
/**
 * The mobile scan-roots screen, rendered and pressed.
 *
 * ⚠️ **This package had no tests, and that is how the device run went wrong.**
 * Its desktop twin was covered, the two are transcriptions of each other, and
 * both were wrong in the same place: the screen reads `ctx.scanner` for its
 * state and `ctx.fs` for the folder picker, but only the first was declared.
 * A phone opening *Music folders* reported
 * `cannot get property "fs" without inject` — from a promise, because the
 * read is inside `addFolder`.
 *
 * So the context here is **scoped to this package's own `inject`**, exactly as
 * `plugin-sources-ui-mobile`'s screens test is: a root `Context` answers
 * `undefined` for a service nobody injected and would have gone on passing.
 *
 * React Native is injected as DOM host components, which is the same seam
 * `apps/mobile` uses to hand over the real `react-native`.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { CodecNode } from '@bbebee/core-codec-node'
import scannerPlugin from '@bbebee/plugin-local-scanner'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { configureNative } from '@BBeBee/ui-kit-mobile'
import { ScanSpecifiedDirsScreen, inject } from './index.js'
import localScannerCatalogue from '../../../feature/plugin-i18n/src/locales/localScanner.json'

afterEach(cleanup)

/** A fake native host: a `div` that keeps the RN props it was given. */
function hostComponent(name: string) {
  return function Host(props: Record<string, unknown> & { children?: ReactNode }) {
    const { children, accessibilityLabel, accessibilityRole, onPress, testID } = props
    return h(
      'div',
      {
        'data-host': name,
        'data-label': typeof accessibilityLabel === 'string' ? accessibilityLabel : undefined,
        'data-role': typeof accessibilityRole === 'string' ? accessibilityRole : undefined,
        'data-testid': typeof testID === 'string' ? testID : undefined,
        onClick: typeof onPress === 'function' ? (onPress as () => void) : undefined,
      },
      children,
    )
  }
}

configureNative({
  View: hostComponent('View'),
  Text: hostComponent('Text'),
  Pressable: hostComponent('Pressable'),
  Image: hostComponent('Image'),
  Modal: hostComponent('Modal'),
  // FlashList takes `data`/`renderItem`, not children, so it needs its own.
  FlashList: function FlashList(props: {
    data?: readonly unknown[]
    renderItem?: (info: { item: unknown; index: number }) => ReactNode
    ListEmptyComponent?: ReactNode
    accessibilityLabel?: string
  }) {
    const items = props.data ?? []
    return h(
      'div',
      { 'data-host': 'FlashList', 'data-label': props.accessibilityLabel, role: 'list' },
      items.length === 0
        ? (props.ListEmptyComponent as ReactNode)
        : items.map((item, index) =>
            h('div', { key: index, role: 'listitem' }, props.renderItem?.({ item, index })),
          ),
    )
  },
  ActivityIndicator: hostComponent('ActivityIndicator'),
  TextInput: hostComponent('TextInput'),
})

/**
 * English i18n service for tests: serves the real `localScanner` catalogue so
 * the screen renders the same copy the app shows in English. Mirrors the
 * `DefaultI18nStub` in `apps/desktop/renderer/Shell.test.tsx`.
 */
const SCANNER_CATALOGUE: Record<string, { en: unknown }> = {
  localScanner: { en: (localScannerCatalogue as { en: unknown }).en },
}

class DefaultI18nStub extends Service {
  static override readonly name = 'i18n'
  locale = 'en'
  private listeners = new Set<(locale: string) => void>()

  constructor(ctx: Context) {
    super(ctx, 'i18n')
  }

  t = (key: string, params?: Record<string, string | number>): string => {
    const sep = key.indexOf(':')
    if (sep < 0) return key
    const catalogue = SCANNER_CATALOGUE[key.slice(0, sep)]?.en
    if (!catalogue) return key
    let cur: unknown = catalogue
    for (const part of key.slice(sep + 1).split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof cur !== 'string') return key
    return params
      ? cur.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`))
      : cur
  }

  onLocaleChange = (cb: (locale: string) => void): (() => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
}

/** The scoped context a shell hands a view, plus the root for fixtures. */
async function harness(): Promise<{ ctx: Context; admin: Context }> {
  const root = new Context()
  await root.plugin(PathsNode, { root: await tempDir('bbebee-scan-ui-mobile') })
  await root.plugin(FsNode)
  await root.plugin(DbNode, { fileName: ':memory:' })
  // `plugin-local-scanner` requires `codec`; without it the plugin never
  // activates and `ctx.scanner` never appears.
  await root.plugin(CodecNode)
  await root.plugin(scannerPlugin)
  await root.plugin(DefaultI18nStub)
  await tick()

  /*
   * Scoped to **this package's own `inject`**, minus `ui`, plus `i18n`: the
   * screen reads it through `useI18n`, which degrades to raw keys without the
   * service, so the stub keeps the English-copy assertions below honest.
   * Derived rather than written out, so a screen that reads an undeclared
   * service throws here exactly as it would in the app.
   */
  const declared = [...inject.filter((name) => name !== 'ui'), 'i18n']
  let scoped: Context | undefined
  root.inject(declared, (s) => void (scoped = s))
  // The scanner's init is genuinely async — it writes its source row, loads
  // its roots and starts watching — so the inject callback lands a few turns
  // later rather than on the next microtask.
  for (let i = 0; i < 20 && !scoped; i++) await tick()
  if (!scoped) throw new Error('scan-ui mobile harness: no scoped context')
  return { ctx: scoped, admin: root }
}

/** The pressable whose label or text matches — RN has no `<button>`. */
function pressableNamed(container: HTMLElement, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-host="Pressable"]')).find(
    (el) => el.textContent?.trim() === text || el.getAttribute('data-label') === text,
  )
}

describe('ScanSpecifiedDirsScreen on mobile', () => {
  it('says there are no folders yet, rather than showing a blank screen', async () => {
    const { ctx } = await harness()
    const { container } = render(h(ScanSpecifiedDirsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain('No folders yet')
    expect(pressableNamed(container, 'Add folder'), 'and offers a way to fix that').toBeTruthy()
  })

  it('shows a folder that was added, and a way to remove it', async () => {
    const { ctx } = await harness()
    const dir = await tempDir('bbebee-scan-dir-mobile')
    await ctx.scanner.addSpecifiedDir(`file://${dir}`)

    const { container } = render(h(ScanSpecifiedDirsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    expect(container.textContent).toContain(dir)
    expect(pressableNamed(container, `Remove file://${dir}`)).toBeTruthy()
  })

  /**
   * The button that reads a *second* service, which is where this went wrong.
   *
   * The screen's state comes from `ctx.scanner`, so rendering it proved
   * nothing about `ctx.fs` — and `addFolder` is the only place that touches
   * it. Pressing it on a scoped context is the whole test.
   */
  it('picks a folder through ctx.fs, which it may only reach if it declares it', async () => {
    const { ctx, admin } = await harness()
    const dir = await tempDir('bbebee-picked-dir-mobile')
    // Spied through the root context: the same service instance the scoped
    // `ctx` resolves, but reachable here without `inject` in the way. `FsNode`
    // has no dialog to open, so the picked uri has to come from the stub.
    const pick = vi.spyOn(admin.fs, 'pickDirectory').mockResolvedValue(`file://${dir}`)
    const addSpecifiedDir = vi.spyOn(ctx.scanner, 'addSpecifiedDir')

    const { container } = render(h(ScanSpecifiedDirsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    await act(async () => {
      pressableNamed(container, 'Add folder')!.click()
      await tick()
      await tick()
    })

    expect(pick, 'the picker is what carries the SAF grant on Android').toHaveBeenCalled()
    expect(addSpecifiedDir, 'and what it returns becomes a scan specified dir').toHaveBeenCalledWith(`file://${dir}`)
  })

  it('offers a scan button that starts a scan', async () => {
    const { ctx } = await harness()
    const scan = vi.spyOn(ctx.scanner, 'scan')

    const { container } = render(h(ScanSpecifiedDirsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    const button = pressableNamed(container, 'Scan now')
    expect(button, 'the mobile screen has a scan button').toBeTruthy()

    await act(async () => {
      button!.click()
      await tick()
    })
    expect(scan, 'pressing it walks the specified dirs').toHaveBeenCalled()
  })

  it('offers a per-folder scan button that scans that specific specified dir', async () => {
    const { ctx } = await harness()
    const dir = await tempDir('bbebee-scan-dir-mobile-per-folder')
    const specifiedDir = await ctx.scanner.addSpecifiedDir(`file://${dir}`)
    const scan = vi.spyOn(ctx.scanner, 'scan')

    const { container } = render(h(ScanSpecifiedDirsScreen, { ctx }))
    await act(async () => {
      await tick()
    })

    const scanBtn = pressableNamed(container, `Scan file://${dir}`)
    expect(scanBtn).toBeTruthy()

    await act(async () => {
      scanBtn!.click()
      await tick()
    })

    expect(scan).toHaveBeenCalledWith({ specifiedDirId: specifiedDir.id })
  })
})
