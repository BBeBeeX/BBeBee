import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  analyzeChanges,
  findWorkspacePackages,
  resolveGitDiff,
  type WorkspacePackage,
} from './index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

describe('findWorkspacePackages', () => {
  it('discovers core workspace packages and apps', () => {
    const packages = findWorkspacePackages(root)
    const names = new Set(packages.map((p) => p.name))

    expect(names.has('@BBeBee/protocol')).toBe(true)
    expect(names.has('@BBeBee/kernel')).toBe(true)
    expect(names.has('@BBeBee/desktop')).toBe(true)
    expect(names.has('@BBeBee/mobile')).toBe(true)
    expect(names.has('@BBeBee/tooling-gen-plugins')).toBe(true)
  })

  it('correctly maps packages to their directory paths', () => {
    const packages = findWorkspacePackages(root)
    const protocol = packages.find((p) => p.name === '@BBeBee/protocol')
    const desktop = packages.find((p) => p.name === '@BBeBee/desktop')

    expect(protocol?.dir).toBe('packages/protocol')
    expect(desktop?.dir).toBe('apps/desktop')
  })
})

describe('analyzeChanges', () => {
  const mockPackages: WorkspacePackage[] = [
    {
      name: '@BBeBee/desktop',
      dir: 'apps/desktop',
      hasTypecheck: true,
      hasTest: true,
    },
    {
      name: '@BBeBee/protocol',
      dir: 'packages/protocol',
      hasTypecheck: true,
      hasTest: false,
    },
  ]

  it('maps changed files to the correct package', () => {
    const files = ['apps/desktop/main/index.ts', 'packages/protocol/src/index.ts']
    const result = analyzeChanges(root, files, mockPackages)

    expect(result.changedPackages.map((p) => p.name).sort()).toEqual([
      '@BBeBee/desktop',
      '@BBeBee/protocol',
    ])
    expect(result.typecheckPackages.map((p) => p.name).sort()).toEqual([
      '@BBeBee/desktop',
      '@BBeBee/protocol',
    ])
  })

  it('does not trigger package typecheck for non-code files like markdown', () => {
    const files = ['apps/desktop/README.md']
    const result = analyzeChanges(root, files, mockPackages)

    expect(result.changedPackages.map((p) => p.name)).toEqual(['@BBeBee/desktop'])
    expect(result.typecheckPackages).toEqual([])
    expect(result.hasCodeChanges).toBe(false)
  })

  it('detects root configuration file changes', () => {
    const files = [
      'tsconfig.base.json',
      'eslint.config.js',
      'vitest.config.ts',
    ]
    const result = analyzeChanges(root, files, mockPackages)

    expect(result.rootTypecheck).toBe(true)
    expect(result.rootLint).toBe(true)
    expect(result.rootTest).toBe(true)
  })

  it('identifies lintable files filtering out non-lintable and missing files', () => {
    // apps/desktop/renderer/main.tsx exists on disk; nonexistent/foo.ts does not
    const files = ['apps/desktop/renderer/main.tsx', 'nonexistent/foo.ts', 'README.md']
    const result = analyzeChanges(root, files, mockPackages)

    expect(result.lintFiles).toContain('apps/desktop/renderer/main.tsx')
    expect(result.lintFiles).not.toContain('nonexistent/foo.ts')
    expect(result.lintFiles).not.toContain('README.md')
  })
})

describe('resolveGitDiff', () => {
  it('returns diff result with base and string array of files', () => {
    const result = resolveGitDiff(root)
    expect(typeof result.base).toBe('string')
    expect(Array.isArray(result.files)).toBe(true)
    expect(typeof result.isClean).toBe('boolean')
  })

  it('honors an explicit since base', () => {
    const result = resolveGitDiff(root, 'HEAD')
    expect(result.base).toBe('HEAD')
  })
})
