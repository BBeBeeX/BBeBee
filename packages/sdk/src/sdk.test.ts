import { describe, expect, it } from 'vitest'
import {
  Context,
  Service,
  Inject,
  definePlugin,
  parseUrn,
} from './index.js'
import { createTestContext, expectNoLeak } from './testing.js'

describe('@BBeBee/sdk', () => {
  it('exports Cordis plugin lifecycle primitives', () => {
    expect(Context).toBeDefined()
    expect(Service).toBeDefined()
    expect(Inject).toBeDefined()
  })

  it('exports protocol contracts and entity helpers', () => {
    expect(typeof parseUrn).toBe('function')
    const urn = parseUrn('BBeBee:local:track:abc123')
    expect(urn.kind).toBe('track')
    expect(urn.sourceId).toBe('local')
    expect(urn.id).toBe('abc123')
  })

  it('defines and runs a function-style plugin on test context', async () => {
    const ctx = createTestContext()
    let loaded = false
    let unloaded = false

    const plugin = definePlugin({
      name: 'test-plugin',
      apply(_c) {
        loaded = true
        return () => {
          unloaded = true
        }
      },
    })

    const fiber = await ctx.plugin(plugin)
    expect(loaded).toBe(true)
    expect(unloaded).toBe(false)

    await fiber.dispose()
    expect(unloaded).toBe(true)
  })

  it('supports service classes subclassing Service', async () => {
    const ctx = createTestContext()

    class TestService extends Service {
      constructor(c: Context) {
        super(c, 'testService')
      }
      getHello() {
        return 'hello world'
      }
    }

    const fiber = await ctx.plugin(TestService)
    // @ts-expect-error dynamic service access
    expect(ctx.testService?.getHello()).toBe('hello world')
    await fiber.dispose()
  })

  it('verifies leak detection with expectNoLeak', async () => {
    const ctx = createTestContext()
    const cleanPlugin = definePlugin({
      name: 'clean-plugin',
      apply(c) {
        const off = c.on('custom-event' as any, () => {})
        return () => {
          off()
        }
      },
    })

    await expectNoLeak(ctx, () => ctx.plugin(cleanPlugin))
  })
})
