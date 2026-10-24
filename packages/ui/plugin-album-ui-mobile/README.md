# @bbebee/plugin-album-ui-mobile

Layer 5 (ui) — the mobile view package for `plugin-album` (headless): the twin half of `plugin-album-ui-desktop`.

## Overview

The **same set of hooks and the same playback semantics** as the desktop version — only the elements and shapes differ. Domain state comes from `@bbebee/plugin-album/hooks`; kit primitives are obtained via `nativePrimitives()`; `ctx.sources` via `inject`, `player` / `downloads` through `serviceOf` (optional). Depends on the headless `@bbebee/plugin-album` and `@bbebee/plugin-sources` (which returns the fallback library route id).

## Source files

### `src/index.tsx`

**Registered view**: `album.view` → `AlbumScreen` (generator effect, fiber name `'album-ui-mobile'`).

**Mobile differences** (behaviour matches the desktop):

- a **`‹ Library` back control** at the top: used when the shell passes `onBack`; otherwise falls back to `ui.navigate(SOURCES_VIEWS.library)` — never leaving the user stranded on a screen with no way out (the error state's "Back to library" button takes the same path);
- the header is **centred and vertical** (200px cover, title `numberOfLines: 2`), where the desktop is horizontal;
- "Play album" is likewise **disabled rather than hidden**;
- single-track taps are verbatim identical to the desktop: `playFromContext(track, all tracks, { context: { kind: 'album', urn, label } })` — jump if already queued, otherwise the whole album becomes the queue starting at the tap; **playback never navigates**, the mini-player announces what is playing;
- download button → `ctx.downloads.enqueue([urn])`; not drawn when there are no downloads.

**`bound(ctx, Screen)`** — the same as every view package: closes over the context captured by this plugin's `apply`; `h(Screen, …)` rather than a function call.

## Tests (`src/screen.test.tsx`)

jsdom + Testing Library. First `configureNative({…})` injects the DOM host components (including a `FlashList` stub) — the same seam `apps/mobile` hands real RN through. 4 cases:

1. draws the album + "Play album" → `playNow([A, B])`;
2. tapping "Jóga" → `playFromContext(B, [A, B], { kind: 'album', urn, label: 'Homogenic' })`;
3. download button → `enqueue([A])` (the DOM host bubbles clicks into the `Pressable`, which RN's responder system would not — "does not trigger playback" is pinned by the desktop twin, where the kit stops propagation explicitly);
4. missing album → "Album unavailable" + "Back to library" falls back to navigating to `sources.library`.

## Related docs

- `packages/feature/plugin-album/README.md`: the headless side
- `packages/ui/plugin-album-ui-desktop/README.md`: the twin half (with a fuller description of the desktop behaviour)
- `packages/ui/plugin-sources-ui-mobile/README.md`: library/search screens (navigation entry)
