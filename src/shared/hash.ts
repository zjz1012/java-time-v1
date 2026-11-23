/**
 * 内容哈希。
 *
 * 单独抽出来是因为它有两个用途，且必须用同一套口径：
 *   1. 程序包指纹（存档隔离键），见 `MidletPackage.fingerprint`
 *   2. 存档文件清单校验（导入时逐文件比对），见 `saves/format.ts`
 *
 * 两处算法不一致就会出现「导出时算得过、导入时说被改过」这种无法解释的失败。
 */

/**
 * 优先用 `crypto.subtle`（浏览器与 Node 20+ 都有）。它只在安全上下文
 * （https / localhost）里可用 —— 子路径部署的 http 页面上会没有。
 *
 * 没有时返回带前缀的占位串而不是抛错：指纹只用于隔离，退化后仍然
 * 能隔离（同一份字节得到同一个占位），不会把功能变成不可用。
 * 但调用方要能从 `sha256:unavailable` 看出「这里没做真校验」。
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) return 'sha256:unavailable'
  // Uint8Array 可能是更大 buffer 的视图；digest 要的是整块 ArrayBuffer。
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return `sha256:${toHex(new Uint8Array(digest))}`
}

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] as number).toString(16).padStart(2, '0')
  }
  return out
}
