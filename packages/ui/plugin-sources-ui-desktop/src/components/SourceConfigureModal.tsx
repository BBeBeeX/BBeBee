import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import type { SourcePingResult } from '@BBeBee/protocol'
import { useSourceParams } from '@BBeBee/plugin-sources/hooks'
import { Button, Sheet, Text, TextField } from '@BBeBee/ui-kit-desktop'
import { tokens } from '@BBeBee/ui-tokens'

export interface SourceConfigureModalProps {
  ctx: Context
  sourceId: string | undefined
  open: boolean
  onClose: () => void
}

function isPasswordKey(key: string): boolean {
  const lower = key.toLowerCase()
  return lower.includes('pass') || lower.includes('token') || lower.includes('secret')
}

export function SourceConfigureModal({
  ctx,
  sourceId,
  open,
  onClose,
}: SourceConfigureModalProps): ReactElement | null {
  const { params, record, loading, pingState, testConnection, saveParams } = useSourceParams(
    ctx,
    sourceId,
  )

  const [host, setHost] = useState('')
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [vars, setVars] = useState<Record<string, string>>({})
  const [newVarKey, setNewVarKey] = useState('')
  const [newVarValue, setNewVarValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [initializedSourceId, setInitializedSourceId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!open) {
      setInitializedSourceId(undefined)
      return
    }
    if (params && initializedSourceId !== sourceId) {
      setHost(params.host || record?.sourceUrl || '')
      setSecrets({ ...params.secrets })
      setVars({ ...params.vars })
      setInitializedSourceId(sourceId)
    }
  }, [open, params, record, sourceId, initializedSourceId])

  if (!open || !sourceId) return null

  const declaredSecretKeys =
    params?.secretKeys && params.secretKeys.length > 0
      ? params.secretKeys
      : ['user', 'password']

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await saveParams({
        sourceUrl: host.trim(),
        host: host.trim(),
        secrets,
        vars,
      })
      onClose()
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = () => {
    void testConnection({
      host: host.trim(),
      user: secrets['user'] ?? secrets['username'],
      password: secrets['password'],
      vars,
    })
  }

  const renderPingBadge = (result: SourcePingResult) => {
    let borderColor = 'rgba(148, 163, 184, 0.2)'
    let bgColor = 'rgba(255, 255, 255, 0.05)'
    let statusText = 'Unknown'
    let statusTone: 'ok' | 'warn' | 'error' = 'ok'

    if (result.status === 'ok') {
      borderColor = 'rgba(52, 199, 89, 0.4)'
      bgColor = 'rgba(52, 199, 89, 0.12)'
      statusText = 'Connected'
      statusTone = 'ok'
    } else if (result.status === 'auth_failed') {
      borderColor = 'rgba(245, 158, 11, 0.4)'
      bgColor = 'rgba(245, 158, 11, 0.12)'
      statusText = 'Authentication Failed'
      statusTone = 'warn'
    } else if (result.status === 'network_error') {
      borderColor = 'rgba(239, 68, 68, 0.4)'
      bgColor = 'rgba(239, 68, 68, 0.12)'
      statusText = 'Network Error'
      statusTone = 'error'
    }

    return h(
      'div',
      {
        'data-testid': 'source-configure-ping-result',
        style: {
          padding: tokens.space[3],
          borderRadius: tokens.radius.sm,
          border: `1px solid ${borderColor}`,
          backgroundColor: bgColor,
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[1],
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: tokens.space[2] } },
        h(Text, { variant: 'sm', tone: statusTone }, statusText),
        result.serverVersion
          ? h(Text, { variant: 'xs', tone: 'muted' }, `v${result.serverVersion}`)
          : null,
        result.latencyMs !== undefined
          ? h(Text, { variant: 'xs', tone: 'muted' }, `${result.latencyMs}ms`)
          : null,
      ),
      result.message
        ? h(Text, { variant: 'xs', tone: statusTone }, result.message)
        : null,
    )
  }

  return h(
    Sheet,
    {
      open,
      onClose,
      title: `Configure ${record?.name ?? 'Source'}`,
      testID: 'source-configure-modal',
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[4],
          maxHeight: '75vh',
          overflowY: 'auto',
          paddingRight: tokens.space[1],
        },
      },
      loading && !params
        ? h(Text, { variant: 'sm', tone: 'muted' }, 'Loading parameters...')
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[3] } },
            // Host Section
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
              h(Text, { variant: 'sm' }, 'Server Host / URL'),
              h(TextField, {
                value: host,
                onChange: setHost,
                placeholder: 'https://music.example.org',
                accessibilityLabel: 'Server Host / URL',
                testID: 'source-configure-host',
              }),
              h(
                Text,
                { variant: 'xs', tone: 'muted' },
                'Updating host automatically updates the sandbox network egress allowlist.',
              ),
            ),

            // Credentials Section
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: tokens.space[2],
                  borderTop: '1px solid rgba(148, 163, 184, 0.14)',
                  paddingTop: tokens.space[3],
                },
              },
              h(
                'div',
                { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                h(Text, { variant: 'sm' }, 'Credentials'),
                h(
                  Text,
                  { variant: 'xs', tone: 'accent' },
                  '🔒 Keychain Secure Storage (write-only)',
                ),
              ),
              ...declaredSecretKeys.map((key) => {
                const isPass = isPasswordKey(key)
                return h(
                  'div',
                  { key, style: { display: 'flex', flexDirection: 'column', gap: tokens.space[1] } },
                  h(Text, { variant: 'xs', tone: 'muted' }, key),
                  h(TextField, {
                    value: secrets[key] ?? '',
                    onChange: (val) => setSecrets((prev) => ({ ...prev, [key]: val })),
                    placeholder: secrets[key] ? '••••••••' : `Enter ${key}`,
                    secure: isPass,
                    accessibilityLabel: key,
                    testID: `source-configure-${key}`,
                  }),
                )
              }),
            ),

            // Custom Variables Section
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: tokens.space[2],
                  borderTop: '1px solid rgba(148, 163, 184, 0.14)',
                  paddingTop: tokens.space[3],
                },
              },
              h(Text, { variant: 'sm' }, 'Variables (source_vars)'),
              ...Object.entries(vars).map(([k, v]) =>
                h(
                  'div',
                  {
                    key: k,
                    style: { display: 'flex', gap: tokens.space[2], alignItems: 'center' },
                  },
                  h('div', { style: { width: 100, flexShrink: 0 } }, h(Text, { variant: 'xs' }, k)),
                  h('div', { style: { flex: 1 } },
                    h(TextField, {
                      value: v,
                      onChange: (val) => setVars((prev) => ({ ...prev, [k]: val })),
                      accessibilityLabel: `Variable ${k}`,
                      testID: `source-configure-var-${k}`,
                    }),
                  ),
                  h(Button, {
                    variant: 'ghost',
                    onPress: () => {
                      setVars((prev) => {
                        const next = { ...prev }
                        delete next[k]
                        return next
                      })
                    },
                    accessibilityLabel: `Delete ${k}`,
                    testID: `source-configure-var-del-${k}`,
                    children: '✕',
                  }),
                ),
              ),
              // Add variable row
              h(
                'div',
                { style: { display: 'flex', gap: tokens.space[2], alignItems: 'center' } },
                h('div', { style: { flex: 1 } },
                  h(TextField, {
                    value: newVarKey,
                    onChange: setNewVarKey,
                    placeholder: 'New key',
                    accessibilityLabel: 'New variable key',
                    testID: 'source-configure-new-var-key',
                  }),
                ),
                h('div', { style: { flex: 1 } },
                  h(TextField, {
                    value: newVarValue,
                    onChange: setNewVarValue,
                    placeholder: 'Value',
                    accessibilityLabel: 'New variable value',
                    testID: 'source-configure-new-var-val',
                  }),
                ),
                h(Button, {
                  variant: 'secondary',
                  disabled: !newVarKey.trim(),
                  onPress: () => {
                    if (!newVarKey.trim()) return
                    setVars((prev) => ({ ...prev, [newVarKey.trim()]: newVarValue }))
                    setNewVarKey('')
                    setNewVarValue('')
                  },
                  testID: 'source-configure-add-var-btn',
                  children: 'Add',
                }),
              ),
            ),

            // Connectivity Probe Section
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: tokens.space[2],
                  borderTop: '1px solid rgba(148, 163, 184, 0.14)',
                  paddingTop: tokens.space[3],
                },
              },
              h(
                'div',
                { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                h(Text, { variant: 'sm' }, 'Connectivity Test'),
                h(Button, {
                  variant: 'secondary',
                  loading: pingState.loading,
                  onPress: handleTest,
                  testID: 'source-configure-test-btn',
                  children: pingState.loading ? 'Testing...' : 'Test Connection',
                }),
              ),
              pingState.result ? renderPingBadge(pingState.result) : null,
            ),

            saveError
              ? h(Text, { variant: 'sm', tone: 'error' }, saveError)
              : null,

            // Action Buttons
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: tokens.space[2],
                  borderTop: '1px solid rgba(148, 163, 184, 0.14)',
                  paddingTop: tokens.space[3],
                },
              },
              h(Button, {
                variant: 'ghost',
                onPress: onClose,
                testID: 'source-configure-cancel-btn',
                children: 'Cancel',
              }),
              h(Button, {
                variant: 'primary',
                loading: saving,
                onPress: handleSave,
                testID: 'source-configure-save-btn',
                children: 'Save Parameters',
              }),
            ),
          ),
    ),
  )
}
