import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { validateLyricSourceDocument, validateSourceDocument } from './validator.ts'
import type { LyricSourceDefinition } from '@BBeBee/protocol'

export interface CompileSourceOptions {
  /** Directory containing source.json and optional source.js */
  sourceDir: string
  /** Destination file path for compiled JSON. If omitted, file is not written. */
  outFile?: string
  /** Whether to run the validator. Defaults to true. */
  validate?: boolean
}

export interface BuildSourcesOptions {
  /**
   * Root directory containing source folders — typically one of the registry
   * submodule's sibling dirs (`registry/music-sources`, `registry/lyric-sources`)
   * or, with `--sources`, a single mixed directory routed per document.
   */
  sourcesDir: string
  /** Output directory for compiled music-source JSON fixtures. Defaults to <repo>/fixtures/sources */
  outDir: string
  /**
   * Output directory for compiled lyric-source JSON fixtures.
   * Defaults to `<outDir>/../lyric-sources` (i.e. <repo>/fixtures/lyric-sources).
   */
  lyricOutDir?: string
  /**
   * Where to emit the generated TS module bundling every compiled lyric
   * source, for `plugin-lyric-sources` to import. Absent = skip codegen.
   */
  lyricCodegenFile?: string
  /** Whether to run the validators. Defaults to true. */
  validate?: boolean
}

