/**
 * 运行时适配层的公共类型。
 *
 * 这一层是产品代码与 J2ME 内核之间唯一的接触面：UI 永远不直接摸内核的
 * 全局对象，内核也永远不知道页面长什么样。契约是本项目独立设计的，
 * 与任何第三方桥接约定无关（见 docs/decisions/0002-runtime-adapter.md）。
 */

/** 桥接协议版本。内核侧与外壳侧不一致时必须在加载阶段就报错，而不是运行到一半才炸。 */
export const RUNTIME_PROTOCOL_VERSION = 1

/**
 * 逻辑按键名。
 *
 * 外壳只认识这些名字，**不认识也永远不该认识设备键码** —— 键码是内核的实现细节
 * （PluotSorbet 的 direction 用的是小写字母的 ASCII 码，不是方向键的键码），
 * 换内核就会变。翻译放在内核侧的宿主页里，见 docs/architecture/kernel-contract.md §12。
 */
export const INPUT_CONTROLS = [
  'up',
  'down',
  'left',
  'right',
  'fire',
  'soft1',
  'soft2',
  'clear',
  'star',
  'pound',
  'num0',
  'num1',
  'num2',
  'num3',
  'num4',
  'num5',
  'num6',
  'num7',
  'num8',
  'num9',
] as const

export type InputControl = (typeof INPUT_CONTROLS)[number]

/** `press` 与 `release` 必须成对；只发 `press` 会让游戏里的键一直处于按下态。 */
export type KeyPhase = 'press' | 'release'

/** 运行时判别。宿主发来的控制名不可信，进内核前要验。 */
export function isInputControl(value: unknown): value is InputControl {
  return typeof value === 'string' && (INPUT_CONTROLS as readonly string[]).includes(value)
}

export type RuntimeState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'failed'

/**
 * 能力声明。外壳据此决定是否显示对应按钮 ——
 * 而不是先显示再在点击时失败。
 */
export interface RuntimeCapabilities {
  /** 可调整模拟速率 */
  readonly speedControl: boolean
  /** 有音频输出 */
  readonly audio: boolean
  /** 提供逐帧回调，可用于帧率统计与掉帧提示 */
  readonly frameTicks: boolean
  /** 支持暂停后继续（部分内核只能停不能续） */
  readonly pauseResume: boolean
  /**
   * 接受按键注入。为 false 时外壳不渲染键区 ——
   * 显示一个按了没反应的键区，比不显示更糟。
   */
  readonly keyInput: boolean
}

/** 一个待运行的 MIDlet 包。字节由调用方持有，运行时不得外传。 */
export interface MidletPackage {
  /** 稳定的内容指纹（如 SHA-256），用于存档隔离与去重 */
  readonly fingerprint: string
  /** 展示名，来自清单或文件名，不参与身份判定 */
  readonly displayName: string
  /** JAR 原始字节 */
  readonly bytes: Uint8Array
  /** 显式主类；省略时由运行时从 MANIFEST 推断 */
  readonly mainClass?: string
}

export interface LoadOptions {
  /** 单次操作的超时毫秒数，默认由各实现决定 */
  readonly timeoutMs?: number
}

export type RuntimeErrorCode =
  | 'PACKAGE_INVALID'
  | 'MIDLET_NOT_FOUND'
  | 'PROTOCOL_MISMATCH'
  | 'INVALID_TRANSITION'
  | 'UNSUPPORTED_CAPABILITY'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'INTERNAL'

export interface RuntimeErrorPayload {
  readonly code: RuntimeErrorCode
  readonly message: string
  /** 原始异常，仅用于日志，不展示给用户 */
  readonly cause?: unknown
}

export interface RuntimeEvents extends Record<string, unknown> {
  statechange: {
    readonly previous: RuntimeState
    readonly current: RuntimeState
    /** 触发原因，用于诊断；不面向用户 */
    readonly reason: string
  }
  frame: {
    /** 单调递增的帧序号，从 1 开始 */
    readonly sequence: number
    /** 高精度时间戳（performance.now 口径） */
    readonly timestamp: number
  }
  error: RuntimeErrorPayload
  exit: {
    /** MIDlet 自行退出时携带的返回码，异常退出为 -1 */
    readonly code: number
  }
}

export interface RuntimeInfo {
  readonly id: string
  readonly protocolVersion: number
  readonly capabilities: RuntimeCapabilities
}
