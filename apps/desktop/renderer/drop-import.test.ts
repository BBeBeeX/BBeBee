// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Context, Service } from 'cordis'
import type { ScannerService, ScanSpecifiedDir, ScanSummary } from '@BBeBee/protocol'
import {
  pathToFileUri,
  serviceOf,
  resolveService,
  importDroppedFiles,
} from './drop-import.js'

try {
  Object.defineProperty(Context.prototype, '$$typeof', {
    value: undefined,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(Context.prototype, 'asymmetricMatch', {
    value: undefined,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(Context.prototype, 'nodeType', {
    value: undefined,
    configurable: true,
    writable: true,
  })
} catch {
  // Ignore in environments where prototype is immutable
}

describe('drop-import', () => {
  describe('pathToFileUri', () => {
    it('converts unix absolute paths correctly', () => {
      expect(pathToFileUri('/music/track 01.mp3')).toBe('file:///music/track%2001.mp3')
    })

    it('converts windows paths with drive letters without encoding the drive', () => {
      expect(pathToFileUri('C:\\Music\\Album\\track.flac')).toBe('file:///C:/Music/Album/track.flac')
      expect(pathToFileUri('d:/songs/artist - title.wav')).toBe('file:///D:/songs/artist%20-%20title.wav')
    })
  })

  describe('serviceOf & resolveService on scoped context', () => {
    it('accesses service from a scoped context without throwing "without inject" error', async () => {
      const root = new Context()

      class DummyUi extends Service {
        constructor(ctx: Context) {
          super(ctx, 'ui')
        }
      }
      class DummyScanner extends Service {
        constructor(ctx: Context) {
          super(ctx, 'scanner')
        }
      }

      await root.plugin(DummyUi)
      await root.plugin(DummyScanner)

      const scoped = await new Promise<Context>((resolve) => {
        root.inject(['ui'], (s) => resolve(s))
      })

      // Accessing scoped.scanner directly would throw
      expect(() => (scoped as unknown as Record<string, unknown>)['scanner']).toThrow(
        /cannot get property "scanner" without inject/,
      )

      // serviceOf safely accesses it
      const scanner = serviceOf<ScannerService>(scoped, 'scanner')
      expect(scanner).toBeDefined()
      expect((scanner as unknown as { name: string }).name).toBe('scanner')

      // resolveService also succeeds
      const resolved = await resolveService<ScannerService>(scoped, 'scanner', 100)
      expect(resolved).toBeDefined()
      expect((resolved as unknown as { name: string }).name).toBe('scanner')
    })

    it('resolveService waits for a deferred service', async () => {
      const root = new Context()

      class DummyUi extends Service {
        constructor(ctx: Context) {
          super(ctx, 'ui')
        }
      }
      await root.plugin(DummyUi)

      const scoped = await new Promise<Context>((resolve) => {
        root.inject(['ui'], (s) => resolve(s))
      })

      expect(serviceOf(scoped, 'scanner')).toBeUndefined()

      const scannerPromise = resolveService<ScannerService>(scoped, 'scanner', 1000)

      setTimeout(() => {
        class DummyScanner extends Service {
          constructor(ctx: Context) {
            super(ctx, 'scanner')
          }
        }
        void root.plugin(DummyScanner)
      }, 50)

      const resolved = await scannerPromise
      expect(resolved).toBeDefined()
      expect((resolved as unknown as { name: string }).name).toBe('scanner')
    })
  })

  describe('importDroppedFiles', () => {
    const originalBBeBee = window.BBeBee

    beforeEach(() => {
      window.BBeBee = {
        files: {
          getPath: (file: File) => (file as unknown as { mockPath?: string }).mockPath ?? file.name,
        },
      } as unknown as typeof window.BBeBee
    })

    afterEach(() => {
      window.BBeBee = originalBBeBee
    })

    function createMockFile(name: string, mockPath: string): File {
      const file = new File([''], name)
      Object.defineProperty(file, 'mockPath', { value: mockPath })
      return file
    }

    function toFileList(files: File[]): FileList {
      return Object.assign([...files], {
        item: (index: number) => files[index] ?? null,
      }) as unknown as FileList
    }

    it('imports audio files on a scoped context without throwing', async () => {
      const root = new Context()

      const mockImportFiles = vi.fn().mockResolvedValue({
        added: 2,
        updated: 0,
        removed: 0,
        errors: 0,
      } as ScanSummary)

      class MockScanner extends Service {
        constructor(ctx: Context) {
          super(ctx, 'scanner')
        }
        importFiles = mockImportFiles
      }

      class MockFs extends Service {
        constructor(ctx: Context) {
          super(ctx, 'fs')
        }
        stat = vi.fn().mockResolvedValue({ isDirectory: false })
      }

      class MockUi extends Service {
        constructor(ctx: Context) {
          super(ctx, 'ui')
        }
      }

      await root.plugin(MockFs)
      await root.plugin(MockScanner)
      await root.plugin(MockUi)

      // Emulate shell context from app.ready(['ui'])
      const scopedShellCtx = await new Promise<Context>((resolve) => {
        root.inject(['ui'], (s) => resolve(s))
      })

      const fileList = toFileList([
        createMockFile('song1.mp3', '/home/user/Music/song1.mp3'),
        createMockFile('song2.flac', '/home/user/Music/song2.flac'),
      ])

      const result = await importDroppedFiles(scopedShellCtx, fileList)

      expect(mockImportFiles).toHaveBeenCalledWith([
        'file:///home/user/Music/song1.mp3',
        'file:///home/user/Music/song2.flac',
      ])
      expect(result).toEqual({
        imported: 2,
        folders: 0,
        failed: 0,
      })
    })

    it('imports folders by adding specified dir and initiating scan', async () => {
      const root = new Context()

      const mockAddDir = vi.fn().mockResolvedValue({ id: 'dir-1', uri: 'file:///home/user/Music' } as ScanSpecifiedDir)
      const mockScan = vi.fn().mockResolvedValue({ added: 10, updated: 0, removed: 0, errors: 0 } as ScanSummary)

      class MockScanner extends Service {
        constructor(ctx: Context) {
          super(ctx, 'scanner')
        }
        addSpecifiedDir = mockAddDir
        scan = mockScan
      }

      class MockFs extends Service {
        constructor(ctx: Context) {
          super(ctx, 'fs')
        }
        stat = vi.fn().mockImplementation((uri: string) => {
          if (uri.includes('Folder')) {
            return Promise.resolve({ isDirectory: true })
          }
          return Promise.resolve({ isDirectory: false })
        })
      }

      class MockUi extends Service {
        constructor(ctx: Context) {
          super(ctx, 'ui')
        }
      }

      await root.plugin(MockFs)
      await root.plugin(MockScanner)
      await root.plugin(MockUi)

      const scopedShellCtx = await new Promise<Context>((resolve) => {
        root.inject(['ui'], (s) => resolve(s))
      })

      const fileList = toFileList([
        createMockFile('MyFolder', '/home/user/Music/MyFolder'),
      ])

      const result = await importDroppedFiles(scopedShellCtx, fileList)

      expect(mockAddDir).toHaveBeenCalledWith('file:///home/user/Music/MyFolder')
      expect(mockScan).toHaveBeenCalled()
      expect(result).toEqual({
        imported: 0,
        folders: 1,
        failed: 0,
      })
    })

    it('rejects non-audio files as failed', async () => {
      const root = new Context()

      class MockScanner extends Service {
        constructor(ctx: Context) {
          super(ctx, 'scanner')
        }
        importFiles = vi.fn()
      }
      class MockFs extends Service {
        constructor(ctx: Context) {
          super(ctx, 'fs')
        }
        stat = vi.fn().mockResolvedValue({ isDirectory: false })
      }
      class MockUi extends Service {
        constructor(ctx: Context) {
          super(ctx, 'ui')
        }
      }

      await root.plugin(MockFs)
      await root.plugin(MockScanner)
      await root.plugin(MockUi)

      const scopedShellCtx = await new Promise<Context>((resolve) => {
        root.inject(['ui'], (s) => resolve(s))
      })

      const fileList = toFileList([
        createMockFile('doc.pdf', '/home/user/doc.pdf'),
        createMockFile('image.png', '/home/user/image.png'),
      ])

      const result = await importDroppedFiles(scopedShellCtx, fileList)

      expect(result).toEqual({
        imported: 0,
        folders: 0,
        failed: 2,
      })
    })
  })
})
