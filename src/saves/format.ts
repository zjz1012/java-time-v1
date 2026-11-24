/**
 * 存档包的格式与校验。
 *
 * 一个包就是一份 ZIP：
 *
 *   manifest.json                 版本、指纹、展示名、导出时间、文件清单
 *   saves/RecordStore/<name>.db   内核 FS 里的原始文件，路径原样保留
 *
 * 校验顺序固定，任一步失败整包拒绝：包体大小 → ZIP 结构 → manifest 结构 →
 * 清单与条目一一对应 → 每个文件的 sha256。**不做事后补救**，因为导入的最后一步
 * 是覆盖现有存档 —— 补救就等于把「包坏了」变成「档没了」。
 *
 * ★ 这是用户可自行导入的入口，所以每一层都要有上界：包体、条目数、单文件
 *   大小、总量、路径长度、字段类型。只靠「我们自己导出的包总是合法的」来
 *   保证安全，等于没校验 —— 用户手里的包不经过我们。
 */
import type { SaveFile } from '@/runtime/types'
import { isFingerprint, sha256Hex } from '@/shared/hash'

import { ZipError, createZip, readZip, type ZipEntry, type ZipLimits } from './zip'

export const SAVE_FORMAT = 'java-time-save'
export const SAVE_FORMAT_VERSION = 1

/** 只接受内核 RMS 的落地目录。别的路径一律视为构造出来的包。 */
export const SNAPSHOT_ROOT = '/RecordStore'

/**
 * 一份存档的规模上限。
 *
 * 数字取「一局游戏的真实存档 × 很多倍」：RMS 单条记录上限 64KB，
 * 常见存档几个文件、几十 KB。给到 4 MiB/文件、8 MiB/包已经非常宽松，
 * 再大就属于异常，而不是「用户存得多」。
 */
export const SAVE_LIMITS = {
  maxFiles: 32,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxArchiveBytes: 12 * 1024 * 1024,
  /** 路径字符数上限（内核的 RMS 文件名很短，128 已经足够） */
  maxPathChars: 128,
  maxDisplayNameChars: 64,
} as const

const ZIP_LIMITS: ZipLimits = {
  maxEntries: SAVE_LIMITS.maxFiles + 1, // + manifest.json
  maxEntryBytes: SAVE_LIMITS.maxFileBytes,
  maxTotalBytes: SAVE_LIMITS.maxTotalBytes,
  maxArchiveBytes: SAVE_LIMITS.maxArchiveBytes,
  maxNameBytes: 160,
}

const MANIFEST_NAME = 'manifest.json'
const PAYLOAD_PREFIX = 'saves'
const MANIFEST_KEYS = new Set([
  'format',
  'version',
  'fingerprint',
  'displayName',
  'exportedAt',
  'files',
])
const ENTRY_KEYS = new Set(['path', 'size', 'sha256'])
const DIGEST = /^sha256:[0-9a-f]{64}$/

export type SaveFormatErrorCode =
  | 'not-save'
  | 'unsupported-version'
  | 'invalid-manifest'
  | 'invalid-path'
  | 'missing-file'
  | 'unexpected-file'
  | 'hash-mismatch'
  | 'too-large'
  | 'duplicate-file'
  | 'empty'

export class SaveFormatError extends Error {
  readonly code: SaveFormatErrorCode

  constructor(code: SaveFormatErrorCode, message: string) {
    super(message)
    this.name = 'SaveFormatError'
    this.code = code
  }
}

export interface SaveManifestEntry {
  readonly path: string
  readonly size: number
  readonly sha256: string
}

