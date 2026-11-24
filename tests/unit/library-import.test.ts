import { describe, expect, it } from 'vitest'

import {
  ImportError,
  MAX_IMPORT_BYTES,
  assertNoConflict,
  importedId,
  parseJarFile,
  titleFromFilename,
} from '@/library/import'

import { buildZip, manifestText } from './fixtures/zip'

/**
 * 样本必须是**能过预检的真 JAR**（manifest + MIDlet-1 + 主类三件齐）。
 *
 * 这里曾经用的是「四个字节的 ZIP 魔数 + 随机填充」—— 那种包在「只验文件头」
 * 的年代能过，加了 JAR 预检之后会被正确地拒掉。改样本不是为了迁就新校验，
 * 而是旧样本本来就代表不了「一个能启动的程序」。
 */
const CLASS = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 1])

/** 最小的合法 JAR。`seed` 改主类里的字节，用来造「内容不同」的包。 */
function jarBytes(seed = 0, name = '推箱子'): Uint8Array {
  const body = CLASS.slice()
  body[7] = seed & 0xff
  return buildZip([
    { name: 'META-INF/MANIFEST.MF', data: manifestText(name), deflate: true },
    { name: 'MainMidlet.class', data: body, deflate: true },
  ])
}

function jarFile(name: string, bytes: Uint8Array = jarBytes()): File {
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
    const bytes = jarBytes(42)
    const first = await parseJarFile(jarFile('a.jar', bytes), [])
    const second = await parseJarFile(jarFile('b.jar', bytes), [])
    expect(first.id).toBe(second.id)
    /*
     * 标题也一样，而且**应该**一样：名字取自 manifest 的 `MIDlet-Name`，
     * 不取自文件名。改了文件名不该让同一款游戏换一个标题 ——
     * 文件名是用户随手起的，manifest 才是作者写的。
     */
    expect(first.title).toBe(second.title)
    expect(first.title).toBe('推箱子')
  })

  it('不同字节得到不同 id', async () => {
    const a = await parseJarFile(jarFile('a.jar', jarBytes(1, '推箱子')), [])
    const b = await parseJarFile(jarFile('b.jar', jarBytes(2, '贪吃蛇')), [])
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

  it('普通 ZIP（没有 manifest）被拒，而不是进库后启动超时', async () => {
    // 这条曾经断言「只要文件头是 ZIP 就收」，理由是「内核会给可读提示」。
    // 事实是内核只能给「启动超时」：用户看到一张正常卡片，点进去等十几秒，
    // 不知道自己选错了文件。预检把这句话挪到了导入那一刻。
    const plain = buildZip([{ name: 'readme.txt', data: 'hello', deflate: true }])
    await expect(parseJarFile(jarFile('photos.jar', plain), [])).rejects.toMatchObject({
      code: 'not-midlet',
    })
    await expect(parseJarFile(jarFile('photos.jar', plain), [])).rejects.toThrow(/MANIFEST\.MF/)
  })

  it('只有文件头的半截包被拒', async () => {
    const truncated = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'broken.jar')
    await expect(parseJarFile(truncated, [])).rejects.toMatchObject({ code: 'not-midlet' })
    await expect(parseJarFile(truncated, [])).rejects.toThrow(/不是 JAR 包/)
  })

  it('已存在同 id 时标记 replacesExisting', async () => {
    const bytes = jarBytes(9)
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
