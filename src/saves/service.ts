/**
 * 存档服务：把「仓储」和「ZIP 格式」拼成 UI 能用的四个动作。
 *
 * 单独一层是因为有两条不显然的规则必须只写一遍：
 *   1. 启动前取不到归档时返回空数组，而不是 null —— 空数组在宿主侧
 *      的语义是「清空内核里的 RMS」，正是隔离要的效果（见 ADR 0005）。
 *   2. 导入先完整校验再写归档。校验在 `unpackSave` 里，这里只保证
 *      「校验通过之前不碰仓储」。
 */
import type { SaveFile } from '@/runtime/types'

import type { ArchivedSave, SaveRepository } from './archive'
import { packSave, unpackSave, type UnpackResult } from './format'

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
      const archived = await repository.read(fingerprint)
      return archived?.files ?? []
    },

    async archive(fingerprint, displayName, files) {
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
      const archived = await repository.read(fingerprint)
      if (!archived || archived.files.length === 0) return null
      return packSave({
        fingerprint,
        displayName: archived.displayName || displayName,
        files: archived.files,
      })
    },

    readZip(blob) {
      return blob.arrayBuffer().then((buffer) => unpackSave(buffer))
    },

    async applyImport(manifest, result) {
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
