#!/usr/bin/env node
import { build } from 'vite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, chmodSync } from 'node:fs'
import process from 'node:process'
import console from 'node:console'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

console.log('[build-sidecar] Bundling Node.js sidecar with Vite SSR...')

await build({
  configFile: false,
  build: {
    ssr: true,
    target: 'node22',
    outDir: resolve(root, 'dist-sidecar'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, 'sidecar/index.ts'),
      output: {
        entryFileNames: 'index.mjs',
        format: 'es',
      },
      external: (id) =>
        !id.startsWith('@BBeBee/') &&
        !id.startsWith('.') &&
        !id.startsWith('/') &&
        !id.startsWith('\0'),
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
  console.log(`[build-sidecar] Successfully bundled Node sidecar at: ${outPath}`)
} else {
  console.error('[build-sidecar] Build failed: output file not found')
  process.exit(1)
}
