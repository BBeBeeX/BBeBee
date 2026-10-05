import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      /*
       * The mobile packages import their native module at module scope, which
       * Metro resolves and Node cannot. Aliasing it to a stub is what lets the
       * *logic* in those packages — the command mapping, the control
       * enabling, the artwork policy — be tested at all; the stub throws on
       * anything genuinely native, so a test that strays there fails rather
       * than passing against a fake.
       */
      'react-native-audio-api': fileURLToPath(
        new URL('./test/stubs/react-native-audio-api.ts', import.meta.url),
      ),
      /*
       * `expo-sqlite`, on the other hand, is aliased to something that really
       * works: `node:sqlite` behind the Expo surface. The gate MD-4 added has
       * to be shown to hold on *both* drivers, and a stub that threw would
       * leave the mobile one covered by reading it.
       */
      'expo-sqlite': fileURLToPath(new URL('./test/stubs/expo-sqlite.ts', import.meta.url)),
      /*
       * Same bargain for the filesystem, and the one with a scar: `ctx.fs` has
       * two implementations, their drift is a named risk, and the conformance
       * suite could only ever run against one of them. `File.move` refusing an
       * existing destination — where `rename(2)` replaces it — is what that
       * cost, and the stub reproduces the refusal rather than papering over it.
       */
      'expo-file-system': fileURLToPath(
        new URL('./test/stubs/expo-file-system.ts', import.meta.url),
      ),
    },
  },
  test: {
    /*
     * `.tsx` too: the kits' tests render components, and a pattern that
     * silently matched nothing would report "no test files" as success.
     *
     * `apps/` as well, for the policies that only a shell can hold — the
     * close-to-tray decision is an M1 exit criterion and lived in a file
     * nothing could load, because `main/index.ts` imports Electron at module
     * scope. The testable part is a policy with no imports; the pattern is
     * narrow enough that a shell cannot smuggle logic in behind it.
     */
    include: [
      // `packages/<layer>/<package>/src` — packages are grouped by layer
      // (docs/09 §1), so the glob carries one more segment than a flat
      // workspace would.
      'packages/*/*/src/**/*.test.ts',
      'packages/*/*/src/**/*.test.tsx',
      /*
       * ⚠️ And `packages/<package>/src`, which is not the same shape.
       *
       * Layers 0 and 1 are single packages, not directories of them, so
       * `packages/kernel/src` and `packages/protocol/src` sit one level
       * shallower than everything else — and the glob above, added when the
       * packages were grouped by layer, stopped matching them. Vitest reports
       * files it did not collect as nothing at all, so the run stayed green
       * while `layers.test.ts`, `conventions.test.ts`, `shells.test.ts` and
       * `cordis-assumptions.test.ts` — the checks the architecture is
       * *enforced* by — had not run in some time.
       */
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'apps/*/**/*.test.ts',
      // `.tsx` under `apps/` too. The shells hold one piece of renderable
      // code each — the sidebar and the pane that renders contributed views —
      // and without this the file testing it is collected as nothing.
      'apps/*/**/*.test.tsx',
      'scripts/**/*.test.ts',
    ],
    exclude: [
      ...configDefaults.exclude,
      ...(process.env['TEST_AUDIO_ENGINE']
        ? []
        : ['apps/desktop/main/audio/audio-engine-supervisor.test.ts']),
    ],
    environment: 'node',
    /*
     * jsdom only where a test needs one, opted into per file with a
     * `// @vitest-environment jsdom` docblock. Everything else stays in Node:
     * a DOM for the whole suite would slow every test that has no use for one,
     * and would let a Node-only package accidentally depend on `window`.
     *
     * ⚠️ This was an `environmentMatchGlobs` entry mapping `*.test.tsx` to
     * jsdom. Vitest 4 removed the option, so it stopped applying silently —
     * a `.tsx` test that wanted a DOM got Node and a bare `Element is not
     * defined`, while the files that already carried the docblock went on
     * passing and hid it. The per-file pragma is the supported spelling.
     */
    // Creates the scratch root the harnesses allocate under, and removes it
    // when the run ends. See vitest.global.ts.
    globalSetup: ['./vitest.global.ts'],
    // Cordis schedules work across microtask boundaries; a plugin that never
    // settles should fail loudly rather than hang CI.
    testTimeout: 60_000,
  },
})
