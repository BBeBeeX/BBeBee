# @BBeBee/ui-tokens

Layer 5 (ui) — the design system as plain data.

## Overview

**Values, not components**, and no framework imported anywhere — the only way two view layers that share no component code can still end up looking like one product (docs/08 §6). `ui-kit-mobile` consumes them as `StyleSheet` values; `ui-kit-desktop` emits them as CSS custom properties.

Palettes are **defined per scheme**, not as one color set plus a dark override: a dark theme is not the light theme's luminance flipped — the contrast relationships differ, and expressing dark as a patch is exactly how a palette becomes unreadable in one of the two modes without anyone noticing.

## Source files

### `src/color.ts` — the palette's color math

Contrast is computed here, not judged by eye: "it looks fine on my monitor" is how a palette ends up unreadable in sunlight or for a meaningful share of users. docs/08 §8 makes WCAG AA a CI gate, and a gate needs functions. Pure data in, pure numbers out.

| Export | Purpose |
|---|---|
| `parseHex(hex)` | Parses `#rgb`/`#rrggbb`/`#rrggbbaa` (alpha is parsed but ignored for contrast); throws on invalid input |
| `luminance(color)` | WCAG 2.1 relative luminance. The sRGB→linear step is the part that is easy to skip and wrong to skip: naively averaging the channels would report "gray text on white" as passing |
| `contrastRatio(a, b)` | WCAG contrast ratio, 1 (identical) to 21 (black on white) |
| `AA_TEXT = 4.5` / `AA_LARGE = 3` | WCAG AA thresholds: body text 4.5, large text and UI boundaries 3 |
| `meetsAA(a, b, large?)` | Rounds the ratio to two decimals before comparing — 4.4996 displays as 4.5 in every tool a designer uses; anything else invites arguments instead of fixes |

### `src/index.ts` — tokens, palettes, and the check

**`Palette`** (five groups): `bg` (base/raised/overlay), `text` (primary/secondary/disabled), `accent` (base/hover/muted/on), `state` (error/warn/ok), `border` (subtle separates surfaces, decorative; strong outlines controls or draws focus rings, constrained by WCAG 1.4.11's 3:1 and included in the check).

**`palettes: Record<Scheme, Palette>`** — `dark` first (a music player's default mode of use), `light` second. Every foreground color clears WCAG AA; `paletteContrastIssues()` is the proof, and the parity test is the mechanism that runs it on every change.

**`tokens`** — everything that is not a color, all **scales rather than free values** ("a spacing off the scale is a decision made twice, and the second time it will not match"):

| Scale | Values |
|---|---|
| `space[0..8]` | 0, 4, 8, 12, 16, 24, 32, 48, 64 |
| `radius` | sm 4 / md 8 / lg 16 / pill 999 |
| `font.family` | `ui` (Inter/system stack), `mono` (JetBrains Mono stack) |
| `font.size` | xs 11 / sm 13 / md 15 / lg 20 / xl 28 / display 40 (relativized on mobile, respecting the OS text-size setting, docs/08 §8) |
| `font.weight` / `lineHeight` | 400/500/700; tight 1.2 / normal 1.45 / loose 1.7 |
| `duration` | fast 120 / normal 200 / slow 320 |
| `size` | touchTarget 44 (the minimum reliable touch target both OSes endorse) / icon 20 / iconLarge 28 / row 56 / artworkThumb 48 |
| `z` | base 0 / sticky 10 / overlay 100 / toast 1000 |

**`paletteContrastIssues(): ContrastIssue[]`** — every foreground/background pair the design actually uses, with its minimum requirement, **enumerated rather than derived**: only the design knows that `text.secondary` sits on `bg.raised` and never on `accent.base`, and a combinatorial check would false-positive on pairings nobody puts together. Returns the list of failures rather than a boolean so the CI message can name the pair and the actual ratio — "contrast failed" only sends someone to diff by hand. `border.strong` is held to 3:1 as a UI boundary rather than 4.5.

**`cssVariables(scheme)`** — expands the palette and tokens into `--bb-*` CSS custom properties for the desktop kit/shell to theme with.

## Exports

```ts
export type Scheme = 'light' | 'dark'
export interface Palette / ContrastIssue / Rgb
export const palettes, tokens            // Tokens = typeof tokens
export function paletteContrastIssues, cssVariables
export function parseHex, luminance, contrastRatio, meetsAA
export const AA_TEXT, AA_LARGE
```

## Tests

`src/index.test.ts`: runs `paletteContrastIssues()` over both schemes and asserts it is empty (the AA gate itself), plus edge behavior of the color math.

## Related docs

- `docs/08-ui-architecture.md` §6/§8: tokens, the WCAG AA gate
- `packages/ui/ui-parity/README.md`: the gate that consumes this package for contrast checks
