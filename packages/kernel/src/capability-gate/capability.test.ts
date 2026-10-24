import { describe, expect, it } from 'vitest'
import { Context, Service } from 'cordis'
import { CapabilityError, type Capability } from '@BBeBee/protocol'
import {
  assertDb,
  assertFs,
  assertGranted,
  assertHost,
  capabilityConfigOf,
  classifyDbAccess,
  scopeContext,
} from './capability.js'
import { tick } from '../testing.js'

describe('scopeContext', () => {
  it('delivers grants to every mediated service', async () => {
    // The gate works by interception: the kernel injects the grant set, and
    // each core service reads it off its resolved config.
    const ctx = new Context()
    let seen: unknown

    class FakeFs extends Service<{ granted?: string[] }> {
      constructor(c: Context) {
        super(c, 'fs')
      }
      read(this: FakeFs) {
        seen = this[Service.resolveConfig]()
      }
    }
    await ctx.plugin(FakeFs)

    const scoped = scopeContext(ctx, {
      pluginId: '@bbebee/plugin-demo',
      requested: ['fs:read:media'] as Capability[],
    })
    ;(scoped as never as { fs: FakeFs }).fs.read()
    await tick()

    expect(seen).toMatchObject({
      pluginId: '@bbebee/plugin-demo',
      granted: ['fs:read:media'],
    })
  })

  it('prefers explicit grants over the manifest request', () => {
    // A runtime-installed plugin gets what the user approved, not what it asked
    // for. Requesting more than was granted must not widen access.
    const ctx = new Context()
    const scoped = scopeContext(ctx, {
      pluginId: 'p',
      requested: ['fs:read:all', 'net:host/*'] as Capability[],
      granted: ['fs:read:cache'],
    })
    const config = (scoped as never as Record<symbol, Record<string, unknown>>)[
      Context.intercept as unknown as symbol
    ]
    expect(config!['fs']).toMatchObject({ granted: ['fs:read:cache'] })
  })
})

describe('capabilityConfigOf', () => {
  it('returns undefined for an unmediated caller', () => {
    // The kernel, a core service calling another, and test harnesses are all
    // trusted — they simply have no gate config.
    expect(capabilityConfigOf(undefined)).toBeUndefined()
    expect(capabilityConfigOf({})).toBeUndefined()
    expect(capabilityConfigOf({ pluginId: 'p' })).toBeUndefined()
  })

  it('reads a well-formed config', () => {
    expect(capabilityConfigOf({ pluginId: 'p', granted: ['audio'] })).toEqual({
      pluginId: 'p',
      // Defaults to pluginId. The source runtime overrides it per source, so
      // each imported source gets its own jar, secrets and vars.
      scopeId: 'p',
      granted: ['audio'],
    })
  })
})

describe('assertions', () => {
  const gate = (granted: string[]) => ({ pluginId: 'p', granted })

  it('allows an in-scope fs read and refuses one out of scope', () => {
    expect(() => assertFs(gate(['fs:read:media']), 'read', 'media')).not.toThrow()
    expect(() => assertFs(gate(['fs:read:media']), 'read', 'downloads')).toThrow(CapabilityError)
  })

  it('never refuses an ungated caller', () => {
    expect(() => assertFs(undefined, 'write', 'all')).not.toThrow()
  })

  it('allows a granted host and refuses others', () => {
    const g = gate(['net:host/*.example.org'])
    expect(() => assertHost(g, 'https://music.example.org/rest/ping')).not.toThrow()
    expect(() => assertHost(g, 'https://evil.com/collect')).toThrow(CapabilityError)
  })

  it('refuses a malformed url rather than letting it through', () => {
    expect(() => assertHost(gate(['net:host/*']), 'not a url')).toThrow(CapabilityError)
  })

  it('checks flag capabilities by name', () => {
    expect(() => assertGranted(gate(['audio']), 'audio')).not.toThrow()
    expect(() => assertGranted(gate(['audio']), 'notify')).toThrow(CapabilityError)
  })

  it('reports the capability that was missing', () => {
    try {
      assertHost(gate([]), 'https://music.example.org')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(CapabilityError)
      expect((e as CapabilityError).capability).toBe('net:host/music.example.org')
      expect((e as CapabilityError).message).toContain('p')
    }
  })
})

