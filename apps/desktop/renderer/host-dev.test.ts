/**
 * Dev-mode host shims: their named export surface must be exactly the
 * CommonJS package's real export surface.
 *
 * The React family's dep files are default-only, so the shims enumerate the
 * names by hand — a React bump that adds an export would otherwise fail
 * silently at plugin load ("does not provide an export named …"). This pins
 * each shim against a live `require()` of the pinned version, the same
 * discovery scripts/build-host-modules.js uses for the production chunks.
 * The ESM shims (`export *`) are exact by construction and need no pinning.
 */

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import * as reactDomClientShim from './host-dev/react-dom-client.js'
import * as reactDomShim from './host-dev/react-dom.js'
import * as reactJsxDevRuntimeShim from './host-dev/react-jsx-dev-runtime.js'
import * as reactJsxRuntimeShim from './host-dev/react-jsx-runtime.js'
import * as reactShim from './host-dev/react.js'

const require = createRequire(import.meta.url)

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function cjsExportNames(entry: string): string[] {
  const mod = require(entry) as Record<string, unknown>
  return Object.keys(mod ?? {})
    .filter((k) => k !== 'default' && IDENT.test(k))
    .sort()
}

describe('host-dev CJS shims', () => {
  for (const [entry, shim] of [
    ['react', reactShim],
    ['react-dom', reactDomShim],
    ['react-dom/client', reactDomClientShim],
    ['react/jsx-runtime', reactJsxRuntimeShim],
    ['react/jsx-dev-runtime', reactJsxDevRuntimeShim],
  ] as const) {
    it(`${entry}: named exports match the live CJS surface`, () => {
      const named = Object.keys(shim)
        .filter((k) => k !== 'default')
        .sort()
      expect(named).toEqual(cjsExportNames(entry))
      // The default must be the same object the names were taken from, or a
      // plugin's default import and named imports would fork instances.
      for (const name of named) {
        expect((shim as Record<string, unknown>)[name]).toBe(
          (shim.default as Record<string, unknown>)[name],
        )
      }
    })
  }
})
