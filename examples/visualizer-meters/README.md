# Visualizer Meters — a third-party-style example plugin

`bbebee-plugin-visualizer-meters` is a complete, publishable BBeBee plugin
package written the way a third-party author writes one: **one npm package,
one `BBeBee.plugin.json`, a headless entry and a desktop UI entry**, no
monorepo wiring. It lives under `examples/` precisely so it is *not* part
of the pnpm workspace and *not* in the built-in plugin list — it is a
reference you can copy out of this repo and publish as your own.

It adds three audio meters to the now-playing screen — a **spectrogram**
(scrolling waterfall), a **spectrum** (log-spaced frequency bars) and a
**VU meter** (RMS + peak on a dB scale) — all driven by a service it does
not own: the `visualizer` service of the first-party
`@BBeBee/plugin-visualizer` plugin.

## What this example demonstrates

- **Depending on another plugin's service.** The plugin injects nothing at
  install time it cannot name: the registry entry declares
  `services: ["visualizer"]`, the manifest declares
  `dependencies: ["@BBeBee/plugin-visualizer"]`, and at runtime both halves
  treat the service as *optional* (`ctx.inject(['visualizer'], …)` in the
  headless half; per-frame `serviceOf` reads in the UI) — if the visualizer
  is disabled, the meters idle on a quiet baseline instead of breaking.
- **The combined package shape.** `entry.main` + `entry.ui.desktop` in one
  package; the desktop loader composes them into a single plugin (headless
  first, UI as a child fiber — a broken UI never takes the headless half
  down with it).
- **Host-shared React.** The UI bundle keeps `react`, `react-dom`,
  `react-dom/client`, `react/jsx-runtime` and `react/jsx-dev-runtime`
  external so the shell's import map resolves them to the host's single
  React instance; `package.json` declares the matching
  `peerDependencies` (`^19.0.0`, warn-only at install time). `build.mjs`
  fails the build if a React implementation ever slips into the bundle.
- **Zero capabilities.** `capabilities: []` — the plugin touches no fs,
  network, or database. Its views draw with canvas 2D and host CSS
  variables only; there is no ui-kit import.

## Layout

```
package.json            name/version/files + peerDependencies (the npm face)
BBeBee.plugin.json      the 15-field plugin manifest (id = package name)
registry-entry.json     the registry (schema v2) entry fixture — see below
build.mjs               esbuild: src/index.ts → dist/index.js,
                        src/ui.tsx → dist/ui-desktop.js, plus the
                        host-sharing assertions on the UI bundle
src/
  config.ts             modes, palettes, defaults, config schema, resolver
  meters-math.ts        pure frame math (levels, VU ballistics, log bands,
                        waterfall ring buffer, palette LUTs)
  index.ts              headless def: config resolution, settings-card
                        contribution, optional visualizer watch
  ui.tsx                UI def: view + settings-card registration into the
                        `now-playing.visualizer` slot; the canvas meters
test/
  meters-math.test.ts   node:test unit tests for the pure modules
```

## How the visualizer service is consumed

The protocol contract (`VisualizerService`) is pull-based — there is no
frame event:

- `visualizer.getFrequencyData(buf)` fills a `Uint8Array` of
  `fftSize / 2` byte bins (0 = silence). The service itself fills zeros
  when no analyser is attached.
- `visualizer.getTimeDomainData(buf)` fills a `Uint8Array` of `fftSize`
  bytes centred on 128 (silence).
- `visualizer.settings.fftSize` (default 128) is the sizing source for
  both buffers; the view re-allocates when it changes.

The view runs one `requestAnimationFrame` loop, pulls one frame per tick,
and stops the loop on unmount. With no service (or no audio) the buffers
stay at their silence values and every meter draws its baseline.

## The three meters

- **Spectrum** — bins are grouped into 48 **logarithmically** spaced bands
  (`logBandEdges` in `meters-math.ts`; pitch perception is logarithmic, so
  linear grouping would waste half the width on bass). Each band shows its
  peak bin, coloured through the active palette.
- **Spectrogram** — every frame becomes one column of a ring buffer
  (`WaterfallBuffer`, 240 columns); new frames enter at the right and
  history scrolls left. Frequencies run bottom (low) to top (high), values
  map through a pseudocolor LUT: `ember` is black → purple → orange →
  yellow, alongside `ice` and `mono`. Rendering goes through an offscreen
  `ImageData` strip scaled up to the canvas.
- **VU** — RMS and peak are computed from the time-domain frame and shown
  on a −60…0 dB scale. Ballistics (`stepVu`, a pure function): the level
  bar attacks instantly and releases at 0.9 dB/frame; the peak marker jumps
  to a new peak, holds ≈45 frames, then falls at 0.35 dB/frame and never
  below the current frame's peak.

