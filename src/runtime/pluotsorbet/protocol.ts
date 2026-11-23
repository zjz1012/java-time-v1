import type { RuntimeCapabilities, RuntimeErrorCode, RuntimeState } from '../types'

/**
 * 外壳 ↔ 宿主页的消息协议。
 *
 * 宿主页在 iframe 内，与本模块只通过 postMessage 通信 —— 不共享模块作用域、
 * 不互相引用实现（见 ADR 0002）。因此这份协议是两边唯一的契约：
 * 改字段名必须同时改 `public/runtime/host.html` 里的内联脚本。
 *
 * 版本号在两侧各有一份字面量，`tests/unit/host-protocol.test.ts` 会读宿主页源码
 * 校验二者一致 —— 只靠人记会漂。
 */
export const HOST_PROTOCOL_VERSION = 1

/** 宿主页脚本就绪时发来的第一个事件。 */
export interface HostReadyEvent {
  readonly v: number
  readonly type: 'host:ready'
  readonly payload: {
    readonly protocolVersion: number
    readonly capabilities: RuntimeCapabilities
  }
}

export interface HostStateEvent {
  readonly v: number
  readonly type: 'runtime:state'
  readonly payload: {
    readonly state: RuntimeState
    /** 诊断用，不面向用户 */
    readonly reason: string
  }
}

export interface HostErrorEvent {
  readonly v: number
  readonly type: 'runtime:error'
  readonly payload: {
    readonly code: RuntimeErrorCode
    readonly message: string
  }
}

export type HostEvent = HostReadyEvent | HostStateEvent | HostErrorEvent

/** 启动指令：把字节交给宿主，由它装配内核。 */
export interface HostLaunchCommand {
  readonly v: number
  readonly type: 'runtime:launch'
  readonly payload: {
    readonly bytes: ArrayBuffer
    readonly mainClass?: string
  }
}

export interface HostStopCommand {
  readonly v: number
  readonly type: 'runtime:stop'
  readonly payload: Record<string, never>
}

export type HostCommand = HostLaunchCommand | HostStopCommand

/** 运行时判别：宿主发来的东西不可信，字段必须逐个验。 */
export function parseHostEvent(data: unknown): HostEvent | null {
  if (typeof data !== 'object' || data === null) return null
  const candidate = data as { v?: unknown; type?: unknown; payload?: unknown }
  if (candidate.v !== HOST_PROTOCOL_VERSION) return null
  if (typeof candidate.type !== 'string') return null

  const payload = candidate.payload
  if (typeof payload !== 'object' || payload === null) return null

  switch (candidate.type) {
    case 'host:ready':
    case 'runtime:state':
    case 'runtime:error':
      return candidate as unknown as HostEvent
    default:
      return null
  }
}
