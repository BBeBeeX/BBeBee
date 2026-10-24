/**
 * The realm-side half of the `ext` bridge.
 *
 * `JsRealm.expose` installs *host functions* as realm globals; everything
 * else crosses as data. So the bridge is assembled in two pieces: the host
 * exposes a flat set of `__host*` functions, and this prelude — the first
 * thing evaluated in a fresh extension realm — binds them into the `ext`
 * object authors actually see, plus the `__dispatch` entry point the host
 * calls on every subscribed event.
 *
 * ES5 on purpose: it runs in QuickJS on every platform the app ships to, and
 * avoiding syntax the realm does not need to support keeps the failure mode
 * "the prelude itself does not parse" unreachable in practice.
 */

import {
  EXTENSION_API_VERSION,
  EXTENSION_EVENTS,
  type ExtensionEventName,
} from '@BBeBee/protocol'

/**
 * Build the prelude for one extension. `id` is interpolatd with
 * `JSON.stringify` after the host has validated its charset, so the string
 * cannot terminate its own literal and inject code.
 */
export function makePrelude(id: string, events: readonly ExtensionEventName[] = EXTENSION_EVENTS): string {
  return `(function () {
  'use strict'
  var allowed = ${JSON.stringify(events)}
  var handlers = new Map()
  globalThis.ext = {
    version: ${JSON.stringify(EXTENSION_API_VERSION)},
    id: ${JSON.stringify(id)},
    log: function (m) { __hostLog(typeof m === 'string' ? m : String(m)) },
    http: {
      get: function (url, options) { return __hostHttpGet(url, options || {}).then(unwrap) },
      post: function (url, body, options) { return __hostHttpPost(url, body, options || {}).then(unwrap) },
    },
    storage: {
      get: function (key) { return __hostStorageGet(String(key)).then(unwrap) },
      put: function (key, value) { return __hostStoragePut(String(key), String(value)).then(unwrap) },
      delete: function (key) { return __hostStorageDelete(String(key)).then(unwrap) },
      keys: function () { return __hostStorageKeys().then(unwrap) },
    },
    on: function (event, handler) {
      if (typeof event !== 'string' || allowed.indexOf(event) === -1) {
        throw new Error('ext.on: unknown event ' + String(event))
      }
      if (typeof handler !== 'function') {
        throw new Error('ext.on: handler must be a function')
      }
      var list = handlers.get(event)
      if (!list) handlers.set(event, (list = []))
      list.push(handler)
    },
  }
  globalThis.__dispatch = function (event, payload) {
    var list = handlers.get(event) || []
    return Promise.all(
      list.map(function (handler) {
        try {
          return Promise.resolve(handler(payload)).catch(function (e) {
            __hostLog('handler error: ' + errText(e))
          })
        } catch (e) {
          __hostLog('handler error: ' + errText(e))
          return Promise.resolve()
        }
      })
    ).then(function () {})
  }
  function errText(e) {
    return e && e.message ? String(e.message) : String(e)
  }
  // Host-side failures arrive as { __err, name, message } envelopes — a host
  // exception does not cross the boundary with its identity intact, and a
  // CapabilityError an author cannot read is a gate nobody can debug.
  function unwrap(v) {
    if (v && typeof v === 'object' && v.__err === true) {
      var e = new Error(String(v.message))
      e.name = String(v.name)
      throw e
    }
    return v
  }
})()
`
}
