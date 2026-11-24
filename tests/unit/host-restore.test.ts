import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

import { describe, expect, it } from 'vitest'

/**
 * 宿主页的存档恢复门禁。
 *
 * 这条链路只有真浏览器能完整跑（要 IndexedDB + 内核），但「恢复失败会不会
 * 中止启动」是个纯逻辑判断，可以在 vm 里把宿主脚本单独跑起来验证 ——
 * 这比「读文件里有没有出现某个字符串」结实得多：改动顺序、提前 return、
 * 把 fail 换成 warn，都会让下面的断言失败。
 */

const HOST_HTML = readFileSync(join(process.cwd(), 'public/runtime/host.html'), 'utf8')

interface Posted {
  readonly type: string
  readonly payload: Record<string, unknown>
}

interface HostHarness {
  readonly context: vm.Context
  readonly posted: Posted[]
  /** 被注入到 <head> 的脚本地址。只要有一个就说明开始装载内核了。 */
  readonly loadedScripts: string[]
  /** 触发一次启动指令。 */
  launch(payload: Record<string, unknown>): Promise<void>
}

function bootHost(options: { indexedDB?: unknown } = {}): HostHarness {
  const source = /<script>([\s\S]*?)<\/script>/.exec(HOST_HTML)?.[1]
  if (!source) throw new Error('host.html 里没有找到宿主脚本')

  const posted: Posted[] = []
  const loadedScripts: string[] = []
  const listeners = new Map<string, Array<(event: unknown) => void>>()

  const parentWindow = {
    postMessage(message: Posted) {
      posted.push(message)
    },
  }

  class BlobStub {
    readonly parts: unknown[]
    constructor(parts: unknown[]) {
      this.parts = parts
    }
  }

  const documentStub = {
    hidden: false,
    baseURI: 'https://example.test/',
    activeElement: null,
    head: {
      appendChild(element: { src?: string }) {
        if (element.src) loadedScripts.push(element.src)
      },
    },
    addEventListener() {
      /* 输入相关的监听在启动失败路径上用不到 */
    },
    getElementById() {
      return null
    },
    createElement(tag: string) {
      if (tag === 'canvas') return { width: 0, height: 0, getContext: () => null }
      return {}
    },
  }

  const windowStub = {
    parent: parentWindow,
    addEventListener(type: string, listener: (event: unknown) => void) {
      const bucket = listeners.get(type) ?? []
      bucket.push(listener)
      listeners.set(type, bucket)
    },
    removeEventListener() {
      /* ignore */
    },
  }

  const sandbox: Record<string, unknown> = {
    window: windowStub,
    document: documentStub,
    location: { origin: 'https://example.test' },
    console,
    Blob: BlobStub,
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => undefined },
    // 不给 indexedDB：这就是「浏览器不支持 / 被策略禁用」的形态。
    ...(options.indexedDB === undefined ? {} : { indexedDB: options.indexedDB }),
  }

  const context = vm.createContext(sandbox)
  vm.runInContext(source, context, { filename: 'host.html' })

  return {
    context,
    posted,
    loadedScripts,
    async launch(payload) {
      const handlers = listeners.get('message') ?? []
      expect(handlers.length).toBeGreaterThan(0)
      // ArrayBuffer 必须在同一个 realm 里创建：跨 realm 的 instanceof 恒为 false，
      // 宿主会因此判「没有收到有效的程序包字节」而不是走存档那条路。
      const bytes = vm.runInContext('new ArrayBuffer(32)', context)
      for (const handler of handlers) {
        handler({
          origin: 'https://example.test',
          source: parentWindow,
          data: { v: 1, type: 'runtime:launch', payload: { ...payload, bytes } },
        })
      }
      // 恢复链是 Promise 串起来的，让微任务跑完再断言。
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
    },
  }
}

function errorOf(harness: HostHarness): Posted | undefined {
  return harness.posted.find((message) => message.type === 'runtime:error')
}

