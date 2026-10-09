# The Content Registry (`B_Be_Bee-registry`)

> **What this answers.** How the app discovers, checks and installs third-party
> content — music sources, lyric sources, themes and desktop plugins — from the
> community registry, and how the registry repo is wired into this monorepo.

Music sources are imported strings, not plugins ([spec.md](./spec.md)). The
registry is the curated place where such strings — and the other three kinds of
installable content — are published, versioned and reviewed, so that users have
a first-party path beyond pasting whatever a forum thread says.

---

## 1. Repository wiring

The registry lives in its own repository,
[BBeBeeX/B_Be_Bee-registry](https://github.com/BBeBeeX/B_Be_Bee-registry), and is
consumed by this monorepo as a **git submodule pinned at `registry/`**:

```
registry/
├── music-sources/<id>/     dual-file music source development (source.json + source.js)
├── lyric-sources/<id>/     dual-file lyric source development
├── themes/<id>/            theme documents
├── plugins/                plugin metadata files
├── dist/                   compiled single-file documents the app actually downloads
├── registry.json           the generated index (see §2)
├── scripts/                compile / generate-index / validate (Node builtins only)
├── CONTRIBUTING.md         how to submit an entry
└── MODERATION.md           what maintainers check before publishing
```

- The source of truth for content is the **entry directories**; `dist/` and
  `registry.json` are **generated** (by `scripts/compile.mjs` and
  `scripts/generate-index.mjs` respectively) and validated for freshness by
  `scripts/validate.mjs`.
- The main repo's `pnpm build:sources` compiles the submodule's
  `music-sources/` and `lyric-sources/` into `fixtures/sources/` and
  `fixtures/lyric-sources/` plus the builtin lyric module
  ([authoring workflow](./spec.md#23-dual-file-authoring-vs-single-file-distribution)).
- The submodule's URL is currently a local placeholder. After the remote
  repository is created, point it at the real URL:

  ```bash
  git submodule set-url registry <url> && git submodule sync
  ```

---

## 2. `registry.json` — the index format

```jsonc
{
  "generatedAt": "2026-10-07T10:22:39-04:00",
  "repository": "BBeBeeX/B_Be_Bee-registry",
  "entries": [
    {
      "id": "bilibili",
      "kind": "music-source",
      "name": "Bilibili",
      "version": "1.0.0",
      "author": "BBeBee",
      "description": "…",
      "updatedAt": "2026-10-07T10:22:39-04:00",
      "downloadUrl": "https://…/dist/music-sources/bilibili.json",
      "sourceUrl": "https://www.bilibili.com"
    }
  ]
}
```

| Field | Kinds | Meaning |
|---|---|---|
| `id` | all | Stable entry id. The matching key for `lyric-source` / `theme` / `plugin` (§3). |
| `kind` | all | `music-source` \| `lyric-source` \| `theme` \| `plugin`. |
| `name` | all | Display name. |
| `version` | all | Latest published semver. **Any content change must bump it**; an entry without `version` is treated as `0.0.0` and skipped by update checks. The builtin lyric source already compares against this field to decide whether a registry copy is newer. |
| `author` | all | Attribution, shown in the install dialog. |
| `description` | all | One line shown in listings. |
| `updatedAt` | all | The entry's last-commit date (ISO 8601), set by the index generator. |
| `downloadUrl` | all | Where the installable artifact lives — always a `dist/` build artifact, never raw entry sources. |
| `minAppVersion` | all | Minimum app version the entry needs. Informational; not enforced yet. |
| `sourceUrl` | music-source | The document's backend base URL — the installed-source matching key (§3). |
| `previewUrl` | theme, plugin | Preview image for the install dialog. |
| `repoUrl` | plugin | The plugin author's own repository. |
| `sha256` | plugin | Integrity digest of the plugin bundle (§5). |
| `capabilities` | plugin | The manifest capabilities the bundle declares. |

---

## 3. Matching semantics — what counts as "installed"

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
  /** Installs/updates one entry. The caller must already have shown the user the details (hosts / plugin risk). */
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

---

## 5. Install flows per kind

`install(entry)` routes to the service that owns the kind — the registry
service is a thin coordinator that validates nothing a downstream service
already validates, and hides nothing a user must see before confirming:

| Kind | Flow |
|---|---|
| `music-source` | Fetch the `dist/` document → `ctx.sources.import(text, { originUri: downloadUrl })`. The full import pipeline applies: validation, `sourceUrl` dedup, review of rejected/conflicted rows. Install fails loudly if the report shows no accepted row for the entry's `sourceUrl`. |
| `lyric-source` | Fetch the `dist/` document → shape-check (`id` / `name` / `script`) → `ctx.lyricSources.registerSource(doc)`. |
| `theme` | Fetch the `dist/` document → shape-check → the **same dark/light contrast gate** a user-drafted theme goes through → `ctx.theme.registerTheme(doc)`. |
| `plugin` | Fetch the bundle (`{ manifest, files }` JSON) → **refuse if the entry publishes no `sha256`** → verify the downloaded bytes against the digest → shape-check the manifest → hand to the desktop dynamic host via `setPluginInstaller`. Desktop-only. |

**Security red lines, enforced in the UI before `install()` is called:**

- **`allowedHosts` is shown before install.** `fetchEntryDetails()` extracts
  the music document's egress list so the confirm dialog can name every host
  the source will be allowed to talk to. A host list is a sentence a user can
  judge; it must be on screen before the document is imported, not discovered
  afterwards.
- **Plugin installs are a risk confirmation.** The dialog shows the entry's
  `repoUrl`, declared `capabilities` and verified `sha256`; the user explicitly
  confirms before code is loaded.
- **The app only consumes `dist/` artifacts.** Entry sources in the registry
  repo exist for human review (`MODERATION.md`); nothing fetches them at
  runtime.

---

## 6. Built-in content constraint

The app ships exactly **one built-in lyric source** (lrclib, id
`builtin-lrclib` in the index) and **no built-in music sources**. The registry
must not add new built-in sources: built-ins ship with the app binary and are
covered by the builtin-upgrade comparison, while everything in the registry is
opt-in, user-confirmed content.

---

## 7. Where to go next

[spec.md](./spec.md) defines the music-source document model the registry's
`music-source` entries compile to; [runtime.md](./runtime.md) defines what an
imported source can and cannot do; the registry repo's
[CONTRIBUTING](https://github.com/BBeBeeX/B_Be_Bee-registry/blob/main/CONTRIBUTING.md)
and
[MODERATION](https://github.com/BBeBeeX/B_Be_Bee-registry/blob/main/MODERATION.md)
define how entries get in.
