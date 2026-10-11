# @BBeBee/plugin-mini-player-ui-desktop

Layer 5 (UI) — the desktop presentation of the standalone floating mini-player window and the Dynamic Island, the secondary native-window adapter, and the gesture interaction system.

## Overview

`plugin-mini-player-ui-desktop` handles the visual rendering, animation transitions, and gesture interactions of the floating mini-player window and the top Dynamic Island in the desktop environment.

The plugin runs inside a standalone secondary transparent window (`?window=mini-player` or `#mini-player`), strictly follows the single-Cordis-kernel invariant (ADR-3), and works as a Passive View: it receives streamed data from the main renderer's `ctx.miniPlayer` and sends user actions back for execution.

## Registration & dependencies

- Registered views:
  - `ctx.ui.registerView('mini-player.window', bound(ctx, MiniPlayerWindow))`: the full-screen root container of the secondary window
  - `ctx.ui.registerView('mini-player.button', bound(ctx, MiniPlayerButton))`: the toggle entry on the right side of the main window's top bar
- Required injections: `['ui', 'miniPlayer']`

## Component breakdown & single responsibilities

```
src/
├── components/
│   ├── MiniPlayerWindow.tsx      ← top-level router and form-dispatch container (mounted in the secondary window)
│   ├── MiniPlayerFloating.tsx    ← floating mini-player form (380×96px)
│   ├── MiniPlayerIsland.tsx      ← top Dynamic Island (capsule 280×50px / expanded 420×184px)
│   ├── MiniPlayerControls.tsx    ← transport button group (play/pause/previous/next/progress bar)
│   ├── MiniPlayerButton.tsx      ← mini-player toggle button in the main window's top bar
│   ├── IslandArtwork.tsx         ← artwork component (protocol conversion, CORS policy, error fallback)
│   └── IslandWaveBars.tsx        ← the Dynamic Island's bouncing audio-wave bars
├── screens.test.tsx              ← automated unit tests (rendering, mode switching, button interactions)
└── index.tsx                     ← Cordis plugin lifecycle entry and exports
```

## Three forms and a natural gesture system

To provide an utterly clean, visually undisturbed native desktop experience, this plugin removes the fiddly collapse/dock/detach icon buttons and relies entirely on an intuitive gesture system:

### 1. Floating mini-player form (`normal`)
- **Size & layout**: a 380×96px classic rounded-capsule card.
- **Dragging & docking**: the background area supports window dragging (`-webkit-app-region: drag`). Dragging to the top edge of any display (≤40px) automatically triggers the docking animation and switches to the Dynamic Island form.
- **Actions**: the top-right corner offers "Restore main window" (`⤢`) and "Close mini player" (`✕`) buttons.

### 2. Dynamic Island capsule form (`attached`)
- **Size & layout**: a 280×50px superellipse capsule hugging the top center of the screen.
- **Information**: the current track name and artist, plus the live-bouncing volume bars on the right (`IslandWaveBars`).
- **Expand & collapse**:
  - **Single-click** the capsule: expands into the large-card form;
  - **Double-click** the capsule: quickly collapses.

### 3. Expanded Dynamic Island form (`expanded`)
- **Size & layout**: a 420×184px expanded card hugging the top of the screen.
- **Full functionality**: large album artwork, marquee track text, volume bar, timeline slider, and the full transport buttons.
- **Detach**: dragging the card down past a threshold (>60px) releases the top dock and smoothly returns to the floating mini-player form (remembering the original floating coordinates).
- **Collapse back to the capsule**: double-clicking the card's blank background folds it back into the minimal capsule.

## Artwork & image-rendering safety

- **Privileged protocol for local resources**: the Chromium renderer blocks cross-origin `file://` requests by default. `IslandArtwork` cooperates with the underlying bridge to convert local music file artwork to Electron's privileged `bbebee-file://` protocol;
- **Cross-origin safety attributes**: `crossOrigin="anonymous"` and `referrerPolicy="no-referrer"` are configured to prevent cross-origin image tainting;
- **Graceful degradation**: when artwork fails to load or none is specified, it seamlessly falls back to a polished default monochrome vector music icon, so the UI never shows a broken image.

## Visual & shadow standards

- **No large vignette halos**: blur radii over 30px or bright white spread rings (`0 0 0 1px white`) are strictly forbidden on the transparent window — no dirty, washed-out glow halos.
- **Dark frosted texture**: the background is high-contrast dark glass `rgba(18, 18, 18, 0.85)` with a system-level `backdrop-filter: blur(24px)` and a subtle `1px solid rgba(255, 255, 255, 0.08)` inner border.
- **Compact multi-layer black shadows**:
  - Floating mini-player: `0 6px 16px rgba(0, 0, 0, 0.45), 0 1px 4px rgba(0, 0, 0, 0.25)` (hover strengthens to `0 10px 24px rgba(0, 0, 0, 0.55)`);
  - Dynamic Island capsule: `0 4px 12px rgba(0, 0, 0, 0.45)`;
  - Expanded Dynamic Island: `0 12px 28px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4)`.
