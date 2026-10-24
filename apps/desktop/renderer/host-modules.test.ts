/**
 * Host-shared modules: the manifest is the contract, checked as data.
 *
 * `host-modules.manifest.ts` is the single source of truth for the React
 * surface the shell shares with dynamically loaded plugins. Everything else
 * (vite external list, the injected import map, the esbuild host chunks in
 * `dist/host/`) derives from it — these tests pin the derivations that can
 * drift silently:
 *
 *  - the version constant vs the react dependency the app actually installs
 *    (a react bump that forgets the manifest would share the wrong version);
 *  - the import maps covering exactly the manifest specifiers, no more, no
 *    less (a missing entry means a plugin's `import 'react'` resolves
 *    nowhere; a stale entry means two module surfaces to keep in sync).
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  HOST_MODULES,
  HOST_MODULE_SPECIFIERS,
  HOST_REACT_VERSION,
  buildDevImportMap,
  buildImportMap,
  importMapCspHashSource,
  importMapScriptText,
  renderImportMapTag,
  withImportMapCspHash,
  type ImportMap,
} from './host-modules.manifest.js'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { dependencies: Record<string, string> }

describe('host-modules manifest', () => {
  it('pins the react version the app actually installs', () => {
    expect(pkg.dependencies['react']).toBe(HOST_REACT_VERSION)
    expect(pkg.dependencies['react-dom']).toBe(HOST_REACT_VERSION)
  })

  it('derives the specifier list from the module entries, in order', () => {
    expect(HOST_MODULE_SPECIFIERS).toEqual(HOST_MODULES.map((m) => m.specifier))
    expect(new Set(HOST_MODULE_SPECIFIERS).size).toBe(HOST_MODULES.length)
  })

  it('gives every entry a host file under host/ and a dev pre-bundle file', () => {
    for (const m of HOST_MODULES) {
      expect(m.file).toMatch(/^host\/[\w-]+\.js$/)
      // Vite flattens scoped specifiers to `@scope_name.js`, so the dev
      // pre-bundle file may carry a leading `@`.
      expect(m.devFile).toMatch(/^[\w@-]+\.js$/)
      expect(m.entry.length).toBeGreaterThan(0)
    }
  })
})

describe('host-modules single source of truth', () => {
  it('index.html does not hand-write an import map (vite.config injects it from the manifest)', () => {
    const html = readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8')
    expect(html).not.toContain('importmap')
  })
})

describe('host-modules import maps', () => {
  it('maps every specifier, and nothing else, to its ./host/*.js chunk', () => {
    const map = buildImportMap()
    expect(Object.keys(map.imports).sort()).toEqual([...HOST_MODULE_SPECIFIERS].sort())
    for (const m of HOST_MODULES) {
      expect(map.imports[m.specifier]).toBe(`./${m.file}`)
    }
  })

  it('dev map points at vite pre-bundled deps for the same specifiers', () => {
    // The /@fs/ form is the one Vite actually serves for deps outside its
    // root (see buildDevImportMap); the /node_modules/.vite/deps/ form falls
    // through to the SPA fallback and answers index.html, and a ?v= with the
    // optimizer's browserHash answers 504 (outdated request) — so the map
    // carries bare /@fs/ URLs, no query.
    const map = buildDevImportMap('/@fs/test-deps')
    expect(Object.keys(map.imports).sort()).toEqual([...HOST_MODULE_SPECIFIERS].sort())
    for (const m of HOST_MODULES) {
      expect(map.imports[m.specifier]).toBe(`/@fs/test-deps/${m.devFile}`)
    }
  })

  it('renders a parseable import map script tag', () => {
    const tag = renderImportMapTag(buildImportMap())
    expect(tag.startsWith('<script type="importmap">')).toBe(true)
    expect(tag.endsWith('</script>')).toBe(true)
    const json = tag.slice('<script type="importmap">'.length, -'</script>'.length)
    expect(JSON.parse(json)).toEqual(buildImportMap())
  })
})

describe('host-modules import map CSP allowlist', () => {
  const sourceHtml = readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8')

  /**
   * The document the transform serves: the CSP-augmented source with the
   * import map tag placed the way vite injects it (`head-prepend`), both
   * produced by the same manifest functions vite.config.ts calls.
   */
  function generatedHtml(map: ImportMap): string {
    return withImportMapCspHash(sourceHtml, map).replace('<head>', `<head>${renderImportMapTag(map)}`)
  }

  function importMapTextOf(html: string): string {
    const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)
    if (!m) throw new Error('generated html has no import map script')
    return m[1]!
  }

  function policyOf(html: string): Map<string, string[]> {
    return new Map(
      (/content="([^"]*\bdefault-src\b[^"]*)"/.exec(html)?.[1] ?? '')
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .filter(([name]) => name)
        .map(([name, ...sources]) => [name!, sources]),
    )
  }

  function sha256SourceOf(text: string): string {
    return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`
  }

  for (const [mode, build] of [
    ['prod', buildImportMap],
    ['dev', () => buildDevImportMap('/@fs/test-deps')],
  ] as const) {
    it(`${mode}: script-src carries exactly the sha256 of the served import map text`, () => {
      const html = generatedHtml(build())
      // The hash input is the script text as served, recomputed independently.
      const expected = sha256SourceOf(importMapTextOf(html))
      expect(importMapCspHashSource(build())).toBe(expected)
      expect(policyOf(html).get('script-src')).toContain(expected)
      // …and the served text is the manifest's serialization of the same map.
      expect(importMapTextOf(html)).toBe(importMapScriptText(build()))
      expect(JSON.parse(importMapTextOf(html))).toEqual(build())
    })

    it(`${mode}: the augmentation adds one hash token and widens nothing else`, () => {
      const before = policyOf(sourceHtml)
      const after = policyOf(generatedHtml(build()))
      expect([...after.keys()]).toEqual([...before.keys()])
      for (const [directive, sources] of before) {
        if (directive !== 'script-src') expect(after.get(directive)).toEqual(sources)
      }
      const beforeScripts = before.get('script-src') ?? []
      const afterScripts = after.get('script-src') ?? []
      expect(afterScripts.slice(0, beforeScripts.length)).toEqual(beforeScripts)
      expect(afterScripts.slice(beforeScripts.length)).toEqual([importMapCspHashSource(build())])
      expect(afterScripts).not.toContain("'unsafe-inline'")
      expect(afterScripts).not.toContain("'unsafe-eval'")
    })
  }

  it('prod and dev maps produce different hashes', () => {
    expect(importMapCspHashSource(buildImportMap())).not.toBe(
      importMapCspHashSource(buildDevImportMap('/@fs/test-deps')),
    )
  })

  it('fails loud when the page has no CSP meta', () => {
    expect(() => withImportMapCspHash('<html><head></head></html>', buildImportMap())).toThrow(
      /Content-Security-Policy meta/,
    )
  })

  it('fails loud when the CSP has no script-src directive', () => {
    const html =
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\'" />'
    expect(() => withImportMapCspHash(html, buildImportMap())).toThrow(/no script-src directive/)
  })

  it('fails loud instead of stacking a second sha256 source', () => {
    const once = withImportMapCspHash(sourceHtml, buildImportMap())
    expect(() => withImportMapCspHash(once, buildImportMap())).toThrow(/already carries a sha256/)
  })
})
