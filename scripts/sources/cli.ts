#!/usr/bin/env node
/**
 * `pnpm build:sources` — compile multi-file sources into self-contained
 * single-file JSONs.
 *
 * Default flow reads source directories if present: music sources from
 * `registry/music-sources/`, lyric sources from `registry/lyric-sources/`,
 * compiled into `dist/sources/`, `dist/lyric-sources/` and the
 * generated TS module that `plugin-lyric-sources` imports.
 *
 * `--sources <dir>` compiles from a custom directory: one
 * mixed directory routed per document (music docs carry `sourceUrl`, lyric
 * docs don't), with every lyric doc found aggregated into the generated
 * module. `--lyric-sources <dir>` overrides just the lyric directory of the
 * default flow (ignored together with `--sources`).
 */
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { watch } from 'node:fs'
import { buildSources, unpackSource } from './index.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const defaultMusicSourcesDir = join(repoRoot, 'registry', 'music-sources')
const defaultLyricSourcesDir = join(repoRoot, 'registry', 'lyric-sources')
const defaultOutDir = join(repoRoot, 'dist', 'sources')
const defaultLyricCodegenFile = join(
  repoRoot,
  'packages',
  'feature',
  'plugin-lyric-sources',
  'src',
  'generated',
  'builtin-lyric-sources.generated.ts',
)

const args = process.argv.slice(2)

let isWatch = false
let unpackTarget: string | undefined
let unpackDest: string | undefined
let customSourcesDir: string | undefined
let customLyricSourcesDir: string | undefined
let customOutDir: string | undefined

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--watch' || arg === '-w') {
    isWatch = true
  } else if (arg === '--unpack' && i + 1 < args.length) {
    unpackTarget = args[++i]
    if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
      unpackDest = args[++i]
    }
  } else if (arg === '--sources' && i + 1 < args.length) {
    customSourcesDir = args[++i]
  } else if (arg === '--lyric-sources' && i + 1 < args.length) {
    customLyricSourcesDir = args[++i]
  } else if (arg === '--out' && i + 1 < args.length) {
    customOutDir = args[++i]
  }
}

const outDir = customOutDir ? resolve(process.cwd(), customOutDir) : defaultOutDir
// Lyric outputs live next to the music ones: dist/sources → dist/lyric-sources.
const lyricOutDir = join(resolve(outDir, '..'), 'lyric-sources')
const lyricCodegen = defaultLyricCodegenFile

async function runBuild() {
  try {
    let written: string[]
    if (customSourcesDir) {
      // Legacy single-dir flow: one mixed directory routed per document,
      // lyric docs still feeding the generated TS module.
      written = await buildSources({
        sourcesDir: resolve(process.cwd(), customSourcesDir),
        outDir,
        lyricOutDir,
        lyricCodegenFile: lyricCodegen,
        validate: true,
      })
    } else {
      // Default flow: source directories split into two sibling dirs.
      // Music first (nothing routes to the lyric outputs), then lyric —
      // the lyric run is what aggregates docs into the generated module.
      const lyricDir = customLyricSourcesDir
        ? resolve(process.cwd(), customLyricSourcesDir)
        : defaultLyricSourcesDir
      const musicWritten = await buildSources({
        sourcesDir: defaultMusicSourcesDir,
        outDir,
        lyricOutDir,
        validate: true,
      })
      const lyricWritten = await buildSources({
        sourcesDir: lyricDir,
        outDir,
        lyricOutDir,
        lyricCodegenFile: lyricCodegen,
        validate: true,
      })
      written = [...musicWritten, ...lyricWritten]
    }
    console.log(`[build:sources] Successfully compiled ${written.length} source(s):`)
    for (const f of written) {
      console.log(`  - ${f}`)
    }
    if (lyricCodegen) {
      console.log(`[build:sources] Generated lyric-source module: ${lyricCodegen}`)
    }
  } catch (err) {
    console.error(`[build:sources] Error: ${err instanceof Error ? err.message : String(err)}`)
    if (!isWatch) {
      process.exitCode = 1
    }
  }
}

if (unpackTarget) {
  const targetPath = resolve(process.cwd(), unpackTarget)
  const destDir = unpackDest
    ? resolve(process.cwd(), unpackDest)
    : join(defaultMusicSourcesDir, 'unpacked')
  console.log(`[unpack:source] Unpacking ${targetPath} -> ${destDir}...`)
  try {
    const res = await unpackSource({ jsonFile: targetPath, outDir: destDir })
    console.log(`[unpack:source] Created:`)
    console.log(`  - ${res.jsonFile}`)
    if (res.jsFile) console.log(`  - ${res.jsFile}`)
  } catch (err) {
    console.error(`[unpack:source] Failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
} else if (isWatch) {
  // One watcher per input directory, sharing a single debounce so changes
  // landing in both dirs inside the debounce window collapse into one build.
  const watchedDirs = customSourcesDir
    ? [resolve(process.cwd(), customSourcesDir)]
    : [defaultMusicSourcesDir, defaultLyricSourcesDir]
  console.log(`[watch:sources] Watching ${watchedDirs.join(' and ')} for changes...`)
  await runBuild()

  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let buildChain: Promise<void> = Promise.resolve()
  const scheduleBuild = (filename: string | null) => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      console.log(`[watch:sources] Change detected in ${filename ?? 'a watched dir'}, recompiling...`)
      // Serialize rebuilds so overlapping runs never tear the fixtures.
      buildChain = buildChain.then(runBuild)
      await buildChain
    }, 150)
  }
  for (const dir of watchedDirs) {
    watch(dir, { recursive: true }, (_eventType, filename) => {
      if (!filename || filename.startsWith('.') || filename.endsWith('~')) return
      scheduleBuild(filename)
    })
  }
} else {
  await runBuild()
}
