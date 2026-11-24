/**
 * 纯 TypeScript 的 SHA-256（FIPS 180-4）。
 *
 * 存在的唯一理由是**兜底**：`crypto.subtle` 只在安全上下文里可用，
 * 而程序包指纹是存档隔离键 —— 没有它就不能把两款游戏的存档分开。
 *
 * 为什么不用一个固定占位串代替：占位串对所有输入返回同一个值，
 * 于是所有游戏共享同一个存档键，直接串档；而且它看起来像正常指纹，
 * 不会有人发现。宁可算得慢一点，也不能让身份判定失效。
 *
 * 实现按一次性输入处理（整段补位后分块压缩）。调用方只有两类：
 * JAR 内容（几十 KB ~ 几 MB）与单个存档文件（上限 4 MiB），
 * 不需要流式接口。
 */

/** 前 64 个素数立方根小数部分的前 32 位。 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** 循环右移。JS 的位运算先把操作数转 32 位有符号，必须显式 `>>> 0` 还原。 */
function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0
}

/**
 * 计算 SHA-256，返回 32 字节摘要。
 *
 * @param bytes 原文。只读，不会被修改。
 */
export function sha256(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.byteLength * 8
  // 补位：0x80 + 若干 0x00 + 64 位大端长度，凑到 64 字节的整数倍。
  const paddedLength = (((bytes.byteLength + 8) >>> 6) << 6) + 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.byteLength] = 0x80

  const view = new DataView(padded.buffer)
  // 长度写成 64 位：高 32 位对任何现实的输入都是 0，但仍按公式算，
  // 免得以后有人拿它去算超大文件时悄悄算错。
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  const h0 = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false)
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15] as number
      const y = w[i - 2] as number
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0
    }

    let a = h0[0] as number
    let b = h0[1] as number
    let c = h0[2] as number
    let d = h0[3] as number
    let e = h0[4] as number
    let f = h0[5] as number
    let g = h0[6] as number
    let h = h0[7] as number

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + s1 + ch + (K[i] as number) + (w[i] as number)) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + maj) >>> 0

      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    h0[0] = ((h0[0] as number) + a) >>> 0
    h0[1] = ((h0[1] as number) + b) >>> 0
    h0[2] = ((h0[2] as number) + c) >>> 0
    h0[3] = ((h0[3] as number) + d) >>> 0
    h0[4] = ((h0[4] as number) + e) >>> 0
    h0[5] = ((h0[5] as number) + f) >>> 0
    h0[6] = ((h0[6] as number) + g) >>> 0
    h0[7] = ((h0[7] as number) + h) >>> 0
  }

  const digest = new Uint8Array(32)
  const out = new DataView(digest.buffer)
  for (let i = 0; i < 8; i += 1) {
    out.setUint32(i * 4, h0[i] as number, false)
  }
  return digest
}
