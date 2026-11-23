import { describe, expect, it, vi } from 'vitest'

import { MockRuntime } from '@/runtime/mock-runtime'
import { RuntimeFailure } from '@/runtime/errors'
import type { MidletPackage } from '@/runtime/types'

function pkg(overrides: Partial<MidletPackage> = {}): MidletPackage {
  return {
    fingerprint: 'sha256:test-fixture',
    displayName: 'fixture',
    bytes: new Uint8Array([1, 2, 3, 4]),
    ...overrides,
  }
}

describe('RuntimeAdapter 成功路径', () => {
  it('按 idle → ready → running 迁移，并广播状态变化', async () => {
    const runtime = new MockRuntime()
    const seen: string[] = []
    runtime.on('statechange', (e) => seen.push(`${e.previous}->${e.current}`))

    await runtime.load(pkg())
    await runtime.start()

    expect(runtime.currentState()).toBe('running')
    expect(seen).toEqual(['idle->loading', 'loading->ready', 'ready->running'])
  })

  it('暂停后恢复回到 running', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg())
    await runtime.start()
    await runtime.pause()
    expect(runtime.currentState()).toBe('paused')
    await runtime.resume()
    expect(runtime.currentState()).toBe('running')
  })

  it('setSpeed 生效且不重复广播状态', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg())
    await runtime.start()
    const before = vi.fn()
    runtime.on('statechange', before)
    await runtime.setSpeed(2)
    expect(runtime.speed).toBe(2)
    expect(before).not.toHaveBeenCalled()
  })

  it('订阅取消函数幂等', async () => {
    const runtime = new MockRuntime()
    const listener = vi.fn()
    const off = runtime.on('frame', listener)
    runtime.emitFrame(1)
    off()
    off()
    runtime.emitFrame(2)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('RuntimeAdapter 失败路径', () => {
  it('空包被拒绝并进入 failed', async () => {
    const runtime = new MockRuntime()
    await expect(runtime.load(pkg({ bytes: new Uint8Array() }))).rejects.toBeInstanceOf(
      RuntimeFailure,
    )
    expect(runtime.currentState()).toBe('failed')
  })

  it('未就绪就 start 抛 INVALID_TRANSITION', async () => {
    const runtime = new MockRuntime()
    await expect(runtime.start()).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
  })

  it('内核不支持暂停时明确报错而非静默忽略', async () => {
    const runtime = new MockRuntime({ capabilities: { pauseResume: false } })
    await runtime.load(pkg())
    await runtime.start()
    await expect(runtime.pause()).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
    })
  })

  it('不支持调速时报错', async () => {
    const runtime = new MockRuntime({ capabilities: { speedControl: false } })
    await expect(runtime.setSpeed(2)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
    })
  })

  it('超时判定发生在等待结束之前', async () => {
    const runtime = new MockRuntime({ latencyMs: 200 })
    const started = Date.now()
    await expect(runtime.load(pkg(), { timeoutMs: 10 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
    expect(Date.now() - started).toBeLessThan(150)
  })

  it('单个订阅者抛错不影响其他订阅者', async () => {
    const runtime = new MockRuntime()
    const health = vi.fn()
    runtime.on('frame', () => {
      throw new Error('boom')
    })
    runtime.on('frame', health)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    runtime.emitFrame(1)
    expect(health).toHaveBeenCalledOnce()
    spy.mockRestore()
  })
})

describe('RuntimeAdapter 重复调用', () => {
  it('dispose 幂等，之后调用被拒绝', async () => {
    const runtime = new MockRuntime()
    await runtime.dispose()
    await runtime.dispose()
    await expect(runtime.load(pkg())).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    })
  })

  it('stop 后状态为 stopped，可再次 load', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg())
    await runtime.start()
    await runtime.stop()
    expect(runtime.currentState()).toBe('stopped')
    await runtime.load(pkg())
    expect(runtime.currentState()).toBe('ready')
  })
})
