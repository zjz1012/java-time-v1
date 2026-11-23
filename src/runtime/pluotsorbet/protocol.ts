import type {
  InputControl,
  KeyPhase,
  RuntimeCapabilities,
  RuntimeErrorCode,
  RuntimeState,
  SaveFile,
  SaveReason,
} from '../types'

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

/**
 * 存档快照里的一份文件。
 *
 * 类型定义在 `../types`（事件契约也用它），这里只说明本协议怎么搬它：
 * 走结构化克隆，`bytes` 到接收侧仍是 Uint8Array，不需要 base64。
 */
export interface HostSavesEvent {
  readonly v: number
  readonly type: 'runtime:saves'
  readonly payload: {
    readonly reason: SaveReason
    readonly files: readonly SaveFile[]
  }
}

export type HostEvent = HostReadyEvent | HostStateEvent | HostErrorEvent | HostSavesEvent

/**
 * 键盘映射：物理键（`KeyboardEvent.code`）→ 逻辑按键名。
 *
 * 放在启动指令里而不是写死在宿主页，是为了让「一台机器的键位策略」
 * 只有一份定义（`src/input/keymap.ts`）。宿主页不认识物理键的语义，
 * 只负责在按下时把 code 查成控制名、再去查设备键码。
 */
export type PhysicalKeymap = Readonly<Record<string, InputControl>>

/** 启动指令：把字节交给宿主，由它装配内核。 */
export interface HostLaunchCommand {
  readonly v: number
  readonly type: 'runtime:launch'
  readonly payload: {
    readonly bytes: ArrayBuffer
    readonly mainClass?: string
    /** 缺省时宿主不接管物理键盘，只有外壳注入的按键有效 */
    readonly keymap?: PhysicalKeymap
    /**
     * 启动前要灌进内核 FS 的存档。
     *
     * 必须在页面侧写下，不能等内核起来再写：内核没有任何「已 init、MIDlet 未跑」
     * 的插入点，而 MIDlet 一开跑就可能读档（见 ADR 0005）。
     */
    readonly restore?: readonly SaveFile[]
  }
}

/**
 * 按键指令。
 *
 * 走独立指令而不是合成 DOM 键盘事件，原因见 kernel-contract.md §12：
 * 内核的按键监听读的是 `ev.which`，而它期待的是「设备键码」——
 * 字母键的 `which` 是大写 ASCII（D=68），方向键的 `which` 是 37~40，
 * 两者都不在内核的游戏动作表里。合成事件只能改 `code`/`key`，
 * 改不了这两者与设备键码之间的错位。
 */
export interface HostKeyCommand {
  readonly v: number
  readonly type: 'runtime:key'
  readonly payload: {
    readonly control: InputControl
    readonly phase: KeyPhase
  }
}

export interface HostStopCommand {
  readonly v: number
  readonly type: 'runtime:stop'
  readonly payload: Record<string, never>
}

/**
 * 立刻导出一份快照。
 *
 * 静默期归档有约 4 秒滞后（要等游戏写完才敢读），用户点「导出」时不能等，
 * 所以给一条强制读的指令。
 */
export interface HostSnapshotCommand {
  readonly v: number
  readonly type: 'runtime:snapshot'
  readonly payload: Record<string, never>
}

export type HostCommand =
  | HostLaunchCommand
  | HostKeyCommand
  | HostStopCommand
  | HostSnapshotCommand

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
    case 'runtime:saves':
      return candidate as unknown as HostEvent
    default:
      return null
  }
}
