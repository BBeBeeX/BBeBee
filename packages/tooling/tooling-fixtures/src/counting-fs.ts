/**
 * An instrumented `ctx.fs`.
 *
 * M1's first exit criterion is not "a rescan is fast" but "an incremental
 * rescan of an unchanged library costs **stat calls only**" (docs/10 §M1).
 * That is a claim about which methods were called, and the only way to check
 * it is to count them — a timing assertion would pass on a fast disk with a
 * scanner that reads every byte.
 *
 * The methods are patched **on the service instance**, not wrapped in a new
 * object. A cordis service is one instance shared by every fiber, and each
 * fiber reaches it through its own scoped `Context`; replacing `ctx.fs` on the
 * root context leaves every plugin still talking to the original, so a wrapper
 * would count nothing and quietly report success. Patching the instance is
 * what makes the count cover the scanner *and* the codec reading through it.
 *
 * Dev-only. Nothing here is bundled into either shell.
 */

import type { FsService, Uri } from '@BBeBee/protocol'

/** Every method worth counting. `join`/`basename`/`extname` are pure string work. */
export type CountedMethod =
  | 'dir'
  | 'exists'
  | 'stat'
  | 'list'
  | 'mkdir'
  | 'remove'
  | 'move'
  | 'copy'
  | 'readFile'
  | 'readBytes'
  | 'readRange'
  | 'writeFile'
  | 'createReadStream'
  | 'createWriteStream'
  | 'freeSpace'
  | 'watch'
  | 'pickDirectory'
  | 'toPlayableUri'

export type FsCounts = Record<CountedMethod, number>

export interface CountingFs {
  /** The same service that was passed in, now counting. */
  fs: FsService
  counts: FsCounts
  /** Uris passed to each counted method, in order. For diagnosing a failure. */
  calls: { method: CountedMethod; uri?: Uri }[]
  reset(): void
  /** Everything read *from*, by any means. The list criterion 1 asserts is empty. */
  bytesReadFrom(): Uri[]
  /** Put the original methods back. */
  restore(): void
}

const COUNTED: CountedMethod[] = [
  'dir', 'exists', 'stat', 'list', 'mkdir', 'remove', 'move', 'copy',
  'readFile', 'readBytes', 'readRange', 'writeFile', 'createReadStream', 'createWriteStream',
  'freeSpace', 'watch', 'pickDirectory', 'toPlayableUri',
]

/** Methods that open a file's contents, as opposed to its metadata. */
const READS_CONTENT = new Set<CountedMethod>(['readFile', 'readBytes', 'readRange', 'createReadStream'])

export function countingFs(fs: FsService): CountingFs {
  const counts = Object.fromEntries(COUNTED.map((m) => [m, 0])) as FsCounts
  const calls: CountingFs['calls'] = []
  const originals = new Map<CountedMethod, unknown>()

  for (const method of COUNTED) {
    const target = fs as unknown as Record<string, unknown>
    const original = target[method]
    if (typeof original !== 'function') continue
    // Whether the method was the instance's own or the prototype's decides how
    // `restore` undoes this: assigning the prototype's function back would
    // leave an own property shadowing it forever, which is a different object
    // graph from the one we were handed.
    originals.set(method, Object.hasOwn(target, method) ? original : undefined)
    target[method] = function counted(this: unknown, ...args: unknown[]) {
      counts[method] += 1
      calls.push({ method, ...(typeof args[0] === 'string' ? { uri: args[0] as Uri } : {}) })
      return (original as (...a: unknown[]) => unknown).apply(this, args)
    }
  }

  return {
    fs,
    counts,
    calls,
    reset() {
      for (const method of COUNTED) counts[method] = 0
      calls.length = 0
    },
    bytesReadFrom() {
      return calls
        .filter((call) => READS_CONTENT.has(call.method) && call.uri)
        .map((call) => call.uri!)
    },
    restore() {
      const target = fs as unknown as Record<string, unknown>
      for (const [method, original] of originals) {
        if (original === undefined) delete target[method]
        else target[method] = original
      }
      originals.clear()
    },
  }
}
