/**
 * `@bbebee/core-lan-desktop` — the LAN transport, both halves.
 *
 * Two entry points, one package, because they share nothing but the types:
 *
 *   - `LanBridge` (renderer): the `ctx.lan` bootstrap service — thin IPC
 *     client over the desktop bridge, gate-checked here, subscriptions
 *     fanned out locally.
 *   - `createLanHost` (sidecar, via `./host`): the real sockets —
 *     `node:dgram` and `node:http`. Imported only by the sidecar app.
 */

export { LanBridge } from './bridge.js'
export type { LanHostOptions } from './host.js'
export { createLanHost, uriToPath } from './host.js'
