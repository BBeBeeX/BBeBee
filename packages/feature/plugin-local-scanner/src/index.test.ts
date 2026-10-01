/**
 * The scanner, against a real filesystem and a real database.
 *
 * The codec is faked — a tag reader is `core-codec-*`'s contract to keep, not
 * this plugin's — but everything else is real, because the behaviours that
 * matter here are exactly the ones a fake would paper over: what gets opened,
 * what gets written, and what happens when a file disappears.
 */

import { chmod, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { PathsNode } from '@BBeBee/core-paths-node'
import { FsNode } from '@BBeBee/core-fs-node'
import { DbNode } from '@BBeBee/core-db-node'
import { diffSnapshots, snapshotContext, tempDir, tick } from '@BBeBee/kernel/testing'
import type { AudioMetadata, DbService, Uri } from '@BBeBee/protocol'
import plugin, { type Scanner } from './index.js'
import { sortKey } from './import.js'
import { artworkId, splitArtists } from '@BBeBee/toolkit'

/** Counts what the scanner asks of the codec — the exit criterion is a count. */
interface FakeCodec {
  metadataReads: string[]
  artworkReads: string[]
  tags: Map<string, AudioMetadata>
  failures: Set<string>
}

function codecPlugin(fake: FakeCodec) {
  class CodecFake extends Service {
    constructor(ctx: Context) {
      super(ctx, 'codec')
    }
    async readMetadata(uri: Uri): Promise<AudioMetadata> {
      fake.metadataReads.push(uri)
      if (fake.failures.has(uri)) throw new Error('unsupported codec')
      // No title by default, so the filename fallback is exercised rather
      // than hidden behind a fake that always knows one.
      return fake.tags.get(uri) ?? { artist: 'Unknown', hasArtwork: false }
    }
    async readArtwork(uri: Uri): Promise<Uint8Array | undefined> {
      fake.artworkReads.push(uri)
      return new Uint8Array([1, 2, 3, 4])
    }
    async decode() {
      throw new Error('not needed')
    }
    async probeDuration() {
      return 0
    }
    supportedFormats(): string[] {
      return ['mp3', 'flac']
    }
  }
  return CodecFake
}

interface Harness {
  ctx: Context
  scanner: Scanner
  db: DbService
  dir: string
  uri: Uri
  codec: FakeCodec
  write(name: string, content?: string): Promise<string>
}

async function harness(
  opts: { pollIntervalMinutes?: number; canWatch?: boolean } = {},
): Promise<Harness> {
  const dir = await tempDir('bbebee-scan')
  const codec: FakeCodec = {
    metadataReads: [],
    artworkReads: [],
    tags: new Map(),
    failures: new Set(),
  }

  const ctx = new Context()
  await ctx.plugin(PathsNode, { root: await tempDir('bbebee-scan-app') })
  await ctx.plugin(FsNode)
  await ctx.plugin(DbNode, { fileName: ':memory:' })
  await ctx.plugin(codecPlugin(codec))
  if (opts.canWatch === false) {
    // Stand in for the desktop bridge, whose `canWatch` is false.
    Object.defineProperty(ctx.fs, 'canWatch', { get: () => false, configurable: true })
  }
  await ctx.plugin(plugin, {
    batchSize: 2,
    watchDebounceMs: 5,
    ...(opts.pollIntervalMinutes !== undefined
      ? { pollIntervalMinutes: opts.pollIntervalMinutes }
      : {}),
  })
  await tick()

  return {
    ctx,
    scanner: ctx.scanner as Scanner,
    db: ctx.db,
    dir,
    uri: pathToFileURL(dir).href.replace(/\/$/, ''),
    codec,
    async write(name: string, content = 'audio') {
      const path = join(dir, name)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, content)
      return pathToFileURL(path).href
    },
  }
}

