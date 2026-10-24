# @bbebee/plugin-audio-converter

Layer 4 (feature) — `ctx.audioConverter`: the headless audio format transcoding, audio compression, batch queue concurrency, pre-conversion size estimation, and task management service.

## Overview

`plugin-audio-converter` provides unified, robust audio format conversion and compression across desktop and mobile. Built on the Cordis kernel, it coordinates format transcoding, parameter tuning (bitrate, sample rate, channels, bit depth, VBR/CBR, volume gain, fade, and cropping), and concurrent batch processing while strictly adhering to system security boundaries.

Other feature plugins (e.g. `plugin-download`) or headless scripts can invoke `ctx.audioConverter.convertDirect()` to perform zero-UI programmatic conversion, or use `enqueue()` to schedule background tasks managed by the task queue.

## Architecture and Service Declaration

- **Service Key**: `ctx.audioConverter` (implements `AudioConverterService`).
- **Required Injections**: `static inject = ['codec', 'fs', 'paths']`, `export const inject = ['codec', 'fs', 'paths']`.
  - `ctx.codec`: underlying codec service providing format probing and FFmpeg-backed transcoding.
  - `ctx.fs`: sandboxed virtual file system for checking sizes, headers, and atomic file renaming.
  - `ctx.paths`: well-known system directories (`music`, `downloads`, `temp`) for output fallbacks and secure temp storage.
- **Optional Injections**: `['ui']` (contributes the `/audio-converter` route with `placement: ['tray']`).
- **Contributed Capabilities**: `audioConverter`.
- **System Layer**: Layer 4 (`dsp` module).

## Public API

### 1. Direct Conversion

Programmatic synchronous conversion without enqueuing:

```ts
const result = await ctx.audioConverter.convertDirect({
  inputUri: '/path/to/source.wav',
  outputUri: '/path/to/target.flac',
  targetFormat: 'flac',
  options: {
    bitDepth: 24,
    sampleRate: 48000,
  },
  onProgress: (pct, stage) => {
    ctx.logger.debug(`Conversion progress: ${pct}% [${stage}]`)
  },
})

if (result.ok) {
  ctx.logger.info(`Conversion succeeded: ${result.outputSize} bytes`)
} else {
  ctx.logger.error(`Conversion failed: ${result.error}`)
}
```

### 2. Task Queue & Batch Processing

Submits one or more files to the concurrent task queue:

```ts
const tasks = await ctx.audioConverter.enqueue([
  {
    uri: '/path/to/song1.wav',
    options: { targetFormat: 'mp3', bitrateKbps: 320 },
  },
  {
    uri: '/path/to/song2.aiff',
    options: { targetFormat: 'flac', preset: 'high_quality' },
  },
])
```

Queue management methods:
- `ctx.audioConverter.cancelTask(taskId)`: cancels an active or queued task, terminating the underlying FFmpeg process and deleting partial temp files.
- `ctx.audioConverter.retryTask(taskId)`: resets a failed or cancelled task back to pending.
- `ctx.audioConverter.removeTask(taskId)`: removes a task from memory.
- `ctx.audioConverter.clearFinished()`: purges all completed, failed, and cancelled tasks.
- `ctx.audioConverter.getTasks()`: returns snapshot of current task queue.

### 3. Dynamic Encoder Capability Discovery

```ts
const caps = await ctx.audioConverter.getCapabilities()
// caps.supportedInputFormats: ['mp3', 'wav', 'flac', ...]
// caps.supportedOutputFormats: ['mp3', 'wav', 'flac', ...]
// caps.encoders: Record<string, { name: string; description: string; available: boolean }>
```

Detects actual installed FFmpeg encoders dynamically so decode-only formats are never misidentified as writable.

### 4. Compression Heuristics & Size Estimation

```ts
const estimate = ctx.audioConverter.estimateCompression({
  durationMs: 180_000,
  sourceSize: 30_000_000,
  targetFormat: 'mp3',
  bitrateKbps: 192,
})

console.log(estimate.estimatedSize)      // e.g. ~4.4 MB
console.log(estimate.compressionRatio)   // e.g. ~0.15 (85% reduction)
console.log(estimate.isLossless)         // false
console.log(estimate.warning)            // Warns if source was lossy and target is lossless
```

### 5. Reactive UI Hooks (`@bbebee/plugin-audio-converter/hooks`)

- `useAudioConverterTasks(ctx)`: returns reactive tasks array.
- `useAudioConverterConfig(ctx)`: returns reactive config and updater `[config, updateConfig]`.
- `useEncoderCapabilities(ctx)`: returns probed encoder capabilities.

## Security & Path Isolation Invariants

1. **Path Traversal Rejection**: All input and output paths are sanitized through `validateAndNormalizePath()`. Paths containing control characters, null bytes, or `..` path traversal segments are rejected immediately.
2. **Atomic Destination Protection**: Direct overwrites of source files are forbidden unless `overwrite: true` is explicitly passed. Output is written first to a hidden randomized temporary file (`.tmp_*.ext`) in the target directory (or `ctx.paths.temp`), validated for non-zero size, and then moved atomically via `ctx.fs.move()`.
3. **Bridge Containment Authorization**: For files picked outside application directories via native file pickers or drag-and-drop, the desktop host whitelists the file paths and their parent folders into `bridge.host.addExtraRoot` (via `files:authorize` and `audio:transcode`), preventing `outside every application directory` bridge containment failures.
4. **Non-Existent Temp Cleanup Safety**: Temporary transcoding files are guarded with existence checks before deletion, avoiding bridge `ENOENT` stat exceptions on aborted or failed operations.
5. **Shell Injection Prevention**: FFmpeg is executed strictly via array arguments in Layer 2 (`core-codec-node`) and desktop main, never concatenated in raw shell command strings.
6. **Dedicated Tray Route Icon**: Contributes a distinctive `transform` (icon with transform cycle arrows) route icon to avoid visual duplicate with DSP or equalizer settings.

## Event Canon

| Event | Payload | Description |
|---|---|---|
| `audio-converter/tasks-changed` | `tasks: readonly ConvertTask[]` | Emitted when any task is added, removed, or changes state |
| `audio-converter/task-progress` | `taskId: string, progress: number, stage: TaskStage` | Emitted during task progress update (0–100%) |
| `audio-converter/task-completed` | `task: ConvertTask` | Emitted when a conversion task successfully finishes |
| `audio-converter/task-failed` | `taskId: string, error: string` | Emitted when a conversion task fails |
| `audio-converter/task-cancelled` | `taskId: string` | Emitted when a conversion task is aborted |
