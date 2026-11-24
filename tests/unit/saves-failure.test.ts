import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createMemoryRepository, type SaveRepository } from '@/saves/archive'
import { archiveFailureOf, describeArchiveFailure } from '@/saves/failure'
import { unpackSave } from '@/saves/format'
import { createSaveService } from '@/saves/service'

function key(seed: string): string {
  return `sha256:${createHash('sha256').update(seed).digest('hex')}`
}

const FILES = [{ path: '/RecordStore/probe.db', bytes: new Uint8Array([1, 2, 3, 4]) }]

/**
 * 写入失败的说辞。
 *
 * 「空间不足」与「存储坏了」用户要做的事完全不同：前者去清理，后者报问题。
 * 都压成一句「保存失败」等于什么都没说。
 */
describe('归档失败的说辞', () => {
  it('标准 QuotaExceededError → 明确说是空间不够', () => {
    const { message, quota } = describeArchiveFailure(
      new DOMException('The quota has been exceeded.', 'QuotaExceededError'),
    )
    expect(quota).toBe(true)
    expect(message).toContain('存储空间不足')
  })

  it('只有 code 22 的老实现也认', () => {
    // 部分 WebKit / IDB 实现不给 name，只给旧码。认不出来就会说成
    // 「未知原因」，用户不知道该去清空间。
    const error = Object.assign(new Error('boom'), { code: 22 })
    expect(describeArchiveFailure(error).quota).toBe(true)
  })

  it('Firefox 的 1014 也认', () => {
    expect(describeArchiveFailure(Object.assign(new Error('x'), { code: 1014 })).quota).toBe(true)
  })

  it('message 里带 quota 的也认（Safari 曾如此）', () => {
    expect(describeArchiveFailure(new Error('QuotaExceededError: storage is full')).quota).toBe(true)
  })

  it('普通错误带上原文，且不说成空间不足', () => {
    const { message, quota } = describeArchiveFailure(new Error('transaction aborted'))
    expect(quota).toBe(false)
    expect(message).toContain('transaction aborted')
    expect(message).not.toContain('空间不足')
  })

  it('抛出物不是 Error 也不会出现 [object Object]', () => {
    for (const cause of ['磁盘挂了', { name: 'AbortError' }, 42, undefined, null]) {
      const { message } = describeArchiveFailure(cause)
      expect(message).not.toContain('[object Object]')
      expect(message.length).toBeGreaterThan(0)
    }
  })

  it('空快照的失败不算「进度要丢了」', () => {
    // 空快照的语义是删档。删不掉最多让旧档多留一局，不会丢数据。
    expect(archiveFailureOf([], new Error('boom'))).toBeNull()
  })

  it('非空快照的失败把文件一起留下，供重试与紧急导出', () => {
    const failure = archiveFailureOf(FILES, new Error('boom'))
    expect(failure?.files).toBe(FILES)
    expect(failure?.message).toContain('没能存下来')
  })
})

/**
 * 紧急导出。
 *
 * 它的价值全在「不依赖仓储」这一条：写不进去的时候，仓储本身就是坏的。
 * 所以这里用一个「读写必炸」的仓储来验证 —— 如果实现偷偷去读库，用例会红。
 */
describe('紧急导出（exportFiles）', () => {
  const broken: SaveRepository = {
    read: () => Promise.reject(new Error('仓储读不出来')),
    write: () => Promise.reject(new Error('仓储写不进去')),
    remove: () => Promise.reject(new Error('仓储删不掉')),
    list: () => Promise.reject(new Error('仓储列不出来')),
  }

  it('仓储全坏时仍然能导出内存里那份快照', async () => {
    const saves = createSaveService(broken)
    const blob = await saves.exportFiles(key('game-a'), '游戏 A', FILES)

    const unpacked = await unpackSave(await blob.arrayBuffer())
    expect(unpacked.files).toHaveLength(1)
    expect(unpacked.files[0]?.path).toBe('/RecordStore/probe.db')
    expect([...(unpacked.files[0]?.bytes ?? [])]).toEqual([1, 2, 3, 4])
    expect(unpacked.manifest.fingerprint).toBe(key('game-a'))
    expect(unpacked.manifest.displayName).toBe('游戏 A')
  })

  it('导出的包能被正常导入（不是只能看的半成品）', async () => {
    const saves = createSaveService(createMemoryRepository())
    const blob = await saves.exportFiles(key('game-a'), '游戏 A', FILES)
    const unpacked = await saves.readZip(blob)
    expect([...(unpacked.files[0]?.bytes ?? [])]).toEqual([1, 2, 3, 4])
  })

  it('指纹不合法就拒绝导出（键错了导出来的档装不进任何游戏）', async () => {
    const saves = createSaveService(broken)
    await expect(saves.exportFiles('sha256:unavailable', '游戏', FILES)).rejects.toThrow()
  })
})
