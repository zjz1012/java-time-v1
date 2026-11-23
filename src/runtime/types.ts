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
  /**
   * 启动指令已发出，等内核交出首帧。
   *
   * 与 `running` 必须分开：内核从收下 JAR 到出画有 2~4 秒，这段时间画面全黑。
   * 提前标成 `running` 会让「遮住画面」的判断失效，用户看到的就是一块黑屏
   * —— 与「已经挂了」长得一模一样。
   */
  | 'starting'
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
  /**
   * 能导出 / 恢复存档快照。
   *
   * 不声明就说明这个内核的存档只能留在自己肚子里 —— 那样外壳不该显示
   * 导出按钮，也不该假装做了按游戏隔离（见 ADR 0005）。
   */
  readonly saves: boolean
}

/**
 * 一份存档文件。`path` 是内核文件系统里的绝对路径。
 *
 * 快照只取 `/RecordStore` 子树：那是 RMS 的落地位置，也是唯一属于用户的数据。
 * `/_main.ks`（证书库）与 `/Phone` 等是内核自己建的结构，不属于存档。
 */
export interface SaveFile {
  readonly path: string
  /** 已提交的文件内容 */
  readonly bytes: Uint8Array
}

/** 为什么导出：静默期自动、退出前、用户手动。 */
export type SaveReason = 'idle' | 'stop' | 'manual'


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
  /**
   * 启动前要恢复的存档快照。
   *
   * **缺省等于空快照，也就是「清空内核里现有的 RMS」** —— 外壳是存档的真相来源，
   * 不传就代表这款游戏没有存档。这样两款游戏用同名 RMS 时不会互相读走对方的档
   * （内核的 suiteId 恒为 1，它自己不隔离，见 ADR 0005）。
   */
  readonly restore?: readonly SaveFile[]
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
  /**
   * 内核交出一份存档快照。
   *
   * 三个来源都在 `reason` 里：静默期自动归档（兜直接关页面）、退出前、用户手动导出。
   * 上层收到就该落盘 —— 快照是「此刻的事实」，不落就随下一个快照一起消失。
   */
  saves: {
    readonly reason: SaveReason
    readonly files: readonly SaveFile[]
  }
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
