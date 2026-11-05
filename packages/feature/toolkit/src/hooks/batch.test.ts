// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useBatchSelection } from './batch.js'

afterEach(cleanup)

describe('useBatchSelection', () => {
  it('toggles selection and supports select all and clear', () => {
    const { result } = renderHook(() => useBatchSelection())

    expect(result.current.isBatchMode).toBe(false)
    expect(result.current.selectedCount).toBe(0)

    act(() => {
      result.current.setBatchMode(true)
      result.current.toggleSelect('urn:1')
      result.current.toggleSelect('urn:2')
    })

    expect(result.current.isBatchMode).toBe(true)
    expect(result.current.selectedCount).toBe(2)
    expect(result.current.isSelected('urn:1')).toBe(true)
    expect(result.current.isSelected('urn:3')).toBe(false)

    act(() => {
      result.current.toggleSelect('urn:1')
    })
    expect(result.current.selectedCount).toBe(1)
    expect(result.current.isSelected('urn:1')).toBe(false)

    act(() => {
      result.current.selectAll(['urn:1', 'urn:2', 'urn:3'])
    })
    expect(result.current.selectedCount).toBe(3)
    expect(result.current.isSelected('urn:3')).toBe(true)

    act(() => {
      result.current.clearSelection()
    })
    expect(result.current.selectedCount).toBe(0)

    act(() => {
      result.current.selectAll(['urn:1'])
      result.current.setBatchMode(false)
    })
    expect(result.current.isBatchMode).toBe(false)
    expect(result.current.selectedCount).toBe(0)
  })
})
