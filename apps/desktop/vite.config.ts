import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReadStream, promises as fs } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import {
  HOST_MODULE_SPECIFIERS,
  buildDevImportMap,
  buildImportMap,
  importMapScriptText,
  withImportMapCspHash,
} from './renderer/host-modules.manifest.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Dev-mode file proxy for `bbebee-file://` URLs.
 *
 * WebKitGTK blocks custom schemes (`bbebee-file://`) from `http://` origins
 * (vite dev server) via its same-origin policy — the request never reaches
 * the Rust protocol handler. In production the page runs on `tauri://` and
 * the custom protocol works natively.
 *
 * This middleware serves local files over HTTP at `/__bbebee-file/<path>`,
 * so dev-mode `toServableFileUrl` can return a same-origin URL instead.
 * Only enabled in `vite dev` (not in build).
 */
function bbebeeFileProxy(): Plugin {
  return {
    name: 'bbebee-file-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__bbebee-file/')) {
          next()
          return
        }
        try {
          // /__bbebee-file/home/user/x.jpg -> /home/user/x.jpg
          // /__bbebee-file/C:/music/x.jpg -> C:/music/x.jpg
          let filePath = decodeURIComponent(req.url.slice('/__bbebee-file/'.length))
          // Prevent path traversal: normalize and reject `..`
          const segments = filePath.split('/')
          if (segments.includes('..')) {
            res.statusCode = 400
            res.end('Bad request')
            return
          }
          // Windows drive letter: C:/...
          if (!filePath.startsWith('/') && /^[a-zA-Z]:\//.test(filePath)) {
            // keep as-is, e.g. C:/music/x.jpg
          } else if (!filePath.startsWith('/')) {
            filePath = '/' + filePath
          }
          const stat = await fs.stat(filePath)
          if (!stat.isFile()) {
            res.statusCode = 404
            res.end('Not a file')
            return
          }
          const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
          const mime: Record<string, string> = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
            bmp: 'image/bmp',
            mp3: 'audio/mpeg',
            flac: 'audio/flac',
            m4a: 'audio/mp4',
            ogg: 'audio/ogg',
            wav: 'audio/wav',
          }
          res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream')
          res.setHeader('Content-Length', stat.size)
          // Same-origin in dev, but allow it explicitly anyway.
          res.setHeader('Access-Control-Allow-Origin', '*')
          createReadStream(filePath).pipe(res)
        } catch {
          res.statusCode = 404
          res.end('Not found')
        }
      })
    },
  }
}

/**
 * Host-module import map for plugin module sharing.
 *
 * Dynamically loaded plugins (`bbebee-plugin://` imports) must use the SAME
 * React instance as the app — two copies break hooks/context. The shared
 * specifiers live in `renderer/host-modules.manifest.ts` (single source of
 * truth); the renderer build externalizes them (see `build.rollupOptions`
 * below) and the import map injected here resolves them:
 *
 *  - build: `./host/*.js`, the host chunks written by
 *    `scripts/build-host-modules.js` after `vite build`.
 *  - serve (dev): vite's pre-bundled deps (`/node_modules/.vite/deps/*.js`),
 *    which is the copy the dev-served app itself runs.
 *
 * The map is injected ahead of every module script (`head-prepend`), as the
 * HTML spec requires; `index.html` deliberately does NOT hand-write one so
 * the map can never drift from the manifest. Generated here, in both modes,
 * by `transformIndexHtml`.
 *
 * CSP coupling: engines apply `script-src` to inline import maps, so the
 * app CSP would block this one. The same transform therefore also adds the
 * map's exact-text sha256 (`'sha256-…'`) to the CSP meta's `script-src` —
 * map and allowlist come from the same serialized string in the same step
 * and cannot drift. `withImportMapCspHash` throws when the meta/directive
 * is missing: failing the build beats shipping a page whose React imports
 * silently resolve nowhere.
 */
function bbebeeImportMap(): Plugin {
  return {
    name: 'bbebee-import-map',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const map = ctx.server ? buildDevImportMap() : buildImportMap()
        return {
          html: withImportMapCspHash(html, map),
          tags: [
            {
              tag: 'script',
              attrs: { type: 'importmap' },
              children: importMapScriptText(map),
              injectTo: 'head-prepend',
            },
          ],
        }
      },
    },
  }
}

export default defineConfig({
  root: 'renderer',
  plugins: [react(), bbebeeFileProxy(), bbebeeImportMap()],
  optimizeDeps: {
    exclude: ['react-native'],
    // The dev import map (host-modules.manifest.ts) points the shared
    // framework modules at .vite/deps files, so they must actually be
    // pre-bundled. cordis would be discovered on its own; the two
    // workspace packages are linked deps, which vite only pre-bundles
    // when they are included explicitly.
    // Caveat: vite's dep-cache hash does not cover linked packages'
    // sources, so a pulled protocol change (e.g. a new export) leaves a
    // stale pre-bundle that fails at runtime with "does not provide an
    // export named …". The dev script therefore runs `vite --force`
    // (see package.json "dev:frontend") — do not remove the flag.
    include: ['cordis', '@BBeBee/protocol', '@BBeBee/toolkit/hooks'],
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'renderer/index.html'),
      // Host-shared modules: emitted as bare specifiers in the app chunks
      // and resolved through the import map above, so the app bundle and
      // dynamically loaded plugins share one instance.
      external: [...HOST_MODULE_SPECIFIERS],
    },
  },
})
