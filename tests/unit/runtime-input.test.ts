import { describe, expect, it } from 'vitest'

import { MockRuntime } from '@/runtime/mock-runtime'
import { PluotSorbetRuntime } from '@/runtime/pluotsorbet/runtime'
import type { InputControl, KeyPhase } from '@/runtime/types'

const pkg = {
  fingerprint: 'sha256:test',
  displayName: 'fixture',
  bytes: new Uint8Array([1, 2, 3, 4]),
}

describe('按键注入：送达与否如实返回', () => {
  it('游戏没在跑时返回 false，不排队补发', async () => {
    const runtime = new MockRuntime()
    expect(runtime.sendKey('up', 'press')).toBe(false)

    await runtime.load(pkg)
    // 已载入但还没 start：仍然无处可送
    expect(runtime.sendKey('up', 'press')).toBe(false)
  })

  it('运行中送达并保留按下/抬起的顺序', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg)
    await runtime.start()

    expect(runtime.sendKey('up', 'press')).toBe(true)
    expect(runtime.sendKey('up', 'release')).toBe(true)
    expect(runtime.drainKeys()).toEqual([
      { control: 'up', phase: 'press' },
      { control: 'up', phase: 'release' },
    ])
    expect(runtime.drainKeys()).toEqual([])
  })

  it('停不下来的过程中不再收键', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg)
    await runtime.start()
    const stopping = runtime.stop()
    // stop() 先把状态推到 stopping，随后才异步收尾
    expect(runtime.sendKey('fire', 'press')).toBe(false)
    await stopping
    expect(runtime.sendKey('fire', 'press')).toBe(false)
  })

  it('释放后不再收键', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg)
    await runtime.start()
    await runtime.dispose()
    expect(runtime.sendKey('fire', 'press')).toBe(false)
  })

  it('非法控制名与非法阶段都被挡下', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg)
    await runtime.start()

    expect(runtime.sendKey('teleport' as InputControl, 'press')).toBe(false)
    expect(runtime.sendKey('up', 'hold' as KeyPhase)).toBe(false)
    expect(runtime.drainKeys()).toEqual([])
  })
})

describe('PluotSorbetRuntime 的按键前置条件', () => {
  const make = () =>
    new PluotSorbetRuntime({ container: document.createElement('div'), keymap: { ArrowUp: 'up' } })

  it('还没载入（没有 iframe）时返回 false', () => {
    const runtime = make()
    expect(runtime.sendKey('up', 'press')).toBe(false)
  })

  it('非法控制名不产生任何消息', () => {
    const runtime = make()
    expect(runtime.sendKey('nope' as InputControl, 'press')).toBe(false)
    expect(runtime.sendKey('up', 'down' as KeyPhase)).toBe(false)
  })

  it('释放后返回 false', async () => {
    const runtime = make()
    await runtime.dispose()
    expect(runtime.sendKey('up', 'press')).toBe(false)
  })
})
