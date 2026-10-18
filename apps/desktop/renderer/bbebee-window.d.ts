declare global {
  interface Window {
    BBeBee?: {
      paths: { get(kind: string): Promise<string | undefined> }
      getAppVersion: () => Promise<string>
      shell: { openExternal(url: string): Promise<void> }
      dialog: {
        pickDirectory(): Promise<string | undefined>
        pickFiles?(options?: { extensions?: string[] }): Promise<string[]>
      }
      files?: {
        getPath(file: File): string
        authorizePath?(path: string): Promise<boolean>
        toServableUrl?(uri: string): string
      }
      devtools?: { open(): Promise<void> }
      platform: string
      versions: { tauri?: string; node?: string; [key: string]: string | undefined }
      isDebug?: boolean
      window?: {
        minimize(): Promise<void>
        maximize(): Promise<void>
        close(): Promise<void>
        isMaximized(): Promise<boolean>
        setCloseToTray?(enabled: boolean): Promise<void>
        toggle?(): Promise<void>
      }
      proxy?: {
        test(config: unknown): Promise<{ ok: boolean; latencyMs?: number; error?: string }>
        set(config: unknown): Promise<void>
      }
      sandbox?: {
        setHtml(id: string, html: string): Promise<void>
      }
      desktopLyrics?: {
        setVisible(visible: boolean, pos?: { x: number; y: number }): Promise<void>
        setPosition?(pos: { x: number; y: number }): Promise<void>
        getPosition?(): Promise<{ x: number; y: number } | undefined>
        commitPosition?(pos: { x: number; y: number }): Promise<void>
        onMoved?(callback: (pos: { x: number; y: number }) => void): () => void
        setLocked(locked: boolean): Promise<void>
        setIgnoreMouse?(ignore: boolean): Promise<void>
        onCursor?(callback: (pos: { x: number; y: number }) => void): () => void
        updateData(data: unknown): Promise<void>
        sendAction(action: unknown): Promise<void>
        onData(callback: (data: unknown) => void): () => void
        onAction(callback: (action: unknown) => void): () => void
      }
      taskbar?: {
        update(state: {
          isPlaying: boolean
          canPlayOrPause?: boolean
          canPrevious?: boolean
          canNext?: boolean
          title?: string
          artist?: string
        }): Promise<void>
        onAction(callback: (action: 'togglePlay' | 'previous' | 'next') => void): () => void
      }
      locale?: {
        getLocale(): Promise<string>
        notify(locale: string): Promise<void>
        onLocaleChange(callback: (locale: string) => void): () => void
      }
      miniPlayer?: {
        open(options?: { mode?: 'normal' | 'attached' | 'expanded' }): Promise<void>
        close(): Promise<void>
        restoreMain(): Promise<void>
        setMode(mode: 'normal' | 'attached' | 'expanded'): Promise<void>
        getState(): Promise<{ visible: boolean; mode: string; windowState: string }>
        getData(): Promise<unknown>
        updateData(data: unknown): Promise<void>
        sendAction(action: unknown): Promise<void>
        onData(callback: (data: unknown) => void): () => void
        onState(callback: (state: unknown) => void): () => void
        onAction(callback: (action: unknown) => void): () => void
      }
      plugins?: {
        listInstalled(): Promise<
          Array<{ id: string; version: string; manifest: unknown; dirName: string; sha256?: string }>
        >
        getLock?(): Promise<unknown>
        install(
          pluginId: string,
          files: Record<string, string>,
        ): Promise<{ ok: boolean; pluginId: string; path?: string }>
        uninstall(pluginId: string): Promise<{ ok: boolean; message?: string }>
      }
      audio?: {
        transcode(options: {
          inputUri: string
          outputUri: string
          targetFormat: string
          bitrate?: string
          sampleRate?: number
          channels?: number
          bitDepth?: number
          vbr?: boolean
          quality?: number
          vbrQuality?: number
          volumeGainDb?: number
          fadeInSeconds?: number
          fadeOutSeconds?: number
          startTimeSeconds?: number
          endTimeSeconds?: number
          signal?: AbortSignal
          onProgress?: (progress: number, currentTimeSeconds: number) => void
        }): Promise<{ ok: boolean; error?: string }>
        cancelTranscode?(jobId: string): Promise<boolean>
      }
    }
  }
}
