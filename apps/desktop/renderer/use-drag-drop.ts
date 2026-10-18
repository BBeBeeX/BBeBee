/**
 * Drag-and-drop import hook.
 *
 * Handles two drop channels:
 * 1. **Tauri** (`tauri://drag-drop` window event): the supported path.
 *    Payload carries real OS paths; the webview `File` objects never do.
 * 2. **HTML5** (`dataTransfer.files`): fallback for non-Tauri hosts and tests.
 *
 * The overlay (dragenter/dragleave) works on both: Tauri emits
 * `tauri://drag-enter`/`tauri://drag-leave`, HTML5 uses the DOM events.
 * A depth counter prevents flicker when crossing child elements.
 *
 * Import results are deduplicated (1s window): both channels can fire for
 * the same gesture on some platforms.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { Context } from 'cordis'
import {
  importDroppedFiles,
  importDroppedPaths,
  type DropImportResult,
} from './drop-import.js'

export interface UseDragDropOptions {
  ctx: Context
  /** Called with the import result (deduplicated). */
  onImportResult: (result: DropImportResult) => void
  /** Called when the import itself throws. */
  onImportError: () => void
}

export interface UseDragDrop {
  /** Whether the drop overlay is visible. */
  dropActive: boolean
  /** HTML5 dragenter handler (attach to root). */
  handleDragEnter: (e: React.DragEvent) => void
  /** HTML5 dragover handler. */
  handleDragOver: (e: React.DragEvent) => void
  /** HTML5 dragleave handler. */
  handleDragLeave: (e: React.DragEvent) => void
  /** HTML5 drop handler. */
  handleDrop: (e: React.DragEvent) => void
}

const DEDUPE_WINDOW_MS = 1000

/** True if the drag event carries files (guarded for Tauri WebView2). */
function hasDroppedFiles(e: React.DragEvent): boolean {
  const types = e.dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes('Files')
}

export function useDragDrop({ ctx, onImportResult, onImportError }: UseDragDropOptions): UseDragDrop {
  const dragDepth = useRef(0)
  const lastImportAt = useRef(0)
  const dropActiveState = useRef(false)
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0)

  const setDropActive = useCallback((active: boolean) => {
    if (dropActiveState.current !== active) {
      dropActiveState.current = active
      forceUpdate()
    }
  }, [])

  // Deduplicated result handler
  const handleResult = useCallback(
    (result: DropImportResult) => {
      const now = Date.now()
      if (now - lastImportAt.current < DEDUPE_WINDOW_MS) return
      lastImportAt.current = now
      onImportResult(result)
    },
    [onImportResult],
  )

  const runImportPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return
      dragDepth.current = 0
      setDropActive(false)
      void importDroppedPaths(ctx, paths).then(handleResult).catch(onImportError)
    },
    [ctx, handleResult, onImportError, setDropActive],
  )

  // --- HTML5 handlers ---

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      // Under Tauri, show the overlay for any dragenter: WebView2 may not
      // report `Files` in dataTransfer.types, and the real paths arrive via
      // the tauri://drag-drop event anyway.
      if (!window.BBeBee && !hasDroppedFiles(e)) return
      e.preventDefault()
      dragDepth.current += 1
      setDropActive(true)
    },
    [setDropActive],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!window.BBeBee && !hasDroppedFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [],
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!window.BBeBee && !hasDroppedFiles(e)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDropActive(false)
    },
    [setDropActive],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDropActive(false)
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      // Under Tauri the OS drop comes via tauri://drag-drop; the webview
      // File objects carry no path. Skip silently and let the Tauri
      // listener import — reporting "failed" here would be a lie.
      if (window.BBeBee) {
        const hasPaths = Array.from(files).some((f) =>
          window.BBeBee?.files?.getPath(f),
        )
        if (!hasPaths) return
      }
      void importDroppedFiles(ctx, files).then(handleResult).catch(onImportError)
    },
    [ctx, handleResult, onImportError, setDropActive],
  )

  // --- Tauri event subscription ---

  useEffect(() => {
    const unlistens: Array<() => void> = []
    let disposed = false

    const subscribe = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        if (disposed) return
        const win = getCurrentWindow()

        unlistens.push(
          await win.listen('tauri://drag-enter', () => {
            if (disposed) return
            dragDepth.current += 1
            setDropActive(true)
          }),
        )
        unlistens.push(
          await win.listen('tauri://drag-leave', () => {
            if (disposed) return
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (dragDepth.current === 0) setDropActive(false)
          }),
        )
        unlistens.push(
          await win.listen<{ paths?: string[] }>('tauri://drag-drop', (event) => {
            runImportPaths(event.payload?.paths ?? [])
          }),
        )
      } catch {
        // Not in Tauri (browser, tests): HTML5 DnD remains.
      }
    }

    void subscribe()
    return () => {
      disposed = true
      for (const unlisten of unlistens) unlisten()
    }
  }, [runImportPaths, setDropActive])

  // Prevent the browser from navigating on file drop
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  return {
    dropActive: dropActiveState.current,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
