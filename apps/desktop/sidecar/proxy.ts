/**
 * The sidecar's proxy enforcement point.
 *
 * The renderer decides *which* requests are proxied (a boolean rides on the
 * wire request); this side decides *how* — it holds the config pushed through
 * `proxy:set` and turns it into undici dispatchers, because the sidecar is
 * where the socket opens. Two proxy shapes:
 *
 *  - `http`/`https`: undici's `ProxyAgent` (HTTP CONNECT; `https` also means
 *    TLS to the proxy itself);
 *  - `socks5`: undici's `Agent` with a custom `connect` that dials through
 *    the `socks` package first, then lets undici's connector take the socket
 *    (and upgrade it to TLS for `https:` targets).
 *
 * With no config — or a config missing host/port — there is no dispatcher and
 * marked requests simply go direct: the flag is a routing *wish*, and this is
 * the place that can refuse it.
 */

import { Agent, ProxyAgent, buildConnector } from 'undici'
import type { Dispatcher } from 'undici'
import { SocksClient } from 'socks'
import type { HttpProxyConfig } from '@BBeBee/protocol'

/** The connect timeout for the proxy tunnel itself, in milliseconds. */
const CONNECT_TIMEOUT_MS = 10_000

/** A config worth dialing. Anything else behaves as "no proxy configured". */
export type StoredProxyConfig = Required<Pick<HttpProxyConfig, 'protocol' | 'host' | 'port'>> &
  HttpProxyConfig

/**
 * Normalize an incoming proxy document into a dialable config.
 *
 * The document is the *settings* shape, so `enabled` is part of the decision
 * and is enforced here, not just at the caller: a master switch flipped off
 * must mean "no proxy" no matter which channel delivered the rest. Every
 * other field is untrusted too — wrong types, empty host, port 0. Anything
 * that does not add up to "switched on, an address, and a way to reach it"
 * comes back `null`, and `null` means the side has no proxy — never a throw,
 * because a half-saved settings form must not take the HTTP transport down
 * with it.
 */
export function normalizeProxyConfig(input: unknown): StoredProxyConfig | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (raw['enabled'] === false) return null
  const protocol = raw['protocol'] === 'socks5' || raw['protocol'] === 'https' ? raw['protocol'] : 'http'
  const host = typeof raw['host'] === 'string' ? raw['host'].trim() : ''
  const port = Number(raw['port'])
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null
  return {
    protocol,
    host,
    port,
    ...(typeof raw['username'] === 'string' && raw['username'] ? { username: raw['username'] } : {}),
    ...(typeof raw['password'] === 'string' && raw['password'] ? { password: raw['password'] } : {}),
  }
}

/**
 * A log-safe description of a proxy config: scheme, host, port — and
 * deliberately nothing else. `username`/`password` never appear (not even
 * percent-encoded: that encoding is reversible), so a log line copied into a
 * bug report cannot carry the credential with it.
 */
export function describeProxy(config: StoredProxyConfig | null): string {
  if (!config) return 'direct'
  return `${config.protocol}://${config.host}:${config.port}`
}

function sameConfig(a: StoredProxyConfig | null, b: StoredProxyConfig | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.protocol === b.protocol &&
    a.host === b.host &&
    a.port === b.port &&
    a.username === b.username &&
    a.password === b.password
  )
}

/**
 * The dispatcher for one config. Built fresh every call — `ProxyRegistry`
 * caches it, `proxy:test` builds a throwaway one so a probe never shares
 * socket pools with real traffic.
 */
export function buildProxyDispatcher(config: StoredProxyConfig): Dispatcher {
  if (config.protocol === 'socks5') {
    return new Agent({
      connect: socksConnect(config),
      connectTimeout: CONNECT_TIMEOUT_MS,
    })
  }
  // `https` here is TLS *to the proxy* (RFC 9310 style); undici derives the
  // proxy TLS from the uri scheme. The Basic token is the one auth form
  // CONNECT has; a proxy that wants a challenge flow is not supported here.
  const token =
    config.username || config.password
      ? `Basic ${Buffer.from(`${config.username ?? ''}:${config.password ?? ''}`).toString('base64')}`
      : undefined
  return new ProxyAgent({
    uri: `${config.protocol}://${config.host}:${config.port}`,
    ...(token ? { token } : {}),
  })
}

/** undici's `connect` function type, derived so no deep type import is needed. */
type ConnectFn = ReturnType<typeof buildConnector>

/** undici `connect` that dials the target through a SOCKS5 proxy first. */
function socksConnect(config: StoredProxyConfig): ConnectFn {
  const connect = buildConnector({ timeout: CONNECT_TIMEOUT_MS })
  return (opts, callback) => {
    const destination = {
      host: String(opts.hostname),
      // `port` arrives as number or string depending on the URL it came from.
      port: Number(opts.port) || (opts.protocol === 'https:' ? 443 : 80),
    }
    SocksClient.createConnection({
      proxy: {
        host: config.host,
        port: config.port,
        type: 5,
        ...(config.username || config.password
          ? { userId: config.username ?? '', password: config.password ?? '' }
          : {}),
      },
      command: 'connect',
      destination,
      timeout: CONNECT_TIMEOUT_MS,
    })
      .then(({ socket }) => {
        // Hand the established tunnel to undici's connector: plain socket for
        // `http:`, TLS upgrade for `https:`. On error the tunnel is closed here —
        // an abandoned raw socket would otherwise outlive the failed request.
        connect({ ...opts, httpSocket: socket }, (connectError, raw) => {
          if (connectError || !raw) {
            socket.destroy()
            callback(connectError ?? new Error('proxy tunnel closed'), null)
            return
          }
          callback(null, raw)
        })
      })
      .catch((err: unknown) => {
        callback(err instanceof Error ? err : new Error(String(err)), null)
      })
  }
}

/**
 * The sidecar's live proxy state.
 *
 * One dispatcher at a time, rebuilt only when the config actually changes —
 * `proxy:set` fires on *every* settings change (the composition root pushes
 * the whole document), and rebuilding undici pools per keystroke would drop
 * in-flight keep-alive sockets for nothing.
 */
export class ProxyRegistry {
  private stored: StoredProxyConfig | null = null
  private current: Dispatcher | null = null

  /** The dispatcher to route a marked request through, or `null` for direct. */
  get dispatcher(): Dispatcher | null {
    return this.current
  }

  get config(): StoredProxyConfig | null {
    return this.stored
  }

  set(input: unknown): StoredProxyConfig | null {
    const next = normalizeProxyConfig(input)
    if (sameConfig(this.stored, next)) return this.stored
    const previous = this.current
    this.stored = next
    this.current = next ? buildProxyDispatcher(next) : null
    void previous?.close().catch(() => undefined)
    return next
  }

  dispose(): void {
    void this.current?.close().catch(() => undefined)
    this.current = null
    this.stored = null
  }
}
