# @BBeBee/sdk

Official Plugin Development Kit (SDK) for building plugins for **BBeBee** music player.

## Installation

```bash
# In your plugin project:
pnpm add @BBeBee/sdk
# or
npm install @BBeBee/sdk
```

## Quick Start

### 1. Function-style Plugin

```ts
import { definePlugin, type Context, type Track } from '@BBeBee/sdk'

export default definePlugin({
  name: 'my-custom-plugin',
  inject: ['player'], // Declare required services
  async apply(ctx: Context) {
    ctx.logger?.info('Plugin loaded!')

    // Listen to track changes
    const off = ctx.on('player/track-changed', (track: Track | undefined) => {
      if (track) {
        ctx.logger?.info(`Now playing: ${track.title} by ${track.artist}`)
      }
    })

    // Return teardown function for clean disposal
    return () => {
      off()
      ctx.logger?.info('Plugin unloaded!')
    }
  },
})
```

### 2. Service Class Plugin

When contributing a new service to `ctx.<serviceName>`:

```ts
import { Service, type Context } from '@BBeBee/sdk'

export class CustomLyricsService extends Service {
  static inject = ['http']

  constructor(ctx: Context) {
    super(ctx, 'customLyrics') // claims ctx.customLyrics
  }

  async [Service.init]() {
    // Initialisation
    return () => {
      // Disposer
    }
  }

  async fetchLyrics(title: string) {
    // Implement service method
  }
}

declare module '@BBeBee/sdk' {
  interface Context {
    customLyrics: CustomLyricsService
  }
}
```

## Unit Testing

Use `@BBeBee/sdk/testing` to write unit tests for your plugin:

```ts
import { describe, expect, it } from 'vitest'
import { createTestContext, expectNoLeak } from '@BBeBee/sdk/testing'
import myPlugin from './index.js'

describe('my-plugin', () => {
  it('loads and unloads cleanly without leaking listeners', async () => {
    const ctx = createTestContext()
    await expectNoLeak(ctx, () => ctx.plugin(myPlugin))
  })
})
```

## Plugin Manifest (`BBeBee.plugin.json`)

Every plugin must include a `BBeBee.plugin.json` describing its metadata and required capabilities:

```json
{
  "id": "my-custom-plugin",
  "name": "my-custom-plugin",
  "displayName": "My Custom Plugin",
  "description": "Example third-party plugin for BBeBee",
  "version": "1.0.0",
  "author": "Your Name",
  "engines": { "BBeBee": "^0.1.0" },
  "enabled": true,
  "dependencies": [],
  "systemId": "layer-4",
  "moduleId": "playback",
  "entry": {
    "main": "./dist/index.js"
  },
  "capabilities": [
    "net:host/*"
  ],
  "contributes": {},
  "effect": null
}
```

## Bundling Guidelines

Because BBeBee loads plugins at runtime via dynamic ESM imports (`bbebee-plugin://`), build your plugin into a standalone ESM module (e.g. using `tsup`):

```ts
// tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  bundle: true,
  target: 'es2022',
  external: ['@BBeBee/sdk', 'cordis'],
})
```
