/**
 * The scaffolder's output.
 *
 * `render` is pure, so the shape of a generated package is checkable without
 * touching disk. The properties asserted here are the ones a hand-rolled
 * plugin gets wrong — and that fail silently when they do.
 */

import { describe, expect, it } from 'vitest'
import { packageNameFor, render, serviceNameFor } from './index.js'

const base = { root: '/tmp', name: 'scrobble', kind: 'feature' as const, ui: 'none' as const }
const fileNamed = (files: ReturnType<typeof render>, suffix: string) =>
  files.find((f) => f.path.endsWith(suffix))!

describe('naming', () => {
  it('prefixes by kind', () => {
    expect(packageNameFor('feature', 'scrobble')).toBe('plugin-scrobble')
    expect(packageNameFor('effect', 'eq10')).toBe('plugin-effect-eq10')
  })

  it('rejects an unknown kind rather than scaffolding the wrong package', () => {
    expect(() => render({ ...base, kind: 'source' as never })).toThrow(/--kind must be one of/)
    expect(() => render({ ...base, kind: 'source' as never })).toThrow(/imported document/)
  })

  it('rejects an unknown ui target', () => {
    expect(() => render({ ...base, ui: 'web' as never })).toThrow(/--ui must be one of/)
  })

  it('camel-cases the service key', () => {
    expect(serviceNameFor('log-buffer')).toBe('logBuffer')
  })

  it('rejects a name that is not a slug', () => {
    for (const bad of ['Scrobble', 'plugin_x', '9lives', '@scope/x']) {
      expect(() => render({ ...base, name: bad }), bad).toThrow(/must match/)
    }
  })
})

describe('generated headless package', () => {
  const files = render(base)

  it('emits a manifest, tsconfigs, source and a test', () => {
    for (const suffix of [
      'package.json',
      'BBeBee.plugin.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'src/index.ts',
      'src/index.test.ts',
    ]) {
      expect(files.some((f) => f.path.endsWith(suffix)), suffix).toBe(true)
    }
  })

  it('awaits its child plugin', () => {
    // The defect that bit twice while building M0: an un-awaited child does
    // not propagate readiness. The template must not teach it.
    const source = fileNamed(files, 'src/index.ts').contents
    expect(source).toContain('await ctx.plugin(')
    expect(source).not.toMatch(/\n\s*const fiber = ctx\.plugin\(/)
  })

  it('ships a leak test, not just a smoke test', () => {
    const test = fileNamed(files, 'src/index.test.ts').contents
    expect(test).toContain('diffSnapshots')
  })

  it('depends only on the contract layer', () => {
    // docs/02 §1 — a Layer 3 package depends on Layer 0 and, for the pinned
    // Cordis surface, Layer 1. Never on a `core-*` package: a Layer 2
    // dependency is spelled `inject: ['fs']`, not an import.
    const pkg = JSON.parse(fileNamed(files, 'package.json').contents) as {
      dependencies: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@BBeBee/kernel',
      '@BBeBee/protocol',
      'cordis',
    ])
  })

  it('lands each package in its layer directory', () => {
    // docs/09 §1 — eslint.config.js keys its rules off the layer directory,
    // so a scaffolded package in the wrong one is silently governed by the
    // wrong rules. Headless is Layer 3; its views are Layer 4.
    const withUi = render({ ...base, ui: 'desktop' })
    for (const file of withUi) {
      const expected = file.path.includes('-ui-desktop/') ? 'ui' : 'feature'
      expect(file.path, file.path).toMatch(new RegExp(`^packages/${expected}/`))
    }
  })

  it('marks nothing instantiable', () => {
    // The scaffolder used to emit `plugin-source-<name>` with
    // `instantiable: true`, because one source plugin served many servers.
    // Both concepts are gone: a music backend is an imported document, and
    // two servers are two documents (docs/06 §1.2, docs/09 §1).
    for (const kind of ['feature', 'effect'] as const) {
      const manifest = JSON.parse(
        fileNamed(render({ ...base, kind }), 'BBeBee.plugin.json').contents,
      ) as Record<string, unknown>
      expect(manifest.instantiable, kind).toBeUndefined()
    }
  })
})

describe('view packages', () => {
  it('emits none by default', () => {
    expect(render(base).some((f) => f.path.includes('-ui-'))).toBe(false)
  })

  it('emits one per requested target, and records them in the manifest', () => {
    const files = render({ ...base, ui: 'both' })
    expect(files.some((f) => f.path.includes('plugin-scrobble-ui-desktop'))).toBe(true)
    expect(files.some((f) => f.path.includes('plugin-scrobble-ui-mobile'))).toBe(true)

    const manifest = JSON.parse(fileNamed(files, 'BBeBee.plugin.json').contents) as {
      entry: { ui?: { desktop?: string; mobile?: string } }
    }
    expect(manifest.entry.ui?.desktop).toBeDefined()
    expect(manifest.entry.ui?.mobile).toBeDefined()
  })

  it('gives a view package a type-only dependency on the headless one', () => {
    const files = render({ ...base, ui: 'desktop' })
    const pkg = JSON.parse(
      files.find((f) => f.path.endsWith('plugin-scrobble-ui-desktop/package.json'))!.contents,
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
    // Views take the headless package as a dev dependency: types, not values.
    expect(pkg.devDependencies['@bbebee/plugin-scrobble']).toBe('workspace:*')
    expect(pkg.dependencies['@bbebee/plugin-scrobble']).toBeUndefined()
  })
})
