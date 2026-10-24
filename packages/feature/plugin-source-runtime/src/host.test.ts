/**
 * The per-evaluation `src` HTTP budget (docs/06 §8): a `@js:` rule that
 * loops `src.get` must be stopped at 8 calls, and the next evaluation
 * must start from zero again.
 */

import { describe, expect, it, vi } from 'vitest'
import type { HttpResponse } from '@BBeBee/protocol'
import { createSourceHost, MAX_SRC_HTTP_CALLS_PER_EVALUATION } from './host.js'

function respond(): HttpResponse {
  const bytes = new TextEncoder().encode('{"ok":true}')
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    url: 'https://host/x',
    text: async () => '{"ok":true}',
    json: async () => ({ ok: true }) as never,
    bytes: async () => bytes,
    stream: () => new ReadableStream(),
  }
}

function host() {
  const http = vi.fn(async () => respond())
  const created = createSourceHost({
    http: http as never,
    sourceId: 's1',
    assertAllowed: () => {},
    vars: { get: () => undefined, put: () => {} },
  })
  return { created, http }
}

describe('src HTTP budget', () => {
  it('allows exactly 8 calls per evaluation', async () => {
    const { created, http } = host()
    for (let i = 0; i < MAX_SRC_HTTP_CALLS_PER_EVALUATION; i++) {
      await expect(created.functions.__src_get('https://host/x', undefined)).resolves.toMatchObject({
        status: 200,
      })
    }
    expect(http).toHaveBeenCalledTimes(MAX_SRC_HTTP_CALLS_PER_EVALUATION)
  })

  it('refuses the 9th call in the same evaluation', async () => {
    const { created, http } = host()
    for (let i = 0; i < MAX_SRC_HTTP_CALLS_PER_EVALUATION; i++) {
      await created.functions.__src_get('https://host/x', undefined)
    }
    await expect(created.functions.__src_get('https://host/x', undefined)).rejects.toThrow(
      /at most 8 src\.get\/src\.post calls/,
    )
    // The refused call never reached the network.
    expect(http).toHaveBeenCalledTimes(MAX_SRC_HTTP_CALLS_PER_EVALUATION)
  })

  it('resets for the next evaluation', async () => {
    const { created } = host()
    for (let i = 0; i < MAX_SRC_HTTP_CALLS_PER_EVALUATION; i++) {
      await created.functions.__src_get('https://host/x', undefined)
    }
    created.resetHttpCallCount()
    await expect(created.functions.__src_get('https://host/x', undefined)).resolves.toMatchObject({
      status: 200,
    })
  })

  it('does not spend budget on an allowlist refusal', async () => {
    const http = vi.fn(async () => respond())
    let refuse = true
    const created = createSourceHost({
      http: http as never,
      sourceId: 's1',
      assertAllowed: () => {
        if (refuse) throw new Error('did not declare evil.example')
      },
      vars: { get: () => undefined, put: () => {} },
    })
    await expect(created.functions.__src_get('https://evil.example/x', undefined)).rejects.toThrow(
      /did not declare/,
    )
    expect(http).not.toHaveBeenCalled()
    // The refused probe did not consume budget: 8 allowed calls still pass.
    refuse = false
    for (let i = 0; i < MAX_SRC_HTTP_CALLS_PER_EVALUATION; i++) {
      await created.functions.__src_get('https://host/x', undefined)
    }
    await expect(created.functions.__src_get('https://host/x', undefined)).rejects.toThrow(
      /at most 8/,
    )
  })
})
