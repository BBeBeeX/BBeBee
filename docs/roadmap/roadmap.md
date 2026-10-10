# Roadmap & Risk Register

> **Legacy Reference:** Formerly `docs/10-roadmap.md`.

> **What this answers.** The order to build things in, what "done" means for each stage, and an
> honest accounting of what could go wrong.

The sequencing principle: **prove the riskiest architectural claim as early as possible.** The
claim that one plugin graph runs unmodified on Hermes and in an Electron renderer is either true
or the project needs redesigning, and it is cheap to test in week one and ruinous to discover in
month six. So M0 is deliberately unglamorous — no music plays until M1.

---

## Milestones

### M0 — The kernel runs on both platforms

Build `@BBeBee/protocol`, `@BBeBee/kernel`, and the minimum core services (`paths`, `fs`, `store`,
`db`, `logger` transports) with both implementations. Two shells that boot, load a trivial plugin,
and render its contributed view. The conformance harness and the leak test from
[workflow/testing.md §6](../workflow/testing.md#6-testing-strategy).

**Exit criteria**
- The same plugin package loads and activates on an iOS simulator, an Android emulator, and
  Electron, with no conditional code in the plugin.
- `pnpm test` runs the `fs`, `db`, and `store` conformance suites green against all
  implementations, on device for the Expo ones.
- Disabling a plugin restores the context snapshot exactly.
- The plugin inspector shows the fiber tree with labelled effects.

**Why first.** Every ADR is a hypothesis until this passes. If Cordis misbehaves on Hermes, or
Metro cannot resolve its `exports` map, or standard decorators do not transpile — this is where
that surfaces, while backing out is still cheap.

---

### M1 — It plays music

`core-audio-webaudio`, `plugin-player`, `plugin-source-local`, `plugin-local-scanner`, a
stream-only slice of `plugin-source-runtime`, plus enough UI in both shells to browse a library
and control playback. Media session integration.

> **Detailed plan** — [M1 Execution Plan (Historical Archive)](./archive-m1.md): the package set, the build
> order, the milestone-level decisions, and the check behind each criterion below.

**Exit criteria**
- Scan a folder of ≥ 5,000 files; incremental rescan of an unchanged library costs stat calls only.
- Play, pause, seek, next, previous, queue reorder — on all three platforms.
- Lock-screen and notification controls work on iOS and Android; MPRIS/SMTC/Now Playing on desktop.
- Playback survives backgrounding on mobile and window-hide on desktop.
- Headphone unplug pauses ([audio/playback.md §5](../audio/playback.md#5-interruptions-focus-and-routes)).
- Queue and position restore across a restart, without auto-playing.

**Where it stands.** Built and under test: `core-audio-webaudio` with its conformance suite,
`core-codec-node` and `core-codec-rn`, `core-http-node` and `core-http-rn` with the M1-slice
conformance suite running against a real byte-serving socket, `ctx.device`, `ctx.background` and
`ctx.mediaSession` on both targets, the scanner, the catalogue, the player with gapless, crossfade,
prefetch and the interruption table, both UI kits with the parity check, and the five screens on
both shells — since split so a screen can evolve without touching a service: the library itself
(playlists, albums, collections) is `plugin-library-ui-*`, the search, source-list, import and
test screens stay in `plugin-sources-ui-*`, the album page is `plugin-album-ui-*`, the player and
its bar are `plugin-now-playing-ui-*`, the up-next list is `plugin-queue-ui-*`, and
`plugin-player` itself is headless with commands only. Both shells load
the **generated** registry, so a package is bundled by declaring a
manifest rather than by being added to two hand-written lists that can disagree. Criterion 1 is
checked at the size it names: a generated 5,000-file corpus, read by the real codec, through an
instrumented `ctx.fs` that asserts the second pass opens no file.

The transport reaches every state its type declares, `stalled` included: a streamed source reports
an underrun through `ctx.audio`'s `onStalled`, the player shows a spinner rather than a play button
and the lock screen goes on saying *playing*, and a stall that never recovers becomes a retryable
error rather than a spinner that spins for ever. Both kits virtualise their lists — FlashList on
mobile, `@tanstack/react-virtual` on desktop, the latter publishing `aria-setsize` so windowing
stays invisible to a screen reader rather than catastrophic for one.

Still open, and every one of them needs hardware: **the Stage 0 spike has not been run** on an iOS
device, an Android device, or in Electron, so ADR-4's verdict below is still a hypothesis; the
device smoke matrix has not been run; and **`load({ strategy: 'stream' })` has no mobile
implementation** — React Native has no `HTMLMediaElement`, so a long remote track is buffered or
not played, which is the gap `StreamerNode` closes and the one piece of M1 that is architecture
rather than wiring.

---

### M2 — Sources are strings

The whole of [ADR-5](../architecture/overview.md#adr-5--music-sources-are-imported-strings-interpreted-by-one-runtime):
`source-rules` (the language), `ctx.js` and both `core-js-quickjs-*` (the sandbox), the rest of
`plugin-source-runtime` (search, explore, album, lyrics, login), the import/export/editor/tracer
UI, and `ctx.secrets` with persistent cookie jars. `ctx.sources` aggregation and the
identity-linking tables. The source corpus in `plugin-source-runtime` grows a Subsonic and a podcast-feed
document.

**Exit criteria**
- **A pasted string plays music.** A Subsonic document imported from text — never compiled, never
  installed — searches, browses, and streams on all three platforms.
- Two Navidrome servers imported simultaneously, with isolated cookie jars and independent auth
  state — cookies set by one are never sent to the other.
- **Sign in once, stay signed in.** Force-quit and relaunch: the session is restored from the
  persisted jar with no prompt and no stored password
  ([sources/runtime.md §5.1](../sources/runtime.md#51-session-persistence--cookies-survive-the-app)).
- **Sign out leaves nothing.** After `signOut()`, the persisted jar, the secrets namespace and
  `source_vars` are all gone; relaunching shows a signed-out source.
- **Export round-trips.** Export the source set, import it into a clean profile: identical
  behaviour, and no credential travelled ([sources/authoring.md §9](../sources/authoring.md#9-importing-updating-and-sharing)).
- A document with only `ruleStream` is imported alongside the others without any screen breaking
  on a capability it does not have.
- `searchAll` returns per-source results and reports a failing source without failing the search.
- Session expiry mid-use re-authenticates transparently; a failed re-auth shows an in-place
  re-login and leaves cached content browsable.
- The full error taxonomy is exercised — every row in [sources/authoring.md §7](../sources/authoring.md#7-errors) has
  a test, including `RuleError` and the stale badge.
- **The sandbox holds.** A deliberately hostile document cannot reach an undeclared host, cannot
  read another source's cookies or vars, cannot touch the filesystem, and is interrupted rather
  than hanging the app ([sources/runtime.md §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)).
- **A broken source is diagnosable by a user.** Break a rule deliberately; the test screen shows
  what the backend actually answered, and a re-import of the fixed document succeeds — without a
  rebuild.
- A local track and a server track of the same recording are linked by ISRC and shown as one
  library item with two sources.

**Where it stands.** Built and under test: the rule language including `@js:`, the QuickJS sandbox
(`core-js-quickjs-node`) and `ctx.js`, search, explore, album and lyrics, the catalogue round trip
that keeps a searched or browsed track playable after a restart, `ctx.secrets` on both platforms
(`core-secrets-node`, `core-secrets-expo`), per-source cookie jars that persist and are forgotten
by sign-out, form and variable sign-in with transparent single-flight re-authentication, the
per-feature test screen with its streaming trace, the cross-source search screen (one result
section per source, failures and timeouts kept visible), cross-source identity linking, the import
and source-list screens on both shells, and the full error taxonomy.

Still open, and both need a device to finish: **`core-js-quickjs-expo`** — React Native's Hermes
has no WebAssembly, so the mobile sandbox needs a *native* QuickJS module and therefore a
dev-client rebuild, which is why it was always listed as the one native dependency M2 adds
([services/contracts.md §19](../services/contracts.md#19-ctxjs--the-sandboxed-evaluator)) — and running the two shells
end to end on real hardware. Until the first lands, a scripted document on mobile reports its
affected capabilities as absent rather than offering a button that cannot work, which is the
designed degradation rather than a break.

The curation half that MD-3 deferred from M1 is in as well: `plugin-library` / `ctx.library` —
playlists, favourites, collections, and smart playlists whose rule tree compiles to parameterised
SQL — with screens on both shells ([data-model/schema.md §4.6](../data-model/schema.md#46-curation)).

⚠️ **What "built" did and did not mean until recently.** Every package listed above was built and
green, and *neither shell ran any of it*: the desktop bootstrap omitted `ctx.audio`, `ctx.codec`
and `ctx.http`, so `plugin-player` was commented out and the scanner and the source runtime sat
PENDING, and the mobile shell was still M0 — four core services and the M0 demo plugin. That is
now fixed, and it is worth recording as the failure mode it was: a milestone can be complete
package-by-package and deliver nothing, because the exit criteria are about the *app*. The check
that would have caught it earlier is a boot test per shell, which is the obvious next thing to
write.

**Why second.** M1 plays files. M2 is where the model that the whole design now rests on is either
true — a stranger's string plays music, safely, and can be repaired by the person holding it — or
is revealed to need more than a milestone. It is also the last cheap moment to discover that the
rule language is too weak, because every document written after M2 is one someone has to migrate.

---

### M3 — Offline

`plugin-download` with a resumable task queue, `media_bindings`, download policies, and the
`player/before-resolve` substitution.

> **Shipped.** `ctx.downloads` is built ([audio/playback.md §2](../audio/playback.md#resolution-pipeline)):
> `download_tasks` is a real queue driven by one worker (queued → running → done, with paused,
> canceled and failed), `bytes_done` is checkpointed and resumed with `If-Range: <etag>` so a
> changed remote file restarts instead of splicing, downloads are kept in
> `ctx.paths.downloads/BBeBee/` and never evicted, `wifi_only`/`charging_only` hold queued tasks
> and pause running ones against real `ctx.device` state, and a Downloads settings page in both
> shells drives pause/resume/cancel/retry/delete/clear. The automatic playback cache that used to
> live here moved to `plugin-cache`, which owns covers and streams in `cache_entries`. What is
> still open: per-policy *scopes* (`scope_json` is written empty — one policy governs everything)
> and a per-track download action for playlists, where no track row is rendered today.

**Exit criteria**
- Kill the app mid-download; on relaunch it resumes from `bytes_done`, and a changed `etag`
  restarts cleanly rather than splicing corrupt bytes.
- With `plugin-download` disabled, the same track streams and playback behaves identically —
  the test in [workflow/testing.md §6](../workflow/testing.md#6-testing-strategy).
- Policies honour `wifi_only` and `charging_only` against real `ctx.device.network()` transitions.
- Deleting the underlying file removes the binding rather than failing at play time.
- Cache eviction stays within per-class quotas under sustained use.

---

### M4 — It sounds good

`plugin-dsp` and the built-in effects from
[audio/playback.md §3](../audio/playback.md#built-in-effects). Chain editor UI in both shells.

> **Shipped.** `ctx.dsp` and all 9 built-in effects (`preamp`, `eq10`, `normalize`, `compressor`,
> `reverb`, `widener`, `crossfeed`, `tempo-pitch`, `limiter`) are implemented and verified
> ([audio/dsp.md §3](../audio/dsp.md#3-ctxdsp--the-effect-chain)):
> - **Unified cross-platform effects**: EQ, normalize, compressor, and reverb (along with all other
>   5 effects) run across desktop, iOS, and Android from a single pure Web Audio implementation.
> - **Anti-click audio transitions**: Graph topology rewires (enabling/disabling/reordering effects)
>   use `ctx.audio.dipVolume(20)` to exponentially ramp gain down and back over 20ms, preventing
>   pops and clicks. Parameter updates (such as dragging EQ sliders) apply via `setTargetAtTime`
>   without rebuilding the graph.
> - **Dropout safety**: `tempo-pitch` monitors audio dropouts and automatically disables itself to
>   protect the rest of the chain on resource-constrained platforms.
> - **Chain editor UI**: `@BBeBee/plugin-dsp-ui-desktop` and `@BBeBee/plugin-dsp-ui-mobile` provide
>   10-band graphic EQ sliders, drag-and-drop / ordering controls, individual bypass toggles, latency
>   reporting, and preset selection.
> - **Settings integration**: `@BBeBee/plugin-settings-ui-desktop` and
>   `@BBeBee/plugin-settings-ui-mobile` feature direct in-settings toggles, presets, and sliders for
>   EQ, Normalize, Compressor, and Reverb inside the "Playback" / audio section, plus a dedicated
>   DSP tab and navigation route.
> - **Composition root enabled**: Enabled in `apps/desktop/renderer/plugins.ts` and
>   `apps/mobile/src/plugins.ts`.

**Exit criteria**
- EQ, normalize, compressor, and reverb run on iOS, Android, and desktop from one implementation
  each.
- Every effect's offline-render test matches its reference within tolerance.
- Dragging an EQ slider does not rebuild the graph and produces no clicks.
- Enabling or reordering an effect mid-playback is inaudible apart from the intended change.
- `tempo-pitch` reports dropouts and self-disables on a low-end Android device rather than
  degrading the whole chain.

---

### M4.1 — Bit-Perfect Desktop Audio (WASAPI Exclusive)

> **Descoped (removed before first working build).**
> Exclusive-mode output (`core-audio-wasapi-native`, the sink worklet, the
> `initWasapi`/`writeWasapi` bridge methods) was prototyped end to end and then
> removed: shared output through `context.destination` covers current needs,
> and the native pipeline carried a Rust toolchain plus a per-platform
> verification burden for one OS. What survived from the work: the
> bridge-first FFmpeg decode path, true streaming via the shared
> `StreamedHandle`, source-header forwarding, and native-rate
> `AudioContext` reconstruction (`audio/context-rebuilt`). Revisit if
> bit-perfect output becomes a product requirement again.

---

### M5 — Third-party extensions, on the sandbox

The generalisation of `ctx.js` from "evaluate a source rule" to "host an extension": a service
bridge whose protocol is the capability grammar of
[plugins/capabilities.md §7](../plugins/capabilities.md#capability-grammar), plus install, update, uninstall, grants and
quarantine. Scoped after M2 rather than before it because the realm, the limits, the host-surface
discipline and the conformance suite all arrive with sources — M5 spends them rather than
inventing them.

Its scope shrank when sources became strings
([ADR-1 as amended](../architecture/overview.md#adr-1--plugins-are-statically-bundled-on-every-target)):
music backends no longer need this, so what remains is effects, scrobblers, lyric providers and
transports — real, but no longer urgent. If that demand never materialises, **not building M5 is
a valid outcome**, and the shelf design in
[plugins/loading.md §6.2](../plugins/loading.md#62-desktop-additions--plugin-loader-dynamic) is what it cost.

**Exit criteria**
- An extension built outside the repo installs from a local file and a URL and runs **inside a
  `ctx.js` realm**, not in the renderer's — so the honesty note in
  [plugins/concepts.md §7](../plugins/concepts.md#what-this-is-not) can finally be deleted rather than reworded.
- An extension requesting a capability it was not granted receives a `CapabilityError`, and the
  operation fails cleanly rather than crashing the app.
- The gate holds on **both** platforms, including across the desktop bridge — the gap named in
  [plugins/concepts.md §7](../plugins/concepts.md#where-the-gate-actually-runs) is closed, or M5 does not ship.
- An extension that throws on load twice is quarantined; the app boots normally afterwards and
  shows why.
- Uninstalling disposes the fiber before removing files, and "remove data" drops exactly that
  extension's namespaced tables.

---

### Beyond M5

Not scheduled, but designed for and not blocked by anything above:

- **Sync** — a `SyncProvider` SPI with a file/WebDAV reference implementation. The schema already
  carries `device_id`, `revision`, and `sync_state`.
- **A real sandbox** — a `Worker` or QuickJS realm for third-party plugins, with the capability
  grammar from [plugins/capabilities.md §7](../plugins/capabilities.md#7-capability-model) becoming the bridge protocol.
- **Mobile runtime extensions** — unblocked once M5's bridge exists, since the sandbox itself
  already ships on mobile with sources.
- **A source registry** — a browsable, versioned index of shared source documents with update
  notifications. Deliberately not M2: a distribution channel for other people's code is a
  commitment, and the model has to prove itself on pasted strings first.
- **Fingerprint matching** — an AcoustID plugin feeding `track_links`.
- **More providers** — Jellyfin, podcast feeds, whatever the SPI turns out to accommodate.

---

## Risk register

Ordered by expected cost, not likelihood.

### 🔴 Cordis is a release candidate

Its README says the API may change without notice, and it is the foundation of everything.

*Mitigation* — exact pinning, a deliberately narrow API surface, plugins importing from
`@BBeBee/kernel` rather than `cordis` so one adapter absorbs a signature change, and semantic
tests that fail loudly on an upgrade
([workflow/build-pipelines.md §5.1](../workflow/build-pipelines.md#51-the-cordis-rc-problem)).

*Trigger to reconsider* — if an RC bump breaks the isolation or effect semantics the design
depends on, the fallback is vendoring the pinned version. Cordis's core is a few thousand lines
with two dependencies, which makes that a real option rather than a theoretical one.

### 🔴 `react-native-audio-api` is pre-1.0

ADR-4 buys the entire cross-platform DSP story from a `0.13.x` package.

*Mitigation* — the contract is the **standard Web Audio API**, not the library's own shape, so the
switching cost is bounded. `core-audio-rntp` over `react-native-track-player` is the documented
fallback, at the price of mobile DSP.

*Early warning* — M1 exercises streaming, gapless, and lock-screen controls. If it disappoints
there, the decision can be revisited before M4 depends on it.

### 🟠 The abstraction leaks faster than it is patched

Two implementations of `ctx.fs` drift; a feature plugin quietly starts depending on desktop
behaviour; six months later "it works on my machine" means "it works on desktop".

*Mitigation* — the conformance suites are the primary defence and must run on real devices in CI,
not only in Node. The ESLint import ban ([workflow/structure.md §3](../workflow/structure.md#3-dependency-rules))
catches the crude version. The known leaks are documented with ⚠️ rather than hidden, so a
contributor meets them before their code does.

### 🟠 The split UI doubles more than the view layer

ADR-2 accepts writing views twice. The failure mode is logic creeping into views, at which point
it is written twice too, and the two shells begin to *behave* differently.

*Mitigation* — the three-package convention with hooks in the headless package
([ui/architecture.md §4](../ui/architecture.md#4-binding-services-to-react)), and the component-parity test in
CI. If desktop and mobile ever disagree about what a button does, that is a bug in the headless
package by definition.

### 🟠 iOS background limits

Non-audio background work is unreliable by design, and no architecture fixes it.

*Mitigation* — the constraint is in the contract: `ctx.background.canRunInBackground()` exists so
plugins ask, and `download_tasks` checkpoints per chunk so interruption is cheap. The UI tells the
truth about what will and will not continue, rather than showing a progress bar that silently
stalls.

### 🔴 An imported source is code from a stranger

[ADR-5](../architecture/overview.md#adr-5--music-sources-are-imported-strings-interpreted-by-one-runtime)
puts arbitrary JavaScript from the internet into the app's normal workflow. This is the risk the
project deliberately took on, and it is first-class rather than a footnote.

*Mitigation* — a real realm boundary rather than a policy: `ctx.js` with no ambient globals and
clone-only value passing ([services/contracts.md §19](../services/contracts.md#19-ctxjs--the-sandboxed-evaluator)); an
enumerable host API; engine-enforced time and memory limits; and — the part that actually bounds
damage — a **per-source egress allowlist** shown to the user at import
([sources/runtime.md §8](../sources/runtime.md#8-trust-what-an-imported-source-can-and-cannot-do)). M2's exit
criteria include a hostile-document test, so the claim is checked rather than asserted.

*Residual, stated plainly* — a source sees what the user gives it and can send that to its own
backend. No sandbox fixes a backend the user chose to trust. The import screen names the hosts;
beyond that it is the user's call.

*Trigger to reconsider* — a sandbox escape, or an ecosystem where documents routinely need hosts
they cannot justify. The response is not to widen the allowlist but to narrow what a document may
carry: a declarative-only profile, with `@js:` requiring a separate opt-in per source.

### 🟠 Sources rot, and the app gets blamed

A backend renames a field and every document targeting it silently returns nothing. With a dozen
imported sources this is not an edge case; it is Tuesday. The user experiences it as "the app
broke".

*Mitigation* — `RuleError` is a distinct class from a network failure, and the UI says "<source>
needs updating", not "something went wrong" ([sources/authoring.md §7](../sources/authoring.md#7-errors)). A stale
source keeps its cached catalogue rather than vanishing. `check` finds rot before playback does,
and the test screen shows what the backend actually answered, making the fix a two-minute edit
by the person holding the string
([sources/authoring.md §10](../sources/authoring.md#10-diagnosing-a-broken-source)).

*What would make it worse* — shipping the model without the tracer. That is the one piece of M2
that cannot be deferred, because without it every rotted source becomes a support request.

### 🟡 Extensions that are not sources have no home

With ADR-1 amended, a third-party effect or scrobbler cannot be installed at all until M5, and M5
may never be built.

*Mitigation* — the shelf design is kept and dated
([plugins/loading.md §6.2](../plugins/loading.md#62-desktop-additions--plugin-loader-dynamic)), and the sandbox
M5 would need now ships with sources, so the remaining work is a service bridge rather than a
subsystem. If demand appears, it is a milestone; if it does not, nothing was spent.

### 🟡 Version drift across two large frameworks

Expo SDK bumps move React Native and React together; Electron bumps move Node and V8. They will
not stay aligned on React versions on their own.

*Mitigation* — React and React Native are pinned to what Expo SDK 57 dictates, and the desktop
renderer follows Expo's React, not the newest release
([workflow/build-pipelines.md §5](../workflow/build-pipelines.md#5-version-matrix)). Upgrades are a scheduled task with the
conformance suite as the gate. Choosing `node:sqlite` over `better-sqlite3` already removed the
worst recurring cost.

### 🟡 SQLite as the single store

One database holds catalogue, playlists, history, downloads, settings, and plugin tables. On a
large library with an aggressive scanner and a busy download queue, write contention is plausible.

*Mitigation* — WAL, batched writes in the scanner, and a single serialised writer path on both
platforms. If it becomes a problem, splitting the volatile tables (`play_history`,
`cache_entries`, `download_tasks`) into a second database file is a contained change, because
nothing joins across those boundaries.

*Measured at M1* — scanning 5,000 files while a track plays and checkpoints unthrottled costs
7–13% (`18.2s`→`19.4s` idle, `24.7s`→`27.9s` during a full test run), lands thousands of
checkpoints *during* the scan rather than behind it, and refuses no write. So the risk is real in shape and not yet real in practice; the download queue is
the half M1 could not exercise, because M3 is where one exists. The probe is
[archive-m1.md §7](./archive-m1.md#7-fixtures-and-harnesses) and it runs on every `pnpm test`.

---

## What would make this design wrong

Worth writing down so it is recognisable:

- **If nobody ever writes or imports a source**, the rule language, the interpreter, the sandbox,
  the import flow and the tracer are all overhead, and three hand-written providers would have
  been better. M2 ships the machinery; the six months after it are the test.
- **If the rule language cannot express the backends people actually want**, sources become a
  worse version of plugins — documents padded with `@js:` until they are programs in a bad editor.
  The signal is the ratio of declarative rules to script in the corpus and in shared documents.
- **If plugins are never loaded at runtime**, the capability model and the manifest are cost with
  no return beyond auditability — though ADR-1's amendment already banked most of that saving, and
  the remaining question is only whether M5 is worth building.
- **If mobile and desktop end up with substantially different feature sets**, the split UI has
  become a split *product*, and the universal RN-Web option that ADR-2 rejected was the right call.

None of these are visible yet. All three are checkable by M5.
