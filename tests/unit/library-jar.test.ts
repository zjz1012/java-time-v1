import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ImportError, parseJarFile } from '@/library/import'
import { describeJarProblem, inspectJar } from '@/library/jar'

import { buildZip, manifestText } from './fixtures/zip'

/**
 * JAR 预检。
 *
 * 样本全部自己造，不依赖 `public/assets/*.jar`（那种文件按来源登记不入库）。
 * 最后一组反过来用随包分发的 104 份真实包做回归 —— 严格校验最怕的是
 * 「把好东西也拒了」，只有真包能证明这一点。
 */

const CLASS = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 1, 2, 3, 4])
const MAIN = { name: 'MainMidlet.class', data: CLASS, deflate: true as const }

function jarWith(
  manifest: string | null,
  options: { deflate: boolean; comment?: string; entries?: Array<{ name: string; data: Uint8Array | string; deflate: boolean }> } = {
    deflate: true,
  },
) {
  const entries = []
  if (manifest !== null) {
    entries.push({ name: 'META-INF/MANIFEST.MF', data: manifest, deflate: options.deflate })
  }
  entries.push(...(options.entries ?? [MAIN]))
  return buildZip(entries, options.comment ? { comment: options.comment } : {})
}

describe('读 MIDlet 信息', () => {
  it('deflate 压缩的 manifest（真实 JAR 的常态）', async () => {
    const result = await inspectJar(jarWith(manifestText('推箱子')))
    expect(result.ok).toBe(true)
    expect(result.info).toEqual({ name: '推箱子', vendor: 'zhimiao', mainClass: 'MainMidlet' })
  })

  it('STORE 的 manifest 也能读', async () => {
    const result = await inspectJar(jarWith(manifestText('贪吃蛇'), { deflate: false }))
    expect(result.info?.name).toBe('贪吃蛇')
  })

  it('EOCD 后面带注释时仍能找到目录', async () => {
    const result = await inspectJar(
      jarWith(manifestText('打砖块'), { deflate: true, comment: 'signed by x' }),
    )
    expect(result.info?.name).toBe('打砖块')
  })

  it('manifest 路径大小写不敏感', async () => {
    const bytes = buildZip([
      { name: 'meta-inf/manifest.mf', data: manifestText('小写路径'), deflate: true },
      MAIN,
    ])
    expect((await inspectJar(bytes)).info?.name).toBe('小写路径')
  })

  it('续行拼接：长名字折行后不该被截断', async () => {
    // 规范要求值超过 72 字节折行，续行以单个空格开头。
    const folded = [
      'Manifest-Version: 1.0',
      'MIDlet-Name: 一个非常非常长的',
      ' 游戏名字',
      'MIDlet-1: 一个非常非常长的游戏名字,,MainMidlet',
      '',
    ].join('\r\n')
    const bytes = buildZip([
      { name: 'META-INF/MANIFEST.MF', data: folded, deflate: true },
      MAIN,
    ])
    expect((await inspectJar(bytes)).info?.name).toBe('一个非常非常长的游戏名字')
  })

  it('vendor 缺失时给空串，名字仍然可用', async () => {
    const bytes = jarWith('MIDlet-Name: 没作者\r\nMIDlet-1: 没作者,,MainMidlet\r\n\r\n')
    expect((await inspectJar(bytes)).info).toEqual({
      name: '没作者',
      vendor: '',
      mainClass: 'MainMidlet',
    })
  })

  it('主类名带包名时按路径找 class', async () => {
    const bytes = jarWith('MIDlet-Name: 包内\r\nMIDlet-1: 包内,,com.example.Main\r\n\r\n', {
      deflate: true,
      entries: [{ name: 'com/example/Main.class', data: CLASS, deflate: true }],
    })
    expect((await inspectJar(bytes)).info?.mainClass).toBe('com.example.Main')
  })
})

/**
 * 拒绝的理由要能区分「选错文件」与「包不完整」。
 * 这些包都能通过「文件头是 PK」那一关 —— 正是旧的导入校验会放进来的东西。
 */
describe('拒绝不是程序包的 JAR', () => {
  it('普通 ZIP：没有 manifest', async () => {
    const bytes = buildZip([{ name: 'readme.txt', data: 'hello', deflate: true }])
    const result = await inspectJar(bytes)
    expect(result.ok).toBe(false)
    expect(result.problem).toBe('no-manifest')
    expect(describeJarProblem(result.problem)).toContain('MANIFEST.MF')
  })

  it('manifest 里没有 MIDlet-1', async () => {
    const bytes = jarWith('Manifest-Version: 1.0\r\nMIDlet-Name: 空壳\r\n\r\n')
    const result = await inspectJar(bytes)
    expect(result.problem).toBe('no-midlet')
    // 这句话要能让人明白「这个包没有可启动的东西」，而不是「文件坏了」。
    expect(describeJarProblem(result.problem)).toContain('没有可启动的程序')
  })

  it('MIDlet-1 只有两段（漏了图标那个逗号）', async () => {
    const bytes = jarWith('MIDlet-Name: 两段\r\nMIDlet-1: 两段,MainMidlet\r\n\r\n')
    expect((await inspectJar(bytes)).problem).toBe('bad-midlet')
  })

  it('MIDlet-1 的主类名不合法', async () => {
    for (const bad of ['..', 'a b', 'x;y', '.Start', 'pkg.']) {
      const bytes = jarWith(`MIDlet-Name: 坏名字\r\nMIDlet-1: 坏名字,,${bad}\r\n\r\n`)
      expect((await inspectJar(bytes)).problem, bad).toBe('bad-midlet')
    }
  })

  it('主类不在包里 —— 这是「能进库、点进去等到超时」的元凶', async () => {
    const bytes = jarWith('MIDlet-Name: 缺类\r\nMIDlet-1: 缺类,,pkg.NotThere\r\n\r\n')
    const result = await inspectJar(bytes)
    expect(result.problem).toBe('missing-class')
    expect(describeJarProblem(result.problem, 'pkg.NotThere')).toContain('pkg.NotThere')
    expect(describeJarProblem(result.problem, 'pkg.NotThere')).toContain('超时')
  })

  it('manifest 解压后超过 64 KB 就不解了（压缩炸弹）', async () => {
    // 声明只有几百字节的 manifest，实际解出来 100 KB。压缩后仍然很小，
    // 所以只能靠「边读边数」挡住 —— 等解完再看大小就已经吃掉内存了。
    const bomb = `MIDlet-Name: 炸弹\r\nMIDlet-1: 炸弹,,MainMidlet\r\nX-Filler: ${'A'.repeat(100 * 1024)}\r\n\r\n`
    const bytes = jarWith(bomb)
    expect(bytes.length).toBeLessThan(64 * 1024)
    const result = await inspectJar(bytes)
    expect(result.problem).toBe('manifest-too-large')
    expect(describeJarProblem(result.problem)).toContain('64 KB')
  })
})

