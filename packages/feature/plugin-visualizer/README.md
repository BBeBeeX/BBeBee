# @bbebee/plugin-visualizer

Headless audio visualization service for BBeBee (`ctx.visualizer`).

## What it does

- Unified `AudioAnalyser` abstraction supporting both Web Audio `AnalyserNode` and native libmpv PCM tap (`NativeMpvImpl`).
- Real-time FFT frequency spectrum and time-domain waveform data extraction.
- **Consumer-driven lazy polling (`attachConsumer`)**: Only polls the 16ms (~60 FPS) IPC spectrum bridge when UI visualizer canvases are mounted and active, preventing memory leaks and IPC buffer pileups.
- **Player state & visibility dormancy**: Pauses polling automatically on `player/state-changed` (`status !== 'playing'`) and when document is hidden (`visibilitychange`), with `inFlight` backpressure guard against queue saturation.
- Integrates with `ctx.settings` to persist visualizer preferences (style, color theme, sensitivity, enabled).
- Exposes `useVisualizer` and `useAudioData` hooks for UI packages (`@bbebee/plugin-visualizer/hooks`).
