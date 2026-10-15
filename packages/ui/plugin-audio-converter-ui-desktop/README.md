# @BBeBee/plugin-audio-converter-ui-desktop

Layer 5 (UI) — Desktop view package for the Audio Converter and Compression Workbench.

## Overview

`plugin-audio-converter-ui-desktop` delivers the full-featured desktop user interface for `@BBeBee/plugin-audio-converter`. It renders the workbench interface in the Electron shell, providing file management, format selection, intelligent compression tuning, batch queue inspection, and output inspection.

## View Contributions & Entry Points

- **Route ID**: `audio-converter.view` (`AUDIO_CONVERTER_VIEWS.page`).
- **Path**: `/audio-converter`.
- **Title**: `converter:index.title` (localized as "音频格式转换" in Chinese / "Audio Converter" in English).
- **Placement**: `['tray']`. Appears in the top-bar plugin tray popover menu as a quick-access tool.

## Component Decomposition

The package is modularized into single-responsibility components:

- **`ConverterWorkbench` (`src/components/ConverterWorkbench.tsx`)**: The top-level workbench container with tabs:
  - **Convert**: file staging, format selection, compression presets, and execution.
  - **Queue**: active task queue, progress bars, cancellation, and retry.
  - **Output**: converted file list with size comparisons, saved disk space calculations, and file reveal actions.
- **`AudioFileList` (`src/components/AudioFileList.tsx`)**:
  - File list displaying file name, format tag, size, and duration.
  - Drag-and-drop dropzone with strict event boundary isolation (`stopPropagation`) to prevent bubbling to the main application's music library drop handler.
  - Native file selection via `window.BBeBee.dialog.pickFiles` (falling back to HTML5 `<input type="file">`), preserving absolute file paths and adding them to the bridge extraRoots.
- **`FormatSection` (`src/components/FormatSection.tsx`)**:
  - Target format selection across 12 formats (MP3, WAV, FLAC, AAC, M4A, OGG, Opus, ALAC, AIFF, WMA, WebM, PCM).
  - Real-time encoder capability badge showing whether the required encoder is available on the system.
  - Lossless vs. lossy visual indicator tag.
- **`CompressionSection` (`src/components/CompressionSection.tsx`)**:
  - 5 compression presets: High Quality (320k/24-bit), Balanced (192k/16-bit), Small Size (128k), Speech/Podcast (64k mono), and Custom.
  - Dynamic parameter controls: bitrate (64–320 kbps), sample rate (22.05–48 kHz), channel mode (Mono/Stereo), bit depth (16/24/32-bit), VBR, volume gain (-12 to +12 dB), fade in/out, and start/end time cropping.
  - Real-time pre-conversion size estimation card comparing original file size against estimated output size and compression ratio.
- **`TaskQueueSection` (`src/components/TaskQueueSection.tsx`)**:
  - Live progress display with stage indication (analyzing, encoding, verifying, completed).
  - Cancel and retry controls.
- **`OutputSection` (`src/components/OutputSection.tsx`)**:
  - Displays converted audio items, space saved, output directory, and a "Show in Folder" button using `window.BBeBee.shell.openExternal`.
- **`SettingsModal` (`src/components/SettingsModal.tsx`)**:
  - Configures default format, default preset, default output directory (with native folder picker), concurrency limit (1–8 workers), task timeout, and automatic temp-file cleanup.

## Drag & Drop Event Isolation

To prevent conflicts with the global music library importer in `Shell.tsx`:
1. Both `AudioFileList`'s dropzone and `ConverterWorkbench`'s root container register `onDragEnter`, `onDragOver`, `onDragLeave`, and `onDrop` handlers.
2. Every handler calls `e.preventDefault()` and `e.stopPropagation()`.
3. Dropping files anywhere inside the workbench immediately stages them in the converter queue without navigating away to `library.local`.

## Internationalization & Design Tokens

- **Localization**: Uses `useI18n(ctx)` from `@BBeBee/ui-kit-desktop` with full Chinese (`zh`) and English (`en`) parity in `packages/feature/plugin-i18n/src/locales/converter.json`.
- **Design System**: Built with design tokens from `@BBeBee/ui-tokens` (`tokens.space`, `tokens.radius`, `tokens.color`) and standardized components from `@BBeBee/ui-kit-desktop` (`Button`, `Select`, `Text`, `Sheet`, `Switch`).
