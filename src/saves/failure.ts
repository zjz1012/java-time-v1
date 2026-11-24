/**
 * 归档写入失败的「怎么跟人说」。
 *
 * 为什么单独一层：这个失败发生在**退出路径**上，界面往往已经切走了，没人看着
 * 控制台。历史上这里只有一句 `console.warn` —— 配额满了、存储坏了，用户照样
 * 正常返回库页，只是最新的进度没存上，而且他不会知道。等到下次打开发现回到
 * 昨天，已经没有任何补救余地。
 *
 * 所以这里要产出的是「用户能据此做决定」的信息：
 *   - 是不是空间不够（可以去清点东西，或者至少知道不是游戏坏了）；
 *   - 原文是什么（报给开发者时这一句比「保存失败」有用得多）。
 */
import type { SaveFile } from '@/runtime/types'

export interface ArchiveFailure {
  /** 这次没写进去的快照。重试与紧急导出都用它，不再去问内核要。 */
  readonly files: readonly SaveFile[]
  /** 一句话给人看。 */
  readonly message: string
  /** 空间不足时单独标出来：界面要给的下一步不一样。 */
  readonly quota: boolean
}

/**
 * 判断是不是「存储空间不够」。
 *
 * 三家浏览器给的形态不一样：标准是 `QuotaExceededError`（name），老 WebKit
 * 与部分 IDB 实现只给 `code === 22`，Firefox 的历史值是 1014。三个都认，
 * 因为这类错误最需要说清楚 —— 「空间不足」和「存储坏了」用户要做的事完全不同。
 */
function isQuotaError(cause: unknown): boolean {
  if (typeof DOMException !== 'undefined' && cause instanceof DOMException) {
    if (cause.name === 'QuotaExceededError') return true
    if (cause.code === 22 || cause.code === 1014) return true
  }
  if (cause && typeof cause === 'object') {
    const named = cause as { name?: unknown; code?: unknown; message?: unknown }
    if (named.name === 'QuotaExceededError' || named.code === 22 || named.code === 1014) {
      return true
    }
    // 部分实现把配额信息只写在 message 里（Safari 的 IDB 曾经如此）。
    if (typeof named.message === 'string' && /quota|storage is full/i.test(named.message)) {
      return true
    }
  }
  return false
}

/** 把任意抛出物压成一行原文，别让界面上出现 `[object Object]`。 */
function reasonOf(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  if (typeof cause === 'string' && cause) return cause
  if (cause && typeof cause === 'object') {
    const message = (cause as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
    const name = (cause as { name?: unknown }).name
    if (typeof name === 'string' && name) return name
  }
  return '未知原因'
}

export function describeArchiveFailure(cause: unknown): {
  readonly message: string
  readonly quota: boolean
} {
  if (isQuotaError(cause)) {
    return {
      message: '设备存储空间不足，这一局的进度没能存下来',
      quota: true,
    }
  }
  return {
    message: `写入本地存储失败（${reasonOf(cause)}），这一局的进度没能存下来`,
    quota: false,
  }
}

/**
 * 攒一个失败记录。
 *
 * `files` 为空时返回 null：空快照的语义是「删掉这个游戏的存档」，删除失败最多
 * 让旧档多留一局（下次启动读回旧进度），不会丢东西，不值得在界面上敲一声。
 */
export function archiveFailureOf(
  files: readonly SaveFile[],
  cause: unknown,
): ArchiveFailure | null {
  if (files.length === 0) return null
  const { message, quota } = describeArchiveFailure(cause)
  return { files, message, quota }
}
