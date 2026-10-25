import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { tokens } from '@BBeBee/ui-tokens'
import { Button, Sheet, Text, TextField, nativePrimitives, useI18n, usePalette } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { parseThemeDocument, ThemeImportError, type ThemeImportResult } from '../import.js'

/**
 * The `ctx.fs` surface this card uses. `pickFiles` is optional twice over:
 * the protocol grows it platform-by-platform, and older cores simply do not
 * have it — so its presence is a capability check, never an assumption.
 */
type FsLike = {
  readFile(uri: string): Promise<string>
  pickFiles?(opts?: { multiple?: boolean }): Promise<Array<{ uri: string; name?: string; size?: number }>>
}

export interface ImportSheetProps {
  ctx: Context
  open: boolean
  onClose: () => void
  onImported: (result: ThemeImportResult) => void
}

/**
 * The import dialog: paste a theme JSON, or pick one from disk when the fs
 * service can ask the user for files.
 *
 * Same document format as the desktop card (a single `ThemeDefinition` or a
 * `ThemePack` with `variants`); parsing lives in `../import.js` so the sheet
 * only renders state. The paste path is the always-available fallback — the
 * mobile sources import screen established the pattern.
 */
export function ImportSheet(props: ImportSheetProps): ReactElement | null {
  const { ctx, open, onClose, onImported } = props
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  const p = usePalette()

  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fs = serviceOf<FsLike>(ctx, 'fs')
  const canPickFiles = typeof fs?.pickFiles === 'function'

  if (!open) return null

  const pickFile = (): void => {
    const fsService = fs
    const pick = fsService?.pickFiles?.bind(fsService)
    if (typeof pick !== 'function' || !fsService) return
    void (async () => {
      try {
        // Cancelling resolves [] — no file, no error, sheet stays as it was.
        const [file] = (await pick({ multiple: false })) ?? []
        if (!file) return
        const content = await fsService.readFile(file.uri)
        setText(content)
        setError(null)
      } catch {
        setError(t('theme:themeManagement.importFailedReadFile'))
      }
    })()
  }

  const submit = (): void => {
    try {
      const result = parseThemeDocument(text)
      onImported(result)
      setText('')
      setError(null)
    } catch (err) {
      setError(err instanceof ThemeImportError ? t(err.key) : String(err))
    }
  }

  return h(
    Sheet,
    {
      open,
      onClose,
      title: t('theme:themeManagement.importTheme'),
      testID: 'import-theme-sheet',
    },
    h(
      native.View as never,
      { style: { gap: tokens.space[3], paddingTop: tokens.space[3] } },
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        t('theme:themeManagement.importHint'),
      ),
      canPickFiles
        ? h(Button, {
            variant: 'secondary',
            testID: 'choose-theme-file-btn',
            accessibilityLabel: t('theme:themeManagement.chooseLocalJsonFile'),
            onPress: pickFile,
            children: t('theme:themeManagement.chooseLocalJsonFile'),
          })
        : null,
      h(TextField, {
        value: text,
        onChange: (next: string) => {
          setText(next)
          setError(null)
        },
        multiline: true,
        rows: 8,
        placeholder: t('theme:themeManagement.importPlaceholder'),
        accessibilityLabel: t('theme:themeManagement.importTheme'),
        testID: 'import-theme-textarea',
      }),
      error
        ? h(
            native.View as never,
            {
              testID: 'import-theme-error',
              style: {
                padding: tokens.space[2],
                borderRadius: tokens.radius.sm,
                backgroundColor: p.bg.overlay,
                borderLeftWidth: 3,
                borderLeftColor: p.state.error,
              },
            },
            h(Text, { variant: 'sm', tone: 'error' }, error),
          )
        : null,
      h(
        native.View as never,
        { style: { flexDirection: 'row', gap: tokens.space[2], justifyContent: 'flex-end' } },
        h(Button, {
          variant: 'ghost',
          testID: 'cancel-import-theme',
          onPress: onClose,
          children: t('app:common.cancel'),
        }),
        h(Button, {
          testID: 'submit-import-theme',
          onPress: submit,
          children: t('theme:themeManagement.importAndEnable'),
        }),
      ),
    ),
  )
}