describe('classifyDbAccess', () => {
  it('classifies the ordinary statements', () => {
    expect(classifyDbAccess('SELECT * FROM tracks')).toBe('read')
    expect(classifyDbAccess('  select 1')).toBe('read')
    expect(classifyDbAccess('INSERT INTO tracks (urn) VALUES (?)')).toBe('write')
    expect(classifyDbAccess("UPDATE tracks SET title = 'x'")).toBe('write')
    expect(classifyDbAccess('DELETE FROM tracks')).toBe('write')
    expect(classifyDbAccess('DROP TABLE tracks')).toBe('schema')
    expect(classifyDbAccess('CREATE INDEX idx ON tracks(urn)')).toBe('schema')
  })

  it('looks past a CTE to what the statement actually does', () => {
    expect(classifyDbAccess('WITH t AS (SELECT 1) SELECT * FROM t')).toBe('read')
    expect(classifyDbAccess('WITH t AS (SELECT 1) DELETE FROM tracks WHERE urn IN t')).toBe('write')
  })

  it('takes the most demanding statement in a multi-statement string', () => {
    // Otherwise a DROP rides in behind a SELECT on a read grant.
    expect(classifyDbAccess('SELECT 1; DROP TABLE tracks')).toBe('schema')
    expect(classifyDbAccess('SELECT 1; UPDATE tracks SET title = ?')).toBe('write')
  })

  it('fails closed on comments and on anything it cannot read', () => {
    expect(classifyDbAccess('-- SELECT 1\nDROP TABLE tracks')).toBe('schema')
    expect(classifyDbAccess('/* hi */ SELECT 1')).toBe('read')
    expect(classifyDbAccess('kaboom FROM tracks')).toBe('schema')
  })
})

