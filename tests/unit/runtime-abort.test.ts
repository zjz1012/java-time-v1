import { afterEach, describe, expect, it } from 'vitest'

import { PluotSorbetRuntime } from '@/runtime/pluotsorbet/runtime'
import { HOST_PROTOCOL_VERSION } from '@/runtime/pluotsorbet/protocol'
import type { MidletPackage } from '@/runtime/types'

/**
 * 取消语义的回归测试。
 *
 * 这些用例覆盖的是一条**不会在截图上表现出来**的缺陷：等待中的 Promise
 * 被静静丢掉、永远不 settle。页面看起来一切正常，只是退出后内存不回落，
 * 且「等加载完再继续」的代码再也不执行。没有断言就没人会发现它。
 */

const pkg: MidletPackage = {
  fingerprint: 'sha256:abort-fixture',
  displayName: 'fixture',
  bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
}

const READY = {
  v: HOST_PROTOCOL_VERSION,
  type: 'host:ready',
  payload: {
    protocolVersion: HOST_PROTOCOL_VERSION,
    capabilities: {
      speedControl: false,
      audio: false,
      frameTicks: false,
      pauseResume: false,
      keyInput: true,
    },
  },
}

const RUNNING = {
  v: HOST_PROTOCOL_VERSION,
  type: 'runtime:state',
  payload: { state: 'running', reason: 'first-paint' },
}

const LOADING = {
  v: HOST_PROTOCOL_VERSION,
  type: 'runtime:state',
  payload: { state: 'loading', reason: 'kernel-loaded' },
}

let containers: HTMLElement[] = []

function mount() {
  const container = document.createElement('div')
  // 必须进文档树：jsdom 的 iframe 只有挂上去之后才有 contentWindow。
  document.body.appendChild(container)
  containers.push(container)
  return container
}

/** 伪装成宿主页发来的消息：origin 同源、source 是本实例的 iframe。 */
function emit(container: HTMLElement, data: unknown): void {
  const frame = container.querySelector('iframe')
  if (!frame) throw new Error('iframe 还没插入')
  const event = new MessageEvent('message', { data, origin: window.location.origin })
  Object.defineProperty(event, 'source', { value: frame.contentWindow, configurable: true })
  window.dispatchEvent(event)
}

/** 等到 iframe 真的挂上（load 是异步启动的，插入发生在第一个 await 之前）。 */
function frameOf(container: HTMLElement): HTMLIFrameElement {
  const frame = container.querySelector('iframe')
  if (!frame) throw new Error('iframe 还没插入')
  return frame
}

afterEach(() => {
  for (const container of containers) container.remove()
  containers = []
})

describe('等待中的操作可以被打断', () => {
  it('load 等宿主就绪时被 dispose：以 ABORTED 结束，而不是永远挂着', async () => {
    const container = mount()
    const runtime = new PluotSorbetRuntime({ container })
    const loading = runtime.load(pkg)
    frameOf(container)

    await runtime.dispose()

    await expect(loading).rejects.toMatchObject({ code: 'ABORTED' })
    // 取消不等于失败：用户按返回不是「启动出错」。
    expect(runtime.currentState()).toBe('stopped')
  })

  it('start 等首帧时被 dispose：以 ABORTED 结束', async () => {
    const container = mount()
    const runtime = new PluotSorbetRuntime({ container })
    const loading = runtime.load(pkg)
    emit(container, READY)
    await loading

    const starting = runtime.start()
    // 不等首帧，直接退出 —— 用户在加载页点「返回」就是这个时序
    await runtime.dispose()

    await expect(starting).rejects.toMatchObject({ code: 'ABORTED' })
    expect(runtime.currentState()).toBe('stopped')
  })

  it('打断后 iframe 被移除，不再有残留节点', async () => {
    const container = mount()
    const runtime = new PluotSorbetRuntime({ container })
    void runtime.load(pkg).catch(() => {})
    expect(container.querySelectorAll('iframe')).toHaveLength(1)

    await runtime.dispose()

    expect(container.querySelectorAll('iframe')).toHaveLength(0)
  })
})

describe('「正在启动」与「确认运行」是两件事', () => {
  it('发出启动指令后是 starting，收到首帧才是 running', async () => {
    const container = mount()
    const runtime = new PluotSorbetRuntime({ container })
    const loading = runtime.load(pkg)
    emit(container, READY)
    await loading

    const starting = runtime.start()
    // 关键断言：这一刻画面还是黑的，状态不能是 running，
    // 否则运行页的遮罩条件（!running）失效，用户看到的是纯黑。
    expect(runtime.currentState()).toBe('starting')

    emit(container, RUNNING)
    await starting
    expect(runtime.currentState()).toBe('running')
  })

  it('启动期间宿主发来的 loading 不会把状态退回去', async () => {
    const container = mount()
    const runtime = new PluotSorbetRuntime({ container })
    const loading = runtime.load(pkg)
    emit(container, READY)
    await loading

    const starting = runtime.start()
    emit(container, LOADING)
    // 宿主的装配阶段本来就发生在启动指令之后，退回去只会让徽标闪一下。
    expect(runtime.currentState()).toBe('starting')

    emit(container, RUNNING)
    await starting
    expect(runtime.currentState()).toBe('running')
  })

  it('首帧之前 sendKey 返回 false，不会把按键排进队列', async () => {
    const container = mount()
    const runtime = new PluotSorbetRuntime({ container })
    const loading = runtime.load(pkg)
    emit(container, READY)
    await loading

    const starting = runtime.start()
    expect(runtime.sendKey('up', 'press')).toBe(false)

    emit(container, RUNNING)
    await starting
    expect(runtime.sendKey('up', 'press')).toBe(true)
  })
})

describe('快速退出再启动', () => {
  it('中止后新建实例仍能从零跑通', async () => {
    const container = mount()

    const first = new PluotSorbetRuntime({ container })
    const abandoned = first.load(pkg)
    await first.dispose()
    await expect(abandoned).rejects.toMatchObject({ code: 'ABORTED' })

    const second = new PluotSorbetRuntime({ container })
    const loading = second.load(pkg)
    emit(container, READY)
    await loading
    const starting = second.start()
    emit(container, RUNNING)
    await starting

    expect(second.currentState()).toBe('running')
    // 只剩第二个实例的 iframe —— 第一个被 dispose 时已经拆干净了
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('dispose 之后再 dispose 不会重复中止', async () => {
    const runtime = new PluotSorbetRuntime({ container: mount() })
    await runtime.dispose()
    await expect(runtime.dispose()).resolves.toBeUndefined()
    expect(runtime.currentState()).toBe('stopped')
  })
})
