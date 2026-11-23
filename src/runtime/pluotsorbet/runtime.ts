import { TypedEmitter } from '@/shared/events'

import { BaseRuntime } from '../adapter'
import { RuntimeFailure } from '../errors'
import { isInputControl } from '../types'
import type {
  InputControl,
  KeyPhase,
  LoadOptions,
  MidletPackage,
  RuntimeCapabilities,
  RuntimeErrorCode,
  RuntimeEvents,
} from '../types'
import {
  HOST_PROTOCOL_VERSION,
  parseHostEvent,
  type HostCommand,
  type HostEvent,
  type HostKeyCommand,
  type HostLaunchCommand,
  type PhysicalKeymap,
} from './protocol'

export interface PluotSorbetRuntimeOptions {
  /**
   * 承载 iframe 的容器。**必须已经有尺寸** —— 内核把 `#display` 的
   * clientWidth/clientHeight 当作物理屏幕尺寸，容器为 0 会导致画布 0×0。
   */
  readonly container: HTMLElement
  /** 宿主页地址；默认按当前文档位置解析，兼容子路径部署 */
  readonly hostUrl?: string
  /**
   * 物理键位表。交给宿主页，用于「焦点在游戏画面上」时接管键盘。
   * 焦点在外壳页面时由外壳自己送 `sendKey`，两条路的表是同一份。
   */
  readonly keymap?: PhysicalKeymap
  /** 等宿主页脚本就绪的上限 */
  readonly readyTimeoutMs?: number
  /** 从发出启动指令到首帧出现的上限。内核不会报告「启动完成」，只能等画面 */
  readonly startTimeoutMs?: number
}

const DEFAULT_READY_TIMEOUT_MS = 10_000
/*
 * 30 秒太长了。坏包（非 JAR、或无 MIDlet-1）不会让内核报错，它只是永远不出画 ——
 * 用户看到的就是一个转不完的圈。15 秒足够真机上冷加载 14MB 内核，
 * 再久就应该被告知失败，而不是继续等。
 */
const DEFAULT_START_TIMEOUT_MS = 15_000

interface Waiter {
  readonly test: (event: HostEvent) => boolean
  readonly resolve: (event: HostEvent) => void
  readonly reject: (failure: RuntimeFailure) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/**
 * 基于 PluotSorbet 内核的运行时实现。
 *
 * 内核跑在 iframe 里，本类不直接接触它的任何全局对象。这样做的主因是工程性的：
 * 内核需要 15 个 DOM 节点、`config` 是全局变量、`load()` 走写死的相对路径、
 * 崩溃会带走整个页面（见 ADR 0002 / 0003）。
 *
 * 能力边界如实声明：暂停、续跑、调速在本内核上没有可靠的实现手段，
 * 一律抛 `UNSUPPORTED_CAPABILITY`，不做「假装成功」。
 */
export class PluotSorbetRuntime extends BaseRuntime {
  readonly id = 'pluotsorbet'

  protected readonly emitter = new TypedEmitter<RuntimeEvents>()

  readonly #container: HTMLElement
  readonly #hostUrl: string
  readonly #keymap: PhysicalKeymap | undefined
  readonly #readyTimeoutMs: number
  readonly #startTimeoutMs: number

  #capabilities: RuntimeCapabilities = {
    speedControl: false,
    audio: false,
    frameTicks: false,
    pauseResume: false,
    keyInput: false,
  }

  #iframe: HTMLIFrameElement | null = null
  #waiter: Waiter | null = null
  #packageBytes: ArrayBuffer | null = null
  #launched = false
  #disposed = false
  #listening = false

  readonly #onMessage = (event: MessageEvent): void => {
    const frame = this.#iframe
    if (!frame) return
    // 同源 + 必须来自本 iframe。两者缺一不可：页面上任何脚本都能往这里 postMessage。
    if (event.origin !== window.location.origin) return
    if (event.source !== frame.contentWindow) return

    const parsed = parseHostEvent(event.data)
    if (!parsed) return

    if (parsed.type === 'host:ready') {
      this.#capabilities = parsed.payload.capabilities
      this.#settle(parsed)
      return
    }

