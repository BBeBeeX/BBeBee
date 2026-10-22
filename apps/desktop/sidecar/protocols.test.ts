/**
 * Confinement tests for the `bbebee-plugin://` protocol handler.
 *
 * The handler serves files out of one installed plugin's directory to
 * the webview. These tests pin the escapes found by audit: `..` as the
 * plugin id resolved the plugin directory onto the *parent* (the whole
 * userData tree, since the id sanitizer preserves dots), the encoded
 * spelling of the same trick, and the sibling-prefix hole in the
 * resolved-path check.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pluginDirName } from '@BBeBee/protocol'
import { ProtocolManager, parsePluginRequestUrl, resolvePluginDir } from './protocols.js'

let root: string
let installed: string
let pm: ProtocolManager

function writeFile(base: string, rel: string, content: string): void {
  const path = join(base, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'protocols-test-'))
  installed = join(root, 'plugins')
  mkdirSync(installed, { recursive: true })
  // A file in the *parent* of the installed-plugins root — the userData
  // marker the `..` escape used to serve.
  writeFileSync(join(root, 'userdata-marker.txt'), 'PARENT-SECRET', 'utf8')
  // Plugin A under its hashed directory name (the production layout).
  const dirA = join(installed, pluginDirName('test-plugin-a'))
  writeFile(dirA, 'dist/index.js', 'A-ENTRY')
  writeFile(dirA, 'secret.js', 'A-SECRET')
  // Plugin B under its exact name (the legacy layout step 2 resolves).
  const dirB = join(installed, 'test-plugin-b')
  writeFile(dirB, 'secret.js', 'B-SECRET')
  pm = new ProtocolManager(() => installed)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('bbebee-plugin:// confinement', () => {
  it('serves a legitimate plugin file (hashed dir and exact-name dir)', () => {
    const a = pm.handleBbebeePlugin('bbebee-plugin://app/test-plugin-a/dist/index.js')
    expect(a.status).toBe(200)
    expect(String(a.body)).toContain('A-ENTRY')

    const b = pm.handleBbebeePlugin('bbebee-plugin://app/test-plugin-b/secret.js')
    expect(b.status).toBe(200)
    expect(String(b.body)).toContain('B-SECRET')
  })

  it('serves the Windows http://bbebee-plugin.localhost form identically', () => {
    // WebView2 cannot resolve custom schemes: on Windows the webview
    // addresses the registered scheme as http://bbebee-plugin.localhost.
    expect(parsePluginRequestUrl('http://bbebee-plugin.localhost/app/test-plugin-a/dist/index.js')).toEqual({
      pluginId: 'test-plugin-a',
      subPath: 'dist/index.js',
    })
    const res = pm.handleBbebeePlugin('http://bbebee-plugin.localhost/app/test-plugin-a/dist/index.js')
    expect(res.status).toBe(200)
    expect(String(res.body)).toContain('A-ENTRY')
    // The confinement rules apply to the Windows form too.
    expect(
      parsePluginRequestUrl('http://bbebee-plugin.localhost/app/%2e%2e/secret.js'),
    ).toBeUndefined()
    expect(parsePluginRequestUrl('http://bbebee-plugin.localhost/etc/passwd')).toBeUndefined()
  })

  it('refuses ".." as the plugin id instead of serving the parent directory', () => {
    expect(parsePluginRequestUrl('bbebee-plugin://../userdata-marker.txt')).toBeUndefined()
    const res = pm.handleBbebeePlugin('bbebee-plugin://../userdata-marker.txt')
    expect(res.status).not.toBe(200)
    expect(String(res.body ?? '')).not.toContain('PARENT-SECRET')
  })

  it('refuses the percent-encoded dot-segment spelling (%2e%2e)', () => {
    expect(parsePluginRequestUrl('bbebee-plugin://%2e%2e/userdata-marker.txt')).toBeUndefined()
    const res = pm.handleBbebeePlugin('bbebee-plugin://%2e%2e/userdata-marker.txt')
    expect(res.status).not.toBe(200)
    expect(String(res.body ?? '')).not.toContain('PARENT-SECRET')
  })

  it('refuses "." as the plugin id', () => {
    expect(parsePluginRequestUrl('bbebee-plugin://./userdata-marker.txt')).toBeUndefined()
    expect(resolvePluginDir('.', installed)).toBeUndefined()
    expect(resolvePluginDir('..', installed)).toBeUndefined()
  })

  it('refuses dot segments inside a slashed id and backslash separators', () => {
    // A literal `..` segment in the path is already collapsed by the URL
    // parser itself; the spelling that reaches this code is the encoded
    // one, which only becomes a dot segment after decodeURIComponent.
    expect(parsePluginRequestUrl('bbebee-plugin://app/foo%2f..%2fbar/x.js')).toBeUndefined()
    expect(parsePluginRequestUrl('bbebee-plugin://app/%2e%2e%5csecret/x.js')).toBeUndefined()
    expect(resolvePluginDir('a/../b', installed)).toBeUndefined()
    expect(resolvePluginDir('a\\..\\b', installed)).toBeUndefined()
  })

  it('keeps scoped ids working (a single slash is a name, not a path)', () => {
    // `@scope/name` ids arrive percent-encoded as ONE path segment; the
    // decoded slash must not be mistaken for traversal.
    const parsed = parsePluginRequestUrl('bbebee-plugin://app/%40BBeBee%2Fplugin-x/dist/index.js')
    expect(parsed?.pluginId).toBe('@BBeBee/plugin-x')
  })

  it('does not leak a sibling file through an encoded traversal subpath', () => {
    const res = pm.handleBbebeePlugin(
      'bbebee-plugin://app/test-plugin-a/%2e%2e%2ftest-plugin-b%2fsecret.js',
    )
    expect(res.status).not.toBe(200)
    expect(String(res.body ?? '')).not.toContain('B-SECRET')
  })

  it('404s for a plugin that is not installed', () => {
    const res = pm.handleBbebeePlugin('bbebee-plugin://app/no-such-plugin/dist/index.js')
    expect(res.status).toBe(404)
  })
})
