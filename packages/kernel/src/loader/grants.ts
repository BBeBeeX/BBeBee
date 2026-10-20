/**
 * Reading the `capability_grants` table — the loader side of the ledger.
 *
 * The loader's gate (loader.ts) fails closed: a non-`builtin` plugin
 * whose manifest asks for capabilities is refused unless a grant exists
 * in this table. {@link readCapabilityGrants} aggregates the table into
 * the `Record<pluginId, capability[]>` shape `LoadOptions.grants`
 * expects. The shells pass it to `createApp` as `resolveGrants`, and
 * the kernel re-reads it before every load, so a grant recorded
 * mid-session (an install the user just confirmed) is visible to the
 * very next activation without a restart.
 *
 * The write side lives with its owner: plugin-manager's grant ledger
 * (`packages/feature/plugin-manager/src/grants.ts`) records approvals
 * from the user-confirmed install/update path and revokes them on
 * uninstall. Grants are never written at boot and never by the loader
 * itself — the table is the record of an approval, not a cache of
 * manifest wishes.
 */

import type { DbService } from '@BBeBee/protocol'

/** Aggregate every grant row into the loader's `grants` shape. */
export async function readCapabilityGrants(
  db: DbService,
): Promise<Record<string, string[]>> {
  const rows = await db.query<{ plugin_id: string; capability: string }>(
    'SELECT plugin_id, capability FROM capability_grants',
  )
  const grants: Record<string, string[]> = {}
  for (const row of rows) {
    ;(grants[row.plugin_id] ??= []).push(row.capability)
  }
  return grants
}
