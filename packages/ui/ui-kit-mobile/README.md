# @BBeBee/ui-kit-mobile

Layer 5 (ui) — the mobile half of the React Native parity component set.

## Overview

Twinned with `ui-kit-desktop`: same component names, same props, the same tokens. **Not a plugin**; consumed by the `plugin-*-ui-mobile` view packages and `apps/mobile`.

**Core design — `react-native` is injected, not imported**: the moment RN is imported it pulls in native modules, and this package could only be type-checked/unit-tested on a device — "a check that runs on one end only is roughly no check". So the kit defines the `NativePrimitives` interface; the shell (`apps/mobile`) calls `configureNative()` once at boot to inject the real modules; tests inject fake primitives. The only runtime dependency is `react`; `react-native` sits in devDependencies (types only). The safe area **does not live here** — by repo rule it belongs to the host shell's platform chrome.

## Source files

### `src/index.tsx` — 11 parity components + primitive injection

Components and props map one-to-one onto the desktop half (contracts in `ui-core/props.ts` and `ui-parity/contract.ts`); `testID`/`accessibilityLabel` map directly to the RN spellings. Mobile notes per component:

| Component | Mobile implementation notes |
|---|---|
| `Button` | `Pressable` + `accessibilityRole="button"` + `accessibilityState={disabled, busy}`; loading renders an `ActivityIndicator` (same color as the label) instead of text; disabled sets `onPress` to undefined (never fires). |
| `IconButton` | `Pressable`; at size=8 `width` is still 44 (pinned by the tap-target test). |
| `TextField` | `TextInput`; `autoCorrect: false` + `autoCapitalize: 'none'` default off (rules/URLs are case- and spelling-sensitive, and silent rewriting makes a source fail with no explanation); `secureTextEntry`; multiline min height grows by `fontSize×1.5×rows`, single line ≥44 tappable; error rendered as content. |
| `Text` | RN `Text`, native `numberOfLines` truncation; **`allowFontScaling: true`** — the OS text-size setting is respected, so 200% scaling becomes a layout question rather than a clipping question; `lineHeight = size × 1.45`. |
| `Artwork` | `Image resizeMode="cover"`; `dominantColor` first as background; no uri, no `Image`. |
| `TrackRow` | `Pressable`; `onMore` binds **long-press** (`onLongPress` — desktop is right-click); when active the title tone switches to `'accent'`. |
| `Slider` | **The only stateful component in the kit** (and the only one with its own test file). Dragging uses RN's built-in **responder system**, deliberately not `react-native-gesture-handler` (a native module, contrary to the whole point of `configureNative`): track width comes from `onLayout` (`measure()` is async); `onResponderGrant/Move` → dragging + `onChange`, `onResponderRelease` → commit; `at()` clamps `locationX/width` to [0,1] before multiplying by max; **`onResponderTerminationRequest: () => false` + on terminate the thumb returns to `props.value`** — a phone call or a parent scroll stealing the drag must not strand it under the finger; accessibility `accessibilityRole="adjustable"` + `accessibilityValue`, increment/decrement **steps by 5% of the range** with onChange+onCommit ("announces itself adjustable yet seeks in place" is a broken control); disabled refuses both the responder and the accessibility action. |
| `Sheet` | RN `Modal` (transparent + slide); **`onRequestClose={onClose}` — the Android back button must be able to close it, otherwise the sheet is a trap**; backdrop `Pressable` closes, content area intercepts with an empty onPress; bottom-docked, top rounded corners. |
| `List<T>` | Wraps **FlashList** (injected): recycles row views instead of mounting each, so even a low-end Android scrolls; `onEndReachedThreshold: 0.5`; `empty` → `ListEmptyComponent`; **deliberately does not forward `estimatedItemSize`** — FlashList v2 measures row heights itself and removed the prop, so passing it would be pretending to give a hint (the prop stays in the shared contract because the desktop virtualizer genuinely needs it: a prop ignored by one end is cheaper than two contracts). `data`/`keyExtractor` passed through as-is (stable keys, otherwise every scroll remounts rows). |
| `EmptyState` / `Toast` | Nearly verbatim the desktop halves; Toast announces via `accessibilityLiveRegion="polite"` + `accessibilityRole="alert"`. |

**Kit-level exports**:

- `NativePrimitives` — a deliberately minimal set: `View, Text, Pressable, Image, Modal, FlashList, ActivityIndicator, TextInput`. Each addition is a "shell must provide it + tests must fake it" decision.
- `configureNative(primitives)` — called once at shell boot.
- `nativePrimitives()` — the current primitives; returns `PLACEHOLDER` when not configured — rendering host elements of the same names rather than throwing: **a shell that forgot to configure gets an obviously wrong screen, not an unreadable crash mid-render**.
- `setScheme(next)` — same semantics as desktop.

### `src/manifest.ts` — the parity declaration

`KIT_TARGET = 'mobile'` + `COMPONENT_PROPS` + `COMPONENT_EXPORTS`, **verbatim isomorphic** with the desktop manifest. The reason it must be data is harder than on desktop: this package **cannot be imported off-device at all**, and if the parity gate needed the real modules it could only ever run against one end — roughly no gate. As a manifest, `ui-parity` can check it in CI with no React, DOM, or RN.

## Tests

- **`index.test.tsx`** (no DOM): fake primitives (string hosts like `'RNView'`) injected via `configureNative`, components called one level as functions, results recursively flattened and props asserted. Covers: injection and PLACEHOLDER, Button busy/disabled, IconButton 44px, TrackRow long-press, Sheet's `onRequestClose`, List going through FlashList without forwarding `estimatedItemSize`, TextField controlled + autoCorrect off, Toast liveRegion, and more.
- **`slider.test.tsx`** (jsdom + RTL behavior assertions): the renderer is React DOM — possible precisely because the primitives are injected: the fakes are ordinary components rendering `div`s with RN props attached, and the tests fire `onResponderMove` manually the way the platform would. Behaviors asserted: no division by a zero duration (`max: 0` is a normal state); release position is the commit (M1 mobile exit criterion 2 — "otherwise the scrubber is just a picture of a scrubber"); while dragging `onChange` reports every frame while `onCommit` fires **exactly once**; the thumb follows the finger instead of springing back to the old value; clamped to the range; returns home when the OS steals the drag; screen-reader stepping ±5%; disabled ignores everything. What tests cannot cover is "does the responder system grant the touch to this component" — that is platform territory, left to the device smoke matrix.

## Related docs

- `docs/08-ui-architecture.md` §6/§8
- `packages/ui/ui-kit-desktop/README.md`: the twin half and desktop-only behavior
- `apps/mobile/`: the caller of `configureNative`