describe('启动前的存档恢复', () => {
  it('没有 IndexedDB → 中止启动，并说明原因', async () => {
    const harness = bootHost()
    expect(harness.posted[0]?.type).toBe('host:ready')

    await harness.launch({ restore: [] })

    const error = errorOf(harness)
    expect(error?.payload.code).toBe('SAVE_RESTORE_FAILED')
    expect(String(error?.payload.message)).toContain('IndexedDB')
    // 关键：一个内核脚本都没装载。恢复了才准启动。
    expect(harness.loadedScripts).toEqual([])
  })

  it('恢复路径越界 → 中止启动，不把内核的其他文件当存档写', async () => {
    const harness = bootHost()
    await harness.launch({
      restore: [{ path: '/Phone/secret.db', bytes: new Uint8Array([1, 2, 3]) }],
    })

    expect(errorOf(harness)?.payload.code).toBe('SAVE_RESTORE_FAILED')
    expect(String(errorOf(harness)?.payload.message)).toContain('/Phone/secret.db')
    expect(harness.loadedScripts).toEqual([])
  })

  it('路径含 .. → 中止启动', async () => {
    const harness = bootHost()
    await harness.launch({
      restore: [{ path: '/RecordStore/../certs/_main.ks', bytes: new Uint8Array([1]) }],
    })

    expect(errorOf(harness)?.payload.code).toBe('SAVE_RESTORE_FAILED')
    expect(harness.loadedScripts).toEqual([])
  })

  it('重复路径 → 中止启动（否则后一个会静默盖掉前一个）', async () => {
    const harness = bootHost()
    await harness.launch({
      restore: [
        { path: '/RecordStore/a.db', bytes: new Uint8Array([1]) },
        { path: '/RecordStore/a.db', bytes: new Uint8Array([2]) },
      ],
    })

    expect(errorOf(harness)?.payload.code).toBe('SAVE_RESTORE_FAILED')
    expect(String(errorOf(harness)?.payload.message)).toContain('重复')
    expect(harness.loadedScripts).toEqual([])
  })

  it('文件过多 → 中止启动', async () => {
    const harness = bootHost()
    const restore = Array.from({ length: 33 }, (_, index) => ({
      path: `/RecordStore/${index}.db`,
      bytes: new Uint8Array([index]),
    }))
    await harness.launch({ restore })

    expect(errorOf(harness)?.payload.code).toBe('SAVE_RESTORE_FAILED')
    expect(harness.loadedScripts).toEqual([])
  })

  it('单个文件超限 → 中止启动', async () => {
    const harness = bootHost()
    await harness.launch({
      restore: [{ path: '/RecordStore/big.db', bytes: new Uint8Array(4 * 1024 * 1024 + 1) }],
    })

    expect(errorOf(harness)?.payload.code).toBe('SAVE_RESTORE_FAILED')
    expect(harness.loadedScripts).toEqual([])
  })

  it('恢复内容不是数组 → 中止启动', async () => {
    const harness = bootHost()
    await harness.launch({ restore: 'oops' })

    expect(errorOf(harness)?.payload.code).toBe('SAVE_RESTORE_FAILED')
    expect(harness.loadedScripts).toEqual([])
  })

  it('存储库打不开 → 中止启动，并把浏览器的错误名带出来', async () => {
    // 「打开失败」是最容易被写成「跳过」的一条：反正没数据，先跑起来再说。
    // 但跳过之后内核会自己建一个空库，游戏就在空档上玩了。
    const harness = bootHost({
      indexedDB: {
        databases: () => Promise.resolve([{ name: 'asyncStorage' }]),
        open() {
          const request: Record<string, unknown> = { error: { name: 'InvalidStateError' } }
          setTimeout(() => {
            const handler = request.onerror
            if (typeof handler === 'function') handler()
          }, 0)
          return request
        },
      },
    })

    await harness.launch({ restore: [] })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const error = errorOf(harness)
    expect(error?.payload.code).toBe('SAVE_RESTORE_FAILED')
    expect(String(error?.payload.message)).toContain('InvalidStateError')
    expect(harness.loadedScripts).toEqual([])
  })
})

describe('宿主自检', () => {
  it('能力声明里存档为 true —— 恢复与快照两条路都在宿主侧', () => {
    const harness = bootHost()
    const ready = harness.posted[0]
    expect((ready?.payload.capabilities as Record<string, unknown>)?.saves).toBe(true)
  })
})
