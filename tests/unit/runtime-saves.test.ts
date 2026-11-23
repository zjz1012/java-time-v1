import { describe, expect, it } from 'vitest'

import { MockRuntime } from '@/runtime/mock-runtime'
import { RuntimeFailure } from '@/runtime/errors'
import type { MidletPackage, SaveFile } from '@/runtime/types'

function pkg(): MidletPackage {
  return {
    fingerprint: 'sha256:saves-fixture',
    displayName: '存档夹具',
    bytes: new Uint8Array([1, 2, 3, 4]),
  }
}

function saveFile(fill: number): SaveFile {
  return { path: '/RecordStore/save.db', bytes: new Uint8Array([fill, fill, fill]) }
}

describe('存档快照的边界', () => {
  it('非运行状态导出直接失败，不返回空数组', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg())

    // 返回空数组会让「导出成功但内容是空的」变成用户发现不了的故障。
    await expect(runtime.snapshot()).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
  })

  it('停止之后不能再导出', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg())
    await runtime.start()
    await runtime.stop()

    await expect(runtime.snapshot()).rejects.toBeInstanceOf(RuntimeFailure)
  })

  it('运行中导出的内容就是 load 时恢复的那份', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg(), { restore: [saveFile(7)] })
    await runtime.start()

    const files = await runtime.snapshot()
    expect(files).toHaveLength(1)
    expect(files[0]?.bytes[0]).toBe(7)
  })

  it('缺省 restore 等于空快照', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg())
    await runtime.start()

    expect(await runtime.snapshot()).toEqual([])
  })
})

describe('退出时的快照顺序', () => {
  it('先交快照再报 stopped', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg(), { restore: [saveFile(3)] })
    await runtime.start()

    const order: string[] = []
    runtime.on('saves', (event) => order.push(`saves:${event.reason}`))
    runtime.on('statechange', (event) => {
      if (event.current === 'stopped') order.push('stopped')
    })

    await runtime.stop()

    // 反过来的话，真内核里 iframe 已经被拆了，这份快照根本发不出来。
    expect(order).toEqual(['saves:stop', 'stopped'])
  })

  it('订阅者能收到静默期归档', async () => {
    const runtime = new MockRuntime()
    await runtime.load(pkg())
    await runtime.start()

    const reasons: string[] = []
    runtime.on('saves', (event) => reasons.push(event.reason))

    runtime.setSaves([saveFile(5)])
    runtime.emitSaves('idle')

    expect(reasons).toEqual(['idle'])
  })
})
