import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  SAVE_FORMAT,
  SAVE_FORMAT_VERSION,
  SAVE_LIMITS,
  SaveFormatError,
  packSave,
  unpackSave,
  type SaveManifest,
} from '@/saves/format'
import { crc32, createZip } from '@/saves/zip'

function pattern(length: number): Uint8Array {
  return new Uint8Array(Array.from({ length }, (_, index) => index & 0xff))
}

function digestOf(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(Buffer.from(bytes)).digest('hex')}`
}

const FIXED = new Date('2026-11-23T09:00:00Z')
/** 真实形状的指纹：64 位十六进制，不是 'sha256:fixture' 这种占位串。 */
const FP = digestOf(new TextEncoder().encode('sokoban.jar'))
const WRONG_DIGEST = `sha256:${'b'.repeat(64)}`

async function packFixture(files: Array<{ path: string; bytes: Uint8Array }>) {
  return packSave({
    fingerprint: FP,
    displayName: '推箱子',
    files,
    now: FIXED,
  })
}

function manifestOf(overrides: Partial<SaveManifest> = {}): SaveManifest {
  return {
    format: SAVE_FORMAT,
    version: SAVE_FORMAT_VERSION,
    fingerprint: FP,
    displayName: '推箱子',
    exportedAt: FIXED.getTime(),
    files: [],
    ...overrides,
  }
}

/** 构造一个 manifest 与条目都能自洽、但内容故意不对的包。 */
function craftZip(
  manifest: SaveManifest | unknown,
  payloads: Array<{ name: string; bytes: Uint8Array }>,
): Uint8Array {
  return createZip(
    [
      { name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest)) },
      ...payloads,
    ],
    FIXED,
  )
}

/**
 * 手搓 ZIP，绕过 `createZip` 的重复条目检查。
 *
 * 要验证「解析器会拒绝重复条目」，就必须先造一个重复条目的包 ——
 * 而打包函数本身会拦下来，所以这里直接按格式写字节。
 */
function rawZip(entries: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const local = new Uint8Array(30 + name.length + entry.bytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true)
    lv.setUint32(14, crc32(entry.bytes), true)
    lv.setUint32(18, entry.bytes.length, true)
    lv.setUint32(22, entry.bytes.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(entry.bytes, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint32(16, crc32(entry.bytes), true)
    cv.setUint32(20, entry.bytes.length, true)
    cv.setUint32(24, entry.bytes.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length
  }

  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0)
  const out = new Uint8Array(offset + centralSize + 22)
  let pointer = 0
  for (const item of locals) {
    out.set(item, pointer)
    pointer += item.length
  }
  for (const item of centrals) {
    out.set(item, pointer)
    pointer += item.length
  }

  const view = new DataView(out.buffer)
  view.setUint32(pointer, 0x06054b50, true)
  view.setUint16(pointer + 8, entries.length, true)
  view.setUint16(pointer + 10, entries.length, true)
  view.setUint32(pointer + 12, centralSize, true)
  view.setUint32(pointer + 16, offset, true)
  return out
}

describe('存档包往返', () => {
  it('打包再解包，路径与字节逐个一致', async () => {
    const files = [
      { path: '/RecordStore/save.db', bytes: pattern(64) },
      { path: '/RecordStore/save.idx', bytes: pattern(8) },
    ]
    const blob = await packFixture(files)
    const result = await unpackSave(await blob.arrayBuffer())

    expect(result.manifest.format).toBe(SAVE_FORMAT)
    expect(result.manifest.version).toBe(SAVE_FORMAT_VERSION)
    expect(result.manifest.displayName).toBe('推箱子')
    expect(result.manifest.fingerprint).toBe(FP)
    expect(result.files.map((file) => file.path)).toEqual([
      '/RecordStore/save.db',
      '/RecordStore/save.idx',
    ])
    expect(Array.from(result.files[0]?.bytes ?? [])).toEqual(Array.from(files[0]?.bytes ?? []))
  })

  it('空快照也能往返，不会被当成坏包', async () => {
    const blob = await packFixture([])
    const result = await unpackSave(await blob.arrayBuffer())
    expect(result.files).toEqual([])
    expect(result.manifest.files).toEqual([])
  })

  it('导出时间戳保留在 manifest 里', async () => {
    const blob = await packFixture([{ path: '/RecordStore/a.db', bytes: pattern(4) }])
    const result = await unpackSave(await blob.arrayBuffer())
    expect(result.manifest.exportedAt).toBe(FIXED.getTime())
  })
})

describe('存档包校验', () => {
  it('随便一段字节 → not-save', async () => {
    await expect(unpackSave(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(SaveFormatError)
  })

  it('空文件 → empty', async () => {
    await expect(unpackSave(new Uint8Array(0))).rejects.toMatchObject({ code: 'empty' })
  })

  it('改掉一个数据字节 → 整包拒绝（CRC 先抓到）', async () => {
    const blob = await packFixture([{ path: '/RecordStore/save.db', bytes: pattern(64) }])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    // 找一个非零字节改掉。改的是本地头之后的数据区，不影响 ZIP 结构。
    const index = bytes.findIndex((value) => value !== 0)
    expect(index).toBeGreaterThan(-1)
    bytes[index] = (bytes[index] as number) ^ 0xff

    await expect(unpackSave(bytes)).rejects.toMatchObject({ name: 'SaveFormatError' })
  })

  it('manifest 里的 sha256 对不上 → hash-mismatch', async () => {
    const payload = pattern(16)
    const zip = craftZip(
      manifestOf({ files: [{ path: '/RecordStore/a.db', size: 16, sha256: WRONG_DIGEST }] }),
      [{ name: 'saves/RecordStore/a.db', bytes: payload }],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'hash-mismatch' })
  })

  it('清单里的 size 与内容不符 → hash-mismatch', async () => {
    const payload = pattern(16)
    const zip = craftZip(
      manifestOf({ files: [{ path: '/RecordStore/a.db', size: 8, sha256: digestOf(payload) }] }),
      [{ name: 'saves/RecordStore/a.db', bytes: payload }],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'hash-mismatch' })
  })

  it('清单里有、包里没有 → missing-file', async () => {
    const zip = craftZip(
      manifestOf({
        files: [{ path: '/RecordStore/a.db', size: 4, sha256: digestOf(pattern(4)) }],
      }),
      [],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'missing-file' })
  })

  it('包里有、清单里没有 → unexpected-file', async () => {
    const zip = craftZip(manifestOf(), [
      { name: 'saves/RecordStore/extra.db', bytes: pattern(4) },
    ])

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'unexpected-file' })
  })

  it('越界路径 → invalid-path，不去碰 /RecordStore 以外的东西', async () => {
    const zip = craftZip(
      manifestOf({
        files: [{ path: '/etc/passwd', size: 4, sha256: digestOf(pattern(4)) }],
      }),
      [{ name: 'saves/etc/passwd', bytes: pattern(4) }],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('版本比当前高 → unsupported-version', async () => {
    const zip = craftZip(manifestOf({ version: SAVE_FORMAT_VERSION + 1 }), [])
    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'unsupported-version' })
  })

  it('没有 manifest 的 ZIP → not-save', async () => {
    const zip = createZip([{ name: 'saves/RecordStore/a.db', bytes: pattern(4) }], FIXED)
    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'not-save' })
  })
})

/**
 * 导入是用户自带文件，不能只保证「我们自己导出的包能过」。
 * 下面每一条都对应一种构造出来的坏包。
 */
describe('导入边界：构造出来的包', () => {
  it('重复条目 → duplicate-file（不让解析器替我二选一）', async () => {
    const payload = pattern(8)
    const manifest = manifestOf({
      files: [{ path: '/RecordStore/a.db', size: 8, sha256: digestOf(payload) }],
    })
    const zip = rawZip([
      {
        name: 'manifest.json',
        bytes: new TextEncoder().encode(JSON.stringify(manifest)),
      },
      { name: 'saves/RecordStore/a.db', bytes: payload },
      { name: 'saves/RecordStore/a.db', bytes: payload },
    ])

    // ZIP 层先拦（重复条目），映射到存档层就是 duplicate-file
    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'duplicate-file' })
  })

  it('路径含 .. → invalid-path，不靠宿主兜底', async () => {
    const payload = pattern(4)
    const zip = rawZip([
      {
        name: 'manifest.json',
        bytes: new TextEncoder().encode(
          JSON.stringify(
            manifestOf({
              files: [{ path: '/RecordStore/../evil.db', size: 4, sha256: digestOf(payload) }],
            }),
          ),
        ),
      },
      { name: 'saves/RecordStore/../evil.db', bytes: payload },
    ])

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('路径含反斜杠 → invalid-path', async () => {
    const payload = pattern(4)
    const zip = rawZip([
      {
        name: 'manifest.json',
        bytes: new TextEncoder().encode(
          JSON.stringify(
            manifestOf({
              files: [
                { path: '/RecordStore\\..\\evil.db', size: 4, sha256: digestOf(payload) },
              ],
            }),
          ),
        ),
      },
      { name: 'saves/RecordStore/a.db', bytes: payload },
    ])

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('路径含控制字符 → invalid-path', async () => {
    const payload = pattern(4)
    const zip = craftZip(
      manifestOf({
        // \u0000 在表面上完全看不见，是「两个不同名字解码成同一个」的常见来源。
        files: [{ path: '/RecordStore/a\u0000b.db', size: 4, sha256: digestOf(payload) }],
      }),
      [{ name: 'saves/RecordStore/a.db', bytes: payload }],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('空路径段（//）→ invalid-path', async () => {
    const payload = pattern(4)
    const zip = craftZip(
      manifestOf({
        files: [{ path: '/RecordStore//a.db', size: 4, sha256: digestOf(payload) }],
      }),
      [{ name: 'saves/RecordStore/a.db', bytes: payload }],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('条目数超过上限 → too-large', async () => {
    const payloads = Array.from({ length: SAVE_LIMITS.maxFiles + 1 }, (_, index) => ({
      name: `saves/RecordStore/${index}.db`,
      bytes: pattern(4),
    }))
    // 用 rawZip：打包函数自己就会拦超量，这里要测的是**解析**这一侧。
    const zip = rawZip([
      {
        name: 'manifest.json',
        bytes: new TextEncoder().encode(
          JSON.stringify(
            manifestOf({
              files: payloads.map((item) => ({
                path: item.name.slice('saves'.length),
                size: 4,
                sha256: digestOf(item.bytes),
              })),
            }),
          ),
        ),
      },
      ...payloads,
    ])

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'too-large' })
  })

  it('单个文件超过上限 → too-large（manifest 里的 size 就先挡住）', async () => {
    const zip = craftZip(
      manifestOf({
        files: [
          {
            path: '/RecordStore/big.db',
            size: SAVE_LIMITS.maxFileBytes + 1,
            sha256: digestOf(pattern(4)),
          },
        ],
      }),
      [{ name: 'saves/RecordStore/big.db', bytes: pattern(4) }],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'too-large' })
  })

  it('包体超过上限 → too-large，且不进入解析', async () => {
    const oversize = new Uint8Array(SAVE_LIMITS.maxArchiveBytes + 1)
    await expect(unpackSave(oversize)).rejects.toMatchObject({ code: 'too-large' })
  })

  it('manifest 缺字段 / 类型不对 → invalid-manifest', async () => {
    const cases: unknown[] = [
      { format: SAVE_FORMAT, version: SAVE_FORMAT_VERSION, displayName: 'x', exportedAt: 0, files: [] },
      manifestOf({ displayName: '' }),
      manifestOf({ displayName: 'x'.repeat(SAVE_LIMITS.maxDisplayNameChars + 1) }),
      manifestOf({ displayName: 'a\u0007b' }),
      { ...manifestOf(), exportedAt: 'yesterday' },
      { ...manifestOf(), exportedAt: -1 },
      { ...manifestOf(), files: 'nope' },
      { format: SAVE_FORMAT, version: '1', fingerprint: FP, displayName: 'x', exportedAt: 0, files: [] },
    ]

    for (const manifest of cases) {
      await expect(unpackSave(craftZip(manifest, [])), JSON.stringify(manifest)).rejects.toMatchObject(
        { name: 'SaveFormatError' },
      )
    }
  })

  it('manifest 有未知字段 → invalid-manifest（版本内不预留自由字段）', async () => {
    const zip = craftZip({ ...manifestOf(), script: 'alert(1)' }, [])
    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'invalid-manifest' })
  })

  it('指纹是占位串 → invalid-manifest', async () => {
    // 这是本轮修掉的漏洞的守门测试：曾经 crypto.subtle 缺失时所有游戏
    // 都拿到 'sha256:unavailable'，导出的包会互相覆盖存档。
    for (const fingerprint of ['sha256:unavailable', 'sha256:fixture', '']) {
      const zip = craftZip(manifestOf({ fingerprint }), [])
      await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'invalid-manifest' })
    }
  })

  it('清单里的 sha256 不是 64 位十六进制 → invalid-manifest', async () => {
    const zip = craftZip(
      manifestOf({ files: [{ path: '/RecordStore/a.db', size: 4, sha256: 'sha256:deadbeef' }] }),
      [{ name: 'saves/RecordStore/a.db', bytes: pattern(4) }],
    )
    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'invalid-manifest' })
  })

  it('清单里重复列出同一路径 → duplicate-file', async () => {
    const payload = pattern(4)
    const entry = { path: '/RecordStore/a.db', size: 4, sha256: digestOf(payload) }
    const zip = craftZip(manifestOf({ files: [entry, entry] }), [
      { name: 'saves/RecordStore/a.db', bytes: payload },
    ])
    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'duplicate-file' })
  })
})

describe('导出侧与导入侧同一套上限', () => {
  it('指纹不合法就拒绝导出（不出一个自己都导不回来的包）', async () => {
    await expect(
      packSave({ fingerprint: 'sha256:unavailable', displayName: 'x', files: [] }),
    ).rejects.toMatchObject({ code: 'invalid-manifest' })
  })

  it('单个文件超过上限 → too-large', async () => {
    await expect(
      packSave({
        fingerprint: FP,
        displayName: 'x',
        files: [
          { path: '/RecordStore/big.db', bytes: new Uint8Array(SAVE_LIMITS.maxFileBytes + 1) },
        ],
      }),
    ).rejects.toMatchObject({ code: 'too-large' })
  })

  it('文件数超过上限 → too-large', async () => {
    const files = Array.from({ length: SAVE_LIMITS.maxFiles + 1 }, (_, index) => ({
      path: `/RecordStore/${index}.db`,
      bytes: pattern(4),
    }))
    await expect(packSave({ fingerprint: FP, displayName: 'x', files })).rejects.toMatchObject({
      code: 'too-large',
    })
  })

  it('越界路径 → invalid-path', async () => {
    await expect(
      packSave({
        fingerprint: FP,
        displayName: 'x',
        files: [{ path: '/etc/passwd', bytes: pattern(4) }],
      }),
    ).rejects.toMatchObject({ code: 'invalid-path' })
  })
})
