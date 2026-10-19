#!/usr/bin/env node
import { build } from 'vite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, chmodSync, copyFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import process from 'node:process'
import console from 'node:console'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

console.log('[build-sidecar] Bundling Node.js sidecar with Vite SSR...')

await build({
  configFile: false,
  ssr: {
    noExternal: true,
  },
  build: {
    ssr: true,
    target: 'node22',
    outDir: resolve(root, 'dist-sidecar'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, 'sidecar/index.ts'),
        'artwork-worker': resolve(root, '../../packages/core/core-codec-node/src/artwork-worker.ts'),
        'cover': resolve(root, '../../packages/core/core-codec-node/src/cover-sidecar.ts'),
      },
      output: {
        entryFileNames: '[name].mjs',
        format: 'es',
      },
      external: (id) => isBuiltin(id) || id.startsWith('node:'),
    },
  },
})

const outPath = resolve(root, 'dist-sidecar/index.mjs')
if (existsSync(outPath)) {
  try {
    chmodSync(outPath, 0o755)
  } catch {
    // ignore
  }

  // Sync to tauri target directories if they exist so dev/hot builds take effect immediately
  for (const profile of ['debug', 'release']) {
    const targetDir = resolve(root, 'src-tauri/target', profile, 'dist-sidecar')
    if (existsSync(targetDir)) {
      try {
        const targetFile = resolve(targetDir, 'index.mjs')
        copyFileSync(outPath, targetFile)
        chmodSync(targetFile, 0o755)
      } catch {
        // ignore
      }
    }
  }

  console.log(`[build-sidecar] Successfully bundled Node sidecar at: ${outPath}`)
} else {
  console.error('[build-sidecar] Build failed: output file not found')
  process.exit(1)
}
