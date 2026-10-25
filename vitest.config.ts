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
       * `react-native` itself, for the core packages that read `Platform`
       * (the emulator-detection `core-secrets-expo` bases its
       * `isHardwareBacked` answer on). Mutable constants, nothing else.
       */
      'react-native': fileURLToPath(new URL('./test/stubs/react-native.ts', import.meta.url)),
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
      /*
       * And for the keychain. The caller-scoping the node twin carries has to
       * be shown to hold on the expo twin too — a `secrets:own` that confines
       * on one platform and not the other is not a grant. The stub is a real
       * map, minus the real SDK's `[A-Za-z0-9._-]` key constraint; the
       * sanitising that constraint forces is the service's job and is tested
       * as such.
       */
      'expo-secure-store': fileURLToPath(
        new URL('./test/stubs/expo-secure-store.ts', import.meta.url),
      ),
      /*
       * And the transport itself. `expo/fetch` binds the native network stack
       * through `ExpoFetchModule`, so Node cannot load it — but the stub is
       * expo-*shaped*, not Node-shaped: its `Headers` is React Native's
       * whatwg-fetch `Headers` (no `getSetCookie`, repeated values joined with
       * `", "`), because that is the environment the mobile transport really
       * runs in. The shared http conformance suite must exercise that shape —
       * including the multi-`Set-Cookie` fallback built for it — rather than
       * passing against a desktop `Headers` that never existed on a phone.
       */
      'expo/fetch': fileURLToPath(new URL('./test/stubs/expo-fetch.ts', import.meta.url)),
    },
  },
  test: {
    /*
     * `.tsx` too: the kits' tests render components, and a pattern that
     * silently matched nothing would report "no test files" as success.
     *
     * `apps/` as well, for the policies that only a shell can hold — the
     * close-to-tray decision is an M1 exit criterion and lived in a file
     * nothing could load, because desktop shell files may import native bindings at module
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
        : ['apps/desktop/sidecar/audio/audio-engine-supervisor.test.ts']),
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
