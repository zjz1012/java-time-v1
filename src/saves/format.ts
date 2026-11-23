/**
 * 存档包的格式与校验。
 *
 * 一个包就是一份 ZIP：
 *
 *   manifest.json                 版本、指纹、展示名、导出时间、文件清单
 *   saves/RecordStore/<name>.db   内核 FS 里的原始文件，路径原样保留
 *
 * 校验顺序固定，任一步失败整包拒绝：ZIP 结构 → manifest 结构 → 清单与
 * 条目一一对应 → 每个文件的 sha256。**不做事后补救**，因为导入的最后一步
 * 是覆盖现有存档 —— 补救就等于把「包坏了」变成「档没了」。
 */
import type { SaveFile } from '@/runtime/types'
import { sha256Hex } from '@/shared/hash'

import { ZipError, createZip, readZip, type ZipEntry } from './zip'

export const SAVE_FORMAT = 'java-time-save'
export const SAVE_FORMAT_VERSION = 1

/** 只接受内核 RMS 的落地目录。别的路径一律视为构造出来的包。 */
export const SNAPSHOT_ROOT = '/RecordStore'

const MANIFEST_NAME = 'manifest.json'
const PAYLOAD_PREFIX = 'saves'

export type SaveFormatErrorCode =
  | 'not-save'
  | 'unsupported-version'
  | 'invalid-path'
  | 'missing-file'
  | 'unexpected-file'
  | 'hash-mismatch'
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

export function isSnapshotPath(path: string): boolean {
  return path === SNAPSHOT_ROOT || path.startsWith(`${SNAPSHOT_ROOT}/`)
}

function payloadName(path: string): string {
  return `${PAYLOAD_PREFIX}${path.startsWith('/') ? path : `/${path}`}`
}

function pathFromPayload(name: string): string | null {
  if (!name.startsWith(`${PAYLOAD_PREFIX}/`)) return null
  return name.slice(PAYLOAD_PREFIX.length)
}

export interface PackInput {
  readonly fingerprint: string
  readonly displayName: string
  readonly files: readonly SaveFile[]
  /** 固定时间戳，测试用 */
  readonly now?: Date
}

/** 打包。空快照也允许导出 —— 用户可能想留一份「这里是空的」的凭据。 */
export async function packSave(input: PackInput): Promise<Blob> {
  const entries: ZipEntry[] = []
  const manifestFiles: SaveManifestEntry[] = []

  for (const file of input.files) {
    if (!isSnapshotPath(file.path)) {
      throw new SaveFormatError('invalid-path', `快照里出现越界路径：${file.path}`)
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

  const zip = createZip(entries, input.now ?? new Date())
  return new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' })
}

export interface UnpackResult {
  readonly manifest: SaveManifest
  readonly files: readonly SaveFile[]
}

export async function unpackSave(input: ArrayBuffer | Uint8Array): Promise<UnpackResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)

  let entries: Map<string, Uint8Array>
  try {
    entries = readZip(bytes)
  } catch (cause) {
    if (cause instanceof ZipError) {
      throw new SaveFormatError('not-save', `不是有效的存档包：${cause.message}`)
    }
    throw cause
  }

  const manifestBytes = entries.get(MANIFEST_NAME)
  if (!manifestBytes) {
    throw new SaveFormatError('not-save', '包里没有 manifest.json，不是本工具导出的存档')
  }

  let manifest: SaveManifest
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as SaveManifest
  } catch {
    throw new SaveFormatError('not-save', 'manifest.json 无法解析')
  }

  if (manifest?.format !== SAVE_FORMAT) {
    throw new SaveFormatError('not-save', 'manifest 格式标识不符')
  }
  if (manifest.version !== SAVE_FORMAT_VERSION) {
    throw new SaveFormatError(
      'unsupported-version',
      `存档包版本 ${String(manifest.version)} 不受支持（当前 ${SAVE_FORMAT_VERSION}）`,
    )
  }
  if (!Array.isArray(manifest.files)) {
    throw new SaveFormatError('not-save', 'manifest 缺少文件清单')
  }

  const files: SaveFile[] = []
  const seen = new Set<string>()

  for (const entry of manifest.files) {
    if (typeof entry?.path !== 'string' || !isSnapshotPath(entry.path)) {
      throw new SaveFormatError('invalid-path', `清单里有越界路径：${String(entry?.path)}`)
    }
    if (seen.has(entry.path)) {
      throw new SaveFormatError('not-save', `清单里重复列出：${entry.path}`)
    }
    seen.add(entry.path)

    const payload = entries.get(payloadName(entry.path))
    if (!payload) {
      throw new SaveFormatError('missing-file', `包里缺少文件：${entry.path}`)
    }
    if (typeof entry.size === 'number' && payload.byteLength !== entry.size) {
      throw new SaveFormatError('hash-mismatch', `文件大小与清单不符：${entry.path}`)
    }

    const actual = await sha256Hex(payload)
    // `sha256:unavailable` 说明环境没有 WebCrypto：此时无法校验，宁可整包拒绝，
    // 也不要把「没校验」当成「校验通过」。导入是覆盖动作，不该赌。
    if (actual === 'sha256:unavailable') {
      throw new SaveFormatError('hash-mismatch', '当前环境无法校验文件完整性，已拒绝导入')
    }
    if (actual !== entry.sha256) {
      throw new SaveFormatError('hash-mismatch', `文件校验不通过：${entry.path}`)
    }

    files.push({ path: entry.path, bytes: payload })
  }

  // 反向检查：包里多出来的条目也算异常。多出来的可能是被塞进去的文件，
  // 只按清单取会把它静默丢掉，用户以为「导入成功了」但少了东西。
  for (const name of entries.keys()) {
    if (name === MANIFEST_NAME) continue
    const path = pathFromPayload(name)
    if (!path || !seen.has(path)) {
      throw new SaveFormatError('unexpected-file', `包里有清单之外的文件：${name}`)
    }
  }

  return { manifest, files }
}
