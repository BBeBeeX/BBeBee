# Testing Strategy, Conformance & Developer Workflow

> **Legacy Reference:** Formerly `docs/09-project-structure.md §6 – §8`.

## 6. Testing strategy

Four layers, each catching something the others cannot.

| Layer | Tool | What it covers |
|---|---|---|
| **Unit** | Vitest | Pure logic: URN parsing, fractional indexing, smart-playlist compilation, the transport state machine against a mock `AudioService` |
| **Conformance** | Vitest (Node) + Detox (device) | Every `core-*` implementation against the shared suite in `@BBeBee/protocol/conformance` ([services/contracts.md §18](../services/contracts.md)). **The most important layer** |
| **Integration** | Vitest with an in-memory context | A real Cordis context, real feature plugins, fake core services. Covers plugin load order, waterfall composition, and unload completeness |
| **Source corpus** | Vitest, responses recorded inline in the tests | Every example document in `fixtures/sources/` replayed end to end — search, explore, album, stream — so a rule-engine change that breaks real documents fails CI. `pnpm source:record` (to move these to fixture files) is planned, not built |
| **Device smoke** | Manual, per release | Lock screen, Bluetooth, headphone unplug, incoming call, gapless boundary, background survival ([audio/engine.md](../audio/engine.md)) |

Two tests that are worth writing before almost anything else, because they encode the
architecture's central claims:

```ts
// Claim: unload is total. ([plugins/concepts.md §2](../plugins/concepts.md))
it('leaves nothing behind when disabled', async () => {
  const before = snapshotContext(ctx)         // listeners, timers, services, effects
  const fiber = await ctx.plugin(SomePlugin, config)
  await fiber.dispose()
  expect(diffSnapshots(before, snapshotContext(ctx))).toBeUndefined()
})

// Claim: the player does not know downloads or caches exist. ([architecture/layers.md](../architecture/layers.md), [audio/playback.md](../audio/playback.md))
it('plays the same track with and without plugin-download', async () => {
  const withoutDl = await resolveVia(ctxWithout, urn)
  const withDl    = await resolveVia(ctxWith, urn)
  expect(withoutDl.kind).toBe('remote')
  expect(withDl.kind).toBe('local')
  expect(playerBehaviour(withoutDl)).toEqual(playerBehaviour(withDl))
})
```

The first is run parameterised over **every** plugin in the workspace. A plugin that leaks fails CI.

A third belongs beside them once sources exist, because it is the claim the whole string model
rests on:

```ts
// Claim: a source is data, and the runtime is the only interpreter. ([sources/spec.md](../sources/spec.md))
it('plays from a document nobody compiled', async () => {
  await ctx.sources.import(await readFixture('subsonic.json'))
  const hit = await ctx.sources.searchAll({ text: 'radiohead' })
  const handle = await ctx.sources.forUrn(firstUrn(hit))!.resolveStream(id, prefs)
  expect(handle.target).toMatch(/^https:\/\/music\.example\.org\/rest\/stream/)
})
```