export interface UnpackSourceOptions {
  /** Path to the single-file source JSON to unpack */
  jsonFile: string
  /** Destination directory for the unpacked files */
  outDir: string
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

/**
 * Music source documents carry `sourceUrl` (required by their validator);
 * lyric source documents carry `id` + `script`. This is the doc-model split
 * the compiler and the output routing key on.
 */
function isLyricSourceDoc(doc: Record<string, unknown>): boolean {
  return doc.sourceUrl === undefined
}

/**
 * Compiles a single source folder (source.json + optional source.js) into a
 * self-contained single-file JSON — a music `SourceDocument` (script →
 * `jsLib`) or a lyric `LyricSourceDefinition` (script → `script`).
 */
export async function compileSource(opts: CompileSourceOptions): Promise<string> {
  const dirName = basename(opts.sourceDir)

  // 1. Locate JSON definition: source.json, <dirName>.json, or source.meta.json
  const jsonCandidates = [
    join(opts.sourceDir, 'source.json'),
    join(opts.sourceDir, `${dirName}.json`),
    join(opts.sourceDir, 'source.meta.json'),
  ]

  let jsonPath: string | undefined
  for (const candidate of jsonCandidates) {
    if (await fileExists(candidate)) {
      jsonPath = candidate
      break
    }
  }

  if (!jsonPath) {
    throw new Error(`No source JSON found in ${opts.sourceDir}. Expected one of: source.json, ${dirName}.json`)
  }

  const rawJson = await readFile(jsonPath, 'utf8')
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(rawJson)
  } catch (err) {
    throw new Error(
      `Failed to parse JSON in ${jsonPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }

  const lyric = isLyricSourceDoc(doc)
  const scriptField = lyric ? 'script' : 'jsLib'

  // 2. Locate optional JavaScript file: source.js or <dirName>.js
  const jsCandidates = [
    join(opts.sourceDir, 'source.js'),
    join(opts.sourceDir, `${dirName}.js`),
  ]

  let jsPath: string | undefined
  for (const candidate of jsCandidates) {
    if (await fileExists(candidate)) {
      jsPath = candidate
      break
    }
  }

  if (jsPath) {
    const jsContent = (await readFile(jsPath, 'utf8')).trim()
    if (jsContent.length > 0) {
      doc[scriptField] = jsContent
    }
  }

  // 3. Validate document with the validator for its doc model
  if (opts.validate !== false) {
    try {
      if (lyric) validateLyricSourceDocument(doc)
      else validateSourceDocument(doc)
    } catch (err) {
      throw new Error(
        `Validation failed for source in ${opts.sourceDir}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }

  const outputContent = JSON.stringify(doc, null, 2) + '\n'

  // 4. Write output if requested
  if (opts.outFile) {
    await mkdir(resolve(opts.outFile, '..'), { recursive: true })
    await writeFile(opts.outFile, outputContent, 'utf8')
  }

  return outputContent
}

/**
 * Scans a directory of source folders and compiles each into a single-file
 * JSON — music sources into `outDir`, lyric sources into `lyricOutDir`, and
 * every lyric source additionally bundled into the generated TS module the
 * plugin imports.
 */
export async function buildSources(opts: BuildSourcesOptions): Promise<string[]> {
  const entries = await readdir(opts.sourcesDir, { withFileTypes: true })
  const sourceDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
    // `unpacked` is the --unpack scratch output (registry/music-sources/unpacked),
    // never a source — scanning it would fail with "No source JSON found".
    .filter((e) => e.name !== 'unpacked')
    .map((e) => join(opts.sourcesDir, e.name))

  const writtenFiles: string[] = []
  const lyricDocs: LyricSourceDefinition[] = []

  for (const sourceDir of sourceDirs) {
    const id = basename(sourceDir)
    const compiled = await compileSource({ sourceDir, validate: opts.validate })
    const doc = JSON.parse(compiled) as Record<string, unknown>
    let outFile: string

    if (isLyricSourceDoc(doc)) {
      const lyricDir = opts.lyricOutDir ?? resolve(opts.outDir, '../lyric-sources')
      outFile = join(lyricDir, `${id}.json`)
      await mkdir(lyricDir, { recursive: true })
      await writeFile(outFile, compiled, 'utf8')
      lyricDocs.push(doc as unknown as LyricSourceDefinition)
    } else {
      outFile = join(opts.outDir, `${id}.json`)
      await mkdir(opts.outDir, { recursive: true })
      await writeFile(outFile, compiled, 'utf8')
    }
    writtenFiles.push(outFile)
  }

  if (lyricDocs.length > 0 && opts.lyricCodegenFile) {
    await writeLyricSourceCodegen(lyricDocs, opts.lyricCodegenFile)
  }

  return writtenFiles
}

/**
 * Emits the TS module bundling every compiled lyric source, so
 * `plugin-lyric-sources` ships them without carrying per-platform code.
 */
async function writeLyricSourceCodegen(
  docs: LyricSourceDefinition[],
  outFile: string,
): Promise<void> {
  const banner =
    '// GENERATED by `pnpm build:sources` from sources/ — do not edit.\n' +
    '// Lyric source documents (sources/<dir>/source.json + source.js) with the\n' +
    '// sandbox script inlined. Refresh with `pnpm build:sources`.\n\n' +
    "import type { LyricSourceDefinition } from '@BBeBee/protocol'\n\n" +
    'export const BUILTIN_LYRIC_SOURCES: readonly LyricSourceDefinition[] = [\n' +
    docs.map((doc) => JSON.stringify(doc, null, 2) + ',').join('\n') +
    '\n]\n'

  await mkdir(resolve(outFile, '..'), { recursive: true })
  await writeFile(outFile, banner, 'utf8')
}

/**
 * Unpacks a single-file source JSON into source.json and optional source.js in
 * outDir — music documents carry `jsLib`, lyric documents `script`.
 */
export async function unpackSource(opts: UnpackSourceOptions): Promise<{ jsonFile: string; jsFile?: string }> {
  const raw = await readFile(opts.jsonFile, 'utf8')
  const doc = JSON.parse(raw) as Record<string, unknown>

  await mkdir(opts.outDir, { recursive: true })

  let jsFile: string | undefined
  for (const field of ['jsLib', 'script'] as const) {
    if (typeof doc[field] === 'string' && (doc[field] as string).trim().length > 0) {
      jsFile = join(opts.outDir, 'source.js')
      await writeFile(jsFile, (doc[field] as string).trim() + '\n', 'utf8')
      delete doc[field]
      break
    }
  }

  const jsonFile = join(opts.outDir, 'source.json')
  await writeFile(jsonFile, JSON.stringify(doc, null, 2) + '\n', 'utf8')

  return { jsonFile, jsFile }
}
