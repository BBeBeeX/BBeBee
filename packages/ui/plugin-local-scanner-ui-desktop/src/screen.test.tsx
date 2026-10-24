// @vitest-environment jsdom
/**
 * The scan-roots screen, and whether anyone can reach it.
 *
 * Two different claims, and only the first was ever true:
 *
 *  - The screen has a *Scan now* button that calls `ctx.scanner.scan()`.
 *  - Something in the app can navigate to the screen.
 *
 * `plugin-local-scanner` contributes it as a **settings** page, and both
 * shells read only `ctx.ui.routes` — so the button existed, had a view bound
 * to it, and could not be pressed. A contribution nothing renders is a feature
 * nobody has, which is why the reachability half is pinned here rather than
 * left to a device run.
 */

import { act, cleanup, render } from '@testing-library/react'
import { createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { CodecNode } from '@bbebee/core-codec-node'
import uiPlugin from '@bbebee/plugin-ui'
import scannerPlugin from '@bbebee/plugin-local-scanner'
import { withListLayout } from '@BBeBee/ui-kit-desktop/testing'
import { tempDir, tick } from '@BBeBee/kernel/testing'
import { ScanSpecifiedDirsScreen, inject } from './index.js'
import localScannerCatalogue from '../../../feature/plugin-i18n/src/locales/localScanner.json'

afterEach(cleanup)

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

/** The real scanner and the real `ctx.ui`, so both claims are about real wiring. */
async function harness(): Promise<{ ctx: Context; admin: Context }> {
  const root = new Context()
  await root.plugin(PathsNode, { root: await tempDir('bbebee-scan-ui') })
  await root.plugin(FsNode)
  await root.plugin(DbNode, { fileName: ':memory:' })
  // `plugin-local-scanner` requires `codec`; without it the plugin never
  // activates and `ctx.scanner` never appears.
  await root.plugin(CodecNode)
  await root.plugin(uiPlugin)
  await root.plugin(scannerPlugin)
  await root.plugin(DefaultI18nStub)
  await tick()

  // Scoped to what this package declares, plus `i18n`: the screen reads it
  // through `useI18n`, which degrades to raw keys without the service, so the
  // stub keeps the English-copy assertions below honest. Undeclared reads
  // still throw here exactly as they would in the app.
  const declared = [...inject.filter((name) => name !== 'ui'), 'i18n']
  let scoped: Context | undefined
  root.inject(declared, (s) => void (scoped = s))
  // The scanner's init is genuinely async — it writes its source row, loads
  // its roots and starts watching — so the inject callback lands a few turns
  // later rather than on the next microtask.
  for (let i = 0; i < 20 && !scoped; i++) await tick()
  if (!scoped) throw new Error('scan-ui harness: no scoped context')
  return { ctx: scoped, admin: root }
}

/** The button whose accessible name or label matches. */
function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text,
  )
}


describe('ScanSpecifiedDirsScreen', () => {
  it('offers a scan button that starts a scan', async () => {
    const { ctx } = await harness()
    const scan = vi.spyOn(ctx.scanner, 'scan')

    const { container } = await withListLayout(async () => {
      const view = render(h(ScanSpecifiedDirsScreen, { ctx }))
      await act(async () => {
        await tick()
      })
      return view
    })

    const button = buttonNamed(container, 'Scan now')
    expect(button, 'the screen has a scan button').toBeTruthy()

    await act(async () => {
      button!.click()
      await tick()
    })
    expect(scan, 'pressing it walks the specified dirs').toHaveBeenCalled()
  })

  it('offers a way to add a folder, since a scan with no folders does nothing', async () => {
    const { ctx } = await harness()
    const { container } = await withListLayout(async () => {
      const view = render(h(ScanSpecifiedDirsScreen, { ctx }))
      await act(async () => {
        await tick()
      })
      return view
    })

    expect(buttonNamed(container, 'Add folder')).toBeTruthy()
    expect(container.textContent, 'and says so while there are none').toContain('No folders yet')
  })

  /**
   * The button that reads a *second* service, which is where this went wrong.
   *
   * The screen's state comes from `ctx.scanner`, so rendering it proved
   * nothing about `ctx.fs` — and `addFolder` is the only place that touches
   * it. Pressing it on a scoped context is the whole test: an undeclared read
   * throws `cannot get property "fs" without inject`, which is what a device
   * reported while the render tests above stayed green.
   */
  it('picks a folder through ctx.fs, which it may only reach if it declares it', async () => {
    const { ctx, admin } = await harness()
    const dir = await tempDir('bbebee-picked-dir')
    // Spied through the root context: the same service instance the scoped
    // `ctx` resolves, but reachable here without `inject` in the way. `FsNode`
    // has no dialog to open, so the picked uri has to come from the stub.
    const pick = vi.spyOn(admin.fs, 'pickDirectory').mockResolvedValue(`file://${dir}`)
    const addSpecifiedDir = vi.spyOn(ctx.scanner, 'addSpecifiedDir')

    await withListLayout(async () => {
      const { container } = render(h(ScanSpecifiedDirsScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain('No folders yet')

      await act(async () => {
        buttonNamed(container, 'Add folder')!.click()
        for (let i = 0; i < 20; i++) await tick()
      })

      expect(pick, 'the picker is what carries the permission grant').toHaveBeenCalled()
      expect(addSpecifiedDir, 'and what it returns becomes a scan specified dir').toHaveBeenCalledWith(`file://${dir}`)
      expect(container.textContent).toContain(dir)
    })
  })

  it('shows a folder that was added, and a way to remove it', async () => {
    const { ctx } = await harness()
    const dir = await tempDir('bbebee-scan-dir')
    await ctx.scanner.addSpecifiedDir(`file://${dir}`)

    const { container } = await withListLayout(async () => {
      const view = render(h(ScanSpecifiedDirsScreen, { ctx }))
      await act(async () => {
        await tick()
      })
      return view
    })

    expect(container.textContent).toContain(dir)
    expect(buttonNamed(container, `Remove file://${dir}`)).toBeTruthy()
  })

  it('removes a folder when remove button is clicked', async () => {
    const { ctx } = await harness()
    const dir = await tempDir('bbebee-scan-dir-remove')
    await ctx.scanner.addSpecifiedDir(`file://${dir}`)

    await withListLayout(async () => {
      const { container } = render(h(ScanSpecifiedDirsScreen, { ctx }))
      await act(async () => {
        await tick()
      })

      expect(container.textContent).toContain(dir)

      const removeBtn = buttonNamed(container, `Remove file://${dir}`)
      expect(removeBtn).toBeTruthy()

      await act(async () => {
        removeBtn!.click()
        for (let i = 0; i < 20; i++) await tick()
      })

      expect(container.textContent).not.toContain(dir)
      expect(container.textContent).toContain('No folders yet')
    })
  })

  it('offers a per-folder scan button that scans that specific specified dir', async () => {
    const { ctx } = await harness()
    const dir = await tempDir('bbebee-scan-dir-per-folder')
    const specifiedDir = await ctx.scanner.addSpecifiedDir(`file://${dir}`)
    const scan = vi.spyOn(ctx.scanner, 'scan')

    const { container } = await withListLayout(async () => {
      const view = render(h(ScanSpecifiedDirsScreen, { ctx }))
      await act(async () => {
        await tick()
      })
      return view
    })

    const scanBtn = buttonNamed(container, `Scan file://${dir}`)
    expect(scanBtn).toBeTruthy()

    await act(async () => {
      scanBtn!.click()
      await tick()
    })

    expect(scan).toHaveBeenCalledWith({ specifiedDirId: specifiedDir.id })
  })
})
