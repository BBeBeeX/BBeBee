/**
 * `ctx.ui` — the contribution registry.
 *
 * Plugins register renderer-agnostic *descriptors*; each shell resolves them
 * against its own component set. This is what lets one headless plugin serve
 * a React Native shell and a React DOM shell. See docs/08-ui-architecture.md.
 */


// Pulls `cordis` into the program so the `declare module` augmentation below
// resolves. Erased at build time; this adds no runtime import.
import type {} from 'cordis'
import type { Disposable } from '../common.js'
import type { ParamSchema } from './audio.js'

/** Well-known extension points. Both shells implement the same set. */
export type SlotId =
  | 'now-playing.actions'
  | 'now-playing.panel'
  | 'now-playing.visualizer'
  | 'track.context-menu'
  | 'album.context-menu'
  | 'library.sidebar'
  | 'search.results-section'
  | 'settings.sources'
  | 'source.browse'
  | 'topbar.tray'
  /** Desktop only; ignored on mobile. */
  | 'status-bar'

export interface SlotContext {
  [key: string]: unknown
}

export interface RouteContribution {
  kind: 'route'
  id: string
  path: string
  /** i18n key. */
  title: string
  icon?: string
  placement?: ('sidebar' | 'tab-bar' | 'more-menu' | 'tray')[]
  order?: number
}

export interface SlotContribution {
  kind: 'slot'
  id: string
  slot: SlotId
  order?: number
  /** Runs during render — must be synchronous and cheap. */
  when?: (ctx: SlotContext) => boolean
}

export interface CommandContribution {
  kind: 'command'
  id: string
  title: string
  icon?: string
  /** Desktop only; ignored on mobile. */
  defaultKeybinding?: string
  run(args?: unknown): void | Promise<void>
}

/** One option of a `select` settings field. */
export interface SettingsFieldOption {
  value: string | number
  label: string
}

/** Result reported back by an `action` field, shown as inline feedback. */
export interface SettingsFieldOutcome {
  ok: boolean
  message: string
}

/**
 * One renderable field of a schema-driven settings contribution.
 *
 * Simple key/value configuration is declared as data — the settings screen
 * renders a generic form from these descriptors and never receives a
 * hand-written form component per plugin (docs/08 §3). Values are read from
 * and written back to the settings document by dot path (e.g.
 * `desktopLyrics.fontSize`), unless the contribution overrides the read with
 * `getValues` or the write with `onFieldChange`.
 */
export interface SettingsFieldDescriptor {
  /** Dot path of the value within the config document (e.g. 'proxy.host'). */
  key: string
  /** Row label. */
  label: string
  /** Row description line. */
  description?: string
  /** Control to render. Unknown types fall back to `text`. */
  type:
    | 'switch'
    | 'select'
    | 'slider'
    | 'text'
    | 'number'
    | 'color'
    | 'directory'
    | 'action'
    | 'switch-list'
  /** Options for `select`. */
  options?: readonly SettingsFieldOption[]
  /**
   * Async options for `select` whose choices are dynamic (e.g. output
   * devices). Resolved once per mount and again whenever any of the
   * contribution's `refreshEvents` fires.
   */
  optionsAsync?: () => Promise<readonly SettingsFieldOption[]>
  /** Entries for `switch-list` — one boolean switch per entry, dynamic. */
  entriesAsync?: () => Promise<readonly { id: string; label: string; description?: string }[]>
  /**
   * Dynamically computed note rendered under the row (engine degradation
   * notices, usage sizes). Re-resolved on `refreshEvents`.
   */
  noteAsync?: () => Promise<string | undefined>
  /** Slider bounds (`slider`). */
  min?: number
  max?: number
  step?: number
  /** Value unit suffix (`slider`, e.g. 'px', '秒'). */
  unit?: string
  /** Placeholder for text-like controls. */
  placeholder?: string
  /** Button label (`action`, `directory`). */
  actionText?: string
  /** Handler for `action` fields; a returned outcome is shown as feedback. */
  onAction?: () => SettingsFieldOutcome | void | Promise<SettingsFieldOutcome | void>
  /**
   * Sync, cheap visibility predicate evaluated during render — same contract
   * as slot `when`. Hides the field when it returns false (e.g. a directory
   * picker that needs a native bridge this platform does not have).
   */
  when?: () => boolean
}

