import { describe, expect, it } from 'vitest'

import { parseJarFile } from '@/library/import'
import { readMidletInfo } from '@/library/manifest'

import { buildZip, manifestText } from './fixtures/zip'

/**
 * manifest 解析。这里的样本都自己造，不依赖 `public/assets/*.jar`
 * （那个按来源登记不入库，测试不该依赖它）。
 */

const CLASS = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 1, 2, 3, 4])

function jarWith(manifest: string | null, options: { deflate: boolean; comment?: string } = { deflate: true }) {
  const entries = []
  if (manifest !== null) {
    entries.push({ name: 'META-INF/MANIFEST.MF', data: manifest, deflate: options.deflate })
  }
  entries.push({ name: 'MainMidlet.class', data: CLASS, deflate: options.deflate })
  return buildZip(entries, options.comment ? { comment: options.comment } : {})
}

describe('读 MIDlet 信息', () => {
  it('deflate 压缩的 manifest（真实 JAR 的常态）', async () => {
    const info = await readMidletInfo(jarWith(manifestText('推箱子')))
    expect(info).toEqual({ name: '推箱子', vendor: 'zhimiao' })
  })

  it('STORE 的 manifest 也能读', async () => {
    const info = await readMidletInfo(jarWith(manifestText('贪吃蛇'), { deflate: false }))
    expect(info?.name).toBe('贪吃蛇')
  })

  it('EOCD 后面带注释时仍能找到目录', async () => {
    const info = await readMidletInfo(jarWith(manifestText('打砖块'), { deflate: true, comment: 'signed by x' }))
    expect(info?.name).toBe('打砖块')
  })

  it('manifest 路径大小写不敏感', async () => {
    const bytes = buildZip([
      { name: 'meta-inf/manifest.mf', data: manifestText('小写路径'), deflate: true },
    ])
    expect((await readMidletInfo(bytes))?.name).toBe('小写路径')
  })

  it('续行拼接：长名字折行后不该被截断', async () => {
    // 规范要求值超过 72 字节折行，续行以单个空格开头。
    const folded = ['Manifest-Version: 1.0', 'MIDlet-Name: 一个非常非常长的', ' 游戏名字', 'MIDlet-Vendor: zhimiao', ''].join(
      '\r\n',
    )
    const bytes = buildZip([{ name: 'META-INF/MANIFEST.MF', data: folded, deflate: true }])
    expect((await readMidletInfo(bytes))?.name).toBe('一个非常非常长的游戏名字')
  })

  it('没有 manifest 时返回 null', async () => {
    expect(await readMidletInfo(jarWith(null))).toBeNull()
  })

  it('manifest 里没有 MIDlet-Name 时返回 null', async () => {
    const bytes = buildZip([
      {
        name: 'META-INF/MANIFEST.MF',
        data: 'Manifest-Version: 1.0\r\nMIDlet-Vendor: someone\r\n\r\n',
        deflate: true,
      },
    ])
    expect(await readMidletInfo(bytes)).toBeNull()
  })

  it('vendor 缺失时给空串，名字仍然可用', async () => {
    const bytes = buildZip([
      { name: 'META-INF/MANIFEST.MF', data: 'MIDlet-Name: 没作者\r\n\r\n', deflate: true },
    ])
    expect(await readMidletInfo(bytes)).toEqual({ name: '没作者', vendor: '' })
  })

  it('不是 ZIP 的字节不会抛错', async () => {
    // 导入的入口是用户选的文件，畸形输入是常态，不能让异常冒到主流程。
    await expect(readMidletInfo(new Uint8Array([1, 2, 3, 4, 5]))).resolves.toBeNull()
    await expect(readMidletInfo(new Uint8Array(0))).resolves.toBeNull()
  })

  it('截断的 ZIP 不会抛错', async () => {
    const bytes = jarWith(manifestText('会被截断'))
    await expect(readMidletInfo(bytes.slice(0, bytes.length - 30))).resolves.toBeNull()
  })

  it('中央目录被破坏时不会抛错', async () => {
    const bytes = jarWith(manifestText('坏目录'))
    // 把 EOCD 里的「中央目录偏移」改成越界值。
    const eocd = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const index = bytes.length - 22
    eocd.setUint32(index + 16, 0xfffff0, true)
    await expect(readMidletInfo(bytes)).resolves.toBeNull()
  })
})

describe('导入时用 manifest 里的名字', () => {
  function fileFrom(bytes: Uint8Array, name: string): File {
    return new File([bytes as BlobPart], name)
  }

  it('文件名是 sokoban.jar，卡片上显示「推箱子」', async () => {
    const file = fileFrom(jarWith(manifestText('推箱子')), 'sokoban.jar')
    const parsed = await parseJarFile(file, [])
    expect(parsed.title).toBe('推箱子')
    expect(parsed.author).toBe('zhimiao')
  })

  it('读不到 manifest 时退回文件名', async () => {
    const file = fileFrom(jarWith(null), '我的游戏.jar')
    const parsed = await parseJarFile(file, [])
    expect(parsed.title).toBe('我的游戏')
    expect(parsed.author).toBe('本地导入')
  })

  it('没有 vendor 时作者退成默认值，标题仍用 manifest 的', async () => {
    const bytes = buildZip([
      { name: 'META-INF/MANIFEST.MF', data: 'MIDlet-Name: 无名作者\r\n\r\n', deflate: true },
    ])
    const parsed = await parseJarFile(fileFrom(bytes, 'x.jar'), [])
    expect(parsed.title).toBe('无名作者')
    expect(parsed.author).toBe('本地导入')
  })

  it('标题仍受长度与字符清洗约束', async () => {
    const longName = '长'.repeat(120)
    const parsed = await parseJarFile(fileFrom(jarWith(manifestText(longName)), 'x.jar'), [])
    expect(parsed.title.length).toBeLessThanOrEqual(64)
    expect(parsed.title.endsWith('…')).toBe(true)
  })
})
