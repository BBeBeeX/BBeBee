/**
 * StagedFileList — mobile input file staging for the converter workbench.
 *
 * The desktop twin picks through `window.BBeBee.dialog` with a DOM `<input>`
 * fallback; neither exists on React Native. Here picking goes through the
 * optional `fs.pickFiles` capability, and a build without it renders an
 * explicit unavailable state instead of a dead button.
 */

import { createElement as h, useState } from 'react'
import type { ReactElement } from 'react'
import type { Context } from 'cordis'
import { nativePrimitives, Text, useI18n } from '@BBeBee/ui-kit-mobile'
import { serviceOf } from '@BBeBee/toolkit/hooks'
import { formatBytes } from '@BBeBee/toolkit'
import { palettes, tokens } from '@BBeBee/ui-tokens'
import { pickFilesCapability, toStagedFiles, type StagedFile } from '../pick.js'

const p = () => palettes.dark

export interface StagedFileListProps {
  ctx: Context
  files: readonly StagedFile[]
  onAddFiles: (files: StagedFile[]) => void
  onRemoveFile: (id: string) => void
  onClearFiles: () => void
}

export function StagedFileList({
  ctx,
  files,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
}: StagedFileListProps): ReactElement {
  // Resolved inside the component: before the shell's `configureNative` runs,
  // the kit hands back placeholder elements, and a module-level capture would
  // freeze those in place forever.
  const native = nativePrimitives()
  const { t } = useI18n(ctx)
  // Resolved per render via `serviceOf`, never cached in a closure, and never
  // a bare `ctx.fs`: on a plugin-scoped context that read throws instead of
  // answering undefined, and fs is an *optional* capability for this view —
  // the plugin does not inject it.
  const fs = serviceOf<unknown>(ctx, 'fs')
  const pickFiles = pickFilesCapability(fs)
  const [picking, setPicking] = useState(false)

  const handlePick = async () => {
    if (!pickFiles || picking) return
    setPicking(true)
    try {
      const picked = await pickFiles({ multiple: true })
      // Cancel resolves `[]` per the contract — nothing staged, no error.
      if (picked.length > 0) onAddFiles(toStagedFiles(picked, files.length))
    } catch (err) {
      ctx.logger.warn('audio-converter-ui-mobile: file picking failed', err)
    } finally {
      setPicking(false)
    }
  }

  return h(
    native.View as never,
    {
      style: {
        gap: tokens.space[2],
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderRadius: tokens.radius.md,
        padding: tokens.space[3],
      },
    },
    h(
      native.View as never,
      {
        style: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
      },
      h(Text, { variant: 'md' }, t('converter:index.selectedFiles', { count: files.length })),
      files.length > 0
        ? h(
            native.Pressable as never,
            {
              onPress: onClearFiles,
              accessibilityRole: 'button',
              accessibilityLabel: t('converter:index.clearFiles'),
              testID: 'converter-clear-files',
              style: { paddingVertical: 4, paddingHorizontal: 8 },
            },
            h(Text, { variant: 'xs', tone: 'muted' }, t('converter:index.clearFiles')),
          )
        : null,
    ),

    // The pick entry point — or the honest unavailable state. The copy is a
    // deliberate English literal: the locale catalogues live in
    // `packages/feature/plugin-i18n`, outside this package, and no
    // `converter:index.*` key covers "this build cannot pick files". Adding
    // one is deferred rather than misusing a desktop drag-and-drop string.
    pickFiles
      ? h(
          native.Pressable as never,
          {
            onPress: () => void handlePick(),
            accessibilityRole: 'button',
            accessibilityLabel: t('converter:index.browseFiles'),
            testID: 'converter-pick-files',
            style: {
              minHeight: tokens.size.touchTarget,
              borderRadius: tokens.radius.pill,
              borderWidth: 1,
              borderColor: p().border.strong,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: tokens.space[5],
              opacity: picking ? 0.5 : 1,
            },
          },
          h(Text, { variant: 'md' }, t('converter:index.browseFiles')),
        )
      : h(
          native.View as never,
          {
            testID: 'converter-pick-unavailable',
            style: {
              borderRadius: tokens.radius.sm,
              borderWidth: 1,
              borderColor: p().border.subtle,
              padding: tokens.space[3],
              gap: 2,
            },
          },
          h(Text, { variant: 'sm', tone: 'muted' }, t('converter:index.noFilesSelected')),
          h(
            Text,
            { variant: 'xs', tone: 'muted' },
            'This build cannot pick files — no file picker is available on this device.',
          ),
        ),

    ...files.map((file) =>
      h(
        native.View as never,
        {
          key: file.id,
          testID: `converter-staged-row-${file.id}`,
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: tokens.space[2],
            paddingVertical: tokens.space[1],
          },
        },
        h(
          native.View as never,
          {
            style: {
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: tokens.radius.sm,
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
            },
          },
          h(Text, { variant: 'xs' }, file.format),
        ),
        h(
          native.View as never,
          { style: { flex: 1, minWidth: 0 } },
          h(Text, { variant: 'sm', numberOfLines: 1 }, file.name),
          file.size > 0
            ? h(Text, { variant: 'xs', tone: 'muted' }, formatBytes(file.size))
            : null,
        ),
        h(
          native.Pressable as never,
          {
            onPress: () => onRemoveFile(file.id),
            accessibilityRole: 'button',
            accessibilityLabel: t('converter:index.remove'),
            accessibilityValue: { text: file.name },
            testID: `converter-remove-file-${file.id}`,
            style: { paddingHorizontal: 8, paddingVertical: 4 },
          },
          h(Text, { variant: 'xs', tone: 'error' }, t('converter:index.remove')),
        ),
      ),
    ),
  )
}
