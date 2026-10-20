#!/usr/bin/env node
/** `pnpm gen:plugins` — regenerate both shells' static registries and the service-key artifact. */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { generate, generateManifests, generateServiceKeys } from './index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

for (const target of ['mobile'] as const) {
  const outDir = join(root, 'apps', 'mobile', 'generated')
  await mkdir(outDir, { recursive: true })
  const written = await generate({ root, target, outFile: join(outDir, 'plugins.ts') })
  console.log(`generated ${written}`)
}

const inspectorDir = join(root, 'packages/ui/plugin-inspector-ui-desktop/src')
await mkdir(inspectorDir, { recursive: true })
const inspectorWritten = await generateManifests({
  root,
  outFile: join(inspectorDir, 'pcb-manifests.generated.ts'),
})
console.log(`generated ${inspectorWritten}`)

/*
 * The service-key artifact: manifest union ∪ the shell's own declaration.
 * `apps/desktop/renderer/plugins.ts` is a pure-data module (its imports
 * are type-only), so the CLI can read `SHELL_MANIFEST` from it directly
 * under --experimental-strip-types instead of scraping source text.
 */
const shellModule = (await import(
  pathToFileURL(join(root, 'apps/desktop/renderer/plugins.ts')).href
)) as {
  SHELL_MANIFEST?: { id?: string; contributes?: { services?: string[] } }
}
const serviceKeysWritten = await generateServiceKeys({
  root,
  outFile: join(root, 'packages/protocol/service-keys.json'),
  shellServices: shellModule.SHELL_MANIFEST?.contributes?.services ?? [],
  shellProviderId: shellModule.SHELL_MANIFEST?.id ?? '@BBeBee/app-shell',
})
console.log(`generated ${serviceKeysWritten}`)
