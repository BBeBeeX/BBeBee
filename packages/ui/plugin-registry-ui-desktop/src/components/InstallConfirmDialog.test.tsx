// @vitest-environment jsdom
/**
 * Install confirm dialog: the plugin branch shows the resolved install
 * plan version (the install executes exactly that plan), and an
 * unreviewed warning when the plan's target overshoots the reviewed pin.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createElement as h } from 'react'
import { render, cleanup } from '@testing-library/react'
import type { InstallPlan, RegistryEntry, RegistryEntryDetails } from '@BBeBee/protocol'
import { InstallConfirmDialog } from './InstallConfirmDialog.js'

afterEach(cleanup)

function pluginEntry(): RegistryEntry {
  return {
    id: 'plugin-x',
    kind: 'plugin',
    name: 'X Plugin',
    npm: '@bbebee/plugin-x',
    reviewedVersion: '1.1.0',
  }
}

function plan(version: string, unreviewed?: boolean): InstallPlan {
  return {
    target: {
      id: 'plugin-x',
      npm: '@bbebee/plugin-x',
      version,
      tarball: 'https://x/x.tgz',
      ...(unreviewed ? { unreviewed: true } : {}),
    },
    closure: [],
    missingServices: [],
    warnings: [],
  }
}

function details(entry: RegistryEntry, planValue?: InstallPlan): RegistryEntryDetails {
  return { entry, ...(planValue ? { plan: planValue } : {}) }
}

describe('InstallConfirmDialog plan display', () => {
  it('shows the resolved plan version for a reviewed install, without an unreviewed warning', () => {
    const { getByTestId, queryByTestId } = render(
      h(InstallConfirmDialog, {
        details: details(pluginEntry(), plan('1.1.0')),
        action: 'install',
        busy: false,
        error: null,
        onConfirm: () => {},
        onClose: () => {},
      }),
    )
    expect(getByTestId('registry-plugin-plan-version').textContent).toContain('v1.1.0')
    expect(queryByTestId('registry-plugin-unreviewed-warning')).toBeNull()
  })

  it('shows the plan version and an unreviewed warning naming the reviewed version', () => {
    const { getByTestId } = render(
      h(InstallConfirmDialog, {
        details: details(pluginEntry(), plan('1.2.0', true)),
        action: 'install',
        busy: false,
        error: null,
        onConfirm: () => {},
        onClose: () => {},
      }),
    )
    expect(getByTestId('registry-plugin-plan-version').textContent).toContain('v1.2.0')
    const warning = getByTestId('registry-plugin-unreviewed-warning').textContent ?? ''
    expect(warning).toContain('v1.2.0')
    expect(warning).toContain('v1.1.0')
  })

  it('shows neither plan line nor warning when no plan was resolved', () => {
    const { queryByTestId } = render(
      h(InstallConfirmDialog, {
        details: details(pluginEntry()),
        action: 'install',
        busy: false,
        error: null,
        onConfirm: () => {},
        onClose: () => {},
      }),
    )
    expect(queryByTestId('registry-plugin-plan-version')).toBeNull()
    expect(queryByTestId('registry-plugin-unreviewed-warning')).toBeNull()
  })
})