export interface SaveManifest {
  readonly format: typeof SAVE_FORMAT
  readonly version: number
  /** 导出时的程序包指纹。导入时不要求与当前游戏一致，只用于提示。 */
  readonly fingerprint: string
  readonly displayName: string
  readonly exportedAt: number
  readonly files: readonly SaveManifestEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * 内核 FS 的路径必须是从根开始、已规范化的路径。
 *
 * `..` 与空段落在这里就拒掉，而不是留给宿主去处理：宿主那边少写一条判断，
 * 就等于允许一个包把文件写到 `/RecordStore` 之外。
 */
export function isSnapshotPath(path: string): boolean {
  if (typeof path !== 'string') return false
  if (path !== SNAPSHOT_ROOT && !path.startsWith(`${SNAPSHOT_ROOT}/`)) return false
  if (path.length > SAVE_LIMITS.maxPathChars) return false
  if (path.includes('\\')) return false
  if (path.includes('\u0000') || hasControlChars(path)) return false
  const segments = path.slice(1).split('/')
  if (segments.length === 0) return false
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function payloadName(path: string): string {
  return `${PAYLOAD_PREFIX}${path.startsWith('/') ? path : `/${path}`}`
}

export interface PackInput {
  readonly fingerprint: string
  readonly displayName: string
  readonly files: readonly SaveFile[]
  /** 固定时间戳，测试用 */
  readonly now?: Date
}

/**
 * 打包。空快照也允许导出 —— 用户可能想留一份「这里是空的」的凭据。
 *
 * 导出侧和导入侧用同一套上限：出一个自己都导不回来的包，只会在换设备时
 * 才暴露，那时候用户已经没有别的备份了。
 */
export async function packSave(input: PackInput): Promise<Blob> {
  if (!isFingerprint(input.fingerprint)) {
    throw new SaveFormatError('invalid-manifest', '游戏指纹格式不合法，拒绝导出')
  }
  if (
    typeof input.displayName !== 'string' ||
    input.displayName.length === 0 ||
    input.displayName.length > SAVE_LIMITS.maxDisplayNameChars ||
    hasControlChars(input.displayName)
  ) {
    throw new SaveFormatError('invalid-manifest', '游戏名称不合法，拒绝导出')
  }
  if (input.files.length > SAVE_LIMITS.maxFiles) {
    throw new SaveFormatError(
      'too-large',
      `存档文件过多（${input.files.length} > ${SAVE_LIMITS.maxFiles}）`,
    )
  }

  const entries: ZipEntry[] = []
  const manifestFiles: SaveManifestEntry[] = []
  let total = 0

  for (const file of input.files) {
    if (!isSnapshotPath(file.path)) {
      throw new SaveFormatError('invalid-path', `快照里出现越界路径：${file.path}`)
    }
    if (file.bytes.byteLength > SAVE_LIMITS.maxFileBytes) {
      throw new SaveFormatError('too-large', `单个存档文件过大：${file.path}`)
    }
    total += file.bytes.byteLength
    if (total > SAVE_LIMITS.maxTotalBytes) {
      throw new SaveFormatError('too-large', '存档总大小超过上限')
    }
    entries.push({ name: payloadName(file.path), bytes: file.bytes })
    manifestFiles.push({
      path: file.path,
      size: file.bytes.byteLength,
      sha256: await sha256Hex(file.bytes),
    })
  }

  const manifest: SaveManifest = {
    format: SAVE_FORMAT,
    version: SAVE_FORMAT_VERSION,
    fingerprint: input.fingerprint,
    displayName: input.displayName,
    exportedAt: (input.now ?? new Date()).getTime(),
    files: manifestFiles,
  }

  const json = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  entries.unshift({ name: MANIFEST_NAME, bytes: json })

  let zip: Uint8Array
  try {
    zip = createZip(entries, input.now ?? new Date(), ZIP_LIMITS)
  } catch (cause) {
    if (cause instanceof ZipError) throw new SaveFormatError(zipCodeToFormat(cause.code), cause.message)
    throw cause
  }
  return new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' })
}

/**
 * `manifest.json` 的结构校验。
 *
 * 逐个字段查类型而不是「读出来就用」：manifest 决定导入时覆盖哪个游戏、
 * 覆盖哪些文件。缺一个类型检查，一个 `files: "x"` 就能让后面的循环
 * 变成对字符串的下标访问，报出来的错与真正的原因毫无关系。
 */
function readManifest(raw: unknown): SaveManifest {
  if (!isRecord(raw)) {
    throw new SaveFormatError('not-save', 'manifest 不是一个对象')
  }
  for (const key of Object.keys(raw)) {
    if (!MANIFEST_KEYS.has(key)) {
      throw new SaveFormatError('invalid-manifest', `manifest 有未知字段：${key}`)
    }
  }

  if (raw.format !== SAVE_FORMAT) {
    throw new SaveFormatError('not-save', 'manifest 格式标识不符')
  }

  const version = raw.version
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) {
    throw new SaveFormatError('invalid-manifest', 'manifest 缺少合法的版本号')
  }
  if (version !== SAVE_FORMAT_VERSION) {
    throw new SaveFormatError(
      'unsupported-version',
      `存档包版本 ${String(version)} 不受支持（当前 ${SAVE_FORMAT_VERSION}）`,
    )
  }

  const fingerprint = raw.fingerprint
  if (!isFingerprint(fingerprint)) {
    // 这一条同时挡住历史上的 `sha256:unavailable`：拿占位串当身份，
    // 所有游戏的存档会共享同一个键。
    throw new SaveFormatError('invalid-manifest', 'manifest 里的游戏指纹不是合法的 SHA-256')
  }

  const displayName = raw.displayName
  if (
    typeof displayName !== 'string' ||
    displayName.length === 0 ||
    displayName.length > SAVE_LIMITS.maxDisplayNameChars ||
    hasControlChars(displayName)
  ) {
    throw new SaveFormatError('invalid-manifest', 'manifest 里的游戏名称不合法')
  }

  const exportedAt = raw.exportedAt
  if (
    typeof exportedAt !== 'number' ||
    !Number.isSafeInteger(exportedAt) ||
    exportedAt < 0
  ) {
    throw new SaveFormatError('invalid-manifest', 'manifest 里的导出时间不合法')
  }

  const listed = raw.files
  if (!Array.isArray(listed)) {
    throw new SaveFormatError('not-save', 'manifest 缺少文件清单')
  }
  if (listed.length > SAVE_LIMITS.maxFiles) {
    throw new SaveFormatError(
      'too-large',
      `清单里的文件过多（${listed.length} > ${SAVE_LIMITS.maxFiles}）`,
    )
  }

  const files: SaveManifestEntry[] = []
  const seen = new Set<string>()
  let total = 0

  for (const item of listed) {
    if (!isRecord(item)) {
      throw new SaveFormatError('invalid-manifest', '清单里有非对象条目')
    }
    for (const key of Object.keys(item)) {
      if (!ENTRY_KEYS.has(key)) {
        throw new SaveFormatError('invalid-manifest', `清单条目有未知字段：${key}`)
      }
    }

    const path = item.path
    if (typeof path !== 'string' || !isSnapshotPath(path)) {
      throw new SaveFormatError('invalid-path', `清单里有越界路径：${String(path)}`)
    }
    if (seen.has(path)) {
      throw new SaveFormatError('duplicate-file', `清单里重复列出：${path}`)
    }
    seen.add(path)

    const size = item.size
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
      throw new SaveFormatError('invalid-manifest', `清单里的文件大小不合法：${path}`)
    }
    if (size > SAVE_LIMITS.maxFileBytes) {
      throw new SaveFormatError('too-large', `清单里的文件超过大小上限：${path}`)
    }

    const digest = item.sha256
    if (typeof digest !== 'string' || !DIGEST.test(digest)) {
      throw new SaveFormatError('invalid-manifest', `清单里的校验值格式不合法：${path}`)
    }

    total += size
    if (total > SAVE_LIMITS.maxTotalBytes) {
      throw new SaveFormatError('too-large', '清单里的文件总大小超过上限')
    }

    files.push({ path, size, sha256: digest })
  }

