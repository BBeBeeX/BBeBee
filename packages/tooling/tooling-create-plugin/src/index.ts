/**
 * Scaffolder for a new plugin package.
 *
 * Not a nicety. With the three-package convention (docs/08 §1), a manifest, a
 * capability list and a conformance/leak test to wire up, hand-rolling a
 * plugin means getting one of them wrong — usually the one that fails
 * silently, like an un-awaited child plugin or a missing manifest.
 *
 * Emits a package that compiles, lints, and passes its own smoke test on the
 * first run, so `pnpm check` is green before a line of real code is written.
 */

import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Where a scaffolded package lands. Packages are grouped by layer
 * (docs/09 §1): a headless plugin is Layer 3, its per-target views are
 * Layer 4. Getting this wrong is not cosmetic — `eslint.config.js` keys its
 * rules off the layer directory, so a package in the wrong one is governed by
 * the wrong rules.
 */
const FEATURE_DIR = 'feature'
const UI_DIR = 'ui'

/**
 * What kind of package to scaffold.
 *
 * There is deliberately no `source` kind. A music backend is a **source
 * document** — a string the user imports, interpreted by
 * `plugin-source-runtime` (docs/06) — not a package. A plugin is for
 * behaviour the runtime cannot express: an effect, a scrobbler, a transport,
 * a UI surface.
 */
export type PluginKind = 'feature' | 'effect'
export type UiTarget = 'none' | 'desktop' | 'mobile' | 'both'

export interface CreateOptions {
  /** Workspace root. */
  root: string
  /** Bare slug, e.g. `scrobble`. The package becomes `plugin-scrobble`. */
  name: string
  kind: PluginKind
  ui: UiTarget
  /** Capabilities the manifest requests. */
  capabilities?: string[]
  /** Service key the plugin claims, defaulting to a camel-cased `name`. */
  service?: string
}

export interface CreatedFile {
  path: string
  contents: string
}

const SLUG = /^[a-z][a-z0-9-]*$/

export function packageNameFor(kind: PluginKind, name: string): string {
  return kind === 'effect' ? `plugin-effect-${name}` : `plugin-${name}`
}

