/**
 * 存档服务：把「仓储」和「ZIP 格式」拼成 UI 能用的四个动作。
 *
 * 单独一层是因为有两条不显然的规则必须只写一遍：
 *   1. 启动前取不到归档时返回空数组，而不是 null —— 空数组在宿主侧
 *      的语义是「清空内核里的 RMS」，正是隔离要的效果（见 ADR 0005）。
 *   2. 导入先完整校验再写归档。校验在 `unpackSave` 里，这里只保证
 *      「校验通过之前不碰仓储」。
 *   3. 指纹是仓储的键，所以每个入口都自己校验一次格式，不信任调用方。
 *      历史上 `sha256:unavailable` 这类占位串一旦成为键，所有游戏就共享
 *      同一份存档 —— 而这种串档在界面上看起来完全正常，没人会发现。
 */
import type { SaveFile } from '@/runtime/types'
import { isFingerprint } from '@/shared/hash'

import type { ArchivedSave, SaveRepository } from './archive'
import {
  SAVE_LIMITS,
  SaveFormatError,
  packSave,
  unpackSave,
  type UnpackResult,
} from './format'

/**
 * 指纹必须是 `sha256:<64 位小写十六进制>`。
 *
 * 这条断言守的是「键」而不是「值」：只要放进来一个不唯一的串（占位串、
 * 空串、文件名），两个不同的游戏就会落到同一个仓储键上，互相覆盖存档。
 * 覆盖之后界面上一切正常 —— 没有报错、没有空档，只是进度变成了别人的。
 */
function assertFingerprint(fingerprint: string): void {
  if (!isFingerprint(fingerprint)) {
    throw new SaveFormatError(
      'invalid-manifest',
      `游戏指纹不是合法的 SHA-256（${brief(fingerprint)}），拒绝按它读写存档`,
    )
  }
}

function brief(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value)
  return text.length > 32 ? `${text.slice(0, 32)}…` : text || '（空）'
}

export interface SaveService {
  /** 启动前要灌进内核的快照。没有归档时返回空数组，不是 null。 */
  restore(fingerprint: string): Promise<readonly SaveFile[]>
  /** 归档一份快照。空快照等于「删掉这个游戏的存档」。 */
  archive(fingerprint: string, displayName: string, files: readonly SaveFile[]): Promise<void>
  /** 打一个 ZIP 包给用户下载。 */
  exportZip(fingerprint: string, displayName: string): Promise<Blob | null>
  /** 解析并校验一个包。**不写归档** —— 写不写由调用方决定。 */
  readZip(blob: Blob): Promise<UnpackResult>
  /** 把一个已校验的包写进归档。 */
  applyImport(manifest: UnpackResult['manifest'], result: UnpackResult): Promise<void>
  list(): Promise<ArchivedSave[]>
}

export function createSaveService(repository: SaveRepository): SaveService {
  return {
    async restore(fingerprint) {
      assertFingerprint(fingerprint)
      const archived = await repository.read(fingerprint)
      return archived?.files ?? []
    },

    async archive(fingerprint, displayName, files) {
      // 这一条在退出时触发，界面上没人看着 —— 所以更不能「算了就这样写」。
      // 写进共享键 = 把这款游戏的存档盖到别的游戏头上；抛错则只是这一次没存上。
      assertFingerprint(fingerprint)
      if (files.length === 0) {
        // 不写空记录：否则「这个游戏有没有存档」会变成「键存不存在」，
        // 导出时会得到一个没有内容的包，用户以为存过档。
        await repository.remove(fingerprint)
        return
      }
      await repository.write({
        fingerprint,
        displayName,
        updatedAt: Date.now(),
        files,
      })
    },

    async exportZip(fingerprint, displayName) {
      assertFingerprint(fingerprint)
      const archived = await repository.read(fingerprint)
      if (!archived || archived.files.length === 0) return null
      return packSave({
        fingerprint,
        displayName: archived.displayName || displayName,
        files: archived.files,
      })
    },

    readZip(blob) {
      // 先看体积再读进内存：`arrayBuffer()` 会把整份文件复制一遍，
      // 一个几百 MB 的假包足以让标签页在「校验」开始之前就卡死。
      if (blob.size > SAVE_LIMITS.maxArchiveBytes) {
        return Promise.reject(
          new SaveFormatError(
            'too-large',
            `存档包超过上限（${blob.size} > ${SAVE_LIMITS.maxArchiveBytes} 字节）`,
          ),
        )
      }
      return blob.arrayBuffer().then((buffer) => unpackSave(buffer))
    },

    async applyImport(manifest, result) {
      // manifest 已经过 `readManifest` 的 `isFingerprint` 检查，这里再查一次
      // 是刻意的冗余：服务层自己守门，上游换了实现也不会漏。
      assertFingerprint(manifest.fingerprint)
      // 空包等于「清空这款游戏的存档」，与 `archive` 的空语义保持一致。
      if (result.files.length === 0) {
        await repository.remove(manifest.fingerprint)
        return
      }
      await repository.write({
        fingerprint: manifest.fingerprint,
        displayName: manifest.displayName,
        updatedAt: Date.now(),
        files: result.files,
      })
    },

    list() {
      return repository.list()
    },
  }
}
