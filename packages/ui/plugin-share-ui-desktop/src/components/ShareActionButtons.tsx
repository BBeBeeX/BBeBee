import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { Button, useI18n } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

export interface ShareActionButtonsProps {
  ctx: Context
  canCopy: boolean
  copied: boolean
  downloading: boolean
  canDownload: boolean
  onCopy: () => void
  onDownload: () => void
  onDisabledCopyClick: () => void
  onDisabledDownloadClick: () => void
  copyText?: string
  copiedText?: string
  downloadText?: string
  downloadingText?: string
  copyDisabledTestId?: string
  downloadDisabledTestId?: string
}

export function ShareActionButtons(props: ShareActionButtonsProps): ReactElement {
  const { t } = useI18n(props.ctx)
  const {
    canCopy,
    copied,
    downloading,
    canDownload,
    onCopy,
    onDownload,
    onDisabledCopyClick,
    onDisabledDownloadClick,
    copyText = t('share:shareActionButtons.copyBase64'),
    copiedText = t('share:shareActionButtons.copiedBase64'),
    downloadText = t('share:shareActionButtons.downloadImage'),
    downloadingText = t('share:shareActionButtons.generating'),
    copyDisabledTestId = copyText.includes('lyrics') ? 'copy-lyrics-disabled-btn' : 'copy-base64-disabled-btn',
    downloadDisabledTestId = 'download-disabled-btn',
  } = props

  const disabledBtnStyle = {
    width: '100%',
    height: 38,
    borderRadius: tokens.radius.pill,
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: 'var(--color-text-disabled, rgba(255, 255, 255, 0.35))',
    cursor: 'not-allowed',
    fontSize: 13,
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 16px',
  }

  return h(
    'div',
    {
      style: {
        display: 'flex',
        gap: 10,
        width: '100%',
        marginTop: 8,
      },
    },
    h(
      'div',
      { style: { flex: 1, display: 'flex' } },
      canCopy
        ? h(Button, {
            variant: 'secondary',
            onPress: onCopy,
            children: copied ? copiedText : copyText,
          })
        : h(
            'button',
            {
              type: 'button',
              'data-testid': copyDisabledTestId,
              onClick: onDisabledCopyClick,
              style: disabledBtnStyle,
            },
            copyText,
          ),
    ),
    h(
      'div',
      { style: { flex: 1, display: 'flex' } },
      canDownload
        ? h(Button, {
            variant: 'primary',
            onPress: onDownload,
            disabled: downloading,
            children: downloading ? downloadingText : downloadText,
          })
        : h(
            'button',
            {
              type: 'button',
              'data-testid': downloadDisabledTestId,
              onClick: onDisabledDownloadClick,
              style: disabledBtnStyle,
            },
            downloadText,
          ),
    ),
  )
}
