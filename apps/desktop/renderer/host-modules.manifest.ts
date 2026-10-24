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
 * constructs). Every importer of this file runs in Node (vite config, build
 * scripts, tests) — nothing here ships in the renderer bundle, which is why
 * the CSP helpers below may use `node:crypto`.
 */
import { createHash } from 'node:crypto'

export interface HostModuleEntry {
  /** Bare specifier as written in source code, e.g. `'react'`. */
  specifier: string
  /** Host chunk path relative to the app root, e.g. `'host/react.js'`. */
  file: string
  /** Package (sub)path the host chunk is built from, e.g. `'react-dom/client'`. */
  entry: string
  /**
   * File name of the same module inside vite's dev pre-bundle
   * (`<root>/node_modules/.vite/deps/`). Kept as documentation of which dep
   * file a dev shim's bare import resolves to; the dev-mode import map does
   * NOT point at it directly (see buildDevImportMap).
   */
  devFile: string
  /**
   * Dev-mode shim file under `renderer/host-dev/`, e.g. `'react-dom-client.ts'`.
   * Served by vite in dev and used as the dev-mode import map target.
   */
  devShim: string
}

/** Single source of truth for the host React version (mirrors apps/desktop package.json). */
export const HOST_REACT_VERSION = '19.2.3'

