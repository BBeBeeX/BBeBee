import { BUILT_IN_CATALOGUES } from '@BBeBee/plugin-i18n'

export function renderBootErrorMessage(error: string): string {
  const isZh =
    typeof navigator !== 'undefined' && navigator.language
      ? /^zh\b/i.test(navigator.language)
      : typeof Intl !== 'undefined' && /^zh\b/i.test(Intl.DateTimeFormat().resolvedOptions().locale)
  const locale = isZh ? 'zh' : 'en'
  const template =
    BUILT_IN_CATALOGUES['app']?.[locale]?.['common.app.bootFailed'] ??
    BUILT_IN_CATALOGUES['app']?.['en']?.['common.app.bootFailed'] ??
    (isZh ? 'BBeBee 启动失败：\n\n{error}' : 'BBeBee failed to start:\n\n{error}')
  return template.replace('{error}', error)
}
