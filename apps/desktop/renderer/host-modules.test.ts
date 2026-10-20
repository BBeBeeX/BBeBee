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

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  HOST_MODULES,
  HOST_MODULE_SPECIFIERS,
  HOST_REACT_VERSION,
  buildDevImportMap,
  buildImportMap,
  renderImportMapTag,
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
      expect(m.devFile).toMatch(/^[\w-]+\.js$/)
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
    const map = buildDevImportMap()
    expect(Object.keys(map.imports).sort()).toEqual([...HOST_MODULE_SPECIFIERS].sort())
    for (const m of HOST_MODULES) {
      expect(map.imports[m.specifier]).toBe(`/node_modules/.vite/deps/${m.devFile}`)
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