export interface SettingsContribution {
  kind?: 'settings'
  id: string
  /**
   * Target section/category tab in the settings screen.
   * Standard sections: 'general', 'playback', 'audio', 'sources', 'storage', 'about', or any custom section id.
   */
  section: 'general' | 'playback' | 'audio' | 'sources' | 'storage' | 'about' | (string & {})
  title: string
  /** Detailed description or explanation. */
  description?: string
  /** Sort order within the section (lower values appear first). */
  order?: number
  /** Icon name from the shared icon set. */
  icon?: string
  /** Text for the action button when rendered as a link row (e.g. '打开', '管理', '配置'). */
  actionText?: string
  /**
   * Presentation type:
   * - 'link': rendered as a SettingsRow with an action button that navigates to `id`.
   * - 'card': rendered inline as a card/section embedding `ui.viewFor(id)`.
   * - 'auto': embeds if a custom component is registered, otherwise renders as a navigation row.
   */
  display?: 'card' | 'link' | 'auto'
  /** Optional custom action when the button is clicked, overriding default navigate(id). */
  action?: () => void | Promise<void>
  /** Rendered automatically unless a custom view is registered. */
  schema?: ParamSchema
  /**
   * Field descriptors for a generic, auto-rendered form — the data-driven
   * alternative to shipping a custom card view. Values default to the
   * settings document by dot path; see SettingsFieldDescriptor.
   */
  fields?: readonly SettingsFieldDescriptor[]
  /**
   * Read override for field values — for plugins whose configuration lives
   * outside the settings document. Returns a record keyed by field dot path.
   */
  getValues?: () => Record<string, unknown>
  /** Write override for field values, replacing the default settings update. */
  onFieldChange?: (key: string, value: unknown) => void | Promise<void>
  /**
   * Events that make the contribution's async field data (optionsAsync,
   * entriesAsync, noteAsync) re-resolve while the settings screen shows it.
   */
  refreshEvents?: readonly string[]
}

export interface MenuContribution {
  kind: 'menu'
  id: string
  /** Desktop menu bar. Mobile maps these into the more-menu. */
  menu: 'file' | 'edit' | 'view' | 'playback' | 'help'
  title: string
  /** Menus never carry logic — they run a command. */
  command: string
  order?: number
  checked?: () => boolean
}

export interface TrayContribution {
  kind?: 'tray'
  id: string
  title: string
  icon?: string
  targetRoute?: string
  order?: number
  when?: (ctx: SlotContext) => boolean
  action?: () => void | Promise<void>
}

export type Contribution =
  | RouteContribution
  | SlotContribution
  | CommandContribution
  | SettingsContribution
  | MenuContribution
  | TrayContribution

export interface UiService {
  contribute(c: Contribution): Disposable
  /**
   * Bind a view id to a component.
   *
   * Typed as `unknown` deliberately: `@BBeBee/protocol` must not depend on
   * `react`, `react-native`, or `react-dom`, since headless plugins import it
   * in contexts with no React at all. Shells cast once, at the boundary.
   */
  registerView(id: string, component: unknown): Disposable

  navigate(id: string, params?: Record<string, unknown>): void

  readonly routes: readonly RouteContribution[]
  slotsFor(slot: SlotId): readonly SlotContribution[]
  readonly commands: readonly CommandContribution[]
  readonly menus: readonly MenuContribution[]
  readonly settings: readonly SettingsContribution[]
  readonly tray: readonly TrayContribution[]
  runCommand(id: string, args?: unknown): Promise<void>
  viewFor(id: string): unknown | undefined

  /**
   * Contributed ids with no view bound on this target.
   *
   * A direct consequence of ADR-2: a plugin may ship a desktop view and no
   * mobile one, and that is a normal state rather than an error. Shells use
   * this to say so out loud instead of rendering a silent blank.
   */
  missingViews(): string[]
}

declare module 'cordis' {
  interface Context {
    ui: UiService
  }
}
