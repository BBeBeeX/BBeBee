# Entity URNs & Identity Linking

> **Legacy Reference:** Formerly `docs/07-data-model.md §1`.

> **What this answers.** How entities are identified, the URN grammar, why entities are multi-row across sources, and exported URN helper functions.

Everything here lives in one SQLite database behind
[`ctx.db`](../services/contracts.md#5-ctxdb--sql), identical on both platforms.

---

## 1. Identity: the URN

```
BBeBee:<sourceId>:<kind>:<id>
       │          │       └── source-local id, opaque, never parsed
       │          └────────── track | album | artist | playlist | genre
       └───────────────────── source id, derived from sourceUrl (sources/authoring.md §1.2)
```

Examples:

```
BBeBee:local:track:9f2c8a1e
BBeBee:music-example-org-35be9fe2:album:41af02
BBeBee:jellyfin-nas-local-1bb03370:playlist:7c11
```

### Why the source, not the backend kind

Two Navidrome servers are two namespaces, and under the string model they are simply two imported
documents with two `sourceUrl`s ([authoring.md §1.2](../sources/authoring.md#12-identity-the-source-id)). If
the URN keyed on anything coarser — a protocol, a "plugin" — ids would collide the moment a user
added a second server, and removing one would corrupt the other's rows.

The segment survived the move from plugins to strings unchanged, which is the point of having
made it "whichever namespace owns this id" rather than "which package produced this".

### Why the same song is several rows

A FLAC on a Navidrome server and an MP3 of the same recording on disk are **two rows with two
URNs**, joined by a `track_links` row — not one merged row.

This is the single most consequential modelling decision in the document, so the reasoning is
worth stating:

- They genuinely differ in the ways that matter — bitrate, availability, duration to the
  millisecond, artwork, whether they can be seeked.
- Merging requires deciding *which* metadata wins, and any such decision is wrong for some user.
- Un-merging after a bad automatic match is far harder than merging on demand, and fuzzy matching
  is wrong often enough to guarantee bad matches
  ([authoring.md §11](../sources/authoring.md#11-cross-source-identity-and-failover)).
- A source removed from the app should take exactly its own rows with it.

The unified library presents linked tracks as one item at *display* time. Storage stays faithful.

### URN helpers

Declared in `@BBeBee/protocol` (`packages/protocol/src/urn.ts`):

```ts
export const URN_SCHEME = 'BBeBee' as const

export type UrnKind = 'track' | 'album' | 'artist' | 'playlist' | 'genre'

export interface Urn {
  sourceId: string
  kind: UrnKind
  id: string
}

export class UrnError extends Error {
  readonly value: string
  // ...
}

export function isUrnKind(value: string): value is UrnKind
export function parseUrn(urn: string): Urn
export function tryParseUrn(urn: string): Urn | undefined
export function formatUrn(urn: Urn): string
export function sourceOf(urn: string): string
export function kindOf(urn: string): UrnKind
```

`parseUrn` splits on the first three colons only, so source-local ids may contain colons.
`tryParseUrn` returns `undefined` on malformed inputs without throwing.
`formatUrn` validates that `sourceId` contains no colons/whitespace, `kind` is a valid `UrnKind`, and `id` is non-empty.

---


