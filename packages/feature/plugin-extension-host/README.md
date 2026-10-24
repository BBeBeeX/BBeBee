# @bbebee/plugin-extension-host

`ctx.extensions` — the M5 extension host. Third-party extensions run inside a
`ctx.js` realm (QuickJS over WebAssembly, the same sandbox the source runtime
uses), one realm per extension, and see exactly the `ext` bridge:

- `ext.http.get/post` — scoped behind the manifest's `net:host/<glob>`
  capabilities; an ungranted host is a `CapabilityError` thrown before
  anything is sent.
- `ext.storage.*` — namespaced, string-valued, persistent per extension.
- `ext.log(message)`, `ext.on(event, handler)` — the allowlisted canon events
  (`player/track-changed`, `player/state-changed`, `player/track-completed`,
  `queue/changed`).

Lifecycle: `install` (manifest + one self-contained script), `activate`,
`deactivate`, `uninstall`. Two consecutive load failures quarantine the
extension; uninstall disposes the realm before removing files.

The bridge **is** the capability gate: realm code has no ambient `ctx` to
reach around. See `docs/plugins/loading.md` §6.11 and the M5 status note in
`docs/roadmap/roadmap.md`.
