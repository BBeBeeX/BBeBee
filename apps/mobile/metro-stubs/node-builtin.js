/**
 * Stand-in for Node builtins under Metro.
 *
 * `core-codec-node` (inherited whole by `core-codec-rn`) carries sidecar-only
 * paths — the artwork worker pool, ffmpeg probing — whose `node:*` imports
 * are guarded at runtime (`typeof process.versions?.node`, try/catch with an
 * in-process fallback), and whose optional `iconv-lite` GBK recovery transitively
 * requires the `buffer` npm package (Node-only, guarded the same way: the
 * load sits in try/catch and recovery is skipped without it). Metro resolves
 * dynamic imports statically, so those specifiers must resolve *something*
 * on mobile for the bundle to exist at all; the same bargain the root vitest
 * config strikes, and with the same failure mode on purpose: touching the
 * stub is a loud platform error, never a silent fake, so guarded code falls
 * back instead of pretending.
 */

module.exports = new Proxy(
  {},
  {
    get() {
      throw new Error('node: builtin is not available on mobile — the caller was expected to guard this')
    },
  },
)