describe('assertDb verbs', () => {
  const gate = (granted: string[]) => ({ pluginId: 'p', scopeId: 'p', granted })
  const own = 'plugin_p'

  it('db:read:core permits SELECT and refuses mutation', () => {
    const g = gate(['db:own', 'db:read:core'])
    expect(() => assertDb(g, 'SELECT * FROM tracks', own)).not.toThrow()
    expect(() => assertDb(g, "UPDATE tracks SET title='x'", own)).toThrow(CapabilityError)
    expect(() => assertDb(g, 'DELETE FROM tracks', own)).toThrow(CapabilityError)
  })

  it('db:write:core permits mutation and refuses reads and schema changes', () => {
    const g = gate(['db:own', 'db:write:core'])
    expect(() => assertDb(g, 'INSERT INTO tracks (urn) VALUES (?)', own)).not.toThrow()
    expect(() => assertDb(g, 'SELECT * FROM tracks', own)).toThrow(CapabilityError)
    expect(() => assertDb(g, 'DROP TABLE tracks', own)).toThrow(CapabilityError)
  })

  it('db:*:core permits everything in that namespace', () => {
    const g = gate(['db:own', 'db:*:core'])
    expect(() => assertDb(g, 'SELECT * FROM tracks', own)).not.toThrow()
    expect(() => assertDb(g, 'INSERT INTO tracks (urn) VALUES (?)', own)).not.toThrow()
    expect(() => assertDb(g, 'DROP TABLE tracks', own)).not.toThrow()
  })

  it('leaves a plugin its own tables outright', () => {
    const g = gate(['db:own'])
    expect(() => assertDb(g, 'DROP TABLE plugin_p_items', own)).not.toThrow()
    expect(() => assertDb(g, 'SELECT * FROM tracks', own)).toThrow(/outside its own namespace/)
  })

  it('names the grant a refused statement would have needed', () => {
    try {
      assertDb(gate(['db:own', 'db:read:core']), 'INSERT INTO tracks (urn) VALUES (?)', own)
      expect.unreachable()
    } catch (e) {
      expect((e as CapabilityError).capability).toBe('db:write:core')
      expect((e as CapabilityError).message).toContain('tracks')
    }
    try {
      assertDb(gate(['db:own', 'db:write:core']), 'DROP TABLE tracks', own)
      expect.unreachable()
    } catch (e) {
      expect((e as CapabilityError).capability).toBe('db:*:core')
    }
  })

  it('attributes the kernel bookkeeping tables to the core namespace', () => {
    // plugin_records / capability_grants are created by the kernel's own
    // migrations and written by plugin-manager's grants ledger under its
    // db:read:core + db:write:core manifest grants. The plugin_ prefix
    // heuristic must not exile them from the core fallback (regression:
    // every gated install failed on the real machine, 2026-10-22).
    const g = gate(['db:own', 'db:read:core', 'db:write:core'])
    expect(() =>
      assertDb(g, 'INSERT INTO plugin_records (id, version) VALUES (?, ?)', own),
    ).not.toThrow()
    expect(() => assertDb(g, 'SELECT fail_count FROM plugin_records', own)).not.toThrow()
    expect(
      () => assertDb(g, 'DELETE FROM capability_grants WHERE plugin_id = ?', own),
    ).not.toThrow()
    expect(
      () =>
        assertDb(
          g,
          'INSERT INTO capability_grants (plugin_id, capability) VALUES (?, ?)',
          own,
        ),
    ).not.toThrow()
  })

  it('still refuses the bookkeeping tables without core grants', () => {
    // The bookkeeping exception attributes the tables to core; it is not
    // an unconditional skip — a caller with no core grant stays locked out
    // of the grants ledger.
    const g = gate(['db:own'])
    expect(() => assertDb(g, 'INSERT INTO plugin_records (id) VALUES (?)', own)).toThrow(
      /outside its own namespace/,
    )
    expect(() => assertDb(g, 'UPDATE capability_grants SET capability = ?', own)).toThrow(
      /outside its own namespace/,
    )
    // And core access classes still apply: write does not imply read.
    const writeOnly = gate(['db:own', 'db:write:core'])
    expect(() => assertDb(writeOnly, 'SELECT * FROM plugin_records', own)).toThrow(
      CapabilityError,
    )
  })

  it('still refuses a namespace with no grant at all', () => {
    const g = gate(['db:own', 'db:*:core'])
    expect(() => assertDb(g, 'SELECT * FROM plugin_other_notes', own)).toThrow(
      /outside its own namespace/,
    )
  })

  it('does not let a schema qualifier launder another namespace', () => {
    // `main.plugin_other_secrets` was attributed to a table called `main`,
    // which carries no `plugin_` prefix and so fell through to the core
    // fallback — ordinary-looking SQL that read and wrote another plugin's
    // rows under db:read:core / db:write:core.
    const g = gate(['db:own', 'db:read:core', 'db:write:core'])
    expect(() => assertDb(g, 'SELECT * FROM main.plugin_other_secrets', own)).toThrow(
      /outside its own namespace/,
    )
    expect(() => assertDb(g, "UPDATE main.plugin_other_secrets SET v='x'", own)).toThrow(
      /outside its own namespace/,
    )
    // Even the plugin's own tables must be named plainly.
    expect(() => assertDb(g, 'SELECT * FROM main.plugin_p_items', own)).toThrow(CapabilityError)
    expect(() => assertDb(g, 'SELECT * FROM temp.plugin_other_secrets', own)).toThrow(
      CapabilityError,
    )
  })

  it('refuses a change it cannot attribute to any table', () => {
    // The per-table loop is the gate, so a statement naming no table it can
    // see used to pass unexamined: DROP INDEX, DROP TRIGGER, VACUUM, ANALYZE.
    const g = gate(['db:own'])
    for (const sql of [
      'DROP INDEX IF EXISTS idx_tracks_album',
      'DROP TRIGGER core_trig',
      'DROP VIEW core_view',
      'VACUUM',
      'ANALYZE',
    ]) {
      expect(() => assertDb(g, sql, own), sql).toThrow(CapabilityError)
    }
  })

  it('attributes named schema objects to their namespace', () => {
    const g = gate(['db:own'])
    expect(() => assertDb(g, 'DROP INDEX plugin_p_items_status', own)).not.toThrow()
    expect(() => assertDb(g, 'CREATE INDEX plugin_p_x ON plugin_p_items(a)', own)).not.toThrow()
    // The index name is attributed too, so a plugin cannot create an object
    // outside its own namespace on a table inside it.
    expect(() => assertDb(g, 'CREATE INDEX idx_loose ON plugin_p_items(a)', own)).toThrow(
      CapabilityError,
    )
  })

  it('refuses a PRAGMA that reconfigures the shared connection', () => {
    // One connection serves every plugin, and on desktop it lives in main.
    const g = gate(['db:own', 'db:*:core'])
    expect(() => assertDb(g, 'PRAGMA foreign_keys = OFF', own)).toThrow(/may not issue PRAGMA/)
    expect(() => assertDb(g, 'PRAGMA journal_mode = DELETE', own)).toThrow(/may not issue PRAGMA/)
    expect(() => assertDb(g, 'PRAGMA main.foreign_keys = OFF', own)).toThrow(/may not issue PRAGMA/)
    // The per-transaction one the migration runner needs still works.
    expect(() => assertDb(g, 'PRAGMA defer_foreign_keys = ON', own)).not.toThrow()
    expect(() => assertDb(g, 'PRAGMA table_info(plugin_p_items)', own)).not.toThrow()
  })

  it('leaves transaction control alone', () => {
    // Classified as reads: they name nothing and change nothing, and the
    // migration runner issues them on the gated path.
    const g = gate(['db:own'])
    for (const sql of ['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK', 'SAVEPOINT s', 'RELEASE s']) {
      expect(() => assertDb(g, sql, own), sql).not.toThrow()
    }
  })

  it('refuses the arbitrary-file primitives whatever the grants', () => {
    const g = gate(['db:own', 'db:*:core'])
    expect(() => assertDb(g, "ATTACH DATABASE '/tmp/x.db' AS x", own)).toThrow(/may not issue/)
    expect(() => assertDb(g, "VACUUM INTO '/tmp/x.db'", own)).toThrow(/may not issue VACUUM INTO/)
  })
})

