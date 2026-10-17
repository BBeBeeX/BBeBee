import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Migration, SqlValue } from '@BBeBee/protocol'
import {
  MigrationError,
  MigrationRunner,
  NamespaceCollisionError,
  expandNs,
  nsPrefix,
} from './runner.js'
import { CORE_MIGRATIONS } from './core.js'

/**
 * A real SQLite database, not a fake.
 *
 * `node:sqlite` ships with Node 22+ (used by the desktop sidecar) —
 * so this is the same engine `core-db-node` will use in production, and these
 * tests genuinely validate the SQL rather than a mock's idea of it.
 */
/**
 * Insert a source row.
 *
 * A source is its document, so the row needs `doc_json` and `doc_hash` even in
 * a test — which is the point: they are NOT NULL because a row without them
 * could not be exported, and an export that cannot round-trip is the failure
 * the whole storage shape exists to prevent (docs/07 §4.1).
 */
async function insertSource(
  harness: { exec(sql: string, params?: SqlValue[]): Promise<unknown> },
  id: string,
  sourceUrl = `https://${id}.example.org`,
) {
  const doc = JSON.stringify({ sourceUrl, sourceName: id })
  const now = Date.now()
  return harness.exec(
    `INSERT INTO sources (id, source_url, name, doc_json, doc_hash, imported_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, sourceUrl, id, doc, `hash-${id}`, now, now],
  )
}

/** A v1 database with one row in every table a v3 cascade could reach. */
async function seedV1Catalogue(harness: {
  exec(sql: string, params?: SqlValue[]): Promise<unknown>
}) {
  const stmts = [
    `INSERT INTO providers (instance_id, plugin_id, display_name, enabled, sort_order, created_at)
     VALUES ('nas', '@BBeBee/plugin-source-jellyfin', 'NAS', 1, 3, 1000)`,
    `INSERT INTO artists (urn, instance_id, remote_id, name, fetched_at)
     VALUES ('BBeBee:nas:artist:1', 'nas', '1', 'Björk', 1000)`,
    `INSERT INTO albums (urn, instance_id, remote_id, title, fetched_at)
     VALUES ('BBeBee:nas:album:1', 'nas', '1', 'Homogenic', 1000)`,
    `INSERT INTO tracks (urn, instance_id, remote_id, title, album_urn, fetched_at)
     VALUES ('BBeBee:nas:track:1', 'nas', '1', 'Jóga', 'BBeBee:nas:album:1', 1000)`,
    `INSERT INTO lyrics (track_urn, instance_id, format, content, fetched_at)
     VALUES ('BBeBee:nas:track:1', 'nas', 'lrc', 'la', 1000)`,
    `INSERT INTO track_artists (track_urn, artist_urn, role, ordinal)
     VALUES ('BBeBee:nas:track:1', 'BBeBee:nas:artist:1', 'main', 0)`,
    `INSERT INTO album_artists (album_urn, artist_urn, ordinal)
     VALUES ('BBeBee:nas:album:1', 'BBeBee:nas:artist:1', 0)`,
    `INSERT INTO genres (id, name) VALUES ('g1', 'Trip Hop')`,
    `INSERT INTO track_genres (track_urn, genre_id) VALUES ('BBeBee:nas:track:1', 'g1')`,
    `INSERT INTO media_bindings (id, track_urn, uri, origin, created_at)
     VALUES ('b1', 'BBeBee:nas:track:1', 'file:///a.flac', 'scan', 1000)`,
    `INSERT INTO scan_specified_dirs (id, uri) VALUES ('r1', 'file:///music')`,
    `INSERT INTO scan_entries (uri, specified_dir_id, size, mtime, track_urn, status, scanned_at)
     VALUES ('file:///a.flac', 'r1', 1, 1, 'BBeBee:nas:track:1', 'ok', 1000)`,
    `INSERT INTO tracks_fts_map (rowid, urn) VALUES (7, 'BBeBee:nas:track:1')`,
    `INSERT INTO playlists (urn, instance_id, name, created_at, updated_at)
     VALUES ('BBeBee:nas:playlist:1', 'nas', 'Mix', 1000, 1000)`,
    `INSERT INTO playlist_items (id, playlist_urn, position, track_urn, added_at)
     VALUES ('pi1', 'BBeBee:nas:playlist:1', 'a0', 'BBeBee:nas:track:1', 1000)`,
  ]
  for (const sql of stmts) await harness.exec(sql)
}

function memoryDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')

  const base = {
    async exec(sql: string, params: SqlValue[] = []) {
      const stmt = db.prepare(sql)
      const r = stmt.run(...(params as never[]))
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
    },
    async query<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[]
    },
  }

  return {
    db,
    ...base,
    // BEGIN IMMEDIATE takes the write lock up front rather than upgrading
    // mid-transaction, which is what `core-db-node` will do.
    async transaction<T>(fn: (tx: typeof base) => Promise<T>): Promise<T> {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn(base)
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

describe('nsPrefix', () => {
  it('turns a package id into a legible table prefix', () => {
    expect(nsPrefix('plugin:@BBeBee/plugin-scrobble')).toBe('plugin_bbebee_plugin_scrobble')
    expect(nsPrefix('core')).toBe('core')
  })

  it('is lossy: separators all fold to underscore', () => {
    // Readability was chosen over injectivity, so collisions ARE possible.
    // Uniqueness is enforced against schema_namespaces instead — see the
    // NamespaceCollisionError test below.
    expect(nsPrefix('plugin:a-b')).toBe('plugin_a_b')
    expect(nsPrefix('plugin:a.b')).toBe('plugin_a_b')
    expect(nsPrefix('plugin:a_b')).toBe('plugin_a_b')
  })

  it('rejects a namespace with no usable characters', () => {
    expect(() => nsPrefix('!!!')).toThrow()
  })
})

describe('expandNs', () => {
  it('expands every occurrence', () => {
    expect(expandNs('CREATE TABLE {{ns}}_a; CREATE INDEX i ON {{ns}}_a(x)', 'plugin:foo')).toBe(
      'CREATE TABLE plugin_foo_a; CREATE INDEX i ON plugin_foo_a(x)',
    )
  })
})

describe('MigrationRunner', () => {
  let harness: ReturnType<typeof memoryDb>
  let runner: MigrationRunner

  beforeEach(() => {
    harness = memoryDb()
    runner = new MigrationRunner(harness)
  })

  it('applies pending migrations in version order', async () => {
    const order: number[] = []
    const migrations: Migration[] = [
      { version: 2, up: 'CREATE TABLE {{ns}}_b (id TEXT)' },
      { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' },
    ]
    const applied = await runner.apply('plugin:demo', migrations)
    expect(applied).toBe(2)
    expect(await runner.appliedVersions('plugin:demo')).toEqual([1, 2])
    void order
  })

  it('is idempotent — a second run applies nothing', async () => {
    const migrations: Migration[] = [{ version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' }]
    expect(await runner.apply('plugin:demo', migrations)).toBe(1)
    // Would throw "table already exists" if it re-ran.
    expect(await runner.apply('plugin:demo', migrations)).toBe(0)
  })

  it('applies only what is new when a migration is added later', async () => {
    await runner.apply('plugin:demo', [{ version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' }])
    const added = await runner.apply('plugin:demo', [
      { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' },
      { version: 2, up: 'CREATE TABLE {{ns}}_b (id TEXT)' },
    ])
    expect(added).toBe(1)
  })

  it('keeps namespaces independent', async () => {
    await runner.apply('plugin:a', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])
    await runner.apply('plugin:b', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])
    // Same logical table name, two real tables, no collision.
    const tables = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'plugin_%'`,
    )
    expect(tables.map((t) => t.name).sort()).toEqual(['plugin_a_t', 'plugin_b_t'])
  })

  it('wraps a failing migration with its namespace and version', async () => {
    await expect(
      runner.apply('plugin:demo', [{ version: 1, up: 'THIS IS NOT SQL' }]),
    ).rejects.toThrow(MigrationError)
  })

  it('does not record a version whose migration failed', async () => {
    await runner.apply('plugin:demo', [{ version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' }])
    await expect(
      runner.apply('plugin:demo', [
        { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' },
        { version: 2, up: 'NOT SQL' },
      ]),
    ).rejects.toThrow(MigrationError)
    expect(await runner.appliedVersions('plugin:demo')).toEqual([1])
  })

  it('refuses a multi-statement `up` instead of applying half of it', async () => {
    // The driver compiles the first statement and discards the rest in
    // silence, so this migration would create `_a`, record version 1 as
    // applied, and leave the schema permanently short of `_b` with no error
    // to investigate. `up` takes an array precisely so this is expressible.
    await expect(
      runner.apply('plugin:demo', [
        { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT); CREATE TABLE {{ns}}_b (id TEXT)' },
      ]),
    ).rejects.toThrow(MigrationError)

    expect(await runner.appliedVersions('plugin:demo')).toEqual([])
    const tables = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'plugin_demo_%'`,
    )
    expect(tables, 'nothing may have run').toEqual([])

    // The same statements as an array apply normally.
    await runner.apply('plugin:demo', [
      { version: 1, up: ['CREATE TABLE {{ns}}_a (id TEXT)', 'CREATE TABLE {{ns}}_b (id TEXT)'] },
    ])
    expect(await runner.appliedVersions('plugin:demo')).toEqual([1])
  })

  it('rolls back a partially-applied migration so the next boot can retry', async () => {
    // THE regression test for the worst failure mode: without a transaction,
    // statement 1 committed and the bookkeeping row did not, so every
    // subsequent boot re-ran CREATE TABLE into "already exists" — a
    // permanently unbootable database.
    await expect(
      runner.apply('plugin:demo', [
        {
          version: 1,
          up: ['CREATE TABLE {{ns}}_ok (id TEXT)', 'THIS STATEMENT FAILS'],
        },
      ]),
    ).rejects.toThrow(MigrationError)

    // The first statement must have been rolled back.
    const tables = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'plugin_demo_ok'`,
    )
    expect(tables, 'partial migration was not rolled back').toHaveLength(0)

    // …so a corrected migration applies cleanly on the next attempt.
    const applied = await runner.apply('plugin:demo', [
      { version: 1, up: ['CREATE TABLE {{ns}}_ok (id TEXT)', "SELECT 'now valid'"] },
    ])
    expect(applied).toBe(1)
  })

  it('refuses a namespace whose prefix another namespace already owns', async () => {
    // nsPrefix is lossy: 'plugin:a-b' and 'plugin:a.b' both yield
    // 'plugin_a_b'. Without this check they would silently share tables.
    await runner.apply('plugin:a-b', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])
    await expect(
      runner.apply('plugin:a.b', [{ version: 1, up: 'CREATE TABLE {{ns}}_u (id TEXT)' }]),
    ).rejects.toThrow(NamespaceCollisionError)
  })

  it('rejects duplicate versions within one array', async () => {
    // Both would enter `pending`; the second executes its statements and only
    // then fails on the PK conflict — the H1 shape again.
    await expect(
      runner.apply('plugin:demo', [
        { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' },
        { version: 1, up: 'CREATE TABLE {{ns}}_b (id TEXT)' },
      ]),
    ).rejects.toThrow(/more than once/)
  })

  it('refuses to run against a newer schema rather than rolling back', async () => {
    // Simulates downgrading the app: the database knows v2, this build does not.
    await runner.apply('plugin:demo', [
      { version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' },
      { version: 2, up: 'CREATE TABLE {{ns}}_b (id TEXT)' },
    ])
    await expect(
      runner.apply('plugin:demo', [{ version: 1, up: 'CREATE TABLE {{ns}}_a (id TEXT)' }]),
    ).rejects.toThrow(/newer schema/)
  })

  it('dropNamespace removes exactly that plugin\'s tables', async () => {
    await runner.apply('plugin:a', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])
    await runner.apply('plugin:b', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])

    const dropped = await runner.dropNamespace('plugin:a')
    expect(dropped).toEqual(['plugin_a_t'])
    expect(await runner.appliedVersions('plugin:a')).toEqual([])
    // The other plugin is untouched.
    expect(await runner.appliedVersions('plugin:b')).toEqual([1])
  })

  it('dropNamespace does not match a longer prefix through the LIKE wildcard', async () => {
    // `_` is a single-character wildcard in LIKE, so an unescaped
    // `plugin_a_%` also matches `plugin_ax_t` — dropping an unrelated
    // plugin's tables. Cross-plugin data loss on uninstall.
    await runner.apply('plugin:a', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])
    await runner.apply('plugin:ax', [{ version: 1, up: 'CREATE TABLE {{ns}}_t (id TEXT)' }])

    const dropped = await runner.dropNamespace('plugin:a')
    expect(dropped).toEqual(['plugin_a_t'])

    const survivors = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'plugin_ax_t'`,
    )
    expect(survivors, "neighbouring plugin's table was dropped").toHaveLength(1)
  })

  it('dropNamespace tolerates foreign keys between a plugin\'s own tables', async () => {
    // With PRAGMA foreign_keys = ON (which the docs require), dropping a
    // parent before its child would trip a constraint violation.
    await runner.apply('plugin:fk', [
      {
        version: 1,
        up: [
          'CREATE TABLE {{ns}}_parent (id TEXT PRIMARY KEY)',
          'CREATE TABLE {{ns}}_child (id TEXT PRIMARY KEY, p TEXT REFERENCES {{ns}}_parent(id))',
        ],
      },
    ])
    await harness.exec(`INSERT INTO plugin_fk_parent (id) VALUES ('a')`)
    await harness.exec(`INSERT INTO plugin_fk_child (id, p) VALUES ('c', 'a')`)

    const dropped = await runner.dropNamespace('plugin:fk')
    expect(dropped.sort()).toEqual(['plugin_fk_child', 'plugin_fk_parent'])
  })
})

describe('CORE_MIGRATIONS', () => {
  it('applies cleanly against real SQLite', async () => {
    const harness = memoryDb()
    const runner = new MigrationRunner(harness)
    const applied = await runner.apply('core', CORE_MIGRATIONS)
    expect(applied).toBe(CORE_MIGRATIONS.length)
  })

  it('creates every table documented in docs/07-data-model.md §4', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    const rows = await harness.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type IN ('table') AND name NOT LIKE 'sqlite_%'`,
    )
    const tables = new Set(rows.map((r) => r.name))

    for (const expected of [
      'sources', 'source_vars', 'accounts', 'cookie_jars', 'artworks',
      'artists', 'albums', 'tracks', 'track_artists', 'album_artists',
      'genres', 'track_genres', 'external_ids', 'track_links',
      'media_bindings', 'scan_specified_dirs', 'scan_entries',
      'playlists', 'playlist_items', 'library_items', 'collections', 'collection_items',
      'queue_items', 'playback_state', 'play_history', 'track_stats',
      'download_tasks', 'download_policies',
      'effect_chains', 'effect_nodes', 'presets', 'settings',
      'plugin_records', 'capability_grants', 'lyrics', 'cache_entries',
      'tracks_fts',
    ]) {
      expect(tables, `missing table: ${expected}`).toContain(expected)
    }
  })

  it('enforces the track_links canonical-order constraint', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    // The CHECK is what keeps the relation symmetric without storing it twice.
    await expect(
      harness.exec(
        'INSERT INTO track_links (urn_a, urn_b, confidence, method, created_at) VALUES (?,?,?,?,?)',
        ['BBeBee:z:track:2', 'BBeBee:a:track:1', 1.0, 'isrc', Date.now()],
      ),
    ).rejects.toThrow()
  })

  it('allows only one active effect chain per scope', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    const insert = (id: string, active: number) =>
      harness.exec(
        'INSERT INTO effect_chains (id, name, is_active, scope, created_at) VALUES (?,?,?,?,?)',
        [id, id, active, 'global', Date.now()],
      )
    await insert('a', 1)
    await expect(insert('b', 1)).rejects.toThrow()
    // An inactive one alongside is fine.
    await expect(insert('c', 0)).resolves.toBeDefined()
  })

  it('allows only one in-flight download per track', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    const insert = (id: string, state: string) =>
      harness.exec(
        `INSERT INTO download_tasks (id, track_urn, target_uri, state, created_at, updated_at)
         VALUES (?,?,?,?,?,?)`,
        [id, 'BBeBee:nas:track:1', `file:///${id}`, state, Date.now(), Date.now()],
      )
    await insert('t1', 'running')
    await expect(insert('t2', 'queued')).rejects.toThrow()
    // Once done, the partial index no longer covers it, so a re-download is allowed.
    await harness.exec(`UPDATE download_tasks SET state='done' WHERE id='t1'`)
    await expect(insert('t3', 'queued')).resolves.toBeDefined()
  })

  it('upgrades a v1 database forward instead of leaving it half-built', async () => {
    // The regression this exists for: v1 was once *edited in place* to rename
    // providers→sources. A database that had already recorded core@1 computed
    // pending=[] and never got the new tables, so every later boot hit
    // "no such table: sources" with nothing to investigate. Forward-only is
    // not a style preference (docs/07 §6).
    const harness = memoryDb()
    const runner = new MigrationRunner(harness)

    // Exactly what an older build would have left behind.
    await runner.apply('core', CORE_MIGRATIONS.filter((m) => m.version <= 2))
    await seedV1Catalogue(harness)

    // Now the current build starts up against it.
    await runner.apply('core', CORE_MIGRATIONS)

    const sources = await harness.query<{ id: string; name: string; enabled: number; sort_order: number }>(
      'SELECT id, name, enabled, sort_order FROM sources',
    )
    expect(sources, 'the provider row became a source row, disabled').toEqual([
      { id: 'nas', name: 'NAS', enabled: 0, sort_order: 3 },
    ])
    // Disabled with a reason: it has no rules and no import can ever produce
    // a row matching its id, so starting it would fail every call and look
    // like a bug rather than like a migration awaiting a document.
    const [migrated] = await harness.query<{ last_error: string | null }>(
      'SELECT last_error FROM sources WHERE id = ?',
      ['nas'],
    )
    expect(migrated!.last_error).toMatch(/import a source document/i)

    // The catalogue survived, under the new column name.
    const track = await harness.query<{ urn: string; source_id: string; album_urn: string }>(
      'SELECT urn, source_id, album_urn FROM tracks',
    )
    expect(track).toEqual([
      { urn: 'BBeBee:nas:track:1', source_id: 'nas', album_urn: 'BBeBee:nas:album:1' },
    ])
    expect(await harness.query('SELECT source_id FROM artists')).toEqual([{ source_id: 'nas' }])
    expect(await harness.query('SELECT source_id FROM albums')).toEqual([{ source_id: 'nas' }])
    expect(await harness.query('SELECT source_id FROM lyrics')).toEqual([{ source_id: 'nas' }])

    // And the FK now points at `sources`, so a delete still cascades.
    await harness.exec(`DELETE FROM sources WHERE id = 'nas'`)
    expect(await harness.query('SELECT urn FROM tracks')).toHaveLength(0)

    const gone = await harness.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='providers'`,
    )
    expect(gone, 'providers is gone, not shadowed').toHaveLength(0)
    const temps = await harness.query(
      `SELECT name FROM sqlite_master WHERE name LIKE '_mig3%' OR name LIKE '%_new'`,
    )
    expect(temps, 'no scaffolding is left behind').toHaveLength(0)
  })

  it('carries every cascade-reachable row through the v3 rebuild', async () => {
    // The bug this pins: DROP TABLE performs an implicit DELETE FROM, so
    // dropping `albums` nulls tracks.album_urn and dropping `tracks` cascades
    // away its artists, genres, bindings and FTS map. The first version of
    // this migration did exactly that and still reported success.
    const harness = memoryDb()
    const runner = new MigrationRunner(harness)
    await runner.apply('core', CORE_MIGRATIONS.filter((m) => m.version <= 2))
    await seedV1Catalogue(harness)

    await runner.apply('core', CORE_MIGRATIONS)

    const rows = async (sql: string) => (await harness.query(sql)).length
    expect(await rows('SELECT 1 FROM track_artists'), 'track_artists').toBe(1)
    expect(await rows('SELECT 1 FROM album_artists'), 'album_artists').toBe(1)
    expect(await rows('SELECT 1 FROM track_genres'), 'track_genres').toBe(1)
    expect(await rows('SELECT 1 FROM media_bindings'), 'media_bindings').toBe(1)
    expect(await rows('SELECT 1 FROM playlist_items'), 'playlist_items').toBe(1)

    // The FTS map keeps its rowid, or every indexed row would point at the
    // wrong track and search would return confident nonsense.
    expect(await harness.query('SELECT rowid, urn FROM tracks_fts_map')).toEqual([
      { rowid: 7, urn: 'BBeBee:nas:track:1' },
    ])
    // The two SET NULL columns kept their values.
    expect(await harness.query('SELECT album_urn FROM tracks')).toEqual([
      { album_urn: 'BBeBee:nas:album:1' },
    ])
    expect(await harness.query('SELECT track_urn FROM scan_entries')).toEqual([
      { track_urn: 'BBeBee:nas:track:1' },
    ])
  })

  it('is idempotent across a restart at the new version', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)
    await insertSource(harness, 'a')
    // A second boot must be a no-op, not a re-run of the rebuild.
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)
    expect(await harness.query('SELECT id FROM sources')).toEqual([{ id: 'a' }])
  })

  it('cascades source deletion to its catalogue rows and its vars', async () => {
    // Removing a source must take exactly its own rows with it — that is what
    // makes "remove this source and forget everything it stored" a real
    // action rather than an aspiration (docs/07 §4.1).
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    await insertSource(harness, 'nas')
    await harness.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, fetched_at) VALUES (?,?,?,?,?)`,
      ['BBeBee:nas:track:1', 'nas', '1', 'Song', Date.now()],
    )
    await harness.exec(
      'INSERT INTO source_vars (source_id, key, value, updated_at) VALUES (?,?,?,?)',
      ['nas', 'token', 'secret', Date.now()],
    )
    await harness.exec('DELETE FROM sources WHERE id = ?', ['nas'])

    expect(await harness.query('SELECT urn FROM tracks')).toHaveLength(0)
    expect(await harness.query('SELECT key FROM source_vars')).toHaveLength(0)
  })

  it('refuses two sources with the same sourceUrl', async () => {
    // `sourceUrl` is the dedup key on import: two rows for one backend would
    // make every URN in that namespace ambiguous, which is the one thing the
    // URN scheme exists to prevent (docs/06 §1.2).
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    await insertSource(harness, 'a', 'https://music.example.org')
    await expect(insertSource(harness, 'b', 'https://music.example.org')).rejects.toThrow(
      /UNIQUE/i,
    )
  })

  it('supports diacritic-folded full-text search', async () => {
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    await harness.exec(
      `INSERT INTO tracks_fts (rowid, title, artist_names, album_title) VALUES (1, ?, ?, ?)`,
      ['Jóga', 'Björk', 'Homogenic'],
    )
    // A user typing "bjork" must find "Björk".
    const hits = await harness.query(`SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'bjork'`)
    expect(hits).toHaveLength(1)
  })

  it('allows the search index to be updated and pruned', async () => {
    // A plain `content=''` FTS5 table cannot be DELETEd from or UPDATEd —
    // "cannot DELETE from contentless fts5 table". Without contentless_delete
    // a renamed or deleted track keeps its index row forever and searches
    // return stale hits with no way to remove them short of a full rebuild.
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    await harness.exec(
      `INSERT INTO tracks_fts (rowid, title, artist_names, album_title) VALUES (1, ?, ?, ?)`,
      ['Old Title', 'Artist', 'Album'],
    )

    // Re-index as delete + insert. A contentless-delete table rejects an
    // UPDATE that sets only some columns ("cannot UPDATE a subset of columns
    // on fts5 contentless-delete table"), so callers must always rewrite the
    // whole row — which delete + insert makes explicit.
    await harness.exec(`DELETE FROM tracks_fts WHERE rowid = 1`)
    await harness.exec(
      `INSERT INTO tracks_fts (rowid, title, artist_names, album_title) VALUES (1, ?, ?, ?)`,
      ['New Title', 'Artist', 'Album'],
    )
    expect(
      await harness.query(`SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'New'`),
    ).toHaveLength(1)
    expect(
      await harness.query(`SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'Old'`),
      'stale term still matches after re-index',
    ).toHaveLength(0)

    await harness.exec(`DELETE FROM tracks_fts WHERE rowid = 1`)
    expect(
      await harness.query(`SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH 'New'`),
      'deleted track still in the index',
    ).toHaveLength(0)
  })

  it('maps FTS rowids to track urns', async () => {
    // FTS5 addresses rows by integer rowid; the catalogue is keyed by URN.
    // Without the mapping there is no way to re-index or remove one track.
    const harness = memoryDb()
    await new MigrationRunner(harness).apply('core', CORE_MIGRATIONS)

    await insertSource(harness, 'nas')
    await harness.exec(
      `INSERT INTO tracks (urn, source_id, remote_id, title, fetched_at) VALUES (?,?,?,?,?)`,
      ['BBeBee:nas:track:1', 'nas', '1', 'Jóga', Date.now()],
    )
    const { lastInsertRowid } = await harness.exec(
      'INSERT INTO tracks_fts_map (urn) VALUES (?)',
      ['BBeBee:nas:track:1'],
    )
    await harness.exec(
      `INSERT INTO tracks_fts (rowid, title, artist_names, album_title) VALUES (?, ?, ?, ?)`,
      [lastInsertRowid, 'Jóga', 'Björk', 'Homogenic'],
    )

    const found = await harness.query<{ urn: string }>(
      `SELECT m.urn FROM tracks_fts f
       JOIN tracks_fts_map m ON m.rowid = f.rowid
       WHERE tracks_fts MATCH 'bjork'`,
    )
    expect(found.map((f) => f.urn)).toEqual(['BBeBee:nas:track:1'])

    // Deleting the track cascades the mapping, so a stale row cannot linger.
    await harness.exec('DELETE FROM tracks WHERE urn = ?', ['BBeBee:nas:track:1'])
    expect(await harness.query('SELECT rowid FROM tracks_fts_map')).toHaveLength(0)
  })
})

