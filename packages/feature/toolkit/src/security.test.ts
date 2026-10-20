import { describe, expect, it } from 'vitest'
import { isScannableFile, manifestEntryFiles, scanCode, shouldScanFile } from './security.js'

describe('scanCode: data:/blob: dynamic imports (audit W2, sample S1)', () => {
  it('blocks a literal data: dynamic import', () => {
    const report = scanCode(`import('data:text/javascript;base64,YWxlcnQoMSk=')`)
    expect(report.level).toBe('block')
    expect(report.findings.some((f) => f.ruleId === 'data-blob-dynamic-import')).toBe(true)
  })

  it('blocks a literal blob: dynamic import, any quote style', () => {
    for (const code of [
      `import("blob:https://example.com/9d8f")`,
      'import(`blob:null/550e8400`)',
      `import ( 'data:text/plain,hello' )`,
    ]) {
      const report = scanCode(code)
      expect(report.level).toBe('block')
      expect(report.findings.some((f) => f.ruleId === 'data-blob-dynamic-import')).toBe(true)
    }
  })

  it('still passes benign module code', () => {
    const code = [
      `import { helper } from './helper.js'`,
      `export const name = 'benign'`,
      `export async function load() { return import('./lazy.js') }`,
    ].join('\n')
    expect(scanCode(code).level).toBe('pass')
  })

  it('still passes a declared-host fetch (the legitimate-sample shape)', () => {
    const report = scanCode(`export const x = await fetch('https://api.example.com/v1')`, {
      allowedHosts: ['api.example.com'],
    })
    expect(report.level).toBe('pass')
  })
})

describe('scan file selection (audit W2)', () => {
  it('covers every executable-text extension', () => {
    for (const p of ['a.js', 'a.ts', 'a.mjs', 'a.cjs', 'a.jsx', 'a.tsx', 'dist/Deep.JS', 'dist/x.MJS']) {
      expect(isScannableFile(p)).toBe(true)
    }
    for (const p of ['a.json', 'a.css', 'a.md', 'a.wasm', 'a.png', 'Makefile']) {
      expect(isScannableFile(p)).toBe(false)
    }
  })

  it('extracts manifest entry files as package-relative paths, deduped', () => {
    expect(
      manifestEntryFiles({
        main: './dist/index.js',
        ui: { desktop: './dist/ui.js', mobile: '/dist/ui-mobile.js' },
      }),
    ).toEqual(['dist/index.js', 'dist/ui-mobile.js', 'dist/ui.js'])
    expect(manifestEntryFiles({ main: './dist/index.js', ui: { desktop: './dist/index.js' } })).toEqual([
      'dist/index.js',
    ])
    expect(manifestEntryFiles(undefined)).toEqual([])
    expect(manifestEntryFiles({})).toEqual([])
  })

  it('scans a manifest entry file whatever its extension', () => {
    const entries = manifestEntryFiles({ main: './boot.txt' })
    expect(shouldScanFile('boot.txt', entries)).toBe(true)
    expect(shouldScanFile('boot.txt')).toBe(false)
    expect(shouldScanFile('dist/other.txt', entries)).toBe(false)
  })
})