Mode and palette can be switched from the segmented control on the view
itself and from the settings card (Settings → Playback → *Visualizer
Meters*); both write to one small store inside the UI bundle.

## Configuration

The plugin accepts a config object (from its registry entry / install
record) of the shape declared in `src/config.ts` (`METERS_CONFIG_SCHEMA`):

```json
{ "mode": "spectrum" | "spectrogram" | "vu", "palette": "ember" | "ice" | "mono" }
```

The headless half resolves the loader-passed config against the defaults
and logs the result. The composed UI def is registered without a config
argument (that is how the loader's composition works today), so the UI
seeds its session state from the same defaults and in-view changes are
session-local. Persisting them across restarts would require a host
storage capability (`db:own`), which this example deliberately does not
request.

## Build & test

```bash
npm install   # once, for esbuild/types (or skip: in a BBeBee checkout
              # build.mjs falls back to the repo root's esbuild)
npm run build # → dist/index.js + dist/ui-desktop.js, with assertions
npm test      # node --test over the pure modules — no framework needed
```

`dist/` is a build product (gitignored); `package.json`'s `files` ships
exactly `BBeBee.plugin.json` + `dist`, which is what `npm publish` would
upload.

## Trying it locally

1. `npm run build` here.
2. Either publish to npm and install it from the in-app plugin market like
   any registry plugin, or sideload: copy this package directory (with its
   built `dist/`) into the desktop app's `installed-plugins/` directory
   and restart — the loader picks up external packages from there, checks
   the manifest, and composes `entry.main` + `entry.ui.desktop`.
3. Play something and open the now-playing screen: the meters view appears
   in the visualizer slot, after the built-in visualizer canvas.

## The registry entry — and two honest wrinkles

`registry-entry.json` is the schema-v2 entry this package would be
submitted with (as `plugins/bbebeex-visualizer-meters.json` in
`B_Be_Bee-registry`). It was validated with the registry's own
`validate.mjs`; results, separated by check:

- **Field/shape validation** — everything passes except `dependencies`
  (below). Unknown fields are rejected by the schema, so the entry carries
  exactly the allowed set; note schema v2 has no `type` field — an entry's
  kind is its directory (`plugins/`).
- **`services: ["visualizer"]` whitelist** — passes. `visualizer` is in the
  registry's core service-key list (`scripts/lib/service-keys.ts`), so it
  validates even without another entry's `provides`; the `provides`
  mechanism documented in the registry is what covers service keys that
  are *not* core keys.
- **Wrinkle 1 — the dependency on the visualizer plugin.**
  `dependencies: ["@BBeBee/plugin-visualizer@^0.0.0"]` names the
  visualizer's manifest id, which is what the install-time anti-spoofing
  rule would force its registry-entry id to be. But the registry's
  dependency grammar (and the client's `parseDepSpecifier`) only accepts
  **slug** ids, so the validator reports:
  `invalid dependency "@BBeBee/plugin-visualizer@^0.0.0" — expected "<id>" or "<id>@<semver-range>"`.
  First-party plugins have no registry entries today, so a registry-level
  dependency *on one* is currently inexpressible; the working dependency
  channel is the `services` list above (the installer checks the
  visualizer service is available, counting installed plugins'
  contributed services), plus the manifest's own `dependencies`, which do
  use manifest ids. The entry keeps the explicit declaration — it is the
  semantically right target once first-party entries exist — rather than
  inventing a slug that refers to nothing.
- **Wrinkle 2 — npm existence.** The registry CI fetches the packument for
  every entry's `npm` field. This example is not published, so validation
  reports, verbatim:
  `npm package "bbebee-plugin-visualizer-meters" does not exist on the public npm registry (HTTP 404) — publish it before submitting, or fix the "npm" field`.
  That is the expected pre-publication state: publish the package first,
  then submit the entry (the CI also cross-checks the published package's
  manifest id and package name against the entry — both are
  `bbebee-plugin-visualizer-meters` here).

## Notes for authors copying this example

- Keep the two halves' shared code inside this package (`src/config.ts`,
  `src/meters-math.ts` are bundled into each entry that imports them).
  Cross-package value imports are not part of the third-party contract.
- If you need the host's exact shared-module list, the single source of
  truth is `apps/desktop/renderer/host-modules.manifest.ts` in the BBeBee
  repo; `build.mjs` mirrors it and says so.
- Log through `ctx.logger`, register cleanup through the fiber/effect
  being disposed, and keep entry points `async` — the loader discards
  disposers returned by plain non-async functions.
