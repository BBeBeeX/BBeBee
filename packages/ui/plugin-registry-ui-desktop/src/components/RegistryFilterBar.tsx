/**
 * The Discover page's filter bar: search, the third-party toggle, the sort
 * controls, and the plugin-only category filter.
 *
 * Presentational only — every value arrives as a prop and every change leaves
 * through a callback; the screen owns the view state (it filters, sorts and
 * feeds the repo-stats hook itself).
 *
 * Layout: the search box takes the elastic width of the row; the browsing
 * controls sit grouped to its right and the whole row wraps without breaking
 * (each control stays intact, the search just gets narrower first). The
 * toggle and the two dropdowns are drawn in the same pill language as the
 * tabs (`PillSelect` is a native `<select>` under the pill chrome — same
 * value/options/onChange contract as the kit's `Select`).
 */

import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'
import { PILL_BASE, tabPill } from '../styles.js'

/** What the list can be ordered by. */
export type RegistrySortKey = 'name' | 'stars' | 'downloads' | 'contributors'
/** `asc` reads top-down; numeric keys default to biggest-first. */
export type RegistrySortDir = 'asc' | 'desc'

/** The direction a sort key starts in — names A→Z, counts high→low. */
export const DEFAULT_SORT_DIR: Record<RegistrySortKey, RegistrySortDir> = {
  name: 'asc',
  stars: 'desc',
  downloads: 'desc',
  contributors: 'desc',
}

/** Known plugin category slugs → English labels; unknown slugs render verbatim. */
const CATEGORY_LABELS: Record<string, string> = {
  'ui-enhancement': 'UI enhancement',
  'notifications-integration': 'Notifications integration',
  'development-runtime': 'Development runtime',
  'security-permissions': 'Security & permissions',
  'remote-mobile': 'Remote & mobile',
  'marketplace-management': 'Marketplace management',
  other: 'Other',
}

export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug
}

const barStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
} as const

/** The search box owns the row's elastic width; it narrows before wrapping. */
const searchWrapStyle = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  flex: '1 1 220px',
  minWidth: 200,
  maxWidth: 480,
} as const

const searchIconStyle = {
  position: 'absolute',
  left: 12,
  display: 'inline-flex',
  pointerEvents: 'none',
  color: 'var(--text-tertiary, #8B95B0)',
} as const

const searchInputStyle = {
  width: '100%',
  padding: '7px 14px 7px 34px',
  borderRadius: 999,
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
  background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
  color: 'var(--text-primary, #F5F7FF)',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
} as const

/** The browsing controls form one group with the tabs' 8px rhythm. */
const controlGroupStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
} as const

const selectWrapStyle = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
} as const

const selectElStyle = {
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
  borderRadius: 999,
  padding: '6px 30px 6px 14px',
  color: 'var(--text-primary, #F5F7FF)',
  fontSize: 13,
  cursor: 'pointer',
  outline: 'none',
} as const

/**
 * The kit `Select` redrawn in the pill family: a native `<select>` (same
 * value / options / onChange contract the tests exercise) under pill chrome,
 * with the kit's chevron and the shared hover/focus ring from `BASELINE_CSS`.
 */
function PillSelect<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  accessibilityLabel: string
}): ReactElement {
  return h(
    'div',
    { className: 'bbreg-select', style: selectWrapStyle },
    h(
      'select',
      {
        value,
        'aria-label': accessibilityLabel,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value as T),
        style: selectElStyle,
      },
      options.map((opt) => h('option', { key: opt.value, value: opt.value }, opt.label)),
    ),
    tablerIcon('chevron-down', {
      size: 14,
      style: { position: 'absolute', right: 10, pointerEvents: 'none', color: 'var(--text-tertiary, #8B95B0)' },
    }),
  )
}

/**
 * `PillSelect` pinned to the sort-key union: through `createElement` the
 * generic component widens to `string` and the narrow `onChange` stops
 * checking — the same cast the kit `Select` needed.
 */
const SortPillSelect = PillSelect as unknown as (props: {
  value: RegistrySortKey
  options: readonly { value: RegistrySortKey; label: string }[]
  onChange: (value: RegistrySortKey) => void
  accessibilityLabel: string
}) => ReactElement

