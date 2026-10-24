# @bbebee/plugin-visualizer

Headless audio visualization service for BBeBee (`ctx.visualizer`).

## What it does

- Attaches a Web Audio `AnalyserNode` to `ctx.audio.chainOutput` (or `chainInput`).
- Manages real-time FFT frequency data and time-domain waveform data extraction.
- Integrates with `ctx.settings` to persist visualizer preferences (style, color theme, sensitivity, enabled).
- Exposes `useVisualizer` and `useAudioData` hooks for UI packages.
