/**
 * 内容哈希。
 *
 * 单独抽出来是因为它有两个用途，且必须用同一套口径：
 *   1. 程序包指纹（存档隔离键），见 `MidletPackage.fingerprint`
 *   2. 存档文件清单校验（导入时逐文件比对），见 `saves/format.ts`
 *
 * 两处算法不一致就会出现「导出时算得过、导入时说被改过」这种无法解释的失败。
 *
 * ★ 这里**不允许**为了「能用」而退化成常量。指纹是存档隔离键：
 *   两个不同的 JAR 拿到同一个值，它们的存档就是同一个键 —— 会直接串档，
 *   而且看起来一切正常。所以策略是：
 *     1. 安全上下文里有 `crypto.subtle` → 用它（原生实现，最快）；
 *     2. 没有（或调用失败）→ 用纯 TS 实现（`./sha256`），结果逐位一致；
 *     3. 连纯实现都跑不起来（环境被裁剪到不正常的程度）→ 抛
 *        `HashUnavailableError`，调用方必须拒绝启动 / 拒绝导入。
 */
import { sha256 } from './sha256'

/** 指纹的统一前缀。带前缀是为了将来换算法时能一眼看出旧记录的来源。 */
const PREFIX = 'sha256:'

/** 64 位十六进制的 SHA-256。存档包的 manifest 与仓储主键都按这个格式校验。 */
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/

/**
 * 是否为合法的内容指纹。
 *
 * 用途不是「好看」，而是把「没算出来」挡在存档系统之外：任何固定串
 * （包括历史上的 `sha256:unavailable`）都过不了这个正则。
 */
export function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && FINGERPRINT.test(value)
}

/**
 * 环境无法计算摘要。
 *
 * 这是**硬失败**：没有指纹就没有游戏身份，也就无法隔离存档。
 * 调用方应当中止操作并说明原因，而不是用占位串顶替。
 */
export class HashUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'HashUnavailableError'
    if (options && 'cause' in options) this.cause = options.cause
  }
}

/**
 * 算 SHA-256，返回 `sha256:<64 位小写十六进制>`。
 *
 * @throws {HashUnavailableError} 两条实现路径都不可用时
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await digestSha256(bytes)
  return `${PREFIX}${toHex(digest)}`
}

async function digestSha256(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle
  if (subtle && typeof subtle.digest === 'function') {
    try {
      // Uint8Array 可能是更大 buffer 的视图；digest 要的是整块 ArrayBuffer。
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      const digest = await subtle.digest('SHA-256', buffer)
      return new Uint8Array(digest)
    } catch (cause) {
      // subtle 存在却调用失败（被策略拦、实现有 bug）：还能降级到纯实现。
      // 但要留痕 —— 这条路径不该经常发生。
      console.warn('[hash] crypto.subtle 不可用，改用内置 SHA-256 实现', cause)
    }
  }

  try {
    return sha256(bytes)
  } catch (cause) {
    throw new HashUnavailableError('当前环境无法计算内容指纹（缺少可用的 SHA-256 实现）', {
      cause,
    })
  }
}

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] as number).toString(16).padStart(2, '0')
  }
  return out
}