describe('the SQLite version gate', () => {
  it('accepts the version this host actually has', async () => {
    // Node 22 (desktop sidecar) ships newer than the floor; if this fails,
    // the floor moved or the host did.
    const harness = memoryDb()
    await expect(new MigrationRunner(harness).assertSqliteVersion()).resolves.toBeUndefined()
  })

  it('refuses a host too old for the schema, naming why', async () => {
    // The alternative is a syntax error thrown from the middle of migration
    // v2 that names `contentless_delete` rather than the SDK (docs/11 §8).
    const harness = memoryDb()
    await expect(new MigrationRunner(harness).assertSqliteVersion('99.0.0')).rejects.toThrow(
      /needs SQLite >= 99\.0\.0/,
    )
  })

  it('compares numerically, not lexically', async () => {
    // '3.9.0' > '3.43.0' as strings, which is exactly the wrong answer.
    const harness = memoryDb()
    await expect(new MigrationRunner(harness).assertSqliteVersion('3.9.0')).resolves.toBeUndefined()
  })

  it('trusts a driver that cannot answer', async () => {
    // Being unable to check is not evidence of being too old, and refusing to
    // boot over it would be worse than the risk.
    const stub = {
      exec: async () => ({ changes: 0, lastInsertRowid: 0 }),
      query: async () => {
        throw new Error('no such function: sqlite_version')
      },
      transaction: async <T>(fn: (tx: never) => Promise<T>) => fn(undefined as never),
    }
    await expect(
      new MigrationRunner(stub as never).assertSqliteVersion(),
    ).resolves.toBeUndefined()
  })
})
