export type SettingsTab = string

export interface TabItem {
  id: SettingsTab
  label: string
}

export const TABS: readonly TabItem[] = [
  { id: 'general', label: 'General & language' },
  { id: 'playback', label: 'Playback & Audio' },
  { id: 'lyrics', label: 'Desktop lyrics' },
  { id: 'shortcuts', label: 'Global shortcuts' },
  { id: 'network', label: 'Network & proxy' },
  { id: 'sources', label: 'Library & sources' },
  { id: 'storage', label: 'Storage & cache' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'about', label: 'About' },
]