describe('scanning', () => {
  it('imports tagged files into the catalogue', async () => {
    const h = await harness()
    const a = await h.write('a.mp3')
    await h.write('b.flac')
    await h.write('notes.txt')

    h.codec.tags.set(a, {
      title: 'Jóga',
      artist: 'Björk',
      albumArtist: 'Björk',
      album: 'Homogenic',
      trackNo: 2,
      year: 1997,
      durationMs: 302_000,
      genre: ['Electronic'],
      isrc: 'ISRC123',
      hasArtwork: true,
    })

    await h.scanner.addSpecifiedDir(h.uri)
    const summary = await h.scanner.scan()

    expect(summary.added, 'the .txt is not audio').toBe(2)
    expect(summary.errors).toBe(0)

    const tracks = await h.db.query<{ title: string; track_no: number | null }>(
      'SELECT title, track_no FROM tracks ORDER BY title',
    )
    expect(tracks.map((t) => t.title).sort()).toEqual(['Jóga', 'b'])

    const album = await h.db.get<{ title: string; year: number }>('SELECT title, year FROM albums')
    expect(album).toMatchObject({ title: 'Homogenic', year: 1997 })

    const artists = await h.db.query<{ name: string }>('SELECT name FROM artists ORDER BY name')
    expect(artists.map((a) => a.name)).toContain('Björk')

    // The binding is what "this track is a file on disk" means (docs/07 §4.5).
    const binding = await h.db.get<{ uri: string; origin: string }>(
      'SELECT uri, origin FROM media_bindings WHERE uri = ?',
      [a],
    )
    expect(binding).toMatchObject({ uri: a, origin: 'scan' })

    const external = await h.db.get<{ value: string }>(
      "SELECT value FROM external_ids WHERE namespace = 'isrc'",
    )
    expect(external?.value, 'recorded now so M2 can link on it').toBe('ISRC123')

    const libraryItems = await h.db.query<{ urn: string; kind: string; source_id: string }>(
      'SELECT urn, kind, source_id FROM library_items',
    )
    expect(libraryItems).toHaveLength(0)

    const artworkRow = await h.db.get<{ id: string; local_uri: string | null; bytes: number }>(
      'SELECT id, local_uri, bytes FROM artworks',
    )
    expect(artworkRow).toBeDefined()
    expect(artworkRow?.local_uri).toBeDefined()
    expect(await h.ctx.fs.exists(artworkRow!.local_uri!)).toBe(true)
    expect(await h.ctx.fs.readBytes(artworkRow!.local_uri!)).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('imports folder cover when audio has no embedded artwork', async () => {
    const h = await harness()
    const song = await h.write('track.mp3')
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22])
    const coverUri = h.ctx.fs.join(h.uri, 'cover.jpg')
    await h.ctx.fs.writeFile(coverUri, coverBytes)

    h.codec.tags.set(song, {
      title: 'No Art Song',
      album: 'Folder Album',
      artist: 'Folder Artist',
      hasArtwork: false,
    })

    await h.scanner.addSpecifiedDir(h.uri)
    const summary = await h.scanner.scan()
    expect(summary.added).toBe(1)

    const artworkRow = await h.db.get<{ id: string; local_uri: string | null; bytes: number }>(
      'SELECT id, local_uri, bytes FROM artworks',
    )
    expect(artworkRow).toBeDefined()
    expect(artworkRow?.local_uri).toBeDefined()
    expect(await h.ctx.fs.exists(artworkRow!.local_uri!)).toBe(true)
    expect(await h.ctx.fs.readBytes(artworkRow!.local_uri!)).toEqual(coverBytes)

    const track = await h.db.get<{ artwork_id: string }>('SELECT artwork_id FROM tracks WHERE title = ?', ['No Art Song'])
    expect(track?.artwork_id).toBe(artworkRow!.id)

    const album = await h.db.get<{ artwork_id: string }>('SELECT artwork_id FROM albums WHERE title = ?', ['Folder Album'])
    expect(album?.artwork_id).toBe(artworkRow!.id)
  })

  it('rescans an unchanged library with stat calls and nothing else', async () => {
    // M1's first exit criterion, as a count rather than an intention.
    const h = await harness()
    for (let i = 0; i < 10; i++) await h.write(`t${i}.mp3`)
    await h.scanner.addSpecifiedDir(h.uri)

    const first = await h.scanner.scan()
    expect(first.added).toBe(10)
    expect(h.codec.metadataReads).toHaveLength(10)

    h.codec.metadataReads.length = 0
    h.codec.artworkReads.length = 0
    const second = await h.scanner.scan()

    expect(second, 'nothing changed').toMatchObject({ added: 0, updated: 0, removed: 0, errors: 0 })
    expect(h.codec.metadataReads, 'no file is opened on an unchanged rescan').toHaveLength(0)
    expect(h.codec.artworkReads).toHaveLength(0)
  })

  it('re-imports a file whose size or mtime changed', async () => {
    const h = await harness()
    const a = await h.write('a.mp3')
    await h.scanner.addSpecifiedDir(h.uri)
    await h.scanner.scan()

    h.codec.metadataReads.length = 0
    h.codec.tags.set(a, { title: 'Retagged', artist: 'Björk', hasArtwork: false })
    await h.write('a.mp3', 'audio audio audio')

    const summary = await h.scanner.scan()
    expect(summary.updated).toBe(1)
    expect(h.codec.metadataReads).toEqual([a])
    const track = await h.db.get<{ title: string }>('SELECT title FROM tracks')
    expect(track?.title).toBe('Retagged')
  })

  it('re-reads everything when asked for a full scan', async () => {
    const h = await harness()
    await h.write('a.mp3')
    await h.scanner.addSpecifiedDir(h.uri)
    await h.scanner.scan()

    h.codec.metadataReads.length = 0
    await h.scanner.scan({ full: true })
    expect(h.codec.metadataReads).toHaveLength(1)
  })

  it('records a file it cannot decode instead of dropping it', async () => {
    const h = await harness()
    const bad = await h.write('broken.mp3')
    await h.write('good.mp3')
    h.codec.failures.add(bad)

    await h.scanner.addSpecifiedDir(h.uri)
    const summary = await h.scanner.scan()

    expect(summary).toMatchObject({ added: 1, errors: 1 })
    const entry = await h.db.get<{ status: string; error: string }>(
      'SELECT status, error FROM scan_entries WHERE uri = ?',
      [bad],
    )
    expect(entry?.status).toBe('error')
    expect(entry?.error, 'with the reason, for the "could not import" list').toMatch(/unsupported/)
  })

  it('records an error and rejects files with unsupported codec such as ALAC', async () => {
    const h = await harness()
    await h.write('barbies.m4a')
    h.codec.tags.set(h.uri + '/barbies.m4a', {
      title: 'Barbies',
      artist: 'Artist',
      codec: 'ALAC',
      hasArtwork: false,
    })

    await h.scanner.addSpecifiedDir(h.uri)
    const summary = await h.scanner.scan()

    expect(summary).toMatchObject({ added: 0, errors: 1 })
    const entry = await h.db.get<{ status: string; error: string; track_urn: string | null }>(
      'SELECT status, error, track_urn FROM scan_entries WHERE uri = ?',
      [h.uri + '/barbies.m4a'],
    )
    expect(entry?.status).toBe('error')
    expect(entry?.error).toMatch(/unsupported codec: ALAC/)
    expect(entry?.track_urn).toBeNull()

    const bindings = await h.db.query('SELECT * FROM media_bindings')
    expect(bindings).toHaveLength(0)
  })

  it('survives a directory symlink cycle', async () => {
    // `ln -s . loop` inside a music folder — or two folders linking to each
    // other, which real collections do have — made the BFS queue never empty
    // and `found` grow without bound. The scan did not fail; it ran until the
    // process died, which is the worst shape a bug can take.
    const h = await harness()
    await h.write('a.mp3')
    await mkdir(join(h.dir, 'sub'), { recursive: true })
    await writeFile(join(h.dir, 'sub', 'b.mp3'), 'x')
    await symlink(h.dir, join(h.dir, 'sub', 'loop'), 'dir')

    await h.scanner.addSpecifiedDir(h.uri, { recursive: true })
    const summary = await h.scanner.scan()

    // The guarantee is termination and a bounded result — not perfect
    // de-duplication, which needs canonical-path identity `ctx.fs` does not
    // expose. Both real files are found, and the loop does not run forever.
    const rows = await h.db.query<{ urn: string }>('SELECT urn FROM tracks')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.length, 'the walk is depth-bounded, not unbounded').toBeLessThan(200)
    expect(summary.errors).toBe(0)
  })

  it('never removes tracks after a walk it could not finish', async () => {
    /*
     * The regression this exists for, and it is data loss: bounding the walk
     * turned a hang into "terminate, then reconcile" — and reconciliation
     * cannot tell "the walk did not reach it" from "the file is gone". A
     * second scan of a library containing a symlink loop deleted the rows of
     * files still sitting on disk, counted them in `removed`, and reported
     * success.
     */
    const h = await harness()
    await h.write('keep-me.mp3')
    await h.scanner.addSpecifiedDir(h.uri, { recursive: true })
    const first = await h.scanner.scan()
    expect(first.added).toBe(1)
    expect(first.incomplete, 'a clean tree is complete').toBeFalsy()

    // Now make the tree unwalkable in bounded time, and rescan.
    await mkdir(join(h.dir, 'a'), { recursive: true })
    await mkdir(join(h.dir, 'b'), { recursive: true })
    await symlink(join(h.dir, 'b'), join(h.dir, 'a', 'to-b'), 'dir')
    await symlink(join(h.dir, 'a'), join(h.dir, 'b', 'to-a'), 'dir')

    const second = await h.scanner.scan()

    expect(second.incomplete, 'the walk was bounded, and says so').toBe(true)
    expect(second.removed, 'nothing may be removed on a partial view').toBe(0)
    const rows = await h.db.query<{ urn: string }>('SELECT urn FROM tracks')
    expect(rows.length, 'the file is still on disk, so its row stays').toBeGreaterThanOrEqual(1)
  }, 60_000)

  it('never removes tracks after a folder it was not allowed to open', async () => {
    /*
     * The other half of the same data loss, and the one the loop test missed:
     * a permission error is not a budget overrun, so it took a different path
     * out of the walk and never set the flag. Measured before the fix — one
     * `chmod 000` subdirectory, and the second scan reported `removed: 1` for
     * a file still sitting on disk.
     */
    const h = await harness()
    await mkdir(join(h.dir, 'private'), { recursive: true })
    await writeFile(join(h.dir, 'private', 'keep-me.mp3'), 'x')
    await h.scanner.addSpecifiedDir(h.uri, { recursive: true })

    const first = await h.scanner.scan()
    expect(first.added, 'the file imports while the folder is readable').toBe(1)

    await chmod(join(h.dir, 'private'), 0o000)
    // Root ignores the mode bits, so the premise would be false there.
    const blocked = await readdir(join(h.dir, 'private')).then(
      () => false,
      () => true,
    )
    if (!blocked) return

    const second = await h.scanner.scan()

    expect(second.incomplete, 'a folder it could not open is an unfinished walk').toBe(true)
    expect(second.removed, 'the file is still there — it just could not be seen').toBe(0)
    const rows = await h.db.query<{ urn: string }>('SELECT urn FROM tracks')
    expect(rows).toHaveLength(1)

    // Left readable so the temp directory can be cleaned up.
    await chmod(join(h.dir, 'private'), 0o755)
  })

  it('reports an incomplete scan through scan/finished', async () => {
    // A listener that cannot tell a complete scan from a truncated one will
    // render "0 removed" as though the library had been reconciled.
    const h = await harness()
    await h.write('one.mp3')
    await mkdir(join(h.dir, 'a'), { recursive: true })
    await mkdir(join(h.dir, 'b'), { recursive: true })
    await symlink(join(h.dir, 'b'), join(h.dir, 'a', 'to-b'), 'dir')
    await symlink(join(h.dir, 'a'), join(h.dir, 'b', 'to-a'), 'dir')
    await h.scanner.addSpecifiedDir(h.uri, { recursive: true })

    const seen: { incomplete?: boolean }[] = []
    h.ctx.on('scan/finished', (_specifiedDirId, summary) => void seen.push(summary))
    await h.scanner.scan()

    expect(seen.at(-1)?.incomplete).toBe(true)
  }, 60_000)

  it('survives two directories that link to each other', async () => {
    // The case the depth cap alone does not cover: mutual links multiply
    // paths exponentially (2^depth), so a 24-deep walk would still cost
    // millions of listings and mint a ghost track per path.
    const h = await harness()
    await mkdir(join(h.dir, 'a'), { recursive: true })
    await mkdir(join(h.dir, 'b'), { recursive: true })
    await writeFile(join(h.dir, 'a', 'one.mp3'), 'x')
    await writeFile(join(h.dir, 'b', 'two.mp3'), 'x')
    await symlink(join(h.dir, 'b'), join(h.dir, 'a', 'to-b'), 'dir')
    await symlink(join(h.dir, 'a'), join(h.dir, 'b', 'to-a'), 'dir')

    await h.scanner.addSpecifiedDir(h.uri, { recursive: true })
    const summary = await h.scanner.scan()

    expect(summary.errors).toBe(0)
    const rows = await h.db.query<{ urn: string }>('SELECT urn FROM tracks')
    // Bounded by the directory budget rather than by 2^24.
    expect(rows.length).toBeLessThan(2000)
  }, 30_000)

  it('walks subdirectories, and stops at the top when told not to', async () => {
    const h = await harness()
    await h.write('top.mp3')
    await h.write('deep/nested.mp3')

    await h.scanner.addSpecifiedDir(h.uri, { recursive: false })
    expect((await h.scanner.scan()).added).toBe(1)

    await h.scanner.removeSpecifiedDir(h.scanner.specifiedDirs[0]!.id)
    await h.scanner.addSpecifiedDir(h.uri, { recursive: true })
    expect((await h.scanner.scan()).added).toBe(2)
  })

  it('forgets a file that is gone, and the track it was', async () => {
    const h = await harness()
    const a = await h.write('a.mp3')
    await h.write('b.mp3')
    await h.scanner.addSpecifiedDir(h.uri)
    await h.scanner.scan()
    expect(await h.db.query('SELECT urn FROM tracks')).toHaveLength(2)

    await rm(new URL(a))
    const summary = await h.scanner.scan()

    expect(summary.removed).toBe(1)
    expect(await h.db.query('SELECT urn FROM tracks')).toHaveLength(1)
    expect(
      await h.db.query('SELECT id FROM media_bindings WHERE uri = ?', [a]),
      'a binding whose file is gone is deleted, not left to fail at play time',
    ).toHaveLength(0)
    expect(await h.db.query('SELECT uri FROM scan_entries WHERE uri = ?', [a])).toHaveLength(0)
    expect(await h.db.query('SELECT urn FROM library_items')).toHaveLength(0)
  })

  it('gives the same track the same URN on every scan', async () => {
    // Otherwise a rescan orphans every playlist entry and play record.
    const h = await harness()
    await h.write('a.mp3')
    await h.scanner.addSpecifiedDir(h.uri)
    await h.scanner.scan()
    const before = await h.db.get<{ urn: string }>('SELECT urn FROM tracks')

    await h.scanner.scan({ full: true })
    const after = await h.db.query<{ urn: string }>('SELECT urn FROM tracks')
    expect(after).toHaveLength(1)
    expect(after[0]!.urn).toBe(before!.urn)
  })

  it('does not insert scanned items into library_items and cleans unloved items', async () => {
    const h = await harness()
    const t1 = await h.write('t1.mp3')
    const t2 = await h.write('t2.mp3')

    h.codec.tags.set(t1, { title: 'Track 1', album: 'Album A', artist: 'Artist A', hasArtwork: false })
    h.codec.tags.set(t2, { title: 'Track 2', album: 'Album A', artist: 'Artist A', hasArtwork: false })

    await h.scanner.addSpecifiedDir(h.uri)
    await h.scanner.scan()

    expect(await h.db.query('SELECT urn FROM tracks')).toHaveLength(2)
    expect(await h.db.query('SELECT urn FROM albums')).toHaveLength(1)
    expect(await h.db.query('SELECT urn FROM library_items')).toHaveLength(0)

    const b1 = await h.db.get<{ track_urn: string }>('SELECT track_urn FROM media_bindings WHERE uri = ?', [t1])
    const b2 = await h.db.get<{ track_urn: string }>('SELECT track_urn FROM media_bindings WHERE uri = ?', [t2])
    const urn1 = b1!.track_urn
    const urn2 = b2!.track_urn

    // Simulate an old database state where unloved track 1 and loved track 2 are in library_items
    await h.db.exec(
      `INSERT INTO library_items (urn, kind, source_id, added_at, pinned, sort_key)
       VALUES (?, 'track', 'local', 1000, 0, 'Track 1'),
              (?, 'track', 'local', 1000, 0, 'Track 2')`,
      [urn1, urn2],
    )
    // Mark track 2 as loved in track_stats
    await h.db.exec(
      `INSERT INTO track_stats (urn, loved, play_count) VALUES (?, 1, 5)`,
      [urn2],
    )

    // Call cleanUnlovedLibraryItems
    await (h.scanner as unknown as { cleanUnlovedLibraryItems(): Promise<void> }).cleanUnlovedLibraryItems()

    const remaining = await h.db.query<{ urn: string }>('SELECT urn FROM library_items')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.urn).toBe(urn2)

    // Removing the loved track file cleans up tracks and library_items
    await rm(new URL(t2))
    await h.scanner.scan()
    expect(await h.db.query('SELECT urn FROM library_items')).toHaveLength(0)
    expect(await h.db.query('SELECT urn FROM tracks WHERE urn = ?', [urn2])).toHaveLength(0)
  })

  it('checkpoints per batch and reports progress', async () => {
    const h = await harness()
    for (let i = 0; i < 5; i++) await h.write(`t${i}.mp3`)
    const progress: number[] = []
    const changed: number[] = []
    h.ctx.on('scan/progress', (_specifiedDirId, done) => void progress.push(done))
    h.ctx.on('library/changed', (_kind, urns) => void changed.push(urns.length))

    await h.scanner.addSpecifiedDir(h.uri)
    await h.scanner.scan()

    // batchSize is 2, so 5 files are three batches — each one a checkpoint.
    expect(progress).toEqual([2, 4, 5])
    expect(changed, 'the library fills progressively, not at the end').toEqual([2, 2, 1])
  })

  it('stops when cancelled, and says so', async () => {
    const h = await harness()
    for (let i = 0; i < 6; i++) await h.write(`t${i}.mp3`)
    await h.scanner.addSpecifiedDir(h.uri)

    const abort = new AbortController()
    h.ctx.on('scan/progress', () => abort.abort())
    const summary = await h.scanner.scan({ signal: abort.signal })

    expect(summary.cancelled).toBe(true)
    expect(summary.added, 'the first batch is kept — that is the checkpoint').toBe(2)
    const kept = await h.db.query('SELECT urn FROM tracks')
    expect(kept).toHaveLength(2)
  })
})