describe('畸形输入不抛错', () => {
  it('不是 ZIP 的字节', async () => {
    // 导入的入口是用户选的文件，畸形输入是常态，不能让异常冒到主流程。
    await expect(inspectJar(new Uint8Array([1, 2, 3, 4, 5]))).resolves.toMatchObject({
      ok: false,
      problem: 'not-zip',
    })
    await expect(inspectJar(new Uint8Array(0))).resolves.toMatchObject({ ok: false })
  })

  it('截断的 ZIP', async () => {
    const bytes = jarWith(manifestText('会被截断'))
    const result = await inspectJar(bytes.slice(0, bytes.length - 30))
    expect(result.ok).toBe(false)
  })

  it('中央目录被破坏', async () => {
    const bytes = jarWith(manifestText('坏目录'))
    // 把 EOCD 里的「中央目录偏移」改成越界值。
    const eocd = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const index = bytes.length - 22
    eocd.setUint32(index + 16, 0xfffff0, true)
    expect((await inspectJar(bytes)).ok).toBe(false)
  })
})

describe('导入时用 manifest 里的名字', () => {
  function fileFrom(bytes: Uint8Array, name: string): File {
    return new File([bytes as BlobPart], name)
  }

  it('文件名是 sokoban.jar，卡片上显示「推箱子」', async () => {
    const parsed = await parseJarFile(fileFrom(jarWith(manifestText('推箱子')), 'sokoban.jar'), [])
    expect(parsed.title).toBe('推箱子')
    expect(parsed.author).toBe('zhimiao')
  })

  it('没有 MIDlet-Name 时用 MIDlet-1 里的名字', async () => {
    const bytes = jarWith('MIDlet-1: 只有一号,,MainMidlet\r\n\r\n')
    const parsed = await parseJarFile(fileFrom(bytes, 'x.jar'), [])
    expect(parsed.title).toBe('只有一号')
  })

  it('两个名字都空时退回文件名', async () => {
    const bytes = jarWith('MIDlet-1: ,,MainMidlet\r\n\r\n')
    const parsed = await parseJarFile(fileFrom(bytes, '我的游戏.jar'), [])
    expect(parsed.title).toBe('我的游戏')
    expect(parsed.author).toBe('本地导入')
  })

  it('标题仍受长度与字符清洗约束', async () => {
    const longName = '长'.repeat(120)
    const parsed = await parseJarFile(fileFrom(jarWith(manifestText(longName)), 'x.jar'), [])
    expect(parsed.title.length).toBeLessThanOrEqual(64)
    expect(parsed.title.endsWith('…')).toBe(true)
  })

  it('普通 ZIP 在导入这一步就被拒，且给的是「不是程序包」而不是「格式错误」', async () => {
    const zip = buildZip([{ name: 'photos/a.jpg', data: new Uint8Array([1, 2, 3]), deflate: true }])
    const attempt = parseJarFile(fileFrom(zip, '相册.zip'), [])
    await expect(attempt).rejects.toBeInstanceOf(ImportError)
    await expect(attempt).rejects.toMatchObject({ code: 'not-midlet' })
  })

  it('主类缺失同样被拒', async () => {
    const bytes = jarWith('MIDlet-1: 缺,,pkg.Gone\r\n\r\n')
    await expect(parseJarFile(fileFrom(bytes, 'x.jar'), [])).rejects.toMatchObject({
      code: 'not-midlet',
    })
  })
})

/**
 * 严格校验最大的风险是「把好东西也拒了」。
 *
 * 随包分发的 104 款是真实样本（自研 6 + 三个 MIT 上游），它们都必须通过 ——
 * 这也反过来证明清单里那批包确实是有主类的合法 MIDlet，不只是「能跑」。
 */
describe('随包分发的 104 款都是合法 MIDlet', () => {
  const dir = join(process.cwd(), 'public/games')
  const files = readdirSync(dir).filter((name) => name.endsWith('.data'))

  it('数量对得上', () => {
    expect(files.length).toBe(104)
  })

  it('每一款都有 manifest、MIDlet-1 和主类', async () => {
    const broken: string[] = []
    for (const file of files) {
      const result = await inspectJar(new Uint8Array(readFileSync(join(dir, file))))
      if (!result.ok) broken.push(`${file}: ${result.problem}`)
    }
    expect(broken).toEqual([])
  })
})
