/**
 * 最小 ZIP 读写，只支持 STORE（不压缩）。
 *
 * 为什么自己写而不是引一个库：
 *   1. 存档通常几十 KB，压缩收益抵不上一个第三方依赖的维护与许可成本；
 *   2. 浏览器自带的 `CompressionStream` 只有 deflate-raw，要拼成 ZIP 还得
 *      自己算 CRC、自己排布头部 —— 该写的代码没少，反而多了流式处理；
 *   3. STORE 的包任何解压工具都能打开，用户拿着 `.zip` 不会因为「只有你们
 *      自己的工具认得」而卡住。
 *
 * 读的时候严格：压缩方式不是 STORE 就整包拒绝，不猜、不半解。
 * 存档这种数据，「解出一半」比「解不出」更危险。
 */

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
/** 通用标志位 11：文件名是 UTF-8。不设的话中文文件名在别的工具里会乱码。 */
const FLAG_UTF8 = 0x0800
const VERSION = 20

export type ZipErrorCode = 'not-zip' | 'unsupported-method' | 'corrupt' | 'zip64'

export class ZipError extends Error {
  readonly code: ZipErrorCode

  constructor(code: ZipErrorCode, message: string) {
    super(message)
    this.name = 'ZipError'
    this.code = code
  }
}

export interface ZipEntry {
  readonly name: string
  readonly bytes: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** ZIP 的 MS-DOS 时间戳。1980 年之前钳到 1980，否则高位会溢出成负数。 */
function dosTimestamp(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

export function createZip(entries: readonly ZipEntry[], now: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder()
  const stamp = dosTimestamp(now)

  const prepared = entries.map((entry) => ({
    name: encoder.encode(entry.name),
    bytes: entry.bytes,
    crc: crc32(entry.bytes),
  }))

  let localSize = 0
  let centralSize = 0
  for (const entry of prepared) {
    localSize += 30 + entry.name.length + entry.bytes.length
    centralSize += 46 + entry.name.length
  }

  const out = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(out.buffer)
  let offset = 0

  // 每个条目的本地头偏移必须逐条记：中央目录里的 `local header offset`
  // 指的是「这一条自己的头在哪」，不是「从本地区起点算到哪」。
  const localOffsets: number[] = []

  for (const entry of prepared) {
    localOffsets.push(offset)
    view.setUint32(offset, LOCAL_SIG, true)
    view.setUint16(offset + 4, VERSION, true)
    view.setUint16(offset + 6, FLAG_UTF8, true)
    view.setUint16(offset + 8, 0, true) // STORE
    view.setUint16(offset + 10, stamp.time, true)
    view.setUint16(offset + 12, stamp.date, true)
    view.setUint32(offset + 14, entry.crc, true)
    view.setUint32(offset + 18, entry.bytes.length, true)
    view.setUint32(offset + 22, entry.bytes.length, true)
    view.setUint16(offset + 26, entry.name.length, true)
    view.setUint16(offset + 28, 0, true) // extra
    out.set(entry.name, offset + 30)
    out.set(entry.bytes, offset + 30 + entry.name.length)
    offset += 30 + entry.name.length + entry.bytes.length
  }

  const centralStart = offset
  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index] as (typeof prepared)[number]
    view.setUint32(offset, CENTRAL_SIG, true)
    view.setUint16(offset + 4, VERSION, true) // version made by
    view.setUint16(offset + 6, VERSION, true) // version needed
    view.setUint16(offset + 8, FLAG_UTF8, true)
    view.setUint16(offset + 10, 0, true) // STORE
    view.setUint16(offset + 12, stamp.time, true)
    view.setUint16(offset + 14, stamp.date, true)
    view.setUint32(offset + 16, entry.crc, true)
    view.setUint32(offset + 20, entry.bytes.length, true)
    view.setUint32(offset + 24, entry.bytes.length, true)
    view.setUint16(offset + 28, entry.name.length, true)
    view.setUint16(offset + 30, 0, true) // extra
    view.setUint16(offset + 32, 0, true) // comment
    view.setUint16(offset + 34, 0, true) // disk
    view.setUint16(offset + 36, 0, true) // internal attrs
    view.setUint32(offset + 38, 0, true) // external attrs
    view.setUint32(offset + 42, localOffsets[index] as number, true)
    out.set(entry.name, offset + 46)
    offset += 46 + entry.name.length
  }

  const centralEnd = offset
  view.setUint32(offset, EOCD_SIG, true)
  view.setUint16(offset + 4, 0, true) // 本盘号
  view.setUint16(offset + 6, 0, true) // 目录起始盘
  view.setUint16(offset + 8, prepared.length, true)
  view.setUint16(offset + 10, prepared.length, true)
  view.setUint32(offset + 12, centralEnd - centralStart, true)
  view.setUint32(offset + 16, centralStart, true)
  view.setUint16(offset + 20, 0, true) // 注释长度

  return out
}

/**
 * 读出全部条目。任何结构问题都抛 `ZipError`，不做「尽力而为」的解析：
 * 半个存档比没有存档更难排查。
 */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 22) throw new ZipError('not-zip', '文件太小，不是 ZIP')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // EOCD 在尾部，后面可能跟着最多 64KB 注释。倒着找签名。
  let eocd = -1
  const floor = Math.max(0, bytes.length - 65557)
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('not-zip', '找不到 ZIP 目录，文件可能已损坏')

  const count = view.getUint16(eocd + 10, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (centralOffset === 0xffffffff) {
    throw new ZipError('zip64', '不支持 ZIP64 格式')
  }
  if (centralOffset + 4 > bytes.length) {
    throw new ZipError('corrupt', 'ZIP 目录偏移越界')
  }

  const decoder = new TextDecoder('utf-8')
  const entries = new Map<string, Uint8Array>()
  let pointer = centralOffset

  for (let i = 0; i < count; i += 1) {
    if (pointer + 46 > bytes.length) throw new ZipError('corrupt', 'ZIP 目录不完整')
    if (view.getUint32(pointer, true) !== CENTRAL_SIG) {
      throw new ZipError('corrupt', 'ZIP 目录签名不符')
    }

    const method = view.getUint16(pointer + 10, true)
    const crc = view.getUint32(pointer + 16, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const uncompressedSize = view.getUint32(pointer + 24, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const localOffset = view.getUint32(pointer + 42, true)

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new ZipError('zip64', '不支持 ZIP64 格式')
    }
    if (pointer + 46 + nameLength > bytes.length) {
      throw new ZipError('corrupt', 'ZIP 文件名越界')
    }

    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength))

    if (method !== 0) {
      throw new ZipError('unsupported-method', `压缩方式 ${method} 不受支持（只接受 STORE）`)
    }
    if (localOffset + 30 > bytes.length) throw new ZipError('corrupt', `本地头越界：${name}`)
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new ZipError('corrupt', `本地头签名不符：${name}`)
    }

    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) throw new ZipError('corrupt', `数据越界：${name}`)

    const data = bytes.subarray(dataStart, dataEnd)
    if (data.length !== uncompressedSize) {
      throw new ZipError('corrupt', `长度不一致：${name}`)
    }
    if (crc32(data) !== crc) {
      throw new ZipError('corrupt', `校验失败：${name}`)
    }

    entries.set(name, data)
    pointer += 46 + nameLength + extraLength + commentLength
  }

  return entries
}
