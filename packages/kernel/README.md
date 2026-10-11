# @BBeBee/kernel

The BBeBee kernel module — Layer 1, built on Cordis, providing core functionality such as the app lifecycle, configuration management, plugin loading, capability gating, and database migrations.

## Overview

`@BBeBee/kernel` is the core module of the BBeBee music player, responsible for managing the startup, configuration, and plugin system of the whole app. It wraps the Cordis framework and extends it with BBeBee-specific features such as capability gating, database migrations, and testing utilities.

## Core Features

### 1. App Bootstrap

**Path**: `src/bootstrap/app.ts`

Owns the app's startup and shutdown flow, including:

- **`createApp()`**: creates the app instance and manages the loading of core-service plugins and feature plugins
- **`BootstrapError`**: the error class for when a core service fails to start
- **`App`** interface: provides `start()`, `stop()`, `ready()`, and other methods

**Key features**:
- Core-service plugins load before feature plugins
- Graceful shutdown is supported, so a single plugin cannot block the whole shutdown
- Timeouts prevent plugin initialisation from hanging

### 2. Configuration

**Path**: `src/config/config.ts`

Handles the app config document, expanding it into the plugin activation list:

- **`resolveConfig()`**: validates and expands the config document
- **`isEnabled()`**: checks whether a plugin is enabled
- **`AppConfig`** interface: the shape of the config document
- **`ResolvedPlugin`** interface: per-plugin activation info

**Config shape**:
```typescript
{
  plugins: {
    "plugin-id": {
      enabled: true,
      config: { /* plugin config */ }
    }
  }
}
```

### 3. Plugin Loader

**Path**: `src/loader/loader.ts`

The plugin loader, supporting static and dynamic on-demand loading, and handling plugin instantiation and lifecycle:

- **`loadPlugins()`**: instantiates every resolved plugin (dynamic import functions and static instances)
- **`loadPlugin()`**: single-plugin dynamic loader function
- **`PluginRegistry`** type: the registry of dynamic loader functions and metadata
- **`PluginLoader`** type: the dynamic import function type `() => Promise<PluginModule | unknown>`
- **`LoadedPlugin`** interface: the load result, carrying status and error information

**Plugin states**:
- `active`: loaded and running
- `pending`: loaded but waiting on dependency services
- `failed`: failed to load
- `quarantined`: quarantined after consecutive failures
- `missing`: configured but not found in the registry
- `ungranted`: capability requests not granted

### 4. Capability Gate

**Path**: `src/capability-gate/capability.ts`

Every plugin runs in a capability-restricted context, ensuring it can only reach the resources it was granted:

- **`scopeContext()`**: creates the plugin's capability-restricted context
- **`capabilityConfigOf()`**: reads the capability config of a service intercept
- **Assertion functions**: `assertFs()`, `assertHost()`, `assertDb()`, and so on

**Capability types**:
- `fs:read:<scope>` / `fs:write:<scope>`: filesystem access
- `net:host/<glob>`: network access
- `db:own`: the plugin's own database tables
- `db:read:<ns>` / `db:write:<ns>` / `db:*:<ns>`: database access
- `secrets:own`: secret storage
- `audio`, `notify`, `shell`, `background`: system features

**SQL gating**:
- **`sql.ts`**: SQL statement analysis and validation
- **`statementsOf()`**: splits SQL statements
- **`assertSingleStatement()`**: enforces a single statement
- **`assertSqlAllowed()`**: validates that the SQL is allowed

### 5. Database Migrations

**Path**: `src/migrations/runner.ts`

A forward-only, namespaced database migration system:

- **`MigrationRunner`**: the migration runner
- **`nsPrefix()`**: turns a namespace into a table prefix
- **`expandNs()`**: replaces the `{{ns}}` placeholder in SQL
- **`MigrationError`** / **`NamespaceCollisionError`**: error classes

**Core tables**:
- `schema_migrations`: records the applied migration versions
- `schema_namespaces`: records namespace ownership

**Core migrations** (`core.ts`):
- **Version 1**: the initial schema, with tables for providers, catalogs, playlists, downloads, and more
- **Version 2**: full-text search (FTS5)
- **Version 3**: the ADR-5 migration renaming `providers` to `sources`

### 6. Fiber State

**Path**: `src/fiber-state.ts`

A mirror of Cordis fiber states, working around TypeScript compatibility issues:

**State types**:
- `PENDING`: waiting on dependencies
- `LOADING`: initialising
- `ACTIVE`: running
- `FAILED`: failed to start
- `DISPOSED`: disposed
- `UNLOADING`: unloading

**Utility functions**:
- `fiberStateName()`: returns a human-readable state name
- `isActive()` / `isSettled()`: state checks

### 7. Testing

**Path**: `src/testing.ts`

Test helpers, especially for detecting plugin leaks:

- **`snapshotContext()`**: captures a context snapshot
- **`diffSnapshots()`**: diffs two snapshots
- **`expectNoLeak()`**: asserts that unloading a plugin leaks nothing
- **`tick()`**: waits for scheduled Cordis work to settle
- **`createTestContext()`**: creates an empty test context
- **`tempDir()`**: creates a temporary directory (cleaned up automatically)

## Usage Examples

### Creating an app instance

```typescript
import { createApp } from '@BBeBee/kernel'

const app = createApp({
  target: 'desktop',
  bootstrap: [coreFsPlugin, coreDbPlugin],
  registry: pluginRegistry,
  config: appConfig,
})

await app.start()
```

### Declaring plugin capabilities

```json
{
  "name": "plugin-scrobble",
  "capabilities": ["db:own", "net:host/api.last.fm"]
}
```

### Testing plugin leaks

```typescript
import { expectNoLeak } from '@BBeBee/kernel/testing'

await expectNoLeak(ctx, () => ctx.plugin(MyPlugin, config))
```

## Dependencies

- **`@BBeBee/protocol`**: protocol definitions and service interfaces
- **`cordis`**: the underlying DI and plugin framework (version `4.0.0-rc.9`)

## Export Structure

### Plugin Surface
Open to every layer, for typing plugins:
- `Context`, `Service`, `Inject`
- `Plugin`, `Fiber`, `Effect`, `EffectMeta`
- `FiberState`, `fiberStateName`, `isActive`, `isSettled`

### Bootstrap Surface
Open only to Layer 2 and the composition root:
- `createApp`, `BootstrapError`
- `resolveConfig`, `isEnabled`
- `loadPlugins`
- Capability gate functions
- `MigrationRunner`, migration-related helpers

## Related docs

- `docs/01-overview.md`: project overview
- `docs/02-architecture.md`: architecture design
- `docs/03-plugin-system.md`: the plugin system
- `docs/07-data-model.md`: the data model and migration spec