The corpus suite is the one that decays without attention: recorded fixtures drift from live
backends, and a green corpus with a broken real source is the failure mode to watch for. The
`check` command ([sources/authoring.md §10](../sources/authoring.md#10-diagnosing-a-broken-source)) run against live
servers, by hand, per release, is the counterweight — the same shape as the device smoke matrix,
and honestly manual for the same reason.

---

## 7. Developer workflow

### First run

```bash
pnpm install                 # pnpm 11+, Node 22.12+
pnpm check                   # typecheck + lint + test — should be green on a clean checkout
```

`pnpm check` is the whole gate. If it passes, CI passes. Run it before pushing; nothing else in
this section is required reading until something goes wrong.

### Everyday commands

| Command | What it does |
|---|---|
| `pnpm check` | `typecheck` + `lint` + `test`. The one command before a PR |
| `pnpm check:changed` | `typecheck` + `lint` + `test` on packages and files in the current diff |
| `pnpm test` | Vitest once over every package |
| `pnpm test:watch` | Vitest in watch mode — what to leave running while working |
| `pnpm typecheck` | `tsc --noEmit` in every package **and** both apps |
| `pnpm lint` / `pnpm lint:fix` | ESLint, including the architectural rules in [structure.md §3](./structure.md#3-dependency-rules) |
| `pnpm build` | Emit `dist/` for every package |
| `pnpm clean` | Remove `dist/`, `out/`, and build info |

Run a single package's tests by path — `pnpm test packages/core/core-fs-node` — or a single file.

### Why the gate is fast (and what each cache is)

The gate is read-only work — nothing `check` runs consumes another check's output — so its parts
are made independent, parallel, and cached rather than run as one serial chain:

- **`pnpm typecheck` runs unsorted, 8 workers wide.** `tsc --noEmit` resolves imports from
  *source* (exports point at `src/index.ts` by design — [build-pipelines.md §4](./build-pipelines.md#4-build-pipelines)) and writes
  nothing but its own `.tsbuildinfo`, so no package waits for another: `.npmrc` sets
  `workspace-concurrency=8` and the root script passes `--no-sort`. `pnpm build` keeps the
  topological sort, which emit actually needs.
- **`incremental: true` in tsconfig.base.json.** Each package's typecheck and build keeps its own
  `.tsbuildinfo` (named after the tsconfig that wrote it, so the two never share one), gitignored
  and removed by `pnpm clean`. This matters most per package: typechecking `plugin-player`
  re-reads 86 workspace files — 55 of them from protocol — because imports resolve to source, so
  without it a one-package edit still re-pays the whole upstream graph on the next run.
- **`pnpm lint` caches by content**, in `node_modules/.cache/eslint/`. Content strategy, not
  mtime, so a fresh clone or CI checkout still gets a warm run if the cache was restored.
- **CI runs the gate as parallel jobs** ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)):
  lint, typecheck, codegen currency, and the test suite split into four `--shard` slices, each
  shard a pass/fail gate of its own. The workflows restore the caches above, keyed on the ESLint
  config and on the branch's last saved `.tsbuildinfo` files — tsc re-hashes every input and
  falls back to a full check whenever a hash disagrees, so a stale restore can only cost time,
  never pass a broken file.

### Running the apps

| Command | What it does | What it needs |
|---|---|---|
| `pnpm dev:desktop` | `electron-vite dev` — HMR across main, preload and renderer | The Electron binary (fetched by `pnpm install`; needs network on first install) |
| `pnpm build:desktop` | Production bundles into `apps/desktop/out/` | — |
| `pnpm dev:mobile` | `expo start --dev-client` | A **custom dev build** on a device or emulator — see below |

> ⚠️ **Mobile needs a custom dev build, not Expo Go.** `react-native-audio-api`, `expo-sqlite` and
> `expo-file-system` all contain native code, so Expo Go cannot host this app. Build the dev client
> once per native-dependency change (`pnpm --filter @BBeBee/mobile exec expo run:android`), then
> `pnpm dev:mobile` attaches to it.

> 💡 **Packaging Desktop App:** `pnpm package:desktop` packages an unpackaged application folder, while
> `pnpm dist:desktop` uses `electron-builder` (`apps/desktop/electron-builder.yml`) to generate platform installers
> (dmg / nsis / AppImage). Mobile standalone packaging uses EAS build.

### Adding a plugin

```bash
pnpm new:plugin --name scrobble --kind feature --ui desktop --capabilities db:own
pnpm install                 # link the new workspace package
pnpm gen:plugins             # add it to both shells' static registries
pnpm check                   # already green — the template ships passing tests
```

| Flag | Values | Effect |
|---|---|---|
| `--name` | lowercase, hyphenated | `scrobble` → `@BBeBee/plugin-scrobble` |
| `--kind` | `feature` (default), `effect` | Sets the package prefix. There is no `source` kind: a music backend is a document, not a package |
| `--ui` | `none` (default), `desktop`, `mobile`, `both` | Emits the per-target view packages of [ui/architecture.md §1](../ui/architecture.md#1-the-three-package-convention) |
| `--capabilities` | comma-separated | Written into `BBeBee.plugin.json` ([plugins/capabilities.md §7](../plugins/capabilities.md#7-capability-model)) |

The headless package lands in `packages/feature/`, its views in `packages/ui/`
([structure.md §1](./structure.md#1-repository-layout)). That placement is the scaffolder's most consequential output: the
lint rules key off the layer directory, so a package written into the wrong one is silently
governed by the wrong rules. `tooling-create-plugin`'s own test asserts the split.

The scaffolder is not a nicety. With a three-package convention, a manifest format, a capability
list, and a leak test to wire up, hand-rolling a plugin means getting one of them wrong — usually
the one that fails *silently*. The template ships the correct `await ctx.plugin(...)` form and a
leak test, both of which cost a debugging session to discover the hard way.

### Adding & authoring music sources

- **End users**: not a development task at all. In the app: **Settings → Sources → Import**, paste the string, review what it says it will do, confirm ([sources/authoring.md §9](../sources/authoring.md#9-importing-updating-and-sharing)). No install, no rebuild, no restart.
- **Source authors & developers**:
  To avoid writing hundreds of lines of escaped JavaScript inside a single JSON string, author sources as dual files (`source.json` + `source.js`) in the registry repo ([B_Be_Bee-registry](https://github.com/BBeBeeX/B_Be_Bee-registry)), consumed here as the pinned `registry/` submodule ([sources/registry.md](../sources/registry.md)): `registry/music-sources/<id>/` for music sources, `registry/lyric-sources/<id>/` for lyric sources.

| Command | What it does |
|---|---|
| `pnpm build:sources` | Validates and compiles the submodule's `registry/music-sources/` + `registry/lyric-sources/` into self-contained single-file documents in `fixtures/sources/<id>.json` and `fixtures/lyric-sources/<id>.json` |
| `pnpm watch:sources` | Watches both registry dirs and recompiles automatically on change |
| `pnpm build:sources --sources <dir>` | Legacy: compiles one mixed directory, routed per document |
| `node --experimental-strip-types scripts/sources/cli.ts --unpack <file> [dest]` | Unpacks any existing single-file JSON back into `source.json` + `source.js` dual-file format |

Two commands are **planned** (M2 cleanup; for online backend testing) for working on the *documents this repository ships* in `fixtures/sources/`:

| Command (planned) | What it will do |
|---|---|
| `pnpm source:check <file>` | Run [sources/authoring.md §10](../sources/authoring.md#10-diagnosing-a-broken-source)'s health check against the live backend and print the trace. Needs network and, for anything authenticated, credentials in the environment |
| `pnpm source:record <file>` | Replay the same steps and write the HTTP fixtures the corpus suite ([§6](#6-testing-strategy)) replays offline |

**After adding or removing a plugin, run `pnpm gen:plugins`.** Metro cannot resolve a runtime path,
so both shells read a generated registry of static imports ([build-pipelines.md §4](./build-pipelines.md#4-build-pipelines)). The output
is committed; CI checks it is current rather than regenerating it.

### What each gate actually catches

Worth knowing, because a failure in one of these usually means an architectural mistake rather
than a typo:

| Gate | Catches |
|---|---|
| `no-restricted-imports` | A plugin reaching for a platform SDK instead of a `ctx.*` service ([architecture/layers.md §1](../architecture/layers.md#the-invariant)) |
| Conformance suites | Two implementations of one service drifting apart — the thing they exist for |
| `*-scope` suites | A capability gate that holds on one platform and not the other |
| Leak test (`diffSnapshots`) | A plugin that does not unload cleanly ([§6](#6-testing-strategy)) |
| `conventions.test.ts` | An un-awaited `ctx.plugin()`, which silently fails to propagate readiness |

### When something goes wrong

| Symptom | Cause |
|---|---|
| Metro: *cannot resolve `cordis`* | `unstable_enablePackageExports` missing from `metro.config.js` — Cordis is ESM-only with an `exports` map ([services/contracts.md §17](../services/contracts.md#17-runtime-compatibility-checklist)) |
| `@Inject` fails at runtime, compiles fine | Legacy decorators. Babel needs `{ version: '2023-11' }`; `tsconfig` must not set `experimentalDecorators` |
| A plugin sits in `pending` forever | An injected service never became ACTIVE. `ctx.inspector.render()` prints the tree and names what each fiber waits for |
| `app.start()` resolves but a service is not ready | An un-awaited `ctx.plugin()` somewhere. `pnpm test packages/kernel` will name the file |
| `CapabilityError: … may not …` | The manifest is missing a capability, or the path/table is genuinely out of scope. Widen the manifest, never the gate |
| `CapabilityError: host … not allowed` from a source | The document's rules reach a host it did not declare. Add it to `allowedHosts` and re-import, so the user sees it ([sources/spec.md §8](../sources/spec.md#8-sandboxing-the-quickjs-realm)) |
| A source returns nothing, with no error | A rule matched nothing where the field was optional. The test screen shows what the backend actually answered ([sources/authoring.md §10](../sources/authoring.md#10-diagnosing-a-broken-source)); `check` finds it before a user does |
| `JsTimeoutError` in a source | An `@js:` block looped, or awaited a request that never resolved. Limits are per evaluation and not configurable per source ([services/contracts.md §19](../services/contracts.md)) |
| Renderer: *preload bridge is missing* | The renderer loaded without `preload/index.cjs` — rebuild, since preload must be CJS |
| Electron will not launch on a headless machine | Expected. It needs `libgtk-3`, `libnss3` and a display; the bundles still build |

### Local checklist before opening a PR

- [ ] `pnpm check` clean.
- [ ] `pnpm gen:plugins` produces no diff.
- [ ] New plugin passes the leak test in [§6](#6-testing-strategy).
- [ ] New core service implementation passes its conformance suite — **and its `*-scope` suite, on
      every implementation of that service**, not only the one you changed.
- [ ] No new import that the [structure.md §3](./structure.md#3-dependency-rules) rules would have to be widened to permit.
- [ ] Version matrix updated if a dependency moved.
- [ ] If the rule engine changed, the source corpus ([§6](#6-testing-strategy)) is green — and if
      a fixture had to be re-recorded, say why in the PR, because a silently re-recorded fixture
      hides a real behaviour change.

---

## 8. Where to go next

[Roadmap & Milestones](../roadmap/roadmap.md) sequences the build.
