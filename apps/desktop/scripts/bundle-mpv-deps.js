#!/usr/bin/env node
/**
 * Copy the transitive dynamic-library closure of libmpv next to the staged
 * copy, so a machine without the system libmpv runtime can still load it.
 *
 * Denylist, not allowlist, on purpose: the engine dlopens libmpv with
 * RTLD_NOW, which resolves EVERY dependency up front — video stacks included,
 * even though the engine runs `video=no`. One missing soname fails the whole
 * dlopen and the engine drops to its no-mpv fallback, where playback still
 * works (Chromium media element) but the visualizer and native device
 * switching are dead — the "mpv 模式下可视化和切换输出设备无效" report. An
 * allowlist of media libraries cannot express that closure; a denylist of
 * the glibc core can. Shipping a private libc would be actively dangerous,
 * and libstdc++/libgcc_s exist on any distro that can start Electron, so
 * those are the only exclusions.
 */
import { existsSync, copyFileSync, lstatSync, readlinkSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import console from 'node:console'

const EXCLUDED_SONAMES = [
  'linux-vdso',
  'ld-linux',
  'libc.so',
  'libm.so',
  'libpthread',
  'libdl.so',
  'librt.so',
  'libresolv',
  'libgcc_s',
  'libstdc++',
]

function resolveSymlinks(path) {
  let current = path
  while (lstatSync(current).isSymbolicLink()) {
    current = resolve(dirname(current), readlinkSync(current))
  }
  return current
}

/**
 * Stage every transitive dependency of `libmpvPath` into `targetDir`.
 * Idempotent: sonames already present in the target are skipped, so a
 * re-run after a system upgrade only fills gaps.
 *
 * ldd runs with `LD_LIBRARY_PATH=targetDir` so sonames already staged there
 * (the vendored helper libs resolve relatively and would otherwise read as
 * "not found") resolve against the staged copies rather than the build
 * machine's system directories.
 *
 * @returns {number} how many libraries were newly copied
 */
export function bundleMpvDeps(libmpvPath, targetDir) {
  if (process.platform !== 'linux' || !existsSync(libmpvPath)) return 0

  const result = spawnSync('ldd', [libmpvPath], {
    encoding: 'utf-8',
    env: { ...process.env, LD_LIBRARY_PATH: targetDir },
  })
  if (result.status !== 0 || !result.stdout) {
    console.warn(`[bundle-mpv-deps] ldd failed for ${libmpvPath} — dependencies not staged`)
    return 0
  }

  let staged = 0
  const seen = new Set()
  for (const line of result.stdout.split('\n')) {
    // "libfoo.so.1 => /path/libfoo.so.1 (0x…)" — or "=> not found", which is
    // exactly the condition that breaks dlopen on a clean target machine.
    const match = /^(.+?)\s+=>\s+(.+?)(?:\s+\(0x[0-9a-f]+\))?$/.exec(line.trim())
    if (!match) continue
    const soname = match[1].trim()
    const location = match[2].trim()
    const stagedCopy = join(targetDir, soname)
    if (location === 'not found') {
      // Already staged beside the binary? Then the clean machine is covered.
      if (!existsSync(stagedCopy)) {
        console.warn(
          `[bundle-mpv-deps] WARNING: ${soname} is missing on this build machine — ` +
            'the packaged engine will fail to load libmpv on clean targets',
        )
      }
      continue
    }
    const path = location.split(' ')[0]
    if (!path || seen.has(soname)) continue
    seen.add(soname)
    if (EXCLUDED_SONAMES.some((prefix) => soname.startsWith(prefix))) continue
    // A bare soname resolves against LD_LIBRARY_PATH — already staged.
    if (!path.includes('/') || existsSync(stagedCopy)) continue
    if (!existsSync(path)) continue
    try {
      copyFileSync(resolveSymlinks(path), stagedCopy)
      staged++
    } catch (err) {
      console.warn(`[bundle-mpv-deps] failed to copy ${path}: ${err}`)
    }
  }
  console.log(`[bundle-mpv-deps] staged ${staged} dependencies -> ${targetDir}`)
  return staged
}