describe('per-source host narrowing', () => {
  // plugin-source-runtime holds a broad `net:host/*` because the hosts are not
  // known until a document is imported, and narrows it per source. Both lists
  // must allow a request, or the broad grant would be the whole story and a
  // rule could compute a URL to anywhere. See docs/06 §8.
  const scoped = (allowedHosts: string[]) => ({
    pluginId: '@bbebee/plugin-source-runtime',
    scopeId: 'music-example-org-4f1a',
    granted: ['net:host/*'],
    allowedHosts,
  })

  it('allows a declared host', () => {
    expect(() => assertHost(scoped(['music.example.org']), 'https://music.example.org/x')).not.toThrow()
  })

  it('allows a subdomain of a declared host', () => {
    expect(() => assertHost(scoped(['example.org']), 'https://cdn.example.org/x')).not.toThrow()
  })

  it('refuses an undeclared host even under net:host/*', () => {
    expect(() => assertHost(scoped(['music.example.org']), 'https://evil.test/x')).toThrow(
      CapabilityError,
    )
  })

  it('refuses a bare suffix match', () => {
    // `notexample.org` must not pass because `example.org` was declared.
    expect(() => assertHost(scoped(['example.org']), 'https://notexample.org/x')).toThrow(
      CapabilityError,
    )
  })

  it('leaves plugins without a narrowing list governed by grants alone', () => {
    expect(() =>
      assertHost({ pluginId: 'p', granted: ['net:host/*'] }, 'https://anything.test/x'),
    ).not.toThrow()
  })
})
