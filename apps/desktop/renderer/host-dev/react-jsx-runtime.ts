/**
 * Dev-mode host shim for `react/jsx-runtime` — same pattern as react.ts.
 */
import * as def from 'react/jsx-runtime'

export default def
export const { Fragment, jsx, jsxs } = def as unknown as Record<string, unknown>
