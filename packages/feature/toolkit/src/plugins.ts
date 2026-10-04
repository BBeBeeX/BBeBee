/**
 * Pure utilities for plugin identifier normalization, dependency graph analysis,
 * fiber tree walking, and search filtering.
 */

/**
 * Strip leading `@BBeBee/` scope prefix from a plugin ID or package name.
 *
 * Example: `'@BBeBee/plugin-player'` -> `'plugin-player'`.
 */
export function normalizePluginId(id: string): string {
  return id.replace(/^@BBeBee\//, '').trim()
}

/**
 * Check if a candidate plugin identifier matches a target ID or name,
 * matching with or without scope prefix.
 */
export function matchesPluginId(candidate: string, targetId: string, targetName?: string): boolean {
  if (candidate === targetId) return true
  if (targetName && candidate === targetName) return true

  const normCandidate = normalizePluginId(candidate)
  const normTargetId = normalizePluginId(targetId)
  if (normCandidate === normTargetId) return true
  if (targetName && normCandidate === normalizePluginId(targetName)) return true

  return false
}

export interface PluginDependencyItem {
  id: string
  name?: string
  dependencies?: readonly string[]
}

/**
 * Compute reverse dependents for a collection of plugin dependency items.
 *
 * For each plugin, finds all other plugins in the list whose `dependencies`
 * declare a dependency on it (matching by full ID, name, or unscoped ID).
 *
 * Returns a Map of plugin ID to array of dependent plugin IDs.
 */
export function computeReverseDependents<T extends PluginDependencyItem>(
  items: readonly T[],
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const item of items) {
    result.set(item.id, [])
  }

  for (const item of items) {
    const pid = item.id
    const pname = item.name
    const dependents: string[] = []

    for (const other of items) {
      if (other.id === pid) continue
      const dependsOnP = (other.dependencies ?? []).some((dep) =>
        matchesPluginId(dep, pid, pname),
      )
      if (dependsOnP) {
        dependents.push(other.id)
      }
    }

    result.set(pid, dependents)
  }

  return result
}

export interface TreeFiberNode {
  name: string
  children?: readonly TreeFiberNode[]
}

/**
 * Flatten a fiber node tree into a Map keyed by fiber/plugin name,
 * excluding synthetic 'root' and 'anonymous' nodes.
 */
export function flattenFiberNodes<T extends TreeFiberNode>(
  root: T | null | undefined,
  map = new Map<string, T>(),
): Map<string, T> {
  if (!root) return map
  if (root.name && root.name !== 'root' && root.name !== 'anonymous') {
    map.set(root.name, root)
  }
  if (root.children) {
    for (const child of root.children) {
      flattenFiberNodes(child, map)
    }
  }
  return map
}

export interface SearchablePlugin {
  id: string
  name?: string
  displayName?: string
  moduleId?: string
}

/**
 * Case-insensitive substring search across plugin id, name, displayName, and moduleId.
 */
export function filterPlugins<T extends SearchablePlugin>(
  plugins: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...plugins]
  return plugins.filter((p) => {
    const matchId = p.id.toLowerCase().includes(q)
    const matchName = (p.name || '').toLowerCase().includes(q)
    const matchDisplay = (p.displayName || '').toLowerCase().includes(q)
    const matchModule = (p.moduleId || '').toLowerCase().includes(q)
    return matchId || matchName || matchDisplay || matchModule
  })
}