describe('specified dirs', () => {
  it('persists specified dirs and reloads them', async () => {
    const h = await harness()
    const dir = await h.scanner.addSpecifiedDir(h.uri)
    expect(h.scanner.specifiedDirs).toHaveLength(1)

    const rows = await h.db.query<{ id: string; uri: string }>('SELECT id, uri FROM scan_specified_dirs')
    expect(rows[0]).toMatchObject({ id: dir.id, uri: h.uri })

    // Adding the same folder twice is a no-op, not a duplicate.
    await h.scanner.addSpecifiedDir(h.uri)
    expect(h.scanner.specifiedDirs).toHaveLength(1)
  })

  it('disables a specified dir without forgetting it', async () => {
    const h = await harness()
    await h.write('a.mp3')
    const dir = await h.scanner.addSpecifiedDir(h.uri)
    await h.scanner.setEnabled(dir.id, false)

    expect((await h.scanner.scan()).added).toBe(0)
    expect(h.scanner.specifiedDirs[0]!.enabled).toBe(false)
  })

  it('a disabled specified dir leaves the library, and re-enabling brings it back', async () => {
    const h = await harness()
    await h.write('keep/a.mp3')
    await h.write('drop/b.mp3')
    // Two specified dirs over two subfolders; the root itself is never added,
    // so each track is attributable to the dir that must hide it.
    await h.scanner.addSpecifiedDir(pathToFileURL(join(h.dir, 'keep')).href)
    const drop = await h.scanner.addSpecifiedDir(pathToFileURL(join(h.dir, 'drop')).href)
    await h.scanner.scan()
    expect(await h.db.query('SELECT urn FROM tracks WHERE available = 1')).toHaveLength(2)

    const flips: string[][] = []
    h.ctx.on('library/changed', (_kind, urns) => flips.push(urns))
    await h.scanner.setEnabled(drop.id, false)

    // The rows survive untouched — `available` is the only thing that moved —
    // which is what makes re-enabling a no-scan operation.
    const visibility = await h.db.query<{ title: string; available: number }>(
      'SELECT title, available FROM tracks ORDER BY title',
    )
    expect(visibility).toEqual([
      { title: 'a', available: 1 },
      { title: 'b', available: 0 },
    ])
    expect(await h.db.query('SELECT uri FROM scan_entries')).toHaveLength(2)

    const hidden = (await h.db.query<{ urn: string }>("SELECT urn FROM tracks WHERE title = 'b'"))[0]!
      .urn
    expect(flips).toEqual([[hidden]])

    // A toggle that changes nothing must not send the library re-rendering.
    await h.scanner.setEnabled(drop.id, false)
    expect(flips).toEqual([[hidden]])

    await h.scanner.setEnabled(drop.id, true)
    expect(
      (await h.db.query<{ available: number }>("SELECT available FROM tracks WHERE title = 'b'"))[0]!
        .available,
    ).toBe(1)
    expect(flips).toEqual([[hidden], [hidden]])
  })

  it('a scan of the surviving dir re-points a shared file and restores it', async () => {
    // Two dirs over overlapping trees: the same file is covered by both, but
    // its scan_entries row names one owner. Disabling the owner hides the
    // file; the dir still covering it re-points the entry on its next walk —
    // unchanged files included — and the reconcile that follows brings the
    // track back without re-reading its tags.
    const h = await harness()
    await h.write('shared/a.mp3')
    const outer = await h.scanner.addSpecifiedDir(h.uri)
    const inner = await h.scanner.addSpecifiedDir(pathToFileURL(join(h.dir, 'shared')).href)
    await h.scanner.scan()
    expect(await h.db.query('SELECT urn FROM tracks WHERE available = 1')).toHaveLength(1)

    const owner = (
      await h.db.query<{ specified_dir_id: string; track_urn: string }>(
        'SELECT specified_dir_id, track_urn FROM scan_entries',
      )
    )[0]!
    const survivor = owner.specified_dir_id === outer.id ? inner : outer
    await h.scanner.setEnabled(owner.specified_dir_id, false)
    expect(
      (await h.db.query<{ available: number }>('SELECT available FROM tracks WHERE urn = ?', [
        owner.track_urn,
      ]))[0]!.available,
    ).toBe(0)

    const reads = h.codec.metadataReads.length
    await h.scanner.scan()
    expect(
      (await h.db.query<{ available: number }>('SELECT available FROM tracks WHERE urn = ?', [
        owner.track_urn,
      ]))[0]!.available,
    ).toBe(1)
    expect(h.codec.metadataReads.length).toBe(reads)
    expect(survivor.enabled).toBe(true)
  })

  it('removing a specified dir can take its tracks with it', async () => {
    const h = await harness()
    await h.write('a.mp3')
    const dir = await h.scanner.addSpecifiedDir(h.uri)
    await h.scanner.scan()

    await h.scanner.removeSpecifiedDir(dir.id, { forgetTracks: true })
    expect(await h.db.query('SELECT urn FROM tracks')).toHaveLength(0)
    expect(await h.db.query('SELECT urn FROM library_items')).toHaveLength(0)
    expect(await h.db.query('SELECT id FROM scan_specified_dirs')).toHaveLength(0)
  })

  it('emits scan/specified-dirs-changed when specified dirs are added, disabled, or removed', async () => {
    const h = await harness()
    const changes: number[] = []
    h.ctx.on('scan/specified-dirs-changed', (dirs) => changes.push(dirs.length))

    const dir = await h.scanner.addSpecifiedDir(h.uri)
    expect(changes).toEqual([1])

    await h.scanner.setEnabled(dir.id, false)
    expect(changes).toEqual([1, 1])

    await h.scanner.removeSpecifiedDir(dir.id)
    expect(changes).toEqual([1, 1, 0])
  })

  it('re-enables a disabled specified dir when addSpecifiedDir is called with the same uri', async () => {
    const h = await harness()
    const dir = await h.scanner.addSpecifiedDir(h.uri)
    await h.scanner.setEnabled(dir.id, false)
    expect(h.scanner.specifiedDirs[0]!.enabled).toBe(false)

    const readded = await h.scanner.addSpecifiedDir(h.uri)
    expect(readded.enabled).toBe(true)
    expect(h.scanner.specifiedDirs[0]!.enabled).toBe(true)
  })
})

