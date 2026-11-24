import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createMemoryRepository } from '@/saves/archive'
import { SaveFormatError } from '@/saves/format'
import { createSaveService } from '@/saves/service'

/**
 * 清理存档（F15 的延续）。
 *
 * 起因是一句提示：「存储空间不足，清理一些浏览器存储后重试」。那句提示把
 * 动作交给了用户，而产品里并没有「清理」这个东西 —— 用户只能自己去
 * 开发者工具里翻。这段代码补的是那个动作。
 *
 * 它必须是**只删存档**：删库（`indexedDB.deleteDatabase`）会把用户导入的游戏
 * 一起带走，那是另一件事，且同样不可逆。
 */

function fingerprint(seed: string): string {
  return `sha256:${createHash('sha256').update(seed).digest('hex')}`
}

const FILES = [{ path: '/RecordStore/a.db', bytes: new Uint8Array([1, 2, 3]) }]

async function seeded(seeds: string[]) {
  const repository = createMemoryRepository()
  const service = createSaveService(repository)
  for (const seed of seeds) {
    await service.archive(fingerprint(seed), `游戏 ${seed}`, FILES)
  }
  return { repository, service }
}

describe('清空全部存档', () => {
  it('删掉每一份，并返回删掉的份数', async () => {
    const { service } = await seeded(['a', 'b', 'c'])
    expect((await service.list()).length).toBe(3)

    expect(await service.clearAll()).toBe(3)
    expect(await service.list()).toEqual([])

    // 真的没了吗？用「能不能读回来」再确认一次 —— 只看 list() 空不空
    // 会漏掉「列表读不出来但记录还在」的实现。
    expect(await service.restore(fingerprint('a'))).toEqual([])
  })

  it('本来就没有存档时返回 0，不报错', async () => {
    const { service } = await seeded([])
    expect(await service.clearAll()).toBe(0)
  })

  it('只删存档，不碰别的东西', async () => {
    // 仓储里除了存档还有别的 store（导入的游戏、游玩记录），清理不能顺手清它们。
    // 这里用「清理后仍能新建/读取一份存档」间接证明仓储本身没被销毁。
    const { service } = await seeded(['a'])
    await service.clearAll()
    await service.archive(fingerprint('z'), '清理之后又开了一局', FILES)
    expect((await service.list()).length).toBe(1)
    expect(await service.restore(fingerprint('z'))).toEqual(FILES)
  })

  it('单份删除照样守指纹门禁', async () => {
    // 删错键的后果和写错键一样不可逆：把别人的存档删了。
    const { service } = await seeded(['a'])
    await expect(service.remove('sha256:unavailable')).rejects.toBeInstanceOf(SaveFormatError)
    await expect(service.remove('not-a-fingerprint')).rejects.toBeInstanceOf(SaveFormatError)
    // 合法键才真的删
    await service.remove(fingerprint('a'))
    expect(await service.list()).toEqual([])
  })
})
