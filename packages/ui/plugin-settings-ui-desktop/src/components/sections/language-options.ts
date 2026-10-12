export interface LanguageOption {
  value: 'zh' | 'en' | 'system'
  label: string
}

export function getLanguageOptions(t: (k: string) => string): readonly LanguageOption[] {
  return [
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'English' },
    { value: 'system', label: t('settings:index.followSystem') },
  ]
}
