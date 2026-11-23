import type { TypedEmitter } from '@/shared/events'

import type {
  InputControl,
  KeyPhase,
  LoadOptions,
  MidletPackage,
  RuntimeCapabilities,
  RuntimeEvents,
  RuntimeState,
  SaveFile,
} from './types'

/**
 * 运行时适配器契约。
 *
 * 所有方法都可能失败，统一抛 `RuntimeFailure`。调用方不应假设
 * 任何方法同步完成 —— 内核初始化可能跨多个宏任务。
 */
export interface RuntimeAdapter {
  /** 实现标识，用于日志与来源登记 */
  readonly id: string

  /** 能力声明；在 `load()` 之后才保证准确（部分内核要读到清单才知道） */
  readonly capabilities: RuntimeCapabilities

  currentState(): RuntimeState

  /**
   * 载入 MIDlet 包。成功后状态进入 `ready`，等待 `start()`。
   * 重复载入会先停止当前实例。
   */
  load(pkg: MidletPackage, options?: LoadOptions): Promise<void>

  /** 从 `ready` 进入 `running`。 */
  start(): Promise<void>

  /** 暂停。不支持时抛 `UNSUPPORTED_CAPABILITY`，不要静默忽略。 */
  pause(): Promise<void>

  resume(): Promise<void>

  /** 设置模拟速率，1 为正常速度。超出内核支持范围时抛 `UNSUPPORTED_CAPABILITY`。 */
  setSpeed(rate: number): Promise<void>

  /**
   * 注入一次按键。
   *
   * **同步**：输入路径每按一次就要走一遍，为一次按键分配一个 Promise 既没必要，
   * 也会让「按下」与「抬起」的先后顺序在微任务队列里变得不可预测。
   *
   * 返回是否送达。返回 `false` 不是错误 —— 游戏没在跑、或者内核还没装配好时，
   * 按键本来就无处可送。调用方据此决定是否提示，而不是当成异常。
   */
  sendKey(control: InputControl, phase: KeyPhase): boolean

  /**
   * 立刻导出一份存档快照。
   *
   * 只在 `running` 时可用：载入后内核还没装配文件系统，停止后 iframe 已经拆了。
   * 不允许时抛 `INVALID_TRANSITION`，不返回空数组 —— 空数组会让「导出成功但
   * 内容是空的」变成一个用户发现不了的故障。
   */
  snapshot(): Promise<readonly SaveFile[]>

  /** 停止并释放 MIDlet 占用的资源，状态回到 `stopped`。 */
  stop(): Promise<void>

  /** 彻底释放，之后不可再用。幂等。 */
  dispose(): Promise<void>

  /** 订阅事件，返回取消订阅函数。 */
  on<K extends keyof RuntimeEvents>(
    event: K,
    listener: (payload: RuntimeEvents[K]) => void,
  ): () => void
}

/** 供实现复用的基类：状态机、事件广播、订阅管理。 */
export abstract class BaseRuntime implements RuntimeAdapter {
  abstract readonly id: string
  abstract readonly capabilities: RuntimeCapabilities

  protected abstract readonly emitter: TypedEmitter<RuntimeEvents>

  #state: RuntimeState = 'idle'

  currentState(): RuntimeState {
    return this.#state
  }

  on<K extends keyof RuntimeEvents>(
    event: K,
    listener: (payload: RuntimeEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, listener)
  }

  /** 状态迁移。同状态重复设置是空操作，避免事件风暴。 */
  protected transition(next: RuntimeState, reason: string): void {
    if (this.#state === next) return
    const previous = this.#state
    this.#state = next
    this.emitter.emit('statechange', { previous, current: next, reason })
  }

  abstract load(pkg: MidletPackage, options?: LoadOptions): Promise<void>
  abstract start(): Promise<void>
  abstract pause(): Promise<void>
  abstract resume(): Promise<void>
  abstract setSpeed(rate: number): Promise<void>
  abstract sendKey(control: InputControl, phase: KeyPhase): boolean
  abstract snapshot(): Promise<readonly SaveFile[]>
  abstract stop(): Promise<void>
  abstract dispose(): Promise<void>
}
