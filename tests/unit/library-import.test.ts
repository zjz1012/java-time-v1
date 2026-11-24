import { describe, expect, it } from 'vitest'

import {
  ImportError,
  MAX_IMPORT_BYTES,
  assertNoConflict,
  importedId,
  parseJarFile,
  titleFromFilename,
} from '@/library/import'

/** 合法的 ZIP 文件头。JAR 就是 ZIP，前四字节固定是 `PK\x03\x04`。 */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

function jarBytes(extra = 0, seed = 1): Uint8Array {
  const bytes = new Uint8Array(4 + extra)
  bytes.set(ZIP_MAGIC)
  for (let i = 4; i < bytes.length; i += 1) bytes[i] = (seed + i) & 0xff
  return bytes
}

function jarFile(name: string, bytes = jarBytes(64, 7)): File {
  return new File([bytes as BlobPart], name)
}

/**
 * 伪造 size 的 File：直接在实例上覆盖 size，比真的分配 16 MiB 快得多。
 * `size` 在 File 上是 getter，defineProperty 可以在实例上遮蔽它。
 */
function oversizedFile(name: string): File {
  const file = jarFile(name)
  Object.defineProperty(file, 'size', { value: MAX_IMPORT_BYTES + 1 })
  return file
}

describe('导入的标题', () => {
  it('去掉扩展名', () => {
    expect(titleFromFilename('推箱子.jar')).toBe('推箱子')
    expect(titleFromFilename('snake.jad')).toBe('snake')
    expect(titleFromFilename('game.data')).toBe('game')
  })

  it('扩展名不分大小写', () => {
    expect(titleFromFilename('Sokoban.JAR')).toBe('Sokoban')
  })

  it('只去掉最后一个扩展名', () => {
    expect(titleFromFilename('my.game.jar')).toBe('my.game')
  })

  it('折叠空白、去掉控制字符', () => {
    expect(titleFromFilename('  贪吃   蛇  .jar')).toBe('贪吃 蛇')
    expect(titleFromFilename('bad\u0000name\u001f.jar')).toBe('badname')
  })

  it('空名字给默认值，而不是空白卡片', () => {
    expect(titleFromFilename('.jar')).toBe('未命名程序')
    expect(titleFromFilename('   .jar')).toBe('未命名程序')
  })

  it('超长名字被截断，末尾带省略号', () => {
    const long = `${'长'.repeat(120)}.jar`
    const title = titleFromFilename(long)
    expect(title.length).toBeLessThanOrEqual(64)
    expect(title.endsWith('…')).toBe(true)
  })
})

describe('导入游戏的 id', () => {
  it('是 user- 前缀加 16 位十六进制', () => {
    const fingerprint = `sha256:${'ab'.repeat(32)}`
    expect(importedId(fingerprint)).toBe(`user-${'ab'.repeat(8)}`)
  })

  it('同一份字节总是得到同一个 id（重复导入天然去重）', async () => {
    const bytes = jarBytes(32, 42)
    const first = await parseJarFile(jarFile('a.jar', bytes), [])
    const second = await parseJarFile(jarFile('b.jar', bytes), [])
    expect(first.id).toBe(second.id)
    // 标题不同、id 相同：同一款游戏换个文件名导入，不该变成两款。
    expect(first.title).not.toBe(second.title)
  })

  it('不同字节得到不同 id', async () => {
    const a = await parseJarFile(jarFile('a.jar', jarBytes(32, 1)), [])
    const b = await parseJarFile(jarFile('b.jar', jarBytes(32, 2)), [])
    expect(a.id).not.toBe(b.id)
  })
})

describe('导入校验', () => {
  it('正常包解析出指纹、大小与条目', async () => {
    const parsed = await parseJarFile(jarFile('推箱子.jar'), [])
    expect(parsed.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(parsed.bytes.byteLength).toBeGreaterThan(4)
    expect(parsed.category).toBe('imported')
    expect(parsed.replacesExisting).toBe(false)
  })

  it('空文件被拒', async () => {
    const empty = new File([], 'empty.jar')
    await expect(parseJarFile(empty, [])).rejects.toThrow(/空/)
    await expect(parseJarFile(empty, [])).rejects.toMatchObject({ code: 'empty' })
  })

  it('超过上限被拒，且不读进内存', async () => {
    // size 检查在 arrayBuffer 之前：一个几百 MB 的假包不该先把标签页拖死。
    await expect(parseJarFile(oversizedFile('huge.jar'), [])).rejects.toMatchObject({
      code: 'too-large',
    })
  })

  it('不是 ZIP 的文件被拒', async () => {
    const text = new File(['这不是压缩包'], 'readme.jar')
    await expect(parseJarFile(text, [])).rejects.toMatchObject({ code: 'not-archive' })
  })

  it('文件太短（不足 4 字节）被拒', async () => {
    const tiny = new File([new Uint8Array([0x50, 0x4b])], 'tiny.jar')
    await expect(parseJarFile(tiny, [])).rejects.toMatchObject({ code: 'not-archive' })
  })

  it('只要文件头是 ZIP 就收，不尝试解析内部', async () => {
    // 内核会自己做类解析并给出可读的失败；这里再验一遍只会多一套错误码。
    const truncated = new File([new Uint8Array(ZIP_MAGIC)], 'broken.jar')
    await expect(parseJarFile(truncated, [])).resolves.toMatchObject({ id: expect.any(String) })
  })

  it('已存在同 id 时标记 replacesExisting', async () => {
    const bytes = jarBytes(32, 9)
    const first = await parseJarFile(jarFile('a.jar', bytes), [])
    const again = await parseJarFile(jarFile('a.jar', bytes), [first.id])
    expect(again.replacesExisting).toBe(true)
  })
})

describe('id 冲突', () => {
  const fingerprint = `sha256:${'cd'.repeat(32)}`
  const parsed = { id: importedId(fingerprint), fingerprint } as const

  it('同 id 同指纹是「又导了一遍」，允许覆盖', () => {
    expect(() => assertNoConflict({ ...parsed }, [{ ...parsed }])).not.toThrow()
  })

  it('同 id 不同指纹直接拒绝', () => {
    // 16 位前缀撞了：两个包会共用一个库条目，覆盖会让其中一款的
    // 「最近游玩」挂到另一款头上。宁可让人改名重试。
    const other = { id: parsed.id, fingerprint: `sha256:${'ef'.repeat(32)}` }
    expect(() => assertNoConflict({ ...parsed }, [other])).toThrow(ImportError)
    expect(() => assertNoConflict({ ...parsed }, [other])).toThrow(/冲突/)
  })

  it('库里没有同名条目时放行', () => {
    expect(() => assertNoConflict({ ...parsed }, [])).not.toThrow()
  })
})
