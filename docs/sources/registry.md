# The Content Registry (`B_Be_Bee-registry`)

> **What this answers.** How the app discovers, checks and installs third-party
> content — music sources, lyric sources, themes and desktop plugins — from the
> community registry, and how the registry repo is wired into this monorepo.

Music sources are imported strings, not plugins (see the spec at [rules/sources.md §1 — What a Source Is](../../rules/sources.md#1-what-a-source-is) (L2)). The
registry is the curated place where such strings — and the other three kinds of
installable content — are published, versioned and reviewed, so that users have
a first-party path beyond pasting whatever a forum thread says.

---

## 1. Repository architecture

(see the spec at [rules/sources.md §6 — Registry](../../rules/sources.md#6-registry-third-party-registry) (L2): the registry repository's positioning, the four content kinds, entry fields and install red lines belong to that section; this section covers the repository structure and the discovery mechanism.)

The registry lives in its own standalone repository,
[BBeBeeX/B_Be_Bee-registry](https://github.com/BBeBeeX/B_Be_Bee-registry).
Unlike traditional monolithic registries with bundled dist outputs, `B_Be_Bee-registry` operates as a **decentralized, DMS-style metadata index**:
third-party source and plugin code is hosted in the authors' own GitHub repositories, while the registry maintains pure metadata pointers.

```
B_Be_Bee-registry/
├── music-sources/{username}-{name}.json   # Music source metadata pointer
├── lyric-sources/{username}-{name}.json   # Lyric source metadata pointer
├── plugins/{username}-{pluginname}.json   # Plugin metadata pointer
├── themes/{author}-{name}/                # In-repo theme definitions
│   ├── theme.json                         # Color tokens (tokens.dark / tokens.light)
│   └── preview.png                        # Preview screenshot
├── scripts/
│   ├── validate.mjs                       # CI gate, schema validation, negative tests
│   └── lib/                               # Validation schemas and contrast checkers
├── CONTRIBUTING.md                        # Author guidelines & schemas
└── MODERATION.md                          # Authenticity & anti-impersonation review
```

- **Zero centralized build output**: No `dist/` directory and no monolithic `registry.json`.
- **Author repository contract**:
  - Music & lyric sources: the author's repository hosts the source code and compiles a single root `index.json` artifact (e.g. [B_Be_Bee-subsonic](https://github.com/BBeBeeX/B_Be_Bee-subsonic) and [B_Be_Bee-lrclib](https://github.com/BBeBeeX/B_Be_Bee-lrclib)).
  - Plugins: the author's repository provides a root `index.js` bundle alongside `manifest.json`.
  - Themes: self-contained within `themes/{author}-{name}/` directly in the registry repository, requiring no external repo.
- **Remote discovery**: The player application queries the registry via the GitHub Contents API (§5.1), caching metadata locally in `ctx.store`.

---

## 2. Metadata schemas

(see the spec at [rules/sources.md §6](../../rules/sources.md#6-registry-third-party-registry) (L2): the entry field enumerations and version semantics belong to that section; this table expands each field's applicable kinds and meaning.)

Each entry in `music-sources/`, `lyric-sources/`, and `plugins/` is an individual `{username}-{name}.json` file:

```jsonc
// music-sources/bbebeex-subsonic.json
{
  "id": "subsonic",
  "name": "Subsonic",
  "version": "1.0.0",
  "author": "BBeBee",
  "description": "Subsonic-compatible music source with Navidrome / Airsonic support.",
  "repo": "https://github.com/BBeBeeX/B_Be_Bee-subsonic"
}
```

| Field | Kinds | Meaning |
|---|---|---|
| `id` | all | Stable entry id. The matching key for `lyric-source` / `theme` / `plugin` (§3). |
| `kind` | all | `music-source` \| `lyric-source` \| `theme` \| `plugin`. |
| `name` | all | Display name. |
| `version` | all | Latest published semver — bump on any content change; absent = `0.0.0`, skipped by update checks (see the spec at [rules/sources.md §6](../../rules/sources.md#6-registry-third-party-registry) (L2)). The builtin lyric source compares against this field to decide whether a registry copy is newer. |
| `author` | all | Attribution, shown in the install dialog. |
| `description` | all | One line shown in listings. |
| `updatedAt` | all | The entry's last-commit date (ISO 8601), set by the index generator. |
| `downloadUrl` | all | Where the installable artifact lives — the app only consumes `dist/` artifacts, never raw entry sources (see the spec at [rules/sources.md §6](../../rules/sources.md#6-registry-third-party-registry) (L2)). |
| `minAppVersion` | all | Minimum app version the entry needs (semver). Optional; absent means no version restriction. Enforced in UI via `minAppVersionBlock` — disables install and explains why when the running app is older. |
| `sourceUrl` | music-source | The document's backend base URL — the installed-source matching key (§3). |
| `previewUrl` | theme, plugin | Preview image for the install dialog. |
| `repoUrl` | plugin | The plugin author's own repository. |
| `sha256` | plugin | Integrity digest of the plugin bundle (§5). |
| `capabilities` | plugin | The manifest capabilities the bundle declares. |
| `category` | plugin | Free-form category slug (e.g. `ui-enhancement`) the Discover page's category filter groups by. Unknown slugs pass through verbatim. |

---

## 3. Matching semantics — what counts as "installed"

(see the spec at [rules/sources.md §6](../../rules/sources.md#6-registry-third-party-registry) (L2): music-source matching on `sourceUrl` belongs to that section; this section explains why each kind matches the way it does.)

`checkUpdates()` compares index entries against what the user already has.
The identity differs per kind, because it reuses each kind's own identity:

| Kind | Matched by | Why |
|---|---|---|
| `music-source` | `sourceUrl` | A `SourceRecord`'s identity *is* its `sourceUrl` — import dedupes on it ([authoring.md §9](./authoring.md#9-importing-updating-and-sharing)). Two registry entries pointing at the same backend are the same source to the user. |
| `lyric-source` | `id` | Lyric sources are registered and keyed by document `id`. |
| `theme` | `id` | Themes are keyed by document `id`. |
| `plugin` | `id` | Plugins are keyed by manifest id (`ctx['plugin-manager']`). |

An installed copy whose version is older than the entry's `version` produces a
`RegistryUpdate` (`kind`, `id`, `name`, `installedVersion`, `availableVersion`,
`downloadUrl`, and `builtin: true` when the installed copy is a built-in —
today, only the builtin lrclib lyric source).

---

## 4. `ctx.contentRegistry` — the service

The contract lives in `packages/protocol/src/services/registry.ts`:

```ts
export interface RegistryService {
  /** Fetches the index (endpoint configurable via store), caching the last good copy for offline use. */
  getIndex(force?: boolean): Promise<RegistryIndex>
  /** Compares installed content against the index; fires 'registry/updates-available' with the result. */
  checkUpdates(): Promise<readonly RegistryUpdate[]>
  /** The previous checkUpdates() result (for badges without re-fetching). */
  updates(): readonly RegistryUpdate[]
  /** Fetches the distribution document for an entry and returns what the confirm dialog must show. */
  fetchEntryDetails(entry: RegistryEntry): Promise<RegistryEntryDetails>
  /** Installs/updates one entry; the caller has already shown the user the details (hosts / plugin risk) — the allowedHosts disclosure red line in rules/sources.md §6. */
  install(entry: RegistryEntry, opts?: { confirmed?: boolean }): Promise<void>
  /** Composition root sets this so plugin-kind installs can reach the desktop dynamic host. */
  setPluginInstaller(installer: (bundle: PluginInstallBundle) => Promise<void>): void
}
```

> ⚠️ **The service key is `contentRegistry`, not `registry`.** On Cordis 4 the
> `registry` key belongs to the kernel itself — its plugin-registry service,
> whose methods surface as `ctx.plugin` / `ctx.inject`. The content index
> claims `contentRegistry` instead.

**Events.** Every *completed* update check — automatic or manual — fires
[`'registry/updates-available'`](../data-model/events.md) with the full update
list, **including the empty list**. An empty emission is meaningful: it clears
badges left by a previous check. There is no separate "check finished" event.

**Persistence** (`ctx.store`):

| Key | Contents |
|---|---|
| `registry.index-cache` | The last successfully fetched index (`{ fetchedAt, index }`), so listings and update badges work offline. |
| `registry.prefs` | User preferences: `endpoint` (override for the default `registry.json` URL) and `lastCheckAt`. |

**Settings.** `AppSettings.registryAutoCheck` (default `true`) controls the
automatic check: first run ~45 s after boot, then once every 24 h. Manual
checks run regardless.

**Diagnostics.** `RegistryService` also carries two *optional* methods,
`getDiagnostics?()` and `rescanEntry?(entryId)` — a stub that predates them
stays valid, and callers must use optional chaining. `getDiagnostics()`
assembles a `RegistryDiagnosticsReport` in four severity groups, every item
derived from real service state (nothing is invented; a group with no data
source stays empty):

- **conflicts** — `registry.lock.json` records whose content is no longer
  installed (`lock-orphan:*`); installed content matching an index entry but
  missing its lock record (`lock-missing:*`, builtin lyric sources exempt);
  duplicate index ids caught by the sanitizer (`duplicate-id:*`); recorded
  manifest-vs-registry capability mismatches (`cap-mismatch:*`); and installed
  plugins whose declared dependencies are not installed (`deps-unmet:*`).
- **risks** — the persisted per-entry security-audit findings:
  `fetchEntryDetails` stores its scan result under the store key
  `registry.audit-findings` (block/warn only; a passing scan deletes the
  record) instead of discarding it.
- **warnings** — index metadata anomalies (dropped entries, duplicate ids),
  the most recent index fetch failure, an exhausted GitHub download chain
  (recorded by the download layer), and an index cache older than 24 h while
  fetching keeps failing.
- **info** — a lock-file summary and per-kind installed-version overviews.

`rescanEntry(entryId)` looks the entry up in the cached index, re-runs
`fetchEntryDetails` (static security scan included) and refreshes the stored
findings / capability-mismatch records. It is detection only — nothing is
installed, so the install-stage `confirmed` gate never applies.

**Task center.** `RegistryService` also optionally carries `getTasks?()` and
`clearFinishedTasks?()` plus the `'registry/tasks-changed'` event (fired with
the full snapshot, newest first, after every mutation). Each user-facing
install/update is tracked as a `RegistryTask` walking the lifecycle
`pending → running → success | failed` through the stages `download → verify
→ install`; a task parks at `pending` ("Awaiting confirmation") while the confirm dialog is
open. Records live in memory only — the active ones plus the 50 most recently
finished — and are never persisted; `clearFinishedTasks` removes only the
finished ones.

---

## 5. Install flows, author repository artifact chain & security audit

The registry operates an end-to-end security gating architecture covering discovery, downloading, static auditing, pre-installation confirmation, and tamper-resistant local locking:

Every install chain reports its stages (download / verify / install) to the
task center as it runs (§4); the diagnostics rescan (`rescanEntry`) walks the
same fetch path but reports nothing.

### 5.1 Discovery via GitHub Contents API

Instead of querying a single monolithic `registry.json`, `getIndex()` enumerates 4 categorized directories via the GitHub Contents API:
- `music-sources/`
- `lyric-sources/`
- `plugins/`
- `themes/`

Each directory item is parsed and sanitized. If the network or API fails, the service falls back first to a legacy single `registry.json` endpoint if available, and finally to the offline store cache (`registry.index-cache`).

### 5.2 Author Repository Artifact Chain

For third-party plugins and author repositories:
1. **Commit resolution**: Queries `https://api.github.com/repos/{owner}/{repo}/commits/HEAD` to resolve the immutable HEAD commit SHA.
2. **Artifact retrieval**: Downloads root `manifest.json` and `index.js` (or `index.json`) pinned to that exact commit.
3. **Capability consistency check**: Verifies that capabilities declared in `manifest.json` strictly match those declared in registry metadata. If the manifest requests undeclared capabilities or misses declared ones, installation is rejected immediately.

### 5.3 Static Security Audit (`ctx.securityAudit`)

The built-in `@BBeBee/plugin-security-audit` plugin (Layer 4) re-exports the scanner in `packages/feature/toolkit` (`scanCode`). It runs **8 static regex rules** followed by **2 dynamic scan groups** — 13 rule ids in all:

Static rules (regex; one finding per match):

- `eval-function-constructor` — `eval()`, `new Function()`, `window/globalThis.eval()` (block).
- `dynamic-code-execution` — string-code `setTimeout`/`setInterval`, `vm.runIn*` / `new vm.Script`, `require('vm')` (block).
- `credential-private-key` — `-----BEGIN … PRIVATE KEY-----` blocks (block).
- `credential-api-token` — high-risk platform tokens (`ghp_…`, `github_pat_…`, `AKIA…`, `sk-…`) (block).
- `credential-generic-secret` — long literals assigned to `api_key` / `secret_key` / `private_key` / `auth_token` style keys (warn).
- `prototype-pollution` — mutations to `__proto__`, `Object.prototype`, `constructor.prototype` (block).
- `remote-dynamic-import` — dynamic `import()` of remote URLs or indeterminate targets (block).
- `obfuscation-packer` — known JS packer / obfuscation wrapper signatures (`eval(function(p,a,c,k,e,d/r)…`) (block).

Dynamic scan groups:

- **Undeclared egress** — `undeclared-host-egress`: URL literals in the code whose host is not in the entry's declared `allowedHosts` (block).
- **Obfuscation features** — four ids: `obfuscation-dense-hex` (dense `\x` escapes; warn at ≥ 3 occurrences, block at ≥ 6), `obfuscation-dense-unicode` (dense `\u00…` escapes, warn), `obfuscation-packer-identifiers` (`_0x…` identifier swarms, block), `high-entropy-string` (Shannon entropy ≥ 4.8 in a 40+ character literal, warn).

Findings are tagged as `block` (critical) or `warn` (suspicious). If any finding is at `block` level, installation is blocked by default.

### 5.4 Pre-Installation Audit Confirmation Dialog

Before any installation or update proceeds, the desktop UI (`packages/ui/plugin-registry-ui-desktop`) presents an `InstallConfirmDialog`:
- **Security Audit Report**: Displays an audit severity badge (`Pass` / `Warn` / `Block`) and lists individual findings (category, severity, code snippet, line number).
- **Author repository & commit**: Shows the source repository link and commit SHA.
- **Commit Diff**: For updates, displays the commit progression (e.g., `a1b2c3d → e4f5g6h`).
- **Block Gating**: a `block` audit disables the confirm button by default — the explicit-risk-confirmation red line (see the spec at [rules/sources.md §6](../../rules/sources.md#6-registry-third-party-registry) (L2)); the desktop UI implements it as the "I acknowledge the high-risk findings and confirm forced installation" override checkbox.

### 5.5 `registry.lock.json` Anti-Tampering Management

- **Location**: Stored in the App User Data directory as `registry.lock.json` (also mirrored in `ctx.store` under `registry.lock`).
- **Format**:
  ```jsonc
  {
    "version": 1,
    "records": {
      "custom-plugin": {
        "id": "custom-plugin",
        "kind": "plugin",
        "repo": "https://github.com/alice/custom-plugin",
        "commit": "a1b2c3d4e5f67890",
        "sha256": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
        "installedAt": 1775894400000
      }
    }
  }
  ```
- **Load-time Verification**: On boot, the desktop dynamic loader (`apps/desktop/renderer/dynamic-loader.ts`) recalculates the SHA-256 of installed plugins and compares them against `registry.lock.json`. If a mismatch is detected (tampered files), the plugin is marked `quarantined` and execution is refused to prevent malicious code injection.

### 5.6 Download region & GitHub acceleration

Every GitHub request the registry makes — Contents enumeration, commit
resolution, and all raw/api downloads — goes through one unified download layer
(`plugin-registry/src/github-fetch.ts`). Each URL is expanded into an ordered
candidate chain:

1. **Official** — the original URL, always first.
2. **jsDelivr** (system built-in) — generated only for
   `raw.githubusercontent.com/{owner}/{repo}/{commit}/{path}` URLs with the
   commit segment present, rewritten to
   `https://cdn.jsdelivr.net/gh/{owner}/{repo}@{commit}/{path}`. `api.github.com`
   URLs and anything else never get one.
3. **Custom prefixes** — one candidate per configured acceleration prefix, in
   the user's order, gh-proxy style (`prefix + original full URL`); applies to
   both raw and api hosts.

A candidate is abandoned only when it actually fails (transport error or HTTP
status ≥ 400) — never speculatively. Every switch is logged through
`ctx.logger` (`[github-fetch] official failed (403), falling back to jsdelivr: …`)
and is never surfaced as a toast or dialog. A URL on any other host (for
example an author's own `downloadUrl`) keeps exactly one candidate and is
never rewritten.

Two settings back this, edited in the settings screen's network tab
("Downloads & GitHub acceleration" card):

| Setting | Meaning |
|---|---|
| `AppSettings.downloadRegion` | `'global'` (default) or `'mainland-china'`, stored as a preference. Currently advisory only: the official-first rule never changes, and the region value surfaces in the download layer's log lines. |
| `AppSettings.githubAccelerationPrefixes` | Ordered HTTPS base URLs (e.g. `https://ghproxy.example.com/`) that are prepended to the original full URL. Array order is try order; the editor reports the complete array on every change, and the built-in jsDelivr line is not part of the array. |

The `registry.prefs.endpoint` override (§4) keeps its semantics: a configured
override **is** the official candidate and is never accelerated — only the
default GitHub endpoints walk the full chain.

---

## 6. Install flows per kind

| Kind | Flow |
|---|---|
| `music-source` | Fetch the `dist/` document → `ctx.sources.import(text, { originUri: downloadUrl })`. Full import pipeline applies; records pinned metadata in `registry.lock.json`. |
| `lyric-source` | Fetch document / author repo → shape check → static security scan → `ctx.lyricSources.registerSource(doc)` → records in `registry.lock.json`. |
| `theme` | Fetch document / author repo → shape check → WCAG AA contrast check → `ctx.theme.registerTheme(doc)` → records in `registry.lock.json`. |
| `plugin` | Fetch bundle / author repo → capability consistency check → static security scan → desktop dynamic loader bridge `installAndActivatePlugin` → records in `registry.lock.json`. |

---

## 7. Built-in content constraint

(see the spec at [rules/sources.md §6](../../rules/sources.md#6-registry-third-party-registry) (L2): exactly one built-in lyric source, no built-in music source, and the registry must not add new built-ins.) The reason: built-ins ship with the app binary and are
covered by the builtin-upgrade comparison, while everything in the registry is
opt-in, user-confirmed content. Today's one built-in is the lrclib lyric source (id
`builtin-lrclib` in the index).

---

## 8. View placement

The registry view (Discover, route `/registry`) is contributed to the desktop shell with `placement: ['tray']` rather than `sidebar`:

1. **Information architecture hierarchy**: The left sidebar is reserved for primary audio playback and local library navigation (Search, Library, Albums, Playlists). Management tools and extensions (Registry, Downloads, History, Import Share) are aggregated in the TopBar tray to prevent navigation clutter.
2. **Update notification coupling**: `apps/desktop/renderer/TopBar.tsx` hosts `TrayIndicator`, which subscribes to the `registry/updates-available` event. When updates are found, it displays an update indicator dot (`topbar-tray-update-dot`) on the tray toggle button and on the registry entry inside the tray panel. Placing the registry in the tray allows update notifications to alert the user promptly without polluting the core browsing sidebar.

### 8.1 The Discovery page surface

Beyond the four kind tabs, the screen carries a set of client-side view features (all view state; nothing beyond favorites is persisted):

- **Third-party filter** — the "Show third-party content" toggle, on by default. Officialness has exactly one rule: the entry's `repo`/`repoUrl` owner equals the `BBeBeeX` GitHub organization. Organization names are globally unique and cannot be spoofed, so the repository owner is the only trust anchor; an entry that publishes no repository — the built-in lyric sources included — reads as third-party and is hidden while the toggle is off.
- **Sorting** — by name (locale compare), or by GitHub stars / contributor count through the companion `ctx.registryMetadata` service (contracts §25.1). Stats requests fire only while a numeric sort key is active, cache for 24 h, degrade to "—" on failure, and never block rendering.
- **Plugin category filter** — options derive from the `category` slugs actually present in the index (§2); unknown slugs pass through untranslated instead of crashing.
- **Favorites / Installed tabs** — favorites are a localStorage id set (`bbebee_registry_favorites`); the installed tab lists what the content services report as installed or updateable, annotates lock-record commit/date metadata (§5.5), and offers uninstall for the kinds whose owning services expose a remove API (plugins have none — the tab points at plugin management instead).
- **Task center & diagnostics** — the header task button and the Diagnostics tab render the optional service surfaces documented in §4.

---

## 9. Where to go next

[spec.md](./spec.md) defines the music-source document model the registry's
`music-source` entries compile to; [runtime.md](./runtime.md) defines what an
imported source can and cannot do;
[rules/sources.md §6](../../rules/sources.md#6-registry-third-party-registry) is the normative summary of the
registry model; the registry repo's
[CONTRIBUTING](https://github.com/BBeBeeX/B_Be_Bee-registry/blob/main/CONTRIBUTING.md)
and
[MODERATION](https://github.com/BBeBeeX/B_Be_Bee-registry/blob/main/MODERATION.md)
define how entries get in.
