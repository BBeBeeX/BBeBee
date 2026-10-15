/**
 * Audio file upload, drag-and-drop, and file management section.
 */

import { createElement as h, useState } from 'react'
import type { ChangeEvent, DragEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import { Button, IconButton, Text, useI18n } from '@BBeBee/ui-kit-desktop'
import { formatBytes } from '@BBeBee/toolkit'
import { tokens } from '@BBeBee/ui-tokens'
import { extractExtension } from '@BBeBee/plugin-audio-converter'

export interface SelectedAudioFile {
  id: string
  uri: string
  name: string
  format: string
  size: number
  durationMs?: number
}

export interface AudioFileListProps {
  ctx: Context
  files: readonly SelectedAudioFile[]
  onAddFiles: (files: SelectedAudioFile[]) => void
  onRemoveFile: (id: string) => void
  onClearFiles: () => void
}

export function AudioFileList({
  ctx,
  files,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
}: AudioFileListProps): ReactElement {
  const { t } = useI18n(ctx)
  const [isDragOver, setIsDragOver] = useState(false)

  const handleFileInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return

    const newFiles: SelectedAudioFile[] = []
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i]!
      // In Electron / web, file.path is available if file is from local disk
      const filePath = (f as { path?: string }).path || f.name
      const ext = extractExtension(filePath) || extractExtension(f.name) || 'unknown'
      newFiles.push({
        id: `file_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        uri: filePath,
        name: f.name,
        format: ext.toUpperCase(),
        size: f.size,
      })
    }

    onAddFiles(newFiles)
    e.target.value = ''
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    const droppedFiles = e.dataTransfer.files
    if (!droppedFiles || droppedFiles.length === 0) return

    const newFiles: SelectedAudioFile[] = []
    for (let i = 0; i < droppedFiles.length; i++) {
      const f = droppedFiles[i]!
      const filePath = (f as { path?: string }).path || f.name
      const ext = extractExtension(filePath) || extractExtension(f.name) || 'unknown'
      newFiles.push({
        id: `file_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        uri: filePath,
        name: f.name,
        format: ext.toUpperCase(),
        size: f.size,
      })
    }

    onAddFiles(newFiles)
  }

  return h(
    'section',
    {
      'data-testid': 'converter-file-area',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[3],
        padding: tokens.space[4],
        background: 'var(--surface-1, rgba(255, 255, 255, 0.04))',
        borderRadius: tokens.radius.md,
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
      },
    },
    // Header
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
      },
      h(
        Text,
        { variant: 'md' },
        t('converter:index.selectedFiles', { count: files.length }),
      ),
      files.length > 0
        ? h(Button, {
            variant: 'ghost',
            onPress: onClearFiles,
            testID: 'converter-clear-files',
            children: t('converter:index.clearFiles'),
          })
        : null,
    ),
    // Dropzone
    h(
      'div',
      {
        onDragOver: (e: DragEvent<HTMLDivElement>) => {
          e.preventDefault()
          setIsDragOver(true)
        },
        onDragLeave: () => setIsDragOver(false),
        onDrop: handleDrop,
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens.space[2],
          padding: tokens.space[6],
          border: isDragOver
            ? '2px dashed var(--color-primary, #5F87FF)'
            : '2px dashed var(--border-subtle, rgba(255, 255, 255, 0.15))',
          borderRadius: tokens.radius.sm,
          background: isDragOver
            ? 'var(--surface-hover, rgba(95, 135, 255, 0.08))'
            : 'transparent',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        },
        onClick: () => {
          const input = document.getElementById('converter-file-input') as HTMLInputElement | null
          input?.click()
        },
      },
      h(
        'input',
        {
          id: 'converter-file-input',
          type: 'file',
          multiple: true,
          accept: 'audio/*,.mp3,.wav,.flac,.aac,.m4a,.ogg,.opus,.wma,.aiff,.alac,.webm',
          style: { display: 'none' },
          onChange: handleFileInput,
        },
      ),
      h(
        Text,
        { variant: 'sm', tone: 'muted' },
        t('converter:index.dropAudioFiles'),
      ),
      h(
        Button,
        {
          variant: 'secondary',
          onPress: () => {
            const input = document.getElementById('converter-file-input') as HTMLInputElement | null
            input?.click()
          },
          testID: 'converter-browse-btn',
          children: t('converter:index.browseFiles'),
        },
      ),
    ),
    // File items list
    files.length > 0
      ? h(
          'ul',
          {
            'data-testid': 'converter-files-list',
            style: {
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[2],
              maxHeight: 240,
              overflowY: 'auto',
            },
          },
          ...files.map((file) =>
            h(
              'li',
              {
                key: file.id,
                'data-testid': `converter-file-row-${file.id}`,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: `${tokens.space[2]} ${tokens.space[3]}`,
                  background: 'var(--surface-2, rgba(255, 255, 255, 0.06))',
                  borderRadius: tokens.radius.sm,
                  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
                },
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: tokens.space[3], minWidth: 0 } },
                // Format badge
                h(
                  'span',
                  {
                    style: {
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'var(--color-primary-subtle, rgba(95, 135, 255, 0.15))',
                      color: 'var(--color-primary, #5F87FF)',
                      textTransform: 'uppercase',
                    },
                  },
                  file.format,
                ),
                // File name
                h(
                  Text,
                  { numberOfLines: 1, style: { fontWeight: 500, fontSize: 13 } },
                  file.name,
                ),
                // Size
                h(
                  Text,
                  { variant: 'xs', tone: 'muted' },
                  formatBytes(file.size),
                ),
              ),
              h(IconButton, {
                icon: 'x',
                variant: 'ghost',
                size: 16,
                accessibilityLabel: t('converter:index.remove'),
                onPress: () => onRemoveFile(file.id),
                testID: `converter-file-remove-${file.id}`,
              }),
            ),
          ),
        )
      : null,
  )
}
