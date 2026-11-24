import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createMemoryRepository } from '@/saves/archive'
import { createSaveService } from '@/saves/service'
import { packSave } from '@/saves/format'

/** 真实形状的指纹（64 位十六进制）。导出会校验格式，占位串过不去。 */
function key(seed: string): string {
  return `sha256:${createHash('sha256').update(seed).digest('hex')}`
}

function pattern(length: number, fill: number): Uint8Array {
  return new Uint8Array(length).fill(fill)
}

describe('存档隔离（F13）', () => {
  it('两款游戏用同名 RMS 时互不覆盖', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive(key('game-a'), '游戏 A', [
      { path: '/RecordStore/save.db', bytes: pattern(16, 0xaa) },
    ])
    await saves.archive(key('game-b'), '游戏 B', [
      { path: '/RecordStore/save.db', bytes: pattern(16, 0xbb) },
    ])

    const a = await saves.restore(key('game-a'))
    const b = await saves.restore(key('game-b'))

    expect(a[0]?.bytes[0]).toBe(0xaa)
    expect(b[0]?.bytes[0]).toBe(0xbb)
  })

  it('没有归档时返回空数组，而不是 null', async () => {
    const saves = createSaveService(createMemoryRepository())
    // 空数组在宿主侧的含义是「清空内核里的 RMS」，这正是隔离要的效果。
    expect(await saves.restore(key('never-played'))).toEqual([])
  })

  it('改名同包仍是同一份存档', async () => {
    const saves = createSaveService(createMemoryRepository())
    await saves.archive(key('same'), '旧名字', [
      { path: '/RecordStore/save.db', bytes: pattern(4, 1) },
    ])
    // 指纹相同，展示名不同 —— 读还是同一份。
    const restored = await saves.restore(key('same'))
    expect(restored).toHaveLength(1)
  })
})

describe('指纹门禁（占位串不能成为仓储键）', () => {
  // 背景：`hash.ts` 曾经在没有 crypto.subtle 时返回固定串 `sha256:unavailable`。
  // 那个串一旦被当成身份，两个不同的游戏就会落到同一个键上 —— 互相覆盖存档，
  // 而且界面上一切正常。这一组测试守的是「这道门不会再被打开」。
  const PLACEHOLDER = 'sha256:unavailable'

  it('占位串归档被拒，且不会覆盖别的游戏', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive(key('real'), '真游戏', [
      { path: '/RecordStore/save.db', bytes: pattern(4, 0x11) },
    ])

    await expect(
      saves.archive(PLACEHOLDER, '占位', [
        { path: '/RecordStore/save.db', bytes: pattern(4, 0x99) },
      ]),
    ).rejects.toThrow(/指纹不是合法的 SHA-256/)

    // 关键断言：真游戏那份没被占位串盖掉。
    const still = await saves.restore(key('real'))
    expect(still[0]?.bytes[0]).toBe(0x11)
  })

  it('占位串读档被拒，不会读出一个「共享档」', async () => {
    const saves = createSaveService(createMemoryRepository())
    await expect(saves.restore(PLACEHOLDER)).rejects.toThrow(/指纹不是合法的 SHA-256/)
  })

  it('占位串导出被拒', async () => {
    const saves = createSaveService(createMemoryRepository())
    await expect(saves.exportZip(PLACEHOLDER, 'x')).rejects.toThrow(/指纹不是合法的 SHA-256/)
  })

  it.each([
    ['空串', ''],
    ['没有前缀', '0'.repeat(64)],
    ['大写十六进制', `sha256:${'A'.repeat(64)}`],
    ['长度不足', 'sha256:abc'],
    ['一眼是文件名', '/tmp/game.jar'],
  ])('形如「%s」的指纹一律拒绝', async (_label, fingerprint) => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await expect(saves.restore(fingerprint)).rejects.toThrow(/指纹不是合法的 SHA-256/)
    await expect(saves.archive(fingerprint, 'x', [])).rejects.toThrow(/指纹不是合法的 SHA-256/)
    // 空快照本来会走 `repository.remove`，门禁必须先拦住它：
    // 否则会拿一个非法键去删档。
    expect(await repository.list()).toEqual([])
  })

  it('applyImport 即便拿到伪造的 manifest 也守门', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    const manifest = {
      format: 'java-time-save',
      version: 1,
      fingerprint: PLACEHOLDER,
      displayName: '伪造',
      exportedAt: 0,
      files: [],
    } as unknown as Parameters<typeof saves.applyImport>[0]

    // readManifest 已经挡过一次，但服务层不依赖上游 —— 这里直接绕过解析层。
    await expect(saves.applyImport(manifest, { manifest, files: [] })).rejects.toThrow(
      /指纹不是合法的 SHA-256/,
    )
    expect(await repository.list()).toEqual([])
  })
})