export function serviceNameFor(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

export function classNameFor(name: string): string {
  const camel = serviceNameFor(name)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

/**
 * Render every file for the new plugin.
 *
 * Pure, so the generator is testable without touching the filesystem — the
 * scaffolder's own output is checked in `create-plugin.test.ts`.
 */
export const PLUGIN_KINDS: readonly PluginKind[] = ['feature', 'effect']
export const UI_TARGETS: readonly UiTarget[] = ['none', 'desktop', 'mobile', 'both']

export function render(options: CreateOptions): CreatedFile[] {
  if (!SLUG.test(options.name)) {
    throw new Error(`plugin name must match ${SLUG} (lowercase, hyphenated), got "${options.name}"`)
  }
  // A typo used to fall through the `as PluginKind` cast and scaffold a
  // *feature* package under whatever prefix the switch defaulted to — the
  // wrong package, created silently, discovered later.
  if (!PLUGIN_KINDS.includes(options.kind)) {
    throw new Error(
      `--kind must be one of ${PLUGIN_KINDS.join(' | ')}, got "${String(options.kind)}". ` +
        'A music backend is an imported document, not a package (docs/06).',
    )
  }
  if (!UI_TARGETS.includes(options.ui ?? 'none')) {
    throw new Error(`--ui must be one of ${UI_TARGETS.join(' | ')}, got "${String(options.ui)}"`)
  }

  const pkg = packageNameFor(options.kind, options.name)
  const id = `@BBeBee/${pkg}`
  const service = options.service ?? serviceNameFor(options.name)
  const cls = classNameFor(options.name)
  const capabilities = options.capabilities ?? []
  const wantsDesktop = options.ui === 'desktop' || options.ui === 'both'
  const wantsMobile = options.ui === 'mobile' || options.ui === 'both'
  const files: CreatedFile[] = []

  const tsconfig = (extra = '') =>
    `{\n  "extends": "../../../tsconfig.base.json",\n  "compilerOptions": { "rootDir": "src", "outDir": "dist"${extra} },\n  "include": ["src/**/*"]\n}\n`

  /* ── Headless package ─────────────────────────────────────────────── */

  files.push({
    path: `packages/${FEATURE_DIR}/${pkg}/package.json`,
    contents:
      JSON.stringify(
        {
          name: id,
          version: '0.0.0',
          description: `TODO: describe ${pkg}.`,
          type: 'module',
          license: 'MIT',
          exports: { '.': './src/index.ts', './package.json': './package.json' },
          main: './src/index.ts',
          types: './src/index.ts',
          publishConfig: {
            exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
            main: './dist/index.js',
            types: './dist/index.d.ts',
          },
          files: ['dist'],
          scripts: {
            build: 'tsc -p tsconfig.build.json',
            typecheck: 'tsc -p tsconfig.json --noEmit',
          },
          dependencies: {
            '@BBeBee/protocol': 'workspace:*',
            '@BBeBee/kernel': 'workspace:*',
            cordis: '4.0.0-rc.9',
          },
        },
        null,
        2,
      ) + '\n',
  })

  files.push({ path: `packages/${FEATURE_DIR}/${pkg}/tsconfig.json`, contents: tsconfig() })
  files.push({
    path: `packages/${FEATURE_DIR}/${pkg}/tsconfig.build.json`,
    contents: '{ "extends": "./tsconfig.json", "exclude": ["src/**/*.test.ts"] }\n',
  })

  files.push({
    path: `packages/${FEATURE_DIR}/${pkg}/BBeBee.plugin.json`,
    contents:
      JSON.stringify(
        {
          id,
          name: id,
          displayName: cls,
          description: `TODO: describe ${pkg}.`,
          version: '0.0.0',
          author: 'BBeBee Team',
          engines: { BBeBee: '^0.1.0' },
          enabled: true,
          dependencies: [],
          systemId: 'layer-4',
          moduleId: pkg.replace(/^plugin-/, ''),
          entry: {
            main: './dist/index.js',
            ...(wantsDesktop || wantsMobile
              ? {
                  ui: {
                    ...(wantsDesktop ? { desktop: './dist/index.js' } : {}),
                    ...(wantsMobile ? { mobile: './dist/index.js' } : {}),
                  },
                }
              : {}),
          },
          capabilities,
          contributes: {},
          effect: null,
        },
        null,
        2,
      ) + '\n',
  })

  files.push({
    path: `packages/${FEATURE_DIR}/${pkg}/src/index.ts`,
    contents: `/**
 * TODO: describe what this plugin does and why it exists.
 *
 * Layer 3. Reaches the platform only through \`ctx.*\` services — never a
 * platform SDK, never a \`core-*\` package, never the kernel's bootstrap
 * surface (docs/02 §1). Contributes UI as descriptors, never components
 * (docs/08 §2).
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'

export interface ${cls}Config {
  /** TODO: options this plugin accepts. */
  enabled?: boolean
}

export class ${cls} extends Service {
  // Everything named here must be ACTIVE before this plugin starts.
  static inject = []

  constructor(
    ctx: Context,
    private readonly config: ${cls}Config = {},
  ) {
    super(ctx, '${service}')
  }

  async [Service.init]() {
    // Register side effects here and return a disposer, so unloading is total
    // (docs/03 §2). Anything not registered survives the plugin and leaks.
    return () => {
      // TODO: release whatever [Service.init] acquired.
    }
  }

  get isEnabled(): boolean {
    return this.config.enabled ?? true
  }
}

declare module 'cordis' {
  interface Context {
    ${service}: ${cls}
  }
}

export const name = '${pkg}'

/**
 * Awaited deliberately: an un-awaited child plugin does not propagate
 * readiness, so \`await ctx.plugin(thisPlugin)\` would resolve before the
 * service inside is usable.
 */
export async function apply(ctx: Context, config: ${cls}Config = {}) {
  const fiber = await ctx.plugin(${cls}, config)
  return () => void fiber.dispose()
}

export default { name, apply }
`,
  })

  files.push({
    path: `packages/${FEATURE_DIR}/${pkg}/src/index.test.ts`,
    contents: `import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { diffSnapshots, snapshotContext, tick } from '@BBeBee/kernel/testing'
import plugin, { ${cls} } from './index.js'

describe('${pkg}', () => {
  it('activates and claims its service', async () => {
    const ctx = new Context()
    await ctx.plugin(plugin, {})
    await tick()
    expect(ctx.${service}).toBeInstanceOf(${cls})
  })

  it('leaves nothing behind when unloaded', async () => {
    // The architecture's central claim, applied to this plugin (docs/09 §6).
    const ctx = new Context()
    await tick()
    const before = snapshotContext(ctx)

    const fiber = await ctx.plugin(plugin, {})
    await tick()
    await fiber.dispose()
    await tick()

    const problems = diffSnapshots(before, snapshotContext(ctx))
    expect(problems, problems?.join('; ')).toBeUndefined()
  })
})
`,
  })

  /* ── Per-target view packages ─────────────────────────────────────── */

  for (const target of ['desktop', 'mobile'] as const) {
    if (target === 'desktop' && !wantsDesktop) continue
    if (target === 'mobile' && !wantsMobile) continue
    const uiPkg = `${pkg}-ui-${target}`

    files.push({
      path: `packages/${UI_DIR}/${uiPkg}/package.json`,
      contents:
        JSON.stringify(
          {
            name: `@BBeBee/${uiPkg}`,
            version: '0.0.0',
            description: `${target === 'desktop' ? 'React DOM' : 'React Native'} views for ${id}.`,
            type: 'module',
            license: 'MIT',
            exports: { '.': './src/index.tsx', './package.json': './package.json' },
            main: './src/index.tsx',
            types: './src/index.tsx',
            files: ['dist'],
            scripts: {
              build: 'tsc -p tsconfig.build.json',
              typecheck: 'tsc -p tsconfig.json --noEmit',
            },
            dependencies: {
              '@BBeBee/protocol': 'workspace:*',
              '@BBeBee/kernel': 'workspace:*',
              cordis: '4.0.0-rc.9',
              react: '19.2.3',
            },
            devDependencies: { [id]: 'workspace:*', '@types/react': '^19.2.0' },
          },
          null,
          2,
        ) + '\n',
    })
    files.push({
      path: `packages/${UI_DIR}/${uiPkg}/tsconfig.json`,
      contents: tsconfig(', "jsx": "react-jsx", "lib": ["ES2022", "DOM"]'),
    })
    files.push({
      path: `packages/${UI_DIR}/${uiPkg}/tsconfig.build.json`,
      contents: '{ "extends": "./tsconfig.json", "exclude": ["src/**/*.test.ts"] }\n',
    })
    files.push({
      path: `packages/${UI_DIR}/${uiPkg}/src/index.tsx`,
      contents: `/**
 * ${target === 'desktop' ? 'React DOM' : 'React Native'} views for ${id}.
 *
 * Layout and event wiring only. If you are about to write the same \`if\` here
 * and in the other target's package, it belongs in the headless one instead
 * (docs/08 §1).
 */

import { createElement as h } from 'react'
import type { Context } from 'cordis'
import type {} from '@BBeBee/protocol'

export const ${serviceNameFor(options.name)}View = '${options.name}.panel'

export const name = '${uiPkg}'
export const inject = ['ui', '${service}']

export function apply(ctx: Context) {
  return ctx.ui.registerView(${serviceNameFor(options.name)}View, () =>
    h('div', null, 'TODO: render ${cls}'),
  )
}

export default { name, inject, apply }
`,
    })
  }

  return files
}

/** Write the rendered files, refusing to clobber anything that exists. */
export async function create(options: CreateOptions): Promise<string[]> {
  const files = render(options)

  for (const file of files) {
    const full = join(options.root, file.path)
    if (
      await access(full).then(
        () => true,
        () => false,
      )
    ) {
      throw new Error(`refusing to overwrite ${file.path}`)
    }
  }

  for (const file of files) {
    const full = join(options.root, file.path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, file.contents, 'utf8')
  }
  return files.map((f) => f.path)
}
