/**
 * 测试用的最小 ZIP 构造器。
 *
 * 为什么不用 `saves/zip.ts` 的 `createZip`：那个只写 STORE，而真实 JAR 的
 * `MANIFEST.MF` 几乎都是 deflate 压缩的 —— 用 STORE 造样本等于跳过了主路径。
 *
 * 这里不写 CRC32：被测的 `jar.ts` 只按中央目录定位、按本地头取数据，
 * 从不校验 CRC。填 0 不影响任何断言，反而少一处会算错的地方。
 */
import { deflateRawSync } from 'node:zlib'

export interface ZipFixtureEntry {
  readonly name: string
  readonly data: Uint8Array | string
  /** true 用 deflate，false 用 STORE */
  readonly deflate: boolean
}

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

export function buildZip(
  entries: readonly ZipFixtureEntry[],
  options: { readonly comment?: string } = {},
): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data
    const body = entry.deflate ? new Uint8Array(deflateRawSync(raw)) : raw
    const method = entry.deflate ? 8 : 0

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, LOCAL_SIG, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0, true)
    lv.setUint16(8, method, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)

    parts.push(local, body)

    const header = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(header.buffer)
    cv.setUint32(0, CENTRAL_SIG, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, method, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    header.set(nameBytes, 46)
    central.push(header)

    offset += local.length + body.length
  }

  const commentBytes = encoder.encode(options.comment ?? '')
  const centralSize = central.reduce((sum, part) => sum + part.length, 0)

  const eocd = new Uint8Array(22 + commentBytes.length)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, EOCD_SIG, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, commentBytes.length, true)
  eocd.set(commentBytes, 22)

  const all = [...parts, ...central, eocd]
  const total = all.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of all) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

/** 一份合法的 MIDlet manifest 文本。 */
export function manifestText(name: string, vendor = 'zhimiao'): string {
  return [
    'Manifest-Version: 1.0',
    `MIDlet-Name: ${name}`,
    'MIDlet-Version: 1.0',
    `MIDlet-Vendor: ${vendor}`,
    `MIDlet-1: ${name},,MainMidlet`,
    'MicroEdition-Configuration: CLDC-1.1',
    'MicroEdition-Profile: MIDP-2.0',
    '',
  ].join('\r\n')
}
