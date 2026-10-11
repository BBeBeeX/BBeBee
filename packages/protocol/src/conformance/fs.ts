/**
 * Conformance suite for `ctx.fs`.
 *
 * The most divergent service in the system — `core-fs-node` and
 * `core-fs-expo` share no code — so this is where the abstraction is most
 * likely to rot. Every check names the behaviour a feature plugin relies on.
 */

import type { FsService, Uri } from '../index.js'
import { assert, assertEqual, assertRejects, type ConformanceSuite } from './harness.js'

/** The implementation plus a scratch directory the suite may write into. */
export interface FsSubject {
  fs: FsService
  /** An empty, writable directory. Cleaned up by the caller. */
  scratch: Uri
}

export const fsConformance: ConformanceSuite<FsSubject> = {
  service: 'fs',
  checks: [
    {
      name: 'writes and reads back utf8',
      because: 'the config loader and every log transport depend on it',
      async run({ fs, scratch }) {
        const uri = fs.join(scratch, 'hello.txt')
        await fs.writeFile(uri, 'héllo wörld')
        assertEqual(await fs.readFile(uri), 'héllo wörld', 'round-trip')
      },
    },
    {
      name: 'writes and reads back bytes unchanged',
      because: 'downloaded audio must survive the round trip bit-exact',
      async run({ fs, scratch }) {
        const uri = fs.join(scratch, 'bytes.bin')
        const data = new Uint8Array([0, 1, 127, 128, 255, 0, 42])
        await fs.writeFile(uri, data)
        const back = await fs.readBytes(uri)
        assertEqual(Array.from(back), Array.from(data), 'bytes')
      },
    },
    {
      name: 'exists() is false before and true after',
      because: 'binding verification deletes rows whose file is gone',
      async run({ fs, scratch }) {
        const uri = fs.join(scratch, 'later.txt')
        assert(!(await fs.exists(uri)), 'should not exist yet')
        await fs.writeFile(uri, 'x')
        assert(await fs.exists(uri), 'should exist now')
      },
    },
    {
      name: 'stat reports size and a plausible mtime',
      because: 'the scanner skips unchanged files on (size, mtime) alone',
      async run({ fs, scratch }) {
        const uri = fs.join(scratch, 'stat.txt')
        await fs.writeFile(uri, '12345')
        const stat = await fs.stat(uri)
        assertEqual(stat.size, 5, 'size')
        assert(!stat.isDirectory, 'should not be a directory')
        assert(stat.mtime > 0 && stat.mtime <= Date.now() + 5_000, 'mtime is epoch ms')
      },
    },
    {
      name: 'list returns direct children only',
      because: 'the scanner walks recursively itself and would double-count',
      async run({ fs, scratch }) {
        const dir = fs.join(scratch, 'listing')
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(fs.join(dir, 'a.txt'), 'a')
        await fs.mkdir(fs.join(dir, 'sub'), { recursive: true })
        await fs.writeFile(fs.join(dir, 'sub', 'b.txt'), 'b')

        const names = (await fs.list(dir)).map((s) => s.name).sort()
        assertEqual(names, ['a.txt', 'sub'], 'direct children')
      },
    },
    {
      name: 'mkdir is recursive and idempotent',
      because: 'plugin data directories are created on every start',
      async run({ fs, scratch }) {
        const deep = fs.join(scratch, 'a', 'b', 'c')
        await fs.mkdir(deep, { recursive: true })
        await fs.mkdir(deep, { recursive: true })
        assert(await fs.exists(deep), 'deep directory exists')
      },
    },
    {
      name: 'remove deletes a file, and a tree when recursive',
      because: 'uninstall must leave nothing behind',
      async run({ fs, scratch }) {
        const dir = fs.join(scratch, 'doomed')
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(fs.join(dir, 'f.txt'), 'x')
        await fs.remove(dir, { recursive: true })
        assert(!(await fs.exists(dir)), 'tree removed')
      },
    },
    {
      name: 'move relocates content',
      because: 'downloads land in temp and are moved into place atomically',
      async run({ fs, scratch }) {
        const from = fs.join(scratch, 'from.txt')
        const to = fs.join(scratch, 'to.txt')
        await fs.writeFile(from, 'payload')
        await fs.move(from, to)
        assert(!(await fs.exists(from)), 'source gone')
        assertEqual(await fs.readFile(to), 'payload', 'content preserved')
      },
    },
    {
      name: 'move replaces an existing destination',
      because:
        'write-temp-then-move is how every atomic write in this codebase works, and the ' +
        'destination exists on every run after the first',
      async run({ fs, scratch }) {
        /*
         * ⚠️ This case exists because its absence cost a milestone's worth of
         * settings. `rename(2)` replaces the destination; Expo's `File.move`
         * rejects it. Both implementations passed "move relocates content"
         * because it only ever moved onto a fresh path — so `ctx.store` wrote
         * fine on a device's first launch and never again, and nothing in the
         * suite could see it.
         */
        const from = fs.join(scratch, 'replace-from.txt')
        const to = fs.join(scratch, 'replace-to.txt')
        await fs.writeFile(to, 'stale')
        await fs.writeFile(from, 'fresh')
        await fs.move(from, to)
        assert(!(await fs.exists(from)), 'source gone')
        assertEqual(await fs.readFile(to), 'fresh', 'destination replaced, not refused')
      },
    },
    {
      name: 'copy replaces an existing destination',
      because: 'the twin of move, and drifting from it would be the same bug one call along',
      async run({ fs, scratch }) {
        const from = fs.join(scratch, 'copy-from.txt')
        const to = fs.join(scratch, 'copy-to.txt')
        await fs.writeFile(to, 'stale')
        await fs.writeFile(from, 'fresh')
        await fs.copy(from, to)
        assert(await fs.exists(from), 'copy leaves the source')
        assertEqual(await fs.readFile(to), 'fresh', 'destination replaced, not refused')
      },
    },
    {
      name: 'join produces a uri that stat can resolve',
      because: 'plugins never concatenate paths — join is the only builder',
      async run({ fs, scratch }) {
        const uri = fs.join(scratch, 'nested', 'deep.txt')
        await fs.mkdir(fs.join(scratch, 'nested'), { recursive: true })
        await fs.writeFile(uri, 'ok')
        assertEqual((await fs.stat(uri)).size, 2, 'joined uri resolves')
      },
    },
    {
      name: 'basename and extname agree with join',
      because: 'the scanner derives titles and formats from them',
      async run({ fs, scratch }) {
        const uri = fs.join(scratch, 'Song Title.flac')
        assertEqual(fs.basename(uri), 'Song Title.flac', 'basename')
        assertEqual(fs.extname(uri).toLowerCase().replace(/^\./, ''), 'flac', 'extname')
      },
    },
    {
      name: 'stat rejects for a missing file, with a not-found error',
      because: 'callers branch on rejection, not on a sentinel',
      async run({ fs, scratch }) {
        await assertRejects(
          () => fs.stat(fs.join(scratch, 'absent.txt')),
          'stat of a missing file must reject',
          // Must be *not found*, not a permission or path-encoding error.
          /not.?found|ENOENT|no such file|does not exist/i,
        )
      },
    },
    {
      name: 'remove of a non-empty directory without recursive rejects',
      because: 'silently deleting a tree the caller did not ask to delete is worse',
      async run({ fs, scratch }) {
        const dir = fs.join(scratch, 'nonempty')
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(fs.join(dir, 'child.txt'), 'x')
        await assertRejects(
          () => fs.remove(dir),
          'non-recursive remove of a non-empty directory',
          /not empty|ENOTEMPTY|recursive/i,
        )
      },
    },
    {
      name: 'append adds to the end rather than truncating',
      because: 'the rotating log transport appends on every write',
      async run({ fs, scratch }) {
        const uri = fs.join(scratch, 'append.txt')
        await fs.writeFile(uri, 'one')
        await fs.writeFile(uri, '-two', { append: true })
        assertEqual(await fs.readFile(uri), 'one-two', 'appended')
      },
    },
    {
      name: 'copy leaves the source in place',
      because: 'import-into-library must not move the user files',
      async run({ fs, scratch }) {
        const from = fs.join(scratch, 'orig.txt')
        const to = fs.join(scratch, 'copy.txt')
        await fs.writeFile(from, 'content')
        await fs.copy(from, to)
        assertEqual(await fs.readFile(from), 'content', 'source intact')
        assertEqual(await fs.readFile(to), 'content', 'copy written')
      },
    },
    {
      name: 'handles unicode filenames',
      because: 'music libraries are full of them, and normalisation differs by platform',
      async run({ fs, scratch }) {
        const name = 'Björk — Jóga (Ελληνικά).flac'
        const uri = fs.join(scratch, name)
        await fs.writeFile(uri, 'x')
        assert(await fs.exists(uri), 'unicode file should be findable by the uri that wrote it')
        const listed = await fs.list(scratch)
        assert(
          listed.some((s) => s.name.normalize('NFC') === name.normalize('NFC')),
          'unicode filename should survive a round trip through list()',
        )
      },
    },
    {
      name: 'reads an exact byte range',
      because: 'resumable downloads and format probing both need it',
      async run({ fs, scratch }) {
        const uri = fs.join(scratch, 'range.bin')
        await fs.writeFile(uri, new Uint8Array([10, 20, 30, 40, 50]))

        const reader = fs.createReadStream(uri, { start: 1, end: 3 }).getReader()
        const chunks: number[] = []
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(...value)
        }
        // Inclusive end, matching HTTP Range semantics: bytes 1..3.
        assertEqual(chunks, [20, 30, 40], 'range contents')
      },
    },
    {
      name: 'freeSpace reports a positive number',
      because: 'the download policy refuses to start without headroom',
      async run({ fs, scratch }) {
        assert((await fs.freeSpace(scratch)) > 0, 'free space should be positive')
      },
    },
    {
      name: 'toPlayableUri returns something the platform can open',
      because: 'Android SAF uris cannot be handed to a decoder directly',
      async run({ fs, scratch }) {
        const uri = fs.join(scratch, 'playable.txt')
        await fs.writeFile(uri, 'x')
        const playable = await fs.toPlayableUri(uri)
        assert(typeof playable === 'string' && playable.length > 0, 'returns a uri')
      },
    },
    {
      name: 'dir() resolves data and cache, and reports music honestly',
      because: 'iOS has no shared music folder; callers must see undefined, not a lie',
      async run({ fs }) {
        assert(await fs.dir('data'), 'data must exist')
        assert(await fs.dir('cache'), 'cache must exist')
        const music = await fs.dir('music')
        assert(music === undefined || typeof music === 'string', 'music is a uri or undefined')
      },
    },
    {
      name: 'canWatch matches whether watch actually fires',
      because: 'the scanner polls when watching is unavailable',
      async run({ fs, scratch }) {
        if (!fs.canWatch) {
          // Must still be callable and must still return a disposer.
          const off = await fs.watch(scratch, () => {})
          off()
          return
        }
        let fired = false
        const off = await fs.watch(scratch, () => {
          fired = true
        })
        try {
          await fs.writeFile(fs.join(scratch, 'watched.txt'), 'x')
          // Poll rather than sleeping a fixed interval: a single hard-coded
          // wait is either flaky on a slow filesystem or needlessly slow.
          const deadline = Date.now() + 5_000
          while (!fired && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 25))
          }
        } finally {
          off()
        }
        assert(fired, 'canWatch is true but no event fired within 5s')
      },
    },
  ],
}
