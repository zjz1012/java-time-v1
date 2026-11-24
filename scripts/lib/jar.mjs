/**
 * 只读的 ZIP 读取（node 侧），给构建与校验脚本用。
 *
 * 为什么不复用 `src/library/jar.ts`：那是浏览器端的实现，用
 * `DecompressionStream`、依赖 `ReadableStream`，在纯 node 脚本里跑不起来
 * （也不该为了跑一次检查去起 jsdom）。两边各写一份是刻意的取舍：读取逻辑
 * 很短，而共享会逼着浏览器代码迁就 node 的运行时。
 *
 * 与浏览器那份一样，只信中央目录，不猜、不半解。
 */
import { inflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

/**
 * @typedef {object} JarEntry
 * @property {string} name
 * @property {number} method
 * @property {number} compressedSize
 * @property {number} size
 * @property {number} localOffset
 */

function findEocd(buf) {
  const stop = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= stop; i -= 1) {
    if (buf.readUInt32LE(i) !== EOCD_SIG) continue
    if (i + 22 + buf.readUInt16LE(i + 20) === buf.length) return i
  }
  return -1
}

/**
 * 读中央目录。结构不对就抛错 —— 脚本场景里「坏了」应该响，不该静默。
 * @param {Buffer} buf
 * @returns {JarEntry[]}
 */
export function readEntries(buf) {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('找不到 ZIP 目录（EOCD）')

  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  /** @type {JarEntry[]} */
  const entries = []

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buf.length) throw new Error('中央目录越界')
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) throw new Error('中央目录签名不符')

    const nameLength = buf.readUInt16LE(offset + 28)
    const extraLength = buf.readUInt16LE(offset + 30)
    const commentLength = buf.readUInt16LE(offset + 32)

    entries.push({
      name: buf.toString('utf8', offset + 46, offset + 46 + nameLength),
      method: buf.readUInt16LE(offset + 10),
      compressedSize: buf.readUInt32LE(offset + 20),
      size: buf.readUInt32LE(offset + 24),
      localOffset: buf.readUInt32LE(offset + 42),
    })

    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * 取一个条目的**解压后**字节。
 * @param {Buffer} buf
 * @param {JarEntry} entry
 * @returns {Buffer}
 */
export function readEntry(buf, entry) {
  const head = entry.localOffset
  if (head + 30 > buf.length) throw new Error(`${entry.name}: 本地头越界`)
  if (buf.readUInt32LE(head) !== LOCAL_SIG) throw new Error(`${entry.name}: 本地头签名不符`)

  const nameLength = buf.readUInt16LE(head + 26)
  const extraLength = buf.readUInt16LE(head + 28)
  const start = head + 30 + nameLength + extraLength
  const raw = buf.subarray(start, start + entry.compressedSize)

  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error(`${entry.name}: 不支持的压缩方式 ${entry.method}`)
}

/**
 * 取文本条目（manifest）。
 * @param {Buffer} buf
 * @param {JarEntry} entry
 */
export function readEntryText(buf, entry) {
  return readEntry(buf, entry).toString('utf8')
}

/**
 * 按名字找条目（大小写不敏感）。
 * @param {readonly JarEntry[]} entries
 * @param {string} name
 */
export function findEntry(entries, name) {
  const upper = name.toUpperCase()
  return entries.find((entry) => entry.name.toUpperCase() === upper)
}

/**
 * manifest 文本 → 键值表。只取主属性段（空行之前）。
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseManifest(text) {
  /** @type {Map<string, string>} */
  const values = new Map()
  /** @type {string[]} */
  const lines = []

  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') break
    if (raw.startsWith(' ') && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1)
      continue
    }
    lines.push(raw)
  }

  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    values.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  return values
}
