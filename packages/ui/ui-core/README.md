# @BBeBee/ui-core

Layer 5 (ui) — the seam between services and React.

## Overview

It depends only on `react` and `@BBeBee/protocol` (nothing else), so both kits are built on the same hooks: a feature's **state** logic is written once, its pixels twice (docs/08 §4).

This layer exists to enforce one rule: **React does not own domain state.** Services own it; components subscribe to it. Anything here that starts to look like a reducer belongs in a service.

## Source files

### `src/index.ts` — service reads and subscription hooks

| Export | Purpose |
|---|---|
| `serviceOf<T>(ctx, key): T \| undefined` | Reads a service from the context, returning `undefined` when it is not loaded — `undefined` is a normal state, not an error (a plugin can be disabled, a service may not exist on this platform); rendering a placeholder is what docs/08 §3 requires. ⚠️ **`ctx[key]` is not the right question to ask**: on a plugin-scoped context (the only kind a view ever gets), cordis's proxy **throws** on any non-injected property, so even `ctx.player?.x` never gets to short-circuit — the root of the famous "tests answer undefined, on-device it throws" bug. `reflect.get(key, false)` (a "non-required" read) has an answer on both root and scoped contexts. |
| `useService<T>(ctx, key)` | The hook form of `serviceOf`; when absent, shows `key (absent)` in devtools via `useDebugValue`. |
| `useServiceState<T>(ctx, events, select, options?)` | Subscribes to service state (a `useSyncExternalStore` wrapper). Key points: the store lives across re-renders via `useMemo` (otherwise every render resubscribes and the loop-guard cache is thrown away); **`select` is deliberately not in the dependencies** — it is inline at nearly every call site, and adding it would rebuild the store every render; `deps` is the caller's way of saying "the selection itself changed". `select` runs on every notification and every render and must be cheap; **reference stability is not required** — the store caches and compares (see `store.ts`). |
| `AsyncState<T>` / `isReady` | `{ status: 'idle'\|'loading'\|'ready'\|'error', data?, error? }`. Deliberately **not** a data-fetching library: it exists so views do not have to hand-roll `useEffect`s for loading/failure — docs/08 §4 forbids using it for domain work. |

### `src/props.ts` — the shared props contract of both kits (types only)

Written once, at the contract layer, so the desktop `Button` and the mobile `Button` cannot drift into different shapes — that drift makes every plugin author pay twice, forever. **Pure types**: no React import, no platform import; both kits and the parity gate can read it.

- **`CommonProps`** — every component has it, so callers never have to ask which do: `testID?` (one name on both ends, each kit maps it to its own property) and `accessibilityLabel?` (docs/08 §8 mandates an accessible name on every interactive element; a per-component decision would inevitably be forgotten — so it lives here, once).
- Component prop types, one by one: `ButtonProps` (`onPress` rather than `onClick` — one name across both kits; a tap is not a click; `loading` both shows progress **and disables**, two props can drift, one cannot), `IconButtonProps` (`accessibilityLabel` **required** — an icon has no text to fall back on), `TrackRowProps` (`active` = **now playing**, not selected; `onMore` binds right-click on desktop, long-press on mobile), `SliderProps` (**`onChange` and `onCommit` are separate** — seeking on every drag frame is what makes a scrubber unusable), `SheetProps`, `ListProps<T>` (`keyExtractor` required — a 100k-track library needs stable keys; `estimatedItemSize` the desktop virtualizer needs and FlashList measures itself and ignores — "a prop ignored by one end is cheaper than two contracts"), `EmptyStateProps`, `ToastProps`, `TextProps` (`variant` only accepts scale names, **bare pixels never pass in**), `TextFieldProps` (**controlled on both ends** — one end uncontrolled and the other controlled is exactly the divergence the parity gate guards against; `multiline` exists because users will paste source documents that are hundreds of lines of JSON; `autoCorrect` defaults off — a rule silently "corrected" fails without explanation), `ArtworkProps`.
- Union types: `Tone`, `TextVariant`, `ButtonVariant`.

### `src/store.ts` — service state as an external store

`useSyncExternalStore` needs `subscribe` and `getSnapshot`, and both have rules that are easy to get wrong and hard to see. Building them outside React is what makes the rules testable: a hook needs a renderer, a store needs nothing.

| Export | Purpose |
|---|---|
| `createServiceStore(ctx, events, select, options?)` | One service's store, invalidated by a set of events. Core: **snapshots are cached and replaced only when the selection actually changes** — a selector returning a new object/array is safe here; piped straight into `useSyncExternalStore` it would loop forever ("the app is slow", not an error). In `subscribe` the event callback **calls `read()` before `onChange()`**: React calls `getSnapshot` immediately after the notification, and reading a stale value there is a render one beat behind. |
| `shallowArrayEqual(a, b)` | Compares arrays by element identity. The common list-selector case: the queue is a new array on every `queue/changed` but with identical elements; re-rendering a 5000-row list because the wrapper changed is scroll jank. |
| `shallowEqual(a, b)` | One-level-deep object comparison, for selectors that build small records. |

## Tests

`src/store.test.ts`: the store's cache/invalidation behavior and the semantics of both comparators — no renderer needed.

## Related docs

- `docs/08-ui-architecture.md` §3/§4: the view model and hook rules
- `packages/feature/plugin-player/README.md`, `packages/feature/plugin-sources/README.md`: the feature hooks that consume these hooks
