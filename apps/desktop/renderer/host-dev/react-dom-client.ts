/**
 * Dev-mode host shim for `react-dom/client` — same pattern as react.ts.
 */
import * as def from 'react-dom/client'

export default def
export const { createRoot, hydrateRoot, version } = def as unknown as Record<string, unknown>
