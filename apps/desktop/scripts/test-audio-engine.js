#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import console from 'node:console'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = join(__dirname, '..')
const binDir = join(desktopRoot, 'bin')
const srcDir = join(desktopRoot, 'native', 'audio-engine')

const runSupervisor = !process.argv.includes('--native-only')
const runNative = !process.argv.includes('--supervisor-only')

if (runNative) {
  const testSrcFiles = [
    join(srcDir, 'tests', 'test_pcm_tap.cpp'),
    join(srcDir, 'pcm_ring_buffer.cpp'),
  ]

  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true })
  }

  const isWin = process.platform === 'win32'
  const testExe = join(binDir, isWin ? 'audio-engine-tests.exe' : 'audio-engine-tests')

  console.log(`[test-audio-engine] Compiling audio-engine test suite...`)
  console.log(`  Sources: ${testSrcFiles.join(', ')}`)
  console.log(`  Target: ${testExe}`)

  const compilers = isWin ? ['g++', 'clang++', 'cl'] : ['g++', 'clang++']
  let chosenCompiler = null

  for (const c of compilers) {
    const check = spawnSync(c, ['--version'], { stdio: 'ignore' })
    if (check.status === 0 || check.error === undefined) {
      chosenCompiler = c
      break
    }
  }

  if (!chosenCompiler) {
    console.error('[test-audio-engine] Error: No suitable C++17 compiler found.')
    process.exit(1)
  }

  const unixFlags = ['-pthread', '-ldl']
  const args = chosenCompiler === 'cl'
    ? ['/std:c++17', '/O2', '/EHsc', '/W4', '/utf-8', ...testSrcFiles, `/Fe:${testExe}`]
    : ['-Wall', '-Wextra', '-O2', '-std=c++17', ...testSrcFiles, '-o', testExe, ...unixFlags]

  console.log(`[test-audio-engine] Building: ${chosenCompiler} ${args.join(' ')}`)
  const buildProc = spawnSync(chosenCompiler, args, { stdio: 'inherit' })
  if (buildProc.status !== 0) {
    console.error(`[test-audio-engine] Test compilation failed`)
    process.exit(buildProc.status || 1)
  }

  console.log(`[test-audio-engine] Running native test suite...`)
  const runProc = spawnSync(testExe, [], { stdio: 'inherit' })
  if (runProc.status !== 0) {
    console.error(`[test-audio-engine] Test execution failed with exit code ${runProc.status}`)
    process.exit(runProc.status || 1)
  }

  console.log(`[test-audio-engine] All audio-engine native tests passed successfully!`)
}

if (runSupervisor) {
  console.log(`\n[test-audio-engine] Running AudioEngineSupervisor IPC integration tests...`)
  const rootDir = join(desktopRoot, '..', '..')
  const isWin = process.platform === 'win32'
  const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm'
  const vitestProc = spawnSync(
    pnpmCmd,
    ['exec', 'vitest', 'run', 'apps/desktop/main/audio/audio-engine-supervisor.test.ts'],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        TEST_AUDIO_ENGINE: '1',
      },
    },
  )
  if (vitestProc.status !== 0) {
    console.error(`[test-audio-engine] AudioEngineSupervisor tests failed with exit code ${vitestProc.status}`)
    process.exit(vitestProc.status || 1)
  }
}

console.log(`\n[test-audio-engine] All audio-engine tests completed successfully!`)
