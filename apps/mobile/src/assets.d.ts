/**
 * Static asset imports for the mobile shell.
 *
 * Metro resolves these at bundle time; TypeScript needs the module shapes
 * declared, and `types: ["node"]` in tsconfig brings no image declarations
 * with it.
 */

declare module '*.png' {
  const value: number
  export default value
}
