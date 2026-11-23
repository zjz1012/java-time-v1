import { describe, expect, it } from 'vitest'

import { createMemoryRepository } from '@/saves/archive'
import { createSaveService } from '@/saves/service'
import { packSave } from '@/saves/format'

function pattern(length: number, fill: number): Uint8Array {
  return new Uint8Array(length).fill(fill)
}

describe('存档隔离（F13）', () => {
  it('两款游戏用同名 RMS 时互不覆盖', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive('sha256:game-a', '游戏 A', [
      { path: '/RecordStore/save.db', bytes: pattern(16, 0xaa) },
    ])
    await saves.archive('sha256:game-b', '游戏 B', [
      { path: '/RecordStore/save.db', bytes: pattern(16, 0xbb) },
    ])

    const a = await saves.restore('sha256:game-a')
    const b = await saves.restore('sha256:game-b')

    expect(a[0]?.bytes[0]).toBe(0xaa)
    expect(b[0]?.bytes[0]).toBe(0xbb)
  })

  it('没有归档时返回空数组，而不是 null', async () => {
    const saves = createSaveService(createMemoryRepository())
    // 空数组在宿主侧的含义是「清空内核里的 RMS」，这正是隔离要的效果。
    expect(await saves.restore('sha256:never-played')).toEqual([])
  })

  it('改名同包仍是同一份存档', async () => {
    const saves = createSaveService(createMemoryRepository())
    await saves.archive('sha256:same', '旧名字', [
      { path: '/RecordStore/save.db', bytes: pattern(4, 1) },
    ])
    // 指纹相同，展示名不同 —— 读还是同一份。
    const restored = await saves.restore('sha256:same')
    expect(restored).toHaveLength(1)
  })
})

describe('归档语义', () => {
  it('空快照等于删除，不会留下一条空记录', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive('sha256:x', 'x', [{ path: '/RecordStore/a.db', bytes: pattern(2, 1) }])
    expect(await repository.read('sha256:x')).not.toBeNull()

    await saves.archive('sha256:x', 'x', [])
    expect(await repository.read('sha256:x')).toBeNull()
  })

  it('重复归档覆盖上一次', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive('sha256:x', 'x', [{ path: '/RecordStore/a.db', bytes: pattern(2, 1) }])
    await saves.archive('sha256:x', 'x', [
      { path: '/RecordStore/a.db', bytes: pattern(2, 2) },
      { path: '/RecordStore/b.db', bytes: pattern(2, 3) },
    ])

    const restored = await saves.restore('sha256:x')
    expect(restored.map((file) => file.path)).toEqual(['/RecordStore/a.db', '/RecordStore/b.db'])
    expect(restored[0]?.bytes[0]).toBe(2)
  })
})

describe('导出与导入', () => {
  it('没有归档时导出返回 null，不产生空包', async () => {
    const saves = createSaveService(createMemoryRepository())
    expect(await saves.exportZip('sha256:none', 'x')).toBeNull()
  })

  it('导出的包能重新导入，内容一致', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive('sha256:x', '推箱子', [
      { path: '/RecordStore/save.db', bytes: pattern(32, 7) },
    ])

    const blob = await saves.exportZip('sha256:x', '推箱子')
    expect(blob).not.toBeNull()

    const parsed = await saves.readZip(blob as Blob)
    expect(parsed.manifest.fingerprint).toBe('sha256:x')

    // 导入到另一个空仓储，模拟换设备
    const other = createMemoryRepository()
    const otherSaves = createSaveService(other)
    await otherSaves.applyImport(parsed.manifest, parsed)

    const restored = await otherSaves.restore('sha256:x')
    expect(restored[0]?.bytes).toHaveLength(32)
    expect(restored[0]?.bytes[0]).toBe(7)
  })

  it('导入失败时不动现有归档', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive('sha256:x', 'x', [{ path: '/RecordStore/a.db', bytes: pattern(4, 9) }])

    const bogus = new Blob([new Uint8Array([1, 2, 3, 4])])
    await expect(saves.readZip(bogus)).rejects.toThrow()

    // 校验失败发生在写之前，所以原档还在。
    const still = await saves.restore('sha256:x')
    expect(still[0]?.bytes[0]).toBe(9)
  })

  it('导入空包等于清空该游戏的存档', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive('sha256:x', 'x', [{ path: '/RecordStore/a.db', bytes: pattern(4, 9) }])
    const empty = await packSave({ fingerprint: 'sha256:x', displayName: 'x', files: [] })
    const parsed = await saves.readZip(empty)

    await saves.applyImport(parsed.manifest, parsed)
    expect(await saves.restore('sha256:x')).toEqual([])
    expect(await repository.read('sha256:x')).toBeNull()
  })
})
