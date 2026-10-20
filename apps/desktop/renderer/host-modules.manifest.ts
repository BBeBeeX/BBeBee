/**
 * Host-shared modules: the single source of truth for the module surface the
 * desktop shell shares with dynamically loaded plugins (`bbebee-plugin://`
 * imports + composite UI loading in `dynamic-loader.ts`).
 *
 * Why this exists: plugin UIs render inside the host React tree, so they must
 * use the host's React instance. Two copies of React in the page (one in the
 * app bundle, one in the plugin) break hooks/context. These modules are built
 * as host chunks into `dist/host/` (see `scripts/build-host-modules.js`) and
 * resolved for every module in the page — the app bundle included — through an
 * import map injected into `index.html` by `vite.config.ts`.
 *
 * Everything downstream (vite config, the import map generator, the host
 * chunk build script, and the consistency tests) derives from this file.
 * Do NOT write the specifier list anywhere else by hand.
 *
 * Note: the build script imports this file through Node's type stripping, so
 * keep the syntax erasable (no enums, namespaces, or other runtime-emitting
 * constructs).
 */

export interface HostModuleEntry {
  /** Bare specifier as written in source code, e.g. `'react'`. */
  specifier: string
  /** Host chunk path relative to the app root, e.g. `'host/react.js'`. */
  file: string
  /** Package (sub)path the host chunk is built from, e.g. `'react-dom/client'`. */
  entry: string
  /**
   * File name of the same module inside vite's dev pre-bundle
   * (`<root>/node_modules/.vite/deps/`), used only for the dev-mode import map.
   */
  devFile: string
}

/** Single source of truth for the host React version (mirrors apps/desktop package.json). */
export const HOST_REACT_VERSION = '19.2.3'

export const HOST_MODULES: readonly HostModuleEntry[] = [
  { specifier: 'react', file: 'host/react.js', entry: 'react', devFile: 'react.js' },
  { specifier: 'react-dom', file: 'host/react-dom.js', entry: 'react-dom', devFile: 'react-dom.js' },
  {
    specifier: 'react-dom/client',
    file: 'host/react-dom-client.js',
    entry: 'react-dom/client',
    devFile: 'react-dom_client.js',
  },
  {
    specifier: 'react/jsx-runtime',
    file: 'host/jsx-runtime.js',
    entry: 'react/jsx-runtime',
    devFile: 'react_jsx-runtime.js',
  },
  {
    specifier: 'react/jsx-dev-runtime',
    file: 'host/jsx-dev-runtime.js',
    entry: 'react/jsx-dev-runtime',
    devFile: 'react_jsx-dev-runtime.js',
  },
]

/** Bare specifiers to externalize in the renderer build. */
export const HOST_MODULE_SPECIFIERS: readonly string[] = HOST_MODULES.map((m) => m.specifier)

export interface ImportMap {
  imports: Record<string, string>
}

/** Production import map: bare specifier -> `./host/*.js` relative to the document. */
export function buildImportMap(): ImportMap {
  const imports: Record<string, string> = {}
  for (const m of HOST_MODULES) {
    imports[m.specifier] = `./${m.file}`
  }
  return { imports }
}

/**
 * Dev-mode import map: points at vite's pre-bundled copies of the same modules
 * (`/node_modules/.vite/deps/…`), so the dev app and dynamically loaded
 * plugin code share one React instance during `vite` dev as well.
 * Best-effort: dev-mode external plugin loading is already constrained on
 * some WebViews (see vite.config.ts).
 */
export function buildDevImportMap(): ImportMap {
  const imports: Record<string, string> = {}
  for (const m of HOST_MODULES) {
    imports[m.specifier] = `/node_modules/.vite/deps/${m.devFile}`
  }
  return { imports }
}

/** Renders an import map as a `<script type="importmap">` tag. */
export function renderImportMapTag(map: ImportMap): string {
  return `<script type="importmap">${JSON.stringify(map)}</script>`
}
