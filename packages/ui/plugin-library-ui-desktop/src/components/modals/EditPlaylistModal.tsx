import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { Context } from 'cordis'
import type { Playlist } from '@BBeBee/protocol'
import { Button, tablerIcon, useI18n } from '@BBeBee/ui-kit-desktop'

export function EditPlaylistModal({
  ctx,
  playlist,
  onClose,
  onSave,
}: {
  ctx: Context
  playlist: (Playlist & { description?: string }) | null
  onClose: () => void
  onSave: (patch: { name: string; description?: string; artworkUrl?: string }) => Promise<void>
}): ReactElement | null {
  const { t } = useI18n(ctx)
  const [name, setName] = useState(playlist?.name ?? '')
  const [description, setDescription] = useState(playlist?.description ?? '')
  const [artworkUrl, setArtworkUrl] = useState(playlist?.artwork?.sourceUrl ?? '')
  const [previewUrl, setPreviewUrl] = useState(playlist?.artwork?.sourceUrl ?? '')
  const [isHoveringCover, setIsHoveringCover] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (playlist) {
      setName(playlist.name ?? '')
      setDescription(playlist.description ?? '')
      setArtworkUrl(playlist.artwork?.sourceUrl ?? '')
      setPreviewUrl(playlist.artwork?.sourceUrl ?? '')
    }
  }, [playlist])

  if (!playlist) return null

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => {
        const res = reader.result as string
        setArtworkUrl(res)
        setPreviewUrl(res)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        artworkUrl: artworkUrl.trim() || undefined,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return h(
    'div',
    {
      'aria-label': t('library:editPlaylist.editDetails'),
      style: {
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      onClick: (e: ReactMouseEvent) => {
        if (e.target === e.currentTarget) onClose()
      },
    },
    h(
      'div',
      {
        style: {
          width: 524,
          backgroundColor: 'var(--bb-bg-overlay, #282828)',
          borderRadius: 8,
          padding: 24,
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.8)',
          color: 'var(--bb-text-primary, #FFFFFF)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        },
      },
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        h('h2', { style: { margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--bb-text-primary, #FFFFFF)' } }, t('library:editPlaylist.editDetails')),
        h(
          'button',
          {
            type: 'button',
            'aria-label': t('library:editPlaylist.close'),
            onClick: onClose,
            style: {
              background: 'transparent',
              border: 'none',
              color: '#A0A0AE',
              fontSize: 18,
              cursor: 'pointer',
              padding: 4,
            },
          },
          tablerIcon('x', { size: 22 }),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 16 } },
        h(
          'div',
          {
            style: {
              width: 180,
              height: 180,
              borderRadius: 4,
              overflow: 'hidden',
              position: 'relative',
              backgroundColor: '#1E1E1E',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            },
            onMouseEnter: () => setIsHoveringCover(true),
            onMouseLeave: () => setIsHoveringCover(false),
            onClick: () => fileInputRef.current?.click(),
          },
          previewUrl
            ? h('img', {
                src: previewUrl,
                alt: t('library:editPlaylist.coverPreview'),
                style: { width: '100%', height: '100%', objectFit: 'cover' },
              })
            : tablerIcon('music', { size: 52, color: '#555555' }),
          h(
            'div',
            {
              style: {
                position: 'absolute',
                inset: 0,
                backgroundColor: isHoveringCover ? 'rgba(0, 0, 0, 0.65)' : 'transparent',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                color: '#FFFFFF',
                opacity: isHoveringCover ? 1 : 0,
                transition: 'opacity 0.2s ease',
              },
            },
            tablerIcon('camera', { size: 40, color: 'currentColor' }),
            h('span', { style: { fontSize: 13, fontWeight: 600 } }, t('library:quadArtworkCollage.choosePhoto')),
          ),
          h('input', {
            ref: fileInputRef,
            type: 'file',
            accept: 'image/*',
            style: { display: 'none' },
            onChange: handleFileChange,
          }),
        ),
        h(
          'div',
          { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 10 } },
          h(
            'div',
            null,
            h('label', { style: { display: 'block', fontSize: 11, color: '#A0A0AE', marginBottom: 4, fontWeight: 600 } }, t('library:editPlaylist.name')),
            h('input', {
              type: 'text',
              value: name,
              onChange: (e: ChangeEvent<HTMLInputElement>) => setName(e.target.value),
              placeholder: t('library:editPlaylist.addAName'),
              'data-testid': 'edit-playlist-name',
              style: {
                width: '100%',
                height: 38,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 4,
                color: 'var(--bb-text-primary, #FFFFFF)',
                padding: '0 10px',
                fontSize: 14,
                boxSizing: 'border-box',
                outline: 'none',
              },
            }),
          ),
          h(
            'div',
            null,
            h('label', { style: { display: 'block', fontSize: 11, color: '#A0A0AE', marginBottom: 4, fontWeight: 600 } }, t('library:editPlaylist.description')),
            h('textarea', {
              value: description,
              onChange: (e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value),
              placeholder: t('library:editPlaylist.addAnOptionalDescription'),
              rows: 3,
              'data-testid': 'edit-playlist-description',
              style: {
                width: '100%',
                height: 64,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 4,
                color: 'var(--bb-text-primary, #FFFFFF)',
                padding: 8,
                fontSize: 13,
                resize: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                outline: 'none',
              },
            }),
          ),
          h(
            'div',
            null,
            h('label', { style: { display: 'block', fontSize: 11, color: '#A0A0AE', marginBottom: 4, fontWeight: 600 } }, t('library:editPlaylist.coverImageURLOptional')),
            h('input', {
              type: 'text',
              value: artworkUrl,
              onChange: (e: ChangeEvent<HTMLInputElement>) => {
                setArtworkUrl(e.target.value)
                setPreviewUrl(e.target.value)
              },
              placeholder: t('library:editPlaylist.httpsOrUploadFromThe'),
              'data-testid': 'edit-playlist-artwork',
              style: {
                width: '100%',
                height: 32,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 4,
                color: 'var(--bb-text-primary, #FFFFFF)',
                padding: '0 10px',
                fontSize: 12,
                boxSizing: 'border-box',
                outline: 'none',
              },
            }),
          ),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 } },
        h(
          'span',
          { style: { fontSize: 11, color: '#888888' } },
          t('library:editPlaylist.photoConsent'),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 10 } },
          h(Button, {
            variant: 'ghost',
            onPress: onClose,
            children: t('app:common.cancel'),
          }),
          h(Button, {
            variant: 'primary',
            disabled: !name.trim() || saving,
            onPress: handleSave,
            testID: 'edit-playlist-save',
            children: saving ? t('library:editPlaylist.saving') : t('library:userProfile.save'),
          }),
        ),
      ),
    ),
  )
}