describe('keeping up with the filesystem', () => {
  it('defaults to polling once a day (1440 minutes)', async () => {
    const h = await harness()
    expect((h.scanner as any).config.pollIntervalMinutes).toBe(1440)
  })

  it('polls on its own where there is neither a watcher nor a background service', async () => {
    // Desktop has both problems: the bridge's `canWatch` is false and
    // `core-background-electron` does not exist yet — so without this fallback
    // there is no automatic rescan at all, and the library silently goes stale.
    const h = await harness({ pollIntervalMinutes: 1 / 600, canWatch: false }) // 100 ms
    await h.write('a.mp3')
    await h.scanner.addSpecifiedDir(h.uri)
    await h.scanner.scan()
    expect(await h.db.query('SELECT urn FROM tracks')).toHaveLength(1)

    await h.write('b.mp3')
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(
      await h.db.query('SELECT urn FROM tracks'),
      'the new file was picked up without anyone asking',
    ).toHaveLength(2)
  })

  it('runs one scan at a time', async () => {
    // A watch event, a poll and a manual scan can arrive together; two walks
    // would fight over the abort controller and orphan one another.
    const h = await harness()
    for (let i = 0; i < 6; i++) await h.write(`t${i}.mp3`)
    await h.scanner.addSpecifiedDir(h.uri)

    const [first, second] = await Promise.all([h.scanner.scan(), h.scanner.scan()])
    expect(first, 'the second caller joined the first scan').toBe(second)
    expect(first.added).toBe(6)
    expect(h.codec.metadataReads, 'and no file was read twice').toHaveLength(6)
  })
})

