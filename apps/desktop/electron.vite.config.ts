import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as {
  dependencies?: Record<string, string>
}

/**
 * Workspace packages must be **bundled**, not externalized.
 *
 * Their `exports` point at `src/*.ts` so typecheck, vitest and both bundlers
 * resolve without a build step — but Electron's Node loader cannot import
 * TypeScript. Leaving them external makes the main process crash on the first
 * `@BBeBee/*` import. Real npm dependencies stay external as usual.
 */
const workspaceDeps = Object.entries(pkg.dependencies ?? {})
  .filter(([, range]) => range.startsWith('workspace:'))
  .map(([name]) => name)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspaceDeps })],
    build: { rollupOptions: { input: 'main/index.ts' } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspaceDeps })],
    // CJS: a sandboxed preload cannot be an ES module.
    build: {
      rollupOptions: { input: 'preload/index.ts', output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    root: 'renderer',
    plugins: [react()],
    build: { rollupOptions: { input: 'renderer/index.html' } },
    optimizeDeps: {
      exclude: ['react-native'],
    },
  },
})