export const HOST_MODULES: readonly HostModuleEntry[] = [
  {
    specifier: 'react',
    file: 'host/react.js',
    entry: 'react',
    devFile: 'react.js',
    devShim: 'react.ts',
  },
  {
    specifier: 'react-dom',
    file: 'host/react-dom.js',
    entry: 'react-dom',
    devFile: 'react-dom.js',
    devShim: 'react-dom.ts',
  },
  {
    specifier: 'react-dom/client',
    file: 'host/react-dom-client.js',
    entry: 'react-dom/client',
    devFile: 'react-dom_client.js',
    devShim: 'react-dom-client.ts',
  },
  {
    specifier: 'react/jsx-runtime',
    file: 'host/jsx-runtime.js',
    entry: 'react/jsx-runtime',
    devFile: 'react_jsx-runtime.js',
    devShim: 'react-jsx-runtime.ts',
  },
  {
    specifier: 'react/jsx-dev-runtime',
    file: 'host/jsx-dev-runtime.js',
    entry: 'react/jsx-dev-runtime',
    devFile: 'react_jsx-dev-runtime.js',
    devShim: 'react-jsx-dev-runtime.ts',
  },
  // Framework modules. A headless plugin bundle keeps its bare imports
  // of these (scripts/assemble-plugin.mjs: "its established form"), so
  // the shell must resolve them — and must resolve them to the SAME
  // instances the app runs: a plugin's `class X extends Service` only
  // registers with the host's Cordis when `Service` is the host's
  // class, and protocol constants (defaults, service keys) must not
  // fork between the app bundle and plugin code.
  {
    specifier: 'cordis',
    file: 'host/cordis.js',
    entry: 'cordis',
    devFile: 'cordis.js',
    devShim: 'cordis.ts',
  },
  {
    specifier: '@BBeBee/protocol',
    file: 'host/protocol.js',
    entry: '@BBeBee/protocol',
    devFile: '@BBeBee_protocol.js',
    devShim: 'protocol.ts',
  },
  {
    specifier: '@BBeBee/toolkit/hooks',
    file: 'host/toolkit-hooks.js',
    entry: '@BBeBee/toolkit/hooks',
    devFile: '@BBeBee_toolkit_hooks.js',
    devShim: 'toolkit-hooks.ts',
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
 * Dev-mode import map: points at the `renderer/host-dev/` shims, so the dev
 * app and dynamically loaded plugin code share one React instance during
 * `vite` dev as well.
 *
 * The targets must NOT be vite's pre-bundled dep files directly, for two
 * reasons, both verified locally 2026-10-24:
 *
 *  - Serving: this repo's vite root is `renderer/`, so the deps cache
 *    (`apps/desktop/node_modules/.vite/deps/`) sits outside the root. Vite
 *    only serves outside-root deps in `/@fs/…` form; a
 *    `/node_modules/.vite/deps/…` URL falls through to the SPA fallback,
 *    which answers 200 with index.html — a status-only probe then reports
 *    "200" while the module loader fails on the HTML body.
 *  - Exports: a CommonJS package's dep file is default-only
 *    (`export default require_react()`). Vite's import analysis rewrites the
 *    *app's* named imports into property accesses on that default, so the app
 *    never notices — but a plugin loaded through the native import map does:
 *    `import { useCallback }` fails with "does not provide an export named
 *    'useCallback'". The shims are real source files under the vite root, so
 *    Vite transforms their bare imports to the same dep files the app uses
 *    (single instance) while their own named exports become real ESM exports
 *    of the served module. The React-family shims enumerate the actual CJS
 *    export surface (same approach as scripts/build-host-modules.js); the
 *    ESM entries re-export verbatim.
 * Best-effort: dev-mode external plugin loading is already constrained on
 * some WebViews (see vite.config.ts).
 */
export function buildDevImportMap(): ImportMap {
  const imports: Record<string, string> = {}
  for (const m of HOST_MODULES) {
    imports[m.specifier] = `/host-dev/${m.devShim}`
  }
  return { imports }
}

/**
 * The exact text content of the generated import map `<script>` element.
 * This string — byte for byte — is what ends up between the tags in the
 * served HTML, what the browser parses as the map, and what the CSP hash
 * below is computed over. Never re-serialize the map anywhere else.
 */
export function importMapScriptText(map: ImportMap): string {
  return JSON.stringify(map)
}

/** Renders an import map as a `<script type="importmap">` tag. */
export function renderImportMapTag(map: ImportMap): string {
  return `<script type="importmap">${importMapScriptText(map)}</script>`
}

/**
 * The CSP source token that allowlists this import map's inline script:
 * `'sha256-<base64>'` over the exact script text.
 *
 * Engines apply `script-src` to inline import maps (verified on Chromium
 * and WebKitGTK): without this token the map is blocked and every bare
 * specifier in it — the app bundle's own `import 'react'` included —
 * fails to resolve. The map is generated deterministically from this
 * manifest, so the hash is stable; it is computed, never hand-written.
 */
export function importMapCspHashSource(map: ImportMap): string {
  const digest = createHash('sha256').update(importMapScriptText(map), 'utf8').digest('base64')
  return `'sha256-${digest}'`
}

/**
 * Adds the import map's hash source to the `script-src` directive of the
 * CSP `<meta>` in `html`, returning the rewritten document.
 *
 * This must fail loud: if the meta or the directive is not found, silently
 * serving the page anyway would leave the import map CSP-blocked in the
 * real app — plugins (and the app's own React imports) dead with no build
 * error to point at. Throwing here fails the build/serve instead.
 */
export function withImportMapCspHash(html: string, map: ImportMap): string {
  const token = importMapCspHashSource(map)

  const metaTagPattern = /<meta\b[^>]*>/g
  let metaTag: string | undefined
  let metaIndex = -1
  for (let m = metaTagPattern.exec(html); m !== null; m = metaTagPattern.exec(html)) {
    if (/http-equiv\s*=\s*"Content-Security-Policy"/.test(m[0])) {
      metaTag = m[0]
      metaIndex = m.index
      break
    }
  }
  if (metaTag === undefined) {
    throw new Error(
      '[host-modules] index.html has no Content-Security-Policy meta; ' +
        'cannot allowlist the generated import map in script-src',
    )
  }

  const contentMatch = /content\s*=\s*"([^"]*)"/.exec(metaTag)
  if (!contentMatch || contentMatch[1] === undefined) {
    throw new Error(
      '[host-modules] the Content-Security-Policy meta has no content attribute; ' +
        'cannot allowlist the generated import map in script-src',
    )
  }
  const content = contentMatch[1]

  const directives = content.split(';')
  const scriptSrcIndex = directives.findIndex((d) => /^\s*script-src(\s|$)/.test(d))
  if (scriptSrcIndex === -1 || directives[scriptSrcIndex] === undefined) {
    throw new Error(
      '[host-modules] the Content-Security-Policy has no script-src directive; ' +
        'cannot allowlist the generated import map',
    )
  }
  if (directives[scriptSrcIndex].includes("'sha256-")) {
    throw new Error(
      '[host-modules] script-src already carries a sha256 source; ' +
        'the import map hash is generated here and must not be duplicated or hand-written',
    )
  }
  directives[scriptSrcIndex] = directives[scriptSrcIndex].replace(/\s+$/, '') + ' ' + token
  const newContent = directives.join(';')

  // Offset of the content attribute's value within the whole document: the
  // regex match ends right after the value's closing quote, so the value
  // starts (match length - value length - 1) into the match.
  const valueOffset =
    metaIndex + contentMatch.index + (contentMatch[0].length - content.length - 1)
  return html.slice(0, valueOffset) + newContent + html.slice(valueOffset + content.length)
}
