/**
 * Dev-mode host shim for `react/jsx-dev-runtime` — same pattern as react.ts.
 */
import * as def from 'react/jsx-dev-runtime'

export default def
export const { Fragment, jsxDEV } = def as unknown as Record<string, unknown>
