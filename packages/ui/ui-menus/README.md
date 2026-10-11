# @BBeBee/ui-menus

Layer 5 (ui) — the **right-click / long-press menu model** shared by both shells: which actions a track, playlist, or collection gets, and what each action calls.

## Overview

This is the other half of docs/08 §1 "the `if` written once":

- The kits (`ui-kit-desktop` / `ui-kit-mobile`) provide the `ContextMenu` component — it only knows arrays of `MenuItemSpec` and `SubmenuSpec`, and has no idea what a playlist, the queue, or downloads are;
- This package knows **every action** and owns **no pixels**; both shells get the same entries, the same order, the same wording.

It is Layer 5 rather than Layer 4: it composes four features (`ctx.library` / `ctx.player` / `ctx.downloads` / `ctx.ui`) and references `album.view`, which a Layer 4 plugin may not do to its siblings. All services are read through `serviceOf` — in a build without downloads the "Download" entry **disappears** instead of throwing when clicked.

## Exports

```ts
// Pure model (unit-testable, no renderer)
trackMenuItems(ctx, { track, playlistItemId? }, { fromPlaylistUrn?, playlists?, collections? }): MenuItemSpec[]
playlistMenuItems(ctx, { urn, name }, tracks, playlists?, collections?, opts?: { pinned?, onTogglePin?, onEdit?, onDelete?, onMoved? }): MenuItemSpec[]
collectionMenuItems(ctx, trackUrns, playlists?, collections?, opts?: { pinned?, onTogglePin?, onRename?, onDelete?, onCreatePlaylist?, onCreateFolder?, onMoveToFolder?, onPlay? }): MenuItemSpec[]
addToPlaylistSubmenu(library, trackUrns, playlists): SubmenuSpec | undefined
addToCollectionSubmenu(library, urns, collections, opts?: AddToCollectionSubmenuOptions): SubmenuSpec | undefined
addToCollectionOnlyItems(ctx, urns, collections, opts?: AddToCollectionOptions): MenuItemSpec[]

// React controllers: open() + menuProps ready to spread
useTrackMenu(ctx, { fromPlaylistUrn? }) → { open(target, anchor?), menuProps }
usePlaylistMenu(ctx)                    → { open(playlist, tracks, anchor?, opts?), menuProps }
useCollectionMenu(ctx)                  → { open(title, trackUrns, anchor?, opts?), menuProps }
useAddToCollection(ctx)                 → { open(title, itemUrns, anchor?, opts?), menuProps }
```

## Menu contents

**Track**: Add to playlist (submenu: search field → New playlist → all playlists) → Remove from this playlist (only inside a playlist detail) → Remove from Favorites (only when `track.loved`) → Add to play queue (`player.enqueueLast`) → Download → Go to album (when `albumUrn` exists) → sleep timer. (Note: a single track offers no "Add to folder"; folders only organize playlists, albums, and subfolders.)

**Playlist**: Edit details (`edit-details`, when `onEdit` is passed) → Delete (`delete-playlist`, danger red, confirmed through a host dialog) → Pin playlist / Unpin playlist (`toggle-pin`, when `onTogglePin` is passed) → Add to music library (`library.setSaved`) → Add to play queue (enqueues the whole list) → Download (whole list) → Add to another playlist (submenu, copies the whole list) → Move to folder (supports choosing a target folder, New folder, and offers "Move to root" when inside a folder).

**Album (single-entity menu)**: Delete (`delete-album`, danger red, removes from the music library and cleans up folder links, confirmed through a host dialog) → Pin playlist / Unpin playlist (`toggle-pin`) → Move to folder (`add-to-collection`, supports moving across folders and Move to root).

**Collection / folder**: Rename (`rename-collection`) → Delete (`delete-collection`) → Pin folder / Unpin folder (`toggle-pin`) → Create playlist (`create-playlist`) → Create playlist folder (`create-folder`) → Move to folder / Move to root → Play (recursively gathers the tracks of all child playlists and albums into the queue).

## Design notes

- **Delete double-confirmation**: the right-click Delete option for playlists and albums carries the danger red warning (`tone: 'danger'`); its `onDelete` callback is intercepted by the outer screen (e.g. `LibraryScreen`), which raises the `ConfirmDeleteModal` confirmation dialog, and only after the user confirms does the actual `deletePlaylist` or `setSaved(..., false)` run.
- **List actions resolve tracks before the menu opens**: a playlist row only has `trackCount`, no track URNs; the row menu calls `getPlaylist()` / `listCollectionItems()` before opening, and if that fails the corresponding entry is not shown — a menu item that would act on an empty list is worse than none.
- **Smart playlists are disabled inside the "Add to playlist" submenu**: their tracks come from rules, so there is no row an add could write (the service would refuse; a menu item that throws is worse than one that is visibly unavailable).
- **Anchor is optional**: right-click / long-press carries coordinates, the `⋯` button does not — without an anchor the menu lands mid-upper screen, and mobile ignores coordinates (bottom sheet).
- **Move and root awareness**: `currentFolderId` automatically excludes the current folder; an item inside a subfolder gets a "Move to root" shortcut; a move automatically triggers removal from the original folder and addition to the target folder.
- **Favorite double-write invariant**: like / unlike — the track's right-click entry and the "Liked songs" toggle in the `useSaveToPlaylistMenu` popover — write both stores: first `sources.setLoved` (paints the heart, drives `onlyLoved`), then `library.setSaved` (the Favorites shelf reads this side). Writing the catalogue first ensures that when the `library/changed` event fires and listeners re-read, the state is final; writing only one side yields "un-favorited but the row is still hearted".
- The playlist list is fetched only when the menu opens; a slow `listPlaylists` does not block the menu itself; the submenu fills in a beat later.

## Tests (`src/index.test.tsx`)

32 cases: the order of track entries, entries disappearing when a service is missing, `remove-from-playlist` appearing only inside a playlist, unliking writing both `track_stats` and `library_items` (both the right-click and popover-toggle paths pin the double-write and its ordering), the enqueue/download/go-to-album calls, sleep timer presets and custom-time parsing/cancellation, submenu creation/selection/smart-playlist disabling, the album `delete-album` option, playlist and collection entries, moving between folders and Move to root, and `useTrackMenu`'s open/close states.

## Sort menu builder

`sortMenuItems(options, activeId, onPick, order?)`: entry builder for the detail pages' sort dropdown — one entry per key, a check on the active one, and after the trailing hairline divider Ascending/Descending (pass no `order` for key entries only). Shared by the four detail pages, so the same menu cannot grow four dialects.