export interface RegistryFilterBarProps {
  /** The app context — read for the interface language via `useI18n`. */
  ctx: Context
  query: string
  onQueryChange: (query: string) => void
  /** The third-party toggle's checked state (default true: everything shows). */
  showThirdParty: boolean
  onShowThirdPartyChange: (show: boolean) => void
  sortBy: RegistrySortKey
  onSortByChange: (key: RegistrySortKey) => void
  sortDir: RegistrySortDir
  onSortDirChange: (dir: RegistrySortDir) => void
  /** Category slug or `'all'`; rendered only while `showCategoryFilter`. */
  category: string
  onCategoryChange: (slug: string) => void
  /** Distinct category slugs of the current plugin entries, display-ready order. */
  categories: readonly string[]
  showCategoryFilter: boolean
  /** Whether the third-party toggle renders. Defaults to true when showBrowseControls is true. */
  showThirdPartyFilter?: boolean
  /**
   * Whether the browsing controls (third-party toggle, sort key, sort
   * direction) render at all. The favorites and installed tabs pass `false`:
   * those lists are curated, not browsed, so only the search box stays and it
   * filters whatever is on screen.
   */
  showBrowseControls?: boolean
}

export function RegistryFilterBar({
  ctx,
  query,
  onQueryChange,
  showThirdParty,
  onShowThirdPartyChange,
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
  category,
  onCategoryChange,
  categories,
  showCategoryFilter,
  showThirdPartyFilter,
  showBrowseControls = true,
}: RegistryFilterBarProps): ReactElement {
  const { t } = useI18n(ctx)
  const renderThirdParty = (showThirdPartyFilter ?? true) && showBrowseControls
  return h(
    'div',
    { style: barStyle, 'data-testid': 'registry-filter-bar' },
    h(
      'div',
      { style: searchWrapStyle },
      h('span', { style: searchIconStyle }, tablerIcon('search', { size: 14 })),
      h('input', {
        type: 'text',
        'data-testid': 'registry-search',
        className: 'bbreg-input',
        placeholder: t('registry:filter.searchPlaceholder'),
        value: query,
        onChange: (e: { target: { value: string } }) => onQueryChange(e.target.value),
        style: searchInputStyle,
      }),
    ),
    // The browsing controls, grouped: toggle → sort → direction → category.
    showBrowseControls || showCategoryFilter
      ? h(
          'div',
          { style: controlGroupStyle },
          // The toggle reads as its checked state: ON means third-party content shows.
          renderThirdParty
            ? h(
                'button',
                {
                  type: 'button',
                  'data-testid': 'registry-official-toggle',
                  'aria-pressed': showThirdParty,
                  title: t('registry:filter.showThirdPartyHint'),
                  onClick: () => onShowThirdPartyChange(!showThirdParty),
                  className: 'bbreg-btn bbreg-btn-ghost',
                  style: tabPill(showThirdParty),
                },
                showThirdParty ? tablerIcon('check', { size: 14 }) : null,
                t('registry:filter.showThirdParty'),
              )
            : null,
          showBrowseControls
            ? h(
                'span',
                { 'data-testid': 'registry-sort', style: { display: 'inline-flex' } },
                h(SortPillSelect, {
                  value: sortBy,
                  options: [
                    { value: 'name', label: t('registry:filter.sortByName') },
                    { value: 'stars', label: t('registry:filter.sortByStars') },
                    { value: 'downloads', label: t('registry:filter.sortByDownloads') },
                    { value: 'contributors', label: t('registry:filter.sortByContributors') },
                  ],
                  onChange: onSortByChange,
                  accessibilityLabel: t('registry:filter.sortBy'),
                }),
              )
            : null,
          showBrowseControls
            ? h(
                'button',
                {
                  type: 'button',
                  'data-testid': 'registry-sort-direction',
                  'data-dir': sortDir,
                  title: t('registry:filter.toggleSortDirection'),
                  onClick: () => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc'),
                  className: 'bbreg-btn bbreg-btn-ghost',
                  style: {
                    ...PILL_BASE,
                    background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
                    borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.12))',
                    color: 'var(--text-primary, #F5F7FF)',
                  },
                },
                tablerIcon('arrows-sort', { size: 14 }),
                sortDir === 'asc' ? t('registry:filter.ascending') : t('registry:filter.descending'),
              )
            : null,
          showCategoryFilter
            ? h(
                'span',
                { 'data-testid': 'registry-category-filter', style: { display: 'inline-flex' } },
                h(PillSelect, {
                  value: category,
                  options: [
                    { value: 'all', label: t('registry:filter.allCategories') },
                    ...categories.map((slug) => ({ value: slug, label: categoryLabel(slug) })),
                  ],
                  onChange: onCategoryChange,
                  accessibilityLabel: t('registry:filter.categoryFilter'),
                }),
              )
            : null,
        )
      : null,
  )
}