describe('tag handling', () => {
  it('splits an artist tag that names several people', () => {
    // "Artist feat. Other" as free text makes the featured artist unbrowsable.
    expect(splitArtists('Björk feat. Thom Yorke')).toEqual(['Björk', 'Thom Yorke'])
    expect(splitArtists('A; B / C')).toEqual(['A', 'B', 'C'])
    expect(splitArtists(undefined)).toEqual([])
  })

  it('does not split a band whose name contains a slash', () => {
    // AC/DC is one band; "Simon / Garfunkel" is two. The separator is the
    // whitespace, not the slash.
    expect(splitArtists('AC/DC')).toEqual(['AC/DC'])
    expect(splitArtists('Simon / Garfunkel')).toEqual(['Simon', 'Garfunkel'])
    expect(splitArtists('Godspeed You! Black Emperor')).toEqual(['Godspeed You! Black Emperor'])
  })

  it('files sort keys the way a library expects', () => {
    expect(sortKey('The Beatles')).toBe('beatles')
    expect(sortKey('"Heroes"')).toBe('heroes"')
    expect(sortKey(undefined)).toBeUndefined()
  })

  it('falls back to the filename when a file has no title tag', async () => {
    const h = await harness()
    await h.write('01 - Untagged Song.mp3')
    h.codec.tags.clear()
    await h.scanner.addSpecifiedDir(h.uri)
    await h.scanner.scan()

    // The extension is not part of a title, and the name is URL-decoded.
    const track = await h.db.get<{ title: string }>('SELECT title FROM tracks')
    expect(track?.title).toBe('01 - Untagged Song')
  })

  it('allows caller contexts without db capabilities to add and remove specified dirs', async () => {
    const h = await harness()
    const callerCtx = h.ctx.extend()
    callerCtx.intercept('db', {
      pluginId: '@BBeBee/plugin-local-scanner-ui-desktop',
      scopeId: '@BBeBee/plugin-local-scanner-ui-desktop',
      granted: [],
    })
    const dir = await callerCtx.scanner.addSpecifiedDir(h.uri)
    expect(dir.uri).toBe(h.uri)
    expect(callerCtx.scanner.specifiedDirs).toHaveLength(1)
    await callerCtx.scanner.removeSpecifiedDir(dir.id)
    expect(callerCtx.scanner.specifiedDirs).toHaveLength(0)
  })
})

