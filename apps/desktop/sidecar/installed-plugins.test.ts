/**
 * Unit tests for installed-plugin discovery (Fix A): `BBeBee.plugin.json`
 * must be preferred over `manifest.json` / `package.json` so an
 * npm-installed plugin restarts under its registry id (not its npm package
 * name), and the reported sha256 must hash the entry main file.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  discoverPluginManifest,
  entryMainOf,
  listInstalledPlugins,
  writePluginFilesAtomic,
} from './installed-plugins.js'
import { readdirSync, readFileSync } from 'node:fs'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'installed-plugins-test-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writePlugin(dirName: string, files: Record<string, string>): string {
  const dir = join(root, dirName)
  mkdirSync(dir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }
  return dir
}

const BBE_MANIFEST = JSON.stringify({
  id: 'alice-plugin',
  version: '2.0.0',
  entry: { main: './dist/index.js' },
})

describe('discoverPluginManifest', () => {
  it('prefers BBeBee.plugin.json over manifest.json and package.json', () => {
    const dir = writePlugin('alice__plugin', {
      'BBeBee.plugin.json': BBE_MANIFEST,
      'manifest.json': JSON.stringify({ id: 'legacy-id', version: '0.0.1' }),
      'package.json': JSON.stringify({ name: '@alice/pkg', version: '9.9.9' }),
    })
    const manifest = discoverPluginManifest(dir)
    expect(manifest?.['id']).toBe('alice-plugin')
    expect(manifest?.['version']).toBe('2.0.0')
  })

  it('falls back to manifest.json when BBeBee.plugin.json is absent', () => {
    const dir = writePlugin('legacy', {
      'manifest.json': JSON.stringify({ id: 'legacy-id', version: '0.0.1' }),
    })
    expect(discoverPluginManifest(dir)?.['id']).toBe('legacy-id')
  })

  it('falls back to manifest.json when BBeBee.plugin.json is corrupt', () => {
    const dir = writePlugin('corrupt', {
      'BBeBee.plugin.json': '{not json',
      'manifest.json': JSON.stringify({ id: 'legacy-id', version: '0.0.1' }),
    })
    expect(discoverPluginManifest(dir)?.['id']).toBe('legacy-id')
  })

  it('uses an embedded package.json manifest', () => {
    const dir = writePlugin('embedded', {
      'package.json': JSON.stringify({ name: '@alice/pkg', manifest: { id: 'embedded-id', version: '3.0.0' } }),
    })
    const manifest = discoverPluginManifest(dir)
    expect(manifest?.['id']).toBe('embedded-id')
    expect(manifest?.['version']).toBe('3.0.0')
  })

  it('synthesizes a manifest from bare package.json fields', () => {
    const dir = writePlugin('bare', {
      'package.json': JSON.stringify({ name: '@alice/pkg', version: '4.0.0', main: './lib/main.js' }),
    })
    const manifest = discoverPluginManifest(dir)
    expect(manifest?.['id']).toBe('@alice/pkg')
    expect(manifest?.['version']).toBe('4.0.0')
    expect(entryMainOf(manifest!)).toBe('lib/main.js')
  })

  it('returns undefined for an empty directory', () => {
    const dir = writePlugin('empty', {})
    expect(discoverPluginManifest(dir)).toBeUndefined()
  })
})

describe('listInstalledPlugins', () => {
  it('lists plugins by manifest id with the entry-main sha256', () => {
    writePlugin('alice__plugin', {
      'BBeBee.plugin.json': BBE_MANIFEST,
      'package.json': JSON.stringify({ name: '@alice/pkg', version: '2.0.0' }),
      'dist/index.js': 'export const name = "alice-plugin"',
    })
    const [info] = listInstalledPlugins(root)
    expect(info?.id).toBe('alice-plugin')
    expect(info?.version).toBe('2.0.0')
    expect(info?.dirName).toBe('alice__plugin')
    const expected = createHash('sha256').update('export const name = "alice-plugin"').digest('hex')
    expect(info?.sha256).toBe(expected)
  })

  it('omits sha256 when the entry main file is missing', () => {
    writePlugin('alice__plugin', {
      'BBeBee.plugin.json': BBE_MANIFEST,
      'package.json': JSON.stringify({ name: '@alice/pkg', version: '2.0.0' }),
    })
    const [info] = listInstalledPlugins(root)
    expect(info?.id).toBe('alice-plugin')
    expect(info?.sha256).toBeUndefined()
  })

  it('returns [] for a missing root', () => {
    expect(listInstalledPlugins(join(root, 'nope'))).toEqual([])
    expect(existsSync(root)).toBe(true)
  })

  it('skips atomic-write staging/backup scratch directories', () => {
    writePlugin('.backup-alice__plugin-1-2', { 'BBeBee.plugin.json': BBE_MANIFEST })
    writePlugin('.staging-alice__plugin-1-2', { 'BBeBee.plugin.json': BBE_MANIFEST })
    expect(listInstalledPlugins(root)).toEqual([])
  })
})

describe('writePluginFilesAtomic (audit W3)', () => {
  const MANIFEST = JSON.stringify({ id: 'alice-plugin', version: '1.0.0', entry: { main: './dist/index.js' } })

  it('writes a fresh install into the plugin directory', () => {
    const result = writePluginFilesAtomic(root, '@alice/plugin', {
      'BBeBee.plugin.json': MANIFEST,
      'dist/index.js': 'export const v = 1',
    })
    expect(result.path).toBe(join(root, 'alice__plugin'))
    expect(readFileSync(join(root, 'alice__plugin', 'dist', 'index.js'), 'utf8')).toBe('export const v = 1')
    expect(listInstalledPlugins(root).map((p) => p.id)).toEqual(['alice-plugin'])
    // No scratch directories are left behind.
    expect(readdirSync(root)).toEqual(['alice__plugin'])
  })

  it('replaces the whole directory: files dropped by the new version do not linger', () => {
    writePluginFilesAtomic(root, 'alice-plugin', {
      'BBeBee.plugin.json': MANIFEST,
      'dist/index.js': 'v1',
      'dist/old-helper.js': 'leftover from v1',
    })
    writePluginFilesAtomic(root, 'alice-plugin', {
      'BBeBee.plugin.json': MANIFEST,
      'dist/index.js': 'v2',
    })
    const dir = join(root, 'alice-plugin')
    expect(readFileSync(join(dir, 'dist', 'index.js'), 'utf8')).toBe('v2')
    expect(existsSync(join(dir, 'dist', 'old-helper.js'))).toBe(false)
    expect(readdirSync(root)).toEqual(['alice-plugin'])
  })

  it('rejects path traversal and leaves the previous install untouched', () => {
    writePluginFilesAtomic(root, 'alice-plugin', {
      'BBeBee.plugin.json': MANIFEST,
      'dist/index.js': 'v1',
    })
    expect(() =>
      writePluginFilesAtomic(root, 'alice-plugin', {
        'BBeBee.plugin.json': MANIFEST,
        '../escape.js': 'pwned',
      }),
    ).toThrow('Path traversal rejected')
    const dir = join(root, 'alice-plugin')
    expect(readFileSync(join(dir, 'dist', 'index.js'), 'utf8')).toBe('v1')
    expect(existsSync(join(root, 'escape.js'))).toBe(false)
    expect(readdirSync(root)).toEqual(['alice-plugin'])
  })

  it('a write that fails midway (unwritable entry) leaves the previous install intact', () => {
    writePluginFilesAtomic(root, 'alice-plugin', {
      'BBeBee.plugin.json': MANIFEST,
      'dist/index.js': 'v1',
    })
    // A "file" whose path collides with a directory write inside the
    // staging area makes the second write throw mid-package.
    expect(() =>
      writePluginFilesAtomic(root, 'alice-plugin', {
        'dist/index.js': 'v2',
        'dist/index.js/child.js': 'cannot exist under a file',
      }),
    ).toThrow()
    const dir = join(root, 'alice-plugin')
    expect(readFileSync(join(dir, 'dist', 'index.js'), 'utf8')).toBe('v1')
    expect(readdirSync(root)).toEqual(['alice-plugin'])
  })
})
