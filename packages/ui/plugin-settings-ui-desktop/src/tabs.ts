export type SettingsTab = string

export interface TabItem {
  id: SettingsTab
  label: string
  /**
   * A contributed tab's *existence* comes from the live settings
   * contributions — the owning plugin contributes the section's card, and
   * disabling the plugin removes the tab with it. The entry here only pins
   * its position among the static tabs and its fallback label. Tabs without
   * this flag render their own hardcoded section components and are always
   * present.
   */
  contributed?: boolean
}

export const TABS: readonly TabItem[] = [
  { id: 'general', label: 'General & language' },
  { id: 'playback', label: 'Playback & Audio' },
  { id: 'lyrics', label: 'Desktop lyrics', contributed: true },
  { id: 'shortcuts', label: 'Global shortcuts', contributed: true },
  { id: 'network', label: 'Network & proxy' },
  { id: 'sources', label: 'Library & sources' },
  { id: 'storage', label: 'Storage & cache' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'about', label: 'About' },
]
