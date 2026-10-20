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
 *
 * This module also carries the one settings-derived grant the shells
 * layer on top of the ledger: plugin-manager's download-pipeline
 * hosts ({@link withManagerPipelineGrants}), derived from the user's
 * own network settings by the pure function in
 * `@BBeBee/protocol`. That derivation is a composition-root concern —
 * a feature plugin must never grant itself anything — so it happens
 * here and in the boots, and the manager only ever consumes the
 * result.
 */

import type { Context } from 'cordis'
import {
  APP_SETTINGS_STORE_KEY,
  PLUGIN_MANAGER_ID,
  PLUGIN_SETTINGS_ID,
  derivePluginManagerDownloadHosts,
  type AppSettings,
  type DbService,
  type ManagerNetworkSettings,
  type SettingsService,
  type StoreService,
} from '@BBeBee/protocol'

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

/**
 * The user's current network-relevant settings, read the way the
 * shells can at grant-resolution time.
 *
 * `resolveGrants` first runs before the feature plugins load — the
 * settings SERVICE does not exist yet — so the live read usually
 * misses on the boot pass and the persisted document answers instead:
 * the exact store namespace+key the settings plugin itself reads at
 * its init (`store.namespace(PLUGIN_SETTINGS_ID)` is scope-free, so
 * the root context can read it as soon as the bootstrap store is
 * up). On later resolutions (every dynamic `loadPlugin`) the live
 * service is present and wins. Either source failing yields
 * `undefined`, and the derivation below degrades to the built-in
 * host set — settings trouble must never fail the grant resolution
 * open OR closed beyond that.
 */
export async function readConfiguredAppSettings(
  ctx: Context,
): Promise<Partial<AppSettings> | undefined> {
  const live = (ctx as unknown as { settings?: SettingsService }).settings
  if (live) {
    try {
      return live.getSync()
    } catch {
      // A half-initialised settings service must not sink resolution;
      // the persisted document below is the same truth, one write older.
    }
  }
  const store = (ctx as unknown as { store?: StoreService }).store
  if (store) {
    try {
      return (
        (await store
          .namespace(PLUGIN_SETTINGS_ID)
          .get<Partial<AppSettings>>(APP_SETTINGS_STORE_KEY)) ?? undefined
      )
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Union the settings-derived download hosts into plugin-manager's
 * grant entry — the ONE plugin this merge applies to.
 *
 * Why a merge at all: the loader passes a present `granted` entry to
 * `scopeContext` INSTEAD of the manifest's requested capabilities,
 * so the entry built here must be the union of everything the
 * manager legitimately holds — its ledger rows if any, its manifest
 * capabilities, and the derived `net:host/<host>` grants — never
 * the derived set alone. The manager is `builtin` and its manifest
 * is trusted; the derived set adds the hosts its download pipeline
 * may touch under the user's CURRENT settings (custom mirrors and
 * acceleration bases included), which a static manifest cannot
 * know. No other plugin's entry is touched, and no wildcard is
 * introduced: the derivation is a closed, enumerable host list.
 *
 * Freshness: the shells call this on every grant resolution, and
 * `createApp` re-resolves before every dynamic load — but a RUNNING
 * plugin-manager keeps the grants its fiber was created with. A
 * settings change therefore takes gate effect at the manager's next
 * load (in practice the next launch); the manager's own endpoint
 * selection and tarball pre-check read settings live and follow
 * immediately, so what lags is only the gate's copy of a NEW custom
 * host, never the built-in endpoints.
 */
export function withManagerPipelineGrants(
  grants: Record<string, readonly string[]>,
  managerManifestCapabilities: readonly string[] | undefined,
  settings: ManagerNetworkSettings | undefined,
): Record<string, string[]> {
  const derived = derivePluginManagerDownloadHosts(settings).map((host) => `net:host/${host}`)
  const merged = [
    ...new Set([...(grants[PLUGIN_MANAGER_ID] ?? []), ...(managerManifestCapabilities ?? []), ...derived]),
  ]
  return { ...grants, [PLUGIN_MANAGER_ID]: merged }
}

/**
 * The shells' grant resolver, composed once here so desktop and
 * mobile resolve identically by construction: the ledger from the
 * `db` the bootstrap provided, layered with plugin-manager's
 * settings-derived pipeline hosts. Returns `undefined` when no `db`
 * is reachable — `createApp` then keeps the static load options and
 * the gate stays closed, exactly as a resolver failure does.
 */
export function createShellGrantResolver(opts: {
  managerManifestCapabilities?: readonly string[]
}): (ctx: Context) => Promise<Record<string, string[]> | undefined> {
  return async (ctx) => {
    const db = (ctx as unknown as { db?: DbService }).db
    if (!db) return undefined
    const ledger = await readCapabilityGrants(db)
    const settings = await readConfiguredAppSettings(ctx)
    return withManagerPipelineGrants(ledger, opts.managerManifestCapabilities, settings)
  }
}
