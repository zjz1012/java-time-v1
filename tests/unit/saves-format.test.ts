import { describe, expect, it } from 'vitest'

import {
  SAVE_FORMAT,
  SAVE_FORMAT_VERSION,
  SaveFormatError,
  packSave,
  unpackSave,
  type SaveManifest,
} from '@/saves/format'
import { createZip } from '@/saves/zip'

function pattern(length: number): Uint8Array {
  return new Uint8Array(Array.from({ length }, (_, index) => index & 0xff))
}

const FIXED = new Date('2026-11-23T09:00:00Z')

async function packFixture(files: Array<{ path: string; bytes: Uint8Array }>) {
  return packSave({
    fingerprint: 'sha256:fixture',
    displayName: '推箱子',
    files,
    now: FIXED,
  })
}

/** 构造一个 manifest 与条目都能自洽、但内容故意不对的包。 */
function craftZip(
  manifest: SaveManifest,
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
      {
        format: SAVE_FORMAT,
        version: SAVE_FORMAT_VERSION,
        fingerprint: 'sha256:fixture',
        displayName: 'x',
        exportedAt: FIXED.getTime(),
        files: [{ path: '/RecordStore/a.db', size: 16, sha256: 'sha256:deadbeef' }],
      },
      [{ name: 'saves/RecordStore/a.db', bytes: payload }],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'hash-mismatch' })
  })

  it('清单里有、包里没有 → missing-file', async () => {
    const zip = craftZip(
      {
        format: SAVE_FORMAT,
        version: SAVE_FORMAT_VERSION,
        fingerprint: 'sha256:fixture',
        displayName: 'x',
        exportedAt: 0,
        files: [{ path: '/RecordStore/a.db', size: 4, sha256: 'sha256:x' }],
      },
      [],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'missing-file' })
  })

  it('包里有、清单里没有 → unexpected-file', async () => {
    const payload = pattern(4)
    const zip = craftZip(
      {
        format: SAVE_FORMAT,
        version: SAVE_FORMAT_VERSION,
        fingerprint: 'sha256:fixture',
        displayName: 'x',
        exportedAt: 0,
        files: [],
      },
      [{ name: 'saves/RecordStore/extra.db', bytes: payload }],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'unexpected-file' })
  })

  it('越界路径 → invalid-path，不去碰 /RecordStore 以外的东西', async () => {
    const zip = craftZip(
      {
        format: SAVE_FORMAT,
        version: SAVE_FORMAT_VERSION,
        fingerprint: 'sha256:fixture',
        displayName: 'x',
        exportedAt: 0,
        files: [{ path: '/etc/passwd', size: 4, sha256: 'sha256:x' }],
      },
      [{ name: 'saves/etc/passwd', bytes: pattern(4) }],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('版本比当前高 → unsupported-version', async () => {
    const zip = craftZip(
      {
        format: SAVE_FORMAT,
        version: SAVE_FORMAT_VERSION + 1,
        fingerprint: 'sha256:fixture',
        displayName: 'x',
        exportedAt: 0,
        files: [],
      },
      [],
    )

    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'unsupported-version' })
  })

  it('没有 manifest 的 ZIP → not-save', async () => {
    const zip = createZip([{ name: 'saves/RecordStore/a.db', bytes: pattern(4) }], FIXED)
    await expect(unpackSave(zip)).rejects.toMatchObject({ code: 'not-save' })
  })
})