describe('归档语义', () => {
  it('空快照等于删除，不会留下一条空记录', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive(key('x'), 'x', [{ path: '/RecordStore/a.db', bytes: pattern(2, 1) }])
    expect(await repository.read(key('x'))).not.toBeNull()

    await saves.archive(key('x'), 'x', [])
    expect(await repository.read(key('x'))).toBeNull()
  })

  it('重复归档覆盖上一次', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive(key('x'), 'x', [{ path: '/RecordStore/a.db', bytes: pattern(2, 1) }])
    await saves.archive(key('x'), 'x', [
      { path: '/RecordStore/a.db', bytes: pattern(2, 2) },
      { path: '/RecordStore/b.db', bytes: pattern(2, 3) },
    ])

    const restored = await saves.restore(key('x'))
    expect(restored.map((file) => file.path)).toEqual(['/RecordStore/a.db', '/RecordStore/b.db'])
    expect(restored[0]?.bytes[0]).toBe(2)
  })
})

describe('导出与导入', () => {
  it('没有归档时导出返回 null，不产生空包', async () => {
    const saves = createSaveService(createMemoryRepository())
    expect(await saves.exportZip(key('none'), 'x')).toBeNull()
  })

  it('导出的包能重新导入，内容一致', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive(key('x'), '推箱子', [
      { path: '/RecordStore/save.db', bytes: pattern(32, 7) },
    ])

    const blob = await saves.exportZip(key('x'), '推箱子')
    expect(blob).not.toBeNull()

    const parsed = await saves.readZip(blob as Blob)
    expect(parsed.manifest.fingerprint).toBe(key('x'))

    // 导入到另一个空仓储，模拟换设备
    const other = createMemoryRepository()
    const otherSaves = createSaveService(other)
    await otherSaves.applyImport(parsed.manifest, parsed)

    const restored = await otherSaves.restore(key('x'))
    expect(restored[0]?.bytes).toHaveLength(32)
    expect(restored[0]?.bytes[0]).toBe(7)
  })

  it('导入失败时不动现有归档', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive(key('x'), 'x', [{ path: '/RecordStore/a.db', bytes: pattern(4, 9) }])

    const bogus = new Blob([new Uint8Array([1, 2, 3, 4])])
    await expect(saves.readZip(bogus)).rejects.toThrow()

    // 校验失败发生在写之前，所以原档还在。
    const still = await saves.restore(key('x'))
    expect(still[0]?.bytes[0]).toBe(9)
  })

  it('导入空包等于清空该游戏的存档', async () => {
    const repository = createMemoryRepository()
    const saves = createSaveService(repository)

    await saves.archive(key('x'), 'x', [{ path: '/RecordStore/a.db', bytes: pattern(4, 9) }])
    const empty = await packSave({ fingerprint: key('x'), displayName: 'x', files: [] })
    const parsed = await saves.readZip(empty)

    await saves.applyImport(parsed.manifest, parsed)
    expect(await saves.restore(key('x'))).toEqual([])
    expect(await repository.read(key('x'))).toBeNull()
  })
})
