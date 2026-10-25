# @bbebee/plugin-manager-ui-mobile

React Native views for `@bbebee/plugin-manager` — the mobile plugin management
screen: the list of known plugins (from the manager service's registry
manifests) with an enable/disable toggle per row.

Scope is deliberately **list + toggle + status display only**:

- Installs/uninstalls are NOT here — npm installs refuse on mobile (no
  `PluginLifecycleBridge.installPlugin`), and the registry UI
  (`@bbebee/plugin-registry-ui-mobile`) covers content installs.
- No lifecycle bridge is wired: `setEnabled` persists the override and emits
  `plugin-manager/*` events; on mobile nothing loads or unloads at runtime,
  so **changes take effect at the next launch**. The screen says so, and the
  per-row state line shows the plugin's real runtime state next to its
  persisted enabled flag (a plugin that keeps running after being disabled is
  visible as `Not enabled` + `Running (ACTIVE)` rather than hidden).
- Critical-service providers (`criticalServiceKeysOfProvider` from
  `@BBeBee/protocol`) render with a disabled toggle and the lock reason —
  mirroring the service's own `CRITICAL_PROVIDER` refusal.

The service contract lives in `@BBeBee/protocol` (`PluginManagerService`,
`PluginInfo`); this package holds view state only. The view id constant
(`MANAGER_VIEWS`) is declared locally because the headless package's
`./views` subpath is currently a dangling export.