    if (parsed.type === 'runtime:error') {
      // 错误是全局的：无论当前在等什么，都不可能再有结果了。
      const failure = new RuntimeFailure(
        parsed.payload.code,
        parsed.payload.message,
        parsed.payload,
      )
      this.transition('failed', `host-error:${parsed.payload.code}`)
      this.emitter.emit('error', failure.toPayload())
      this.#rejectAll(failure)
      return
    }

    if (parsed.type === 'runtime:state') {
      this.transition(parsed.payload.state, parsed.payload.reason)
      this.#settle(parsed)
    }
  }

  constructor(options: PluotSorbetRuntimeOptions) {
    super()
    this.#container = options.container
    this.#hostUrl =
      options.hostUrl ??
      new URL('runtime/host.html', document.baseURI).href
    this.#keymap = options.keymap
    this.#readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    this.#startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
  }

  get capabilities(): RuntimeCapabilities {
    return this.#capabilities
  }

  async load(pkg: MidletPackage, options?: LoadOptions): Promise<void> {
    this.#assertUsable()

    if (pkg.bytes.byteLength === 0) {
      throw new RuntimeFailure('PACKAGE_INVALID', '程序包为空')
    }

    // 内核不可重入：重载只能换一个干净的 iframe，不能在旧实例上重置。
    this.#teardown()
    this.#packageBytes = toArrayBuffer(pkg.bytes)
    this.#launched = false
    this.transition('loading', 'host-iframe-created')

    const frame = document.createElement('iframe')
    frame.title = 'J2ME 运行区'
    frame.setAttribute('allow', 'autoplay')
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:#000'
    frame.src = this.#hostUrl
    this.#iframe = frame

    if (!this.#listening) {
      window.addEventListener('message', this.#onMessage)
      this.#listening = true
    }
    this.#container.appendChild(frame)

    try {
      await this.#waitFor(
        (event) => event.type === 'host:ready',
        options?.timeoutMs ?? this.#readyTimeoutMs,
      )
    } catch (cause) {
      this.#teardown()
      this.transition('failed', 'host-not-ready')
      throw cause
    }

    this.transition('ready', 'package-loaded')
  }

  async start(): Promise<void> {
    this.#assertUsable()
    if (this.currentState() !== 'ready' || !this.#packageBytes) {
      throw new RuntimeFailure('INVALID_TRANSITION', '没有已载入的程序包，不能启动')
    }
    if (this.#launched) {
      throw new RuntimeFailure('INVALID_TRANSITION', '已经启动过了')
    }
    if (!this.#iframe?.contentWindow) {
      throw new RuntimeFailure('INTERNAL', '宿主窗口不可用')
    }

    this.#launched = true
    this.transition('running', 'launch-requested')

    // 不把 buffer 放进 transfer list：调用方可能还要用它算指纹或写存档，
    // 转移所有权会让对方的 Uint8Array 变成 detached。
    const command: HostLaunchCommand = {
      v: HOST_PROTOCOL_VERSION,
      type: 'runtime:launch',
      payload: {
        bytes: this.#packageBytes,
        // 只有给了表才带上这个字段：宿主据此区分「没接管键盘」与「接管了但表是空的」。
        ...(this.#keymap ? { keymap: this.#keymap } : {}),
      },
    }
    this.#iframe.contentWindow.postMessage(command, window.location.origin)

    try {
      await this.#waitFor(
        (event) => event.type === 'runtime:state' && event.payload.state === 'running',
        this.#startTimeoutMs,
        'TIMEOUT',
      )
    } catch (cause) {
      this.transition('failed', 'start-failed')
      throw cause
    }
  }

  async pause(): Promise<void> {
    // 内核没有暴露暂停入口。假装成功会让 UI 显示「已暂停」而画面还在跑。
    throw new RuntimeFailure('UNSUPPORTED_CAPABILITY', '当前内核不支持暂停')
  }

  async resume(): Promise<void> {
    throw new RuntimeFailure('UNSUPPORTED_CAPABILITY', '当前内核不支持续跑')
  }

  async setSpeed(): Promise<void> {
    throw new RuntimeFailure('UNSUPPORTED_CAPABILITY', '当前内核不支持调速')
  }

  /**
   * 按键注入。
   *
   * 三种情况返回 `false`，都不算错误：
   *   1. 没有 iframe（已释放或还没 `load`）；
   *   2. 游戏没在 `running`（加载中 / 已停）—— 按键此时无处可送；
   *   3. 宿主页还没把 `MIDP` 挂出来（`host:ready` 之后、`main-all.js` 之前）。
   *
   * 不排队补发：按键是「此刻」的输入，补发一个 300ms 前的方向键
   * 只会让角色莫名其妙地动一下。
   */
  sendKey(control: InputControl, phase: KeyPhase): boolean {
    if (this.#disposed) return false
    if (!isInputControl(control)) return false
    if (phase !== 'press' && phase !== 'release') return false
    if (this.currentState() !== 'running') return false

    const frame = this.#iframe
    const target = frame?.contentWindow
    if (!frame || !target) return false

    const command: HostKeyCommand = {
      v: HOST_PROTOCOL_VERSION,
      type: 'runtime:key',
      payload: { control, phase },
    }
    target.postMessage(command, window.location.origin)
    return true
  }

  async stop(): Promise<void> {
    if (this.#disposed) return
    const frame = this.#iframe
    if (!frame) {
      if (this.currentState() !== 'stopped') this.transition('stopped', 'nothing-to-stop')
      return
    }

    this.transition('stopping', 'stop-requested')
    const command: HostCommand = {
      v: HOST_PROTOCOL_VERSION,
      type: 'runtime:stop',
      payload: {} as Record<string, never>,
    }
    frame.contentWindow?.postMessage(command, window.location.origin)

    try {
      await this.#waitFor(
        (event) => event.type === 'runtime:state' && event.payload.state === 'stopped',
        2_000,
      )
    } catch {
      // 停不下来也必须停：内核没有优雅退出路径，直接拆 iframe 是唯一可靠的收尾。
    }

    this.#teardown()
    this.transition('stopped', 'stopped')
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#teardown()
    this.emitter.clear()
    if (this.currentState() !== 'stopped') this.transition('stopped', 'disposed')
  }

  /** 拆掉 iframe 与监听器，让下一个实例从零开始。 */
  #teardown(): void {
    if (this.#waiter) {
      clearTimeout(this.#waiter.timer)
      this.#waiter = null
    }
    this.#iframe?.remove()
    this.#iframe = null
    this.#packageBytes = null
    if (this.#listening) {
      window.removeEventListener('message', this.#onMessage)
      this.#listening = false
    }
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new RuntimeFailure('INVALID_TRANSITION', '运行时已释放')
    }
  }

  #settle(event: HostEvent): void {
    const waiter = this.#waiter
    if (!waiter) return
    if (!waiter.test(event)) return
    clearTimeout(waiter.timer)
    this.#waiter = null
    waiter.resolve(event)
  }

  #rejectAll(failure: RuntimeFailure): void {
    const waiter = this.#waiter
    if (!waiter) return
    clearTimeout(waiter.timer)
    this.#waiter = null
    waiter.reject(failure)
  }

  /**
   * 等待某个宿主事件。
   *
   * 同一时刻只允许一个等待者：适配器的操作本来就是串行的，
   * 允许多个等待者只会让「谁该对超时负责」变得模糊。
   */
  #waitFor(
    test: (event: HostEvent) => boolean,
    timeoutMs: number,
    code: RuntimeErrorCode = 'TIMEOUT',
  ): Promise<HostEvent> {
    if (this.#waiter) {
      return Promise.reject(new RuntimeFailure('INTERNAL', '已有操作在等待宿主响应'))
    }
    return new Promise<HostEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiter = null
        reject(new RuntimeFailure(code, `等待宿主响应超时（${timeoutMs}ms）`))
      }, timeoutMs)
      this.#waiter = { test, resolve, reject, timer }
    })
  }
}

/**
 * `Uint8Array` 可能是更大 buffer 的视图（切片、解包都会这样），
 * 直接取 `.buffer` 会把无关字节一起送过去，JAR 解析随即失败。
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer
  }
  return bytes.slice().buffer as ArrayBuffer
}
