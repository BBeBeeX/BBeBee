# @bbebee/plugin-history-ui-desktop

Layer 5 (ui) — the desktop view package for `plugin-history` (headless): the play history and listening statistics pages.

## Overview

Registers `history.view` and binds it to the desktop shell. All domain statistics and history data come from `@BBeBee/toolkit/hooks` (`usePlayHistory`, `usePlayHistoryStats`, `usePlayHistoryHeatmap`; React bindings consumed across features are unified in toolkit).
`inject = ['ui', 'player', 'sources']`; covers are resolved through the local cache via `useResolvedArtwork` (`@BBeBee/toolkit/hooks`), and context menus plug in through `@BBeBee/ui-menus`.

## Registered views

| id | Component | Description |
|---|---|---|
| `history.view` | `HistoryScreen` | Play history statistics and the deduplicated track records page |

## Core features and interaction design

1. **Listening footprint stat cards**:
   - Total plays: cumulative play count;
   - Total listening time: a formatted presentation of the total time immersed in music;
   - Played today: number of tracks heard today;
   - Completion rate: share of tracks played to completion (`completedPlays / totalPlays`).
2. **Play activity heatmap (PlayHeatmap)**:
   - a GitHub-style 52-week × 7-day grid heatmap, rendering 5 levels of green based on how many tracks were heard that day;
   - clicking a specific cell filters that day's play records by date; clicking again clears the date filter.
3. **Track list with strict deduplication**:
   - **per-track dedup**: deduplicates by `trackUrn`, keeping each song's most recent play record, preventing a single-song loop or repeated plays from flooding the page with the same song;
   - **play count badge**: the right side of a track row shows the song's cumulative play frequency in the history (an `N plays` pill badge);
   - **status and time**: shows "Completed"/"Skipped" badges plus relative/absolute play times (e.g. "Today 14:30", "Yesterday 09:15");
   - **batch metadata loading**: `useTracksByUrn` resolves only the deduplicated list of unique URNs, greatly reducing meaningless duplicate catalogue queries;
   - **single-track taps and context menu**: clicking a track calls `player.playNow([trackUrn])` directly to start playback; right-click opens the standardized track action menu.
4. **Clearing history**:
   - includes a confirmation step ("Clear play history?" / "OK" / "Cancel"), calling `player.clearHistory()`.

## Tests (`src/screens.test.tsx`)

- heatmap level and duration formatting unit tests;
- heatmap cell clicks and date selection;
- empty-history state assertions;
- stat card and track record rendering;
- clear-history confirmation interaction assertions;
- song deduplication and per-song play count badge (`N plays`) rendering assertions.
