# @BBeBee/plugin-history-ui-mobile

Layer 5 (ui) — the mobile view package for `plugin-history` (headless): the play history and statistics page.

## Overview

Registers `history.view` and binds it to the mobile React Native shell. Data comes from `@BBeBee/plugin-player/hooks` (`usePlayHistory`, `usePlayHistoryStats`), and components use `@BBeBee/ui-kit-mobile` (`List`, `TrackRow`, `ContextMenu`).

## Registered views

| id | Component | Description |
|---|---|---|
| `history.view` | `HistoryScreen` | The mobile play history and statistics page |

## Core features

1. **Top stats panel**: shows total plays, total listening time, and tracks heard today.
2. **Track deduplication**: strictly deduplicates by `trackUrn`, keeping only each track's most recent play record.
3. **Play count badge**: shows an `N plays` pill badge to the right of each track.
4. **Single-track playback and long-press menu**: tap to play; long-press opens the track quick-action menu.
