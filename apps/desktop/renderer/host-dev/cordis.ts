/**
 * Dev-mode host shim for `cordis`. Unlike the React family, this entry is ESM,
 * so a verbatim re-export is exact by construction — and, like the CJS shims,
 * going through a Vite-transformed source file resolves the bare specifier to
 * the same dep instance the app uses.
 */
export * from 'cordis'
