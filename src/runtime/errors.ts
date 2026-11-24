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
  /*
   * 超时要给出所有可能，不能只说「文件过大 / 性能不足」。
   * 内核遇到无效的包（比如根本不是 JAR）不会报错，它就是永远不出画 ——
   * 外壳只能等到超时。真凶常常是包本身，不是设备。
   */
  TIMEOUT: '启动超时。可能是程序包不完整、文件过大，或设备性能不足。',
  SAVE_RESTORE_FAILED: '存档没能恢复，已停止启动，避免游戏在空档上覆盖掉原存档。',
  ABORTED: '操作已取消。',
  INTERNAL: '运行组件内部错误。',
}

export function describeFailure(failure: RuntimeFailure): string {
  return describeErrorCode(failure.code, failure.message)
}

/**
 * 按错误码取文案。
 *
 * 单独暴露是因为 UI 也会从事件里收到 `RuntimeErrorPayload`（只有码，没有异常对象），
 * 两条路必须有同一套措辞 —— 否则同一个故障在「抛出来的」和「事件里的」场合
 * 会显示两种说法。
 *
 * `detail` 只对**我们自己写的**码生效（宿主页里的那句原因）。内核抛出的原始
 * 信息不往外透：它常常只有一句话，既不能告诉用户该做什么，也不该出现在界面上。
 */
export function describeErrorCode(code: RuntimeErrorCode, detail?: string): string {
  const base = USER_FACING[code] ?? USER_FACING.INTERNAL
  /*
   * 存档恢复失败必须带上原因：用户能做的事完全取决于它
   * （关掉别的标签页 / 清理站点数据 / 换个浏览器），
   * 一句「内部错误」等于让人无从下手。
   */
  if (code === 'SAVE_RESTORE_FAILED' && detail) return `${base}原因：${detail}。`
  /*
   * 内核缺某项 native 实现时，宿主页会把「缺的是哪个界面控件」翻成人话递上来。
   * 这句话必须显示出来：用户能做的是换一款游戏，而「当前运行组件不支持这个功能」
   * 单独看只会让人以为整个应用坏了。实测 104 款里有 6 款死在这里。
   */
  if (code === 'UNSUPPORTED_CAPABILITY' && detail) return `${base}${detail}。`
  return base
}
