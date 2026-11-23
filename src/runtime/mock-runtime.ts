import { TypedEmitter } from '@/shared/events'

import { BaseRuntime } from './adapter'
import { RuntimeFailure } from './errors'
import {
  RUNTIME_PROTOCOL_VERSION,
  isInputControl,
  type InputControl,
  type KeyPhase,
  type LoadOptions,
  type MidletPackage,
  type RuntimeCapabilities,
  type RuntimeEvents,
  type RuntimeState,
} from './types'

export interface MockRuntimeOptions {
  /** 人为延迟（毫秒），用于观察加载态与验证超时路径 */
  readonly latencyMs?: number
  /** 覆盖默认能力声明，用于测试「不支持」分支 */
  readonly capabilities?: Partial<RuntimeCapabilities>
  /** 指定某个操作抛错，用于测试错误路径 */
  readonly failOn?: 'load' | 'start' | 'pause' | 'resume' | 'speed' | 'stop'
  /** 载入后自动广播的帧数，0 表示不广播 */
  readonly framesAfterStart?: number
}

const DEFAULT_CAPABILITIES: RuntimeCapabilities = {
  speedControl: true,
  audio: false,
  frameTicks: true,
  pauseResume: true,
  keyInput: true,
}

/**
 * 不依赖内核的假实现。
 *
 * 存在的理由有两个：UI 开发不该被内核构建卡住；错误与超时路径
 * 只有用可控假实现才能稳定复现。它不模拟真实 JVM 行为，也不进生产包。
 */
export class MockRuntime extends BaseRuntime {
  readonly id = 'mock'
  readonly protocolVersion = RUNTIME_PROTOCOL_VERSION
  override readonly capabilities: RuntimeCapabilities

  protected override readonly emitter = new TypedEmitter<RuntimeEvents>()

  readonly #options: MockRuntimeOptions
  readonly #keys: Array<{ control: InputControl; phase: KeyPhase }> = []
  #speed = 1
  #frameTimer: ReturnType<typeof setInterval> | undefined
  #disposed = false

