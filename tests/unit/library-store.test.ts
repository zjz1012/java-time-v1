import { describe, expect, it } from 'vitest'

import { createMemoryLibraryRepository } from '@/library/store'
import type { ImportDraft } from '@/library/store'

/**
 * 仓储的行为断言。用内存实现：jsdom 没有 IndexedDB，而「覆盖、去重、累加」
 * 这些恰恰是最该被断言的部分，不能因为环境缺能力就整块不测。
 */

function draft(overrides: Partial<ImportDraft> & { id: string }): ImportDraft {
  return {
    title: overrides.id,
    subtitle: '本地导入',
    category: 'imported',
    author: '本地导入',
    fingerprint: `sha256:${'0'.repeat(64)}`,
    importedAt: 1000,
    bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
    ...overrides,
  }
}

describe('导入的游戏仓储', () => {
  it('写进去能读回来，字节一致', async () => {
    const repository = createMemoryLibraryRepository()
    await repository.saveImported(draft({ id: 'user-1' }))

    const bytes = await repository.readBytes('user-1')
    expect(bytes).not.toBeNull()
    expect([...(bytes as Uint8Array)]).toEqual([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])
  })

  it('列表里不带字节，但带上大小与来源', async () => {
    const repository = createMemoryLibraryRepository()
    await repository.saveImported(draft({ id: 'user-1' }))

    const [entry] = await repository.listImported()
    expect(entry).toMatchObject({ id: 'user-1', source: 'imported', bytes: 7 })
    // 列表项不该携带 ArrayBuffer：104 款游戏的库页没必要把它们全读进内存。
    expect(entry).not.toHaveProperty('blob')
  })

  it('列表按导入时间倒序（新导入的在前）', async () => {
    const repository = createMemoryLibraryRepository()
    await repository.saveImported(draft({ id: 'user-a', importedAt: 100 }))
    await repository.saveImported(draft({ id: 'user-b', importedAt: 300 }))
    await repository.saveImported(draft({ id: 'user-c', importedAt: 200 }))

    expect((await repository.listImported()).map((g) => g.id)).toEqual(['user-b', 'user-c', 'user-a'])
  })

  it('同一个 id 再写一次是覆盖，不是新增', async () => {
    const repository = createMemoryLibraryRepository()
    await repository.saveImported(draft({ id: 'user-1', title: '旧名字' }))
    await repository.saveImported(draft({ id: 'user-1', title: '新名字' }))

    const list = await repository.listImported()
    expect(list).toHaveLength(1)
    expect(list[0]?.title).toBe('新名字')
  })

  it('删除后读不到，列表里也没有', async () => {
    const repository = createMemoryLibraryRepository()
    await repository.saveImported(draft({ id: 'user-1' }))
    await repository.removeImported('user-1')

    expect(await repository.readBytes('user-1')).toBeNull()
    expect(await repository.listImported()).toEqual([])
  })

  it('删除不存在的条目不会抛错', async () => {
    const repository = createMemoryLibraryRepository()
    await expect(repository.removeImported('nobody')).resolves.toBeUndefined()
  })

  it('存的是副本：调用方事后改数组不影响库里的字节', async () => {
    const repository = createMemoryLibraryRepository()
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9])
    await repository.saveImported(draft({ id: 'user-1', bytes }))
    bytes[4] = 0xff

    const stored = await repository.readBytes('user-1')
    expect((stored as Uint8Array)[4]).toBe(9)
  })
})

describe('游玩记录', () => {
  it('第一次记录写入时间与次数 1', async () => {
    const repository = createMemoryLibraryRepository()
    await repository.recordPlay('snake', 5000)

    expect(await repository.listPlays()).toEqual([{ gameId: 'snake', lastPlayedAt: 5000, plays: 1 }])
  })

  it('再玩一次累加次数并更新时间', async () => {
    const repository = createMemoryLibraryRepository()
    await repository.recordPlay('snake', 5000)
    await repository.recordPlay('snake', 9000)

    expect(await repository.listPlays()).toEqual([{ gameId: 'snake', lastPlayedAt: 9000, plays: 2 }])
  })

  it('不同游戏互不影响', async () => {
    const repository = createMemoryLibraryRepository()
    await repository.recordPlay('snake', 5000)
    await repository.recordPlay('sokoban', 6000)

    const plays = await repository.listPlays()
    expect(plays).toHaveLength(2)
    expect(plays.find((p) => p.gameId === 'sokoban')?.plays).toBe(1)
  })

  it('游戏被删后记录仍在（由展示层过滤悬空 id）', async () => {
    const repository = createMemoryLibraryRepository()
    await repository.saveImported(draft({ id: 'user-1' }))
    await repository.recordPlay('user-1', 5000)
    await repository.removeImported('user-1')

    // 删除游戏不清记录：万一用户又重新导入同一个包，历史还在。
    expect((await repository.listPlays()).map((p) => p.gameId)).toEqual(['user-1'])
  })
})
