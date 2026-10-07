/**
 * The view ids `plugin-registry` contributes.
 *
 * Shared by the desktop view package so a descriptor and the component
 * filling it cannot drift apart (docs/08 §3). The headless package
 * contributes the descriptors; `plugin-registry-ui-desktop` fills them.
 */
export const REGISTRY_VIEWS = {
  /** The registry screen: browse the community index, install and update. */
  screen: 'registry.screen',
  /** The settings card: auto-check toggle, manual check, update list. */
  settingsCard: 'registry.settings-card',
} as const