  constructor(options: MockRuntimeOptions = {}) {
    super()
    this.#options = options
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities }
  }

  get speed(): number {
    return this.#speed
  }

  async load(pkg: MidletPackage, options: LoadOptions = {}): Promise<void> {
    this.#assertAlive()
    if (pkg.bytes.length === 0) {
      this.transition('failed', 'empty package')
      throw new RuntimeFailure('PACKAGE_INVALID', '程序包为空')
    }
    this.transition('loading', 'load requested')
    await this.#delay(options.timeoutMs, 'load')
    this.#failIfConfigured('load')
    this.transition('ready', 'package loaded')
  }

  async start(): Promise<void> {
    this.#assertAlive()
    if (this.currentState() !== 'ready' && this.currentState() !== 'paused') {
      throw new RuntimeFailure(
        'INVALID_TRANSITION',
        `无法从 ${this.currentState()} 启动`,
      )
    }
    // 与真实实现保持同一个状态序列：先 starting，拿到「首帧」才 running。
    // 假实现若比真实现少一个状态，照它写的 UI 断言会在真内核上翻车。
    this.transition('starting', 'start')
    await this.#delay(undefined, 'start')
    this.#failIfConfigured('start')
    this.transition('running', 'first-frame')
    this.#scheduleFrames()
  }

  async pause(): Promise<void> {
    this.#assertAlive()
    if (!this.capabilities.pauseResume) {
      throw new RuntimeFailure('UNSUPPORTED_CAPABILITY', '当前内核不支持暂停')
    }
    if (this.currentState() !== 'running') {
      throw new RuntimeFailure('INVALID_TRANSITION', '只有运行中才能暂停')
    }
    this.#failIfConfigured('pause')
    this.#stopFrames()
    this.transition('paused', 'pause')
  }

  async resume(): Promise<void> {
    this.#assertAlive()
    if (!this.capabilities.pauseResume) {
      throw new RuntimeFailure('UNSUPPORTED_CAPABILITY', '当前内核不支持恢复')
    }
    if (this.currentState() !== 'paused') {
      throw new RuntimeFailure('INVALID_TRANSITION', '只有暂停中才能恢复')
    }
    this.#failIfConfigured('resume')
    this.transition('running', 'resume')
    this.#scheduleFrames()
  }

  async setSpeed(rate: number): Promise<void> {
    this.#assertAlive()
    if (!this.capabilities.speedControl) {
      throw new RuntimeFailure('UNSUPPORTED_CAPABILITY', '当前内核不支持调速')
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new RuntimeFailure('UNSUPPORTED_CAPABILITY', `非法速率 ${rate}`)
    }
    this.#failIfConfigured('speed')
    this.#speed = rate
  }

  sendKey(control: InputControl, phase: KeyPhase): boolean {
    if (this.#disposed) return false
    // 与真实实现同语义：游戏没在跑时按键无处可送。
    if (this.currentState() !== 'running') return false
    if (!isInputControl(control)) return false
    // 阶段校验也要有：假实现若比真实现宽松，照着它写的 UI 测试会在真内核上翻车。
    if (phase !== 'press' && phase !== 'release') return false
    this.#keys.push({ control, phase })
    return true
  }

  /** 测试用：取走并清空已记录的按键，避免断言依赖调用顺序之外的状态。 */
  drainKeys(): Array<{ control: InputControl; phase: KeyPhase }> {
    return this.#keys.splice(0, this.#keys.length)
  }

  async stop(): Promise<void> {
    this.#assertAlive()
    this.#stopFrames()
    this.transition('stopping', 'stop requested')
    await Promise.resolve()
    this.#failIfConfigured('stop')
    this.transition('stopped', 'stopped')
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#stopFrames()
    this.transition('stopped', 'disposed')
    this.emitter.clear()
  }

  /** 手动推进一帧，供测试确定性驱动。 */
  emitFrame(sequence: number): void {
    this.emitter.emit('frame', { sequence, timestamp: Date.now() })
  }

  /** 模拟 MIDlet 自行退出。 */
  emitExit(code = 0): void {
    this.#stopFrames()
    this.transition('stopped', 'midlet exited')
    this.emitter.emit('exit', { code })
  }

  /** 模拟不可恢复的运行时错误。 */
  emitError(code: 'INTERNAL', message: string): void {
    this.#stopFrames()
    this.transition('failed', 'runtime error')
    this.emitter.emit('error', { code, message })
  }

  #assertAlive(): void {
    if (this.#disposed) {
      throw new RuntimeFailure('INVALID_TRANSITION', '运行时已释放')
    }
  }

  #failIfConfigured(op: NonNullable<MockRuntimeOptions['failOn']>): void {
    if (this.#options.failOn === op) {
      throw new RuntimeFailure('INTERNAL', `模拟失败：${op}`)
    }
  }

  /**
   * 超时语义：调用方给的 `timeoutMs` 小于实际耗时则立刻判 TIMEOUT，
   * 而不是先等完再报错 —— 真实实现必须遵循同样语义，
   * 否则用户在慢设备上要白等到延迟结束才看到失败。
   */
  async #delay(timeoutMs: number | undefined, op: string): Promise<void> {
    const latency = this.#options.latencyMs ?? 0
    if (timeoutMs !== undefined && latency > timeoutMs) {
      throw new RuntimeFailure('TIMEOUT', `${op} 超时`)
    }
    if (latency <= 0) return
    await new Promise<void>((resolve) => {
      setTimeout(resolve, latency)
    })
  }

  #scheduleFrames(): void {
    const total = this.#options.framesAfterStart ?? 0
    if (total <= 0 || !this.capabilities.frameTicks) return
    let seq = 0
    this.#frameTimer = setInterval(() => {
      seq += 1
      this.emitFrame(seq)
      if (seq >= total && this.#frameTimer !== undefined) {
        this.#stopFrames()
      }
    }, 0)
  }

  #stopFrames(): void {
    if (this.#frameTimer !== undefined) {
      clearInterval(this.#frameTimer)
      this.#frameTimer = undefined
    }
  }
}

/** 类型守卫：让调用方在收到 RuntimeState 后能安全收窄。 */
export function isTerminalState(state: RuntimeState): boolean {
  return state === 'stopped' || state === 'failed'
}
