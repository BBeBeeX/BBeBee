/**
 * The write side of the `capability_grants` ledger — who approved what
 * for whom.
 *
 * The kernel loader's gate fails closed: a non-`builtin` plugin whose
 * manifest asks for capabilities is refused unless a grant exists in
 * this table (the shells feed the loader from the kernel's
 * `readCapabilityGrants`). This ledger is the only writer. A grant is
 * recorded exactly when the user confirms an install or update of the
 * package whose real manifest declares those capabilities — install IS
 * the approval — and revoked on uninstall, so a later reinstall must be
 * approved again rather than resurrecting old grants.
 *
 * The ledger wraps a `DbService` handle captured under plugin-manager's
 * own capability scope (its manifest's `db:read:core`/`db:write:core`):
 * like plugin-sources' stores, the handle lives inside a plain holder
 * class because a raw handle read back through a caller's context is
 * re-shadowed with the caller's grants. It lives in this package, not
 * the kernel, because the layer rules pin feature packages to the
 * kernel's Cordis surface only — table-owning stores belong to their
 * owning feature (the SourceStore precedent).
 */

import type { DbService } from '@BBeBee/protocol'

export interface RecordGrantOptions {
  /** Version being installed, recorded on the `plugin_records` parent row. */
  version?: string
  /** Install channel for the parent row (`plugin_records.source`). */
  source?: string
  /** Who approved the grant. The table's own default is `'user'`. */
  grantedBy?: string
}

/**
 * `capability_grants.plugin_id` references `plugin_records(id)` and
 * the databases run with foreign keys ON, so {@link record} first
 * upserts the parent row. Nothing else writes `plugin_records` today:
 * the row exists to anchor externally installed plugins' grants, and
 * {@link revoke} removes it again on uninstall (the grants themselves
 * would also fall to the FK's ON DELETE CASCADE).
 */
export class CapabilityGrantLedger {
  constructor(private readonly db: DbService) {}

  /**
   * Replace the plugin's grants with `capabilities` — the set from the
   * real packaged manifest the user just confirmed installing. Replace,
   * not merge: an update that drops a capability must stop granting it.
   * An empty array clears the plugin's grants (the parent row stays, so
   * the install itself remains on record).
   */
  async record(
    pluginId: string,
    capabilities: readonly string[],
    options: RecordGrantOptions = {},
  ): Promise<void> {
    const caps = [...new Set(capabilities)]
    const now = Date.now()
    await this.db.transaction(async (tx) => {
      await tx.exec(
        `INSERT INTO plugin_records (id, version, source, installed_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           source = excluded.source,
           updated_at = excluded.updated_at`,
        [pluginId, options.version ?? '', options.source ?? 'npm', now, now],
      )
      await tx.exec('DELETE FROM capability_grants WHERE plugin_id = ?', [pluginId])
      for (const capability of caps) {
        await tx.exec(
          'INSERT INTO capability_grants (plugin_id, capability, granted_at, granted_by) VALUES (?, ?, ?, ?)',
          [pluginId, capability, now, options.grantedBy ?? 'user'],
        )
      }
    })
  }

  /**
   * Drop the plugin's grants and its parent record row. Called on
   * uninstall: a plugin that comes back later must be approved again
   * via a fresh install, not resurrect its previous grants.
   */
  async revoke(pluginId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.exec('DELETE FROM capability_grants WHERE plugin_id = ?', [pluginId])
      await tx.exec('DELETE FROM plugin_records WHERE id = ?', [pluginId])
    })
  }
}