  return {
    format: SAVE_FORMAT,
    version: SAVE_FORMAT_VERSION,
    fingerprint,
    displayName,
    exportedAt,
    files,
  }
}

export interface UnpackResult {
  readonly manifest: SaveManifest
  readonly files: readonly SaveFile[]
}

export async function unpackSave(input: ArrayBuffer | Uint8Array): Promise<UnpackResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)

  if (bytes.byteLength === 0) {
    throw new SaveFormatError('empty', '文件是空的')
  }
  if (bytes.byteLength > SAVE_LIMITS.maxArchiveBytes) {
    throw new SaveFormatError(
      'too-large',
      `存档包超过上限（${bytes.byteLength} > ${SAVE_LIMITS.maxArchiveBytes} 字节）`,
    )
  }

  let entries: Map<string, Uint8Array>
  try {
    entries = readZip(bytes, ZIP_LIMITS)
  } catch (cause) {
    if (cause instanceof ZipError) {
      throw new SaveFormatError(zipCodeToFormat(cause.code), `不是有效的存档包：${cause.message}`)
    }
    throw cause
  }

  const manifestBytes = entries.get(MANIFEST_NAME)
  if (!manifestBytes) {
    throw new SaveFormatError('not-save', '包里没有 manifest.json，不是本工具导出的存档')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifestBytes))
  } catch {
    throw new SaveFormatError('not-save', 'manifest.json 无法解析')
  }

  const manifest = readManifest(parsed)

  const files: SaveFile[] = []
  for (const entry of manifest.files) {
    const payload = entries.get(payloadName(entry.path))
    if (!payload) {
      throw new SaveFormatError('missing-file', `包里缺少文件：${entry.path}`)
    }
    if (payload.byteLength !== entry.size) {
      throw new SaveFormatError('hash-mismatch', `文件大小与清单不符：${entry.path}`)
    }

    const actual = await sha256Hex(payload)
    if (actual !== entry.sha256) {
      throw new SaveFormatError('hash-mismatch', `文件校验不通过：${entry.path}`)
    }

    files.push({ path: entry.path, bytes: payload })
  }

  // 反向检查：包里多出来的条目也算异常。多出来的可能是被塞进去的文件，
  // 只按清单取会把它静默丢掉，用户以为「导入成功了」但少了东西。
  const listed = new Set(manifest.files.map((entry) => payloadName(entry.path)))
  for (const name of entries.keys()) {
    if (name === MANIFEST_NAME) continue
    if (!listed.has(name)) {
      throw new SaveFormatError('unexpected-file', `包里有清单之外的文件：${name}`)
    }
  }

  return { manifest, files }
}

/** ZIP 层的错误码映射到存档层的说法，界面只认后者。 */
function zipCodeToFormat(code: ZipError['code']): SaveFormatErrorCode {
  switch (code) {
    case 'too-large':
      return 'too-large'
    case 'too-many-entries':
      return 'too-large'
    case 'duplicate-entry':
      return 'duplicate-file'
    case 'invalid-name':
      return 'invalid-path'
    default:
      return 'not-save'
  }
}
