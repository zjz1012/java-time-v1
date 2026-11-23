import type { RuntimeErrorCode, RuntimeErrorPayload } from './types'

/** 适配层抛出的统一异常。产品代码只需要处理这一种错误类型。 */
export class RuntimeFailure extends Error {
  readonly code: RuntimeErrorCode
  override readonly cause?: unknown

  constructor(code: RuntimeErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'RuntimeFailure'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }

  toPayload(): RuntimeErrorPayload {
    return this.cause === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, cause: this.cause }
  }
}

/** 面向用户的错误文案。内核抛出的原始信息不直接展示。 */
const USER_FACING: Record<RuntimeErrorCode, string> = {
  PACKAGE_INVALID: '这个文件不是有效的 J2ME 程序包，无法启动。',
  MIDLET_NOT_FOUND: '程序包里没有找到可启动的主程序。',
  PROTOCOL_MISMATCH: '运行组件版本不匹配，请刷新页面后重试。',
  INVALID_TRANSITION: '当前状态不允许这个操作。',
  UNSUPPORTED_CAPABILITY: '当前运行组件不支持这个功能。',
  TIMEOUT: '操作超时，可能是文件过大或设备性能不足。',
  ABORTED: '操作已取消。',
  INTERNAL: '运行组件内部错误。',
}

export function describeFailure(failure: RuntimeFailure): string {
  return describeErrorCode(failure.code)
}

/**
 * 按错误码取文案。
 *
 * 单独暴露是因为 UI 也会从事件里收到 `RuntimeErrorPayload`（只有码，没有异常对象），
 * 两条路必须有同一套措辞 —— 否则同一个故障在「抛出来的」和「事件里的」场合
 * 会显示两种说法。
 */
export function describeErrorCode(code: RuntimeErrorCode): string {
  return USER_FACING[code] ?? USER_FACING.INTERNAL
}
