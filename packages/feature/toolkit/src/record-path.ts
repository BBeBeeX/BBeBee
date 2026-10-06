/**
 * Dot-path access into plain config records.
 *
 * Settings contributions address values by dot path (`proxy.host`,
 * `desktopLyrics.fontSize`); these two helpers are the read and write ends of
 * that convention. Pure — the settings UI renders on both React DOM and
 * React Native from the same logic.
 */

/** Reads a dot path ('a.b.c') from a plain record; undefined when missing. */
export function getPath(record: unknown, path: string): unknown {
  if (!path) return undefined
  let cursor: unknown = record
  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/**
 * Returns a shallow-patched copy of `record` with `value` written at dot path
 * `path`, creating the intermediate levels. One level per segment — a field
 * is a leaf, so existing nested objects at the leaf are replaced, not merged.
 */
export function setPath<T extends Record<string, unknown>>(
  record: T,
  path: string,
  value: unknown,
): T {
  const [head, ...rest] = path.split('.')
  if (!head) return { ...record }
  if (rest.length === 0) {
    return { ...record, [head]: value }
  }
  const nested = (typeof record[head] === 'object' && record[head] !== null
    ? (record[head] as Record<string, unknown>)
    : {}) as Record<string, unknown>
  return { ...record, [head]: setPath(nested, rest.join('.'), value) }
}