describe('identity', () => {
  it('gives different covers of the same size different ids', () => {
    // A single 32-bit round plus the length collides on same-size images often
    // enough to matter at library scale, and a collision silently gives one
    // album another's artwork.
    const a = new Uint8Array(4096).fill(7)
    const b = new Uint8Array(4096).fill(9)
    expect(artworkId(a)).not.toBe(artworkId(b))
    expect(artworkId(a), 'and it stays stable').toBe(artworkId(new Uint8Array(4096).fill(7)))
  })
})

describe('dropped-file imports', () => {
  it('imports individual files without making their folder a scan dir', async () => {
    const h = await harness()
    const a = await h.write('dropped-a.mp3')
    const b = await h.write('nested/dropped-b.flac')
    const txt = await h.write('linernotes.txt')

    h.codec.tags.set(a, { title: 'Dropped A', artist: 'X', hasArtwork: false })
    h.codec.tags.set(b, { title: 'Dropped B', artist: 'X', hasArtwork: false })

    const summary = await h.scanner.importFiles([a, b, txt])

    // The .txt is reported, never silently skipped.
    expect(summary.added).toBe(2)
    expect(summary.errors).toBe(1)
    expect(summary.removed).toBe(0)

    const tracks = await h.db.query<{ title: string; available: number }>(
      'SELECT title, available FROM tracks ORDER BY title',
    )
    expect(tracks.map((t) => t.title).sort()).toEqual(['Dropped A', 'Dropped B'])
    expect(tracks.every((t) => t.available === 1), 'a drop is available on arrival').toBe(true)

    // No `scan_entries` rows: entries belong to a specified dir, and a drop
    // must not invent one — which is also what keeps reconciliation's hands
    // off these tracks.
    const entries = await h.db.query<{ uri: string }>('SELECT uri FROM scan_entries')
    expect(entries).toHaveLength(0)

    // The recorded uris are what the desktop bridge whitelists for reading.
    const recorded = await h.db.query<{ uri: string }>(
      'SELECT uri FROM scan_dropped_files ORDER BY uri',
    )
    expect(recorded.map((r) => r.uri).sort()).toEqual([a, b].sort())

    const bindings = await h.db.query<{ uri: string }>(
      'SELECT uri FROM media_bindings ORDER BY uri',
    )
    expect(bindings.map((r) => r.uri).sort()).toEqual([a, b].sort())
  })

  it('re-importing the same file updates in place', async () => {
    const h = await harness()
    const a = await h.write('twice.mp3')

    const first = await h.scanner.importFiles([a])
    expect(first.added).toBe(1)

    h.codec.tags.set(a, { title: 'Renamed', artist: 'X', hasArtwork: false })
    const second = await h.scanner.importFiles([a])
    expect(second.added).toBe(0)
    expect(second.updated).toBe(1)

    const tracks = await h.db.query<{ title: string }>('SELECT title FROM tracks')
    expect(tracks).toHaveLength(1)
    expect(tracks[0]?.title).toBe('Renamed')
  })

  it('reports an unreadable file and imports the rest', async () => {
    const h = await harness()
    const bad = await h.write('broken.mp3')
    const good = await h.write('fine.mp3')
    h.codec.failures.add(bad)
    h.codec.tags.set(good, { title: 'Fine', artist: 'X', hasArtwork: false })

    const summary = await h.scanner.importFiles([bad, good])

    expect(summary.added).toBe(1)
    expect(summary.errors).toBe(1)

    const tracks = await h.db.query<{ title: string }>('SELECT title FROM tracks')
    expect(tracks.map((t) => t.title)).toEqual(['Fine'])
  })

  it('a later scan of a watched dir never removes a dropped track', async () => {
    const h = await harness()
    // The drop lands outside anything the scanner walks — that is the point.
    const dropped = await h.write('kept.mp3')
    h.codec.tags.set(dropped, { title: 'Kept', artist: 'X', hasArtwork: false })
    await h.scanner.importFiles([dropped])

    // A separate, watched folder that the user later empties.
    await h.write('watched/other.mp3')
    await h.scanner.addSpecifiedDir(h.ctx.fs.join(h.uri, 'watched'))
    expect((await h.scanner.scan()).added).toBe(1)

    await rm(join(h.dir, 'watched', 'other.mp3'), { force: true })
    const second = await h.scanner.scan()
    expect(second.removed).toBe(1)

    const kept = await h.db.get<{ available: number }>(
      `SELECT available FROM tracks
        WHERE urn = (SELECT track_urn FROM media_bindings WHERE uri = ?)`,
      [dropped],
    )
    expect(kept, 'the dropped track survives the unrelated reconciliation').toMatchObject({
      available: 1,
    })
  })
})

describe('lifecycle', () => {
  it('leaves nothing behind when unloaded', async () => {
    const codec: FakeCodec = {
      metadataReads: [],
      artworkReads: [],
      tags: new Map(),
      failures: new Set(),
    }
    const ctx = new Context()
    await ctx.plugin(PathsNode, { root: await tempDir('bbebee-scan-leak') })
    await ctx.plugin(FsNode)
    await ctx.plugin(DbNode, { fileName: ':memory:' })
    await ctx.plugin(codecPlugin(codec))
    await tick()

    const before = snapshotContext(ctx)
    const fiber = await ctx.plugin(plugin, {})
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
