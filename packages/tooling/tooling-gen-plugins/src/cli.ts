#!/usr/bin/env node
/** `pnpm gen:plugins` — regenerate both shells' static registries. */
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { generate, generateManifests } from './index.ts'

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
