import { createHash, webcrypto } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { HashUnavailableError, isFingerprint, sha256Hex } from '@/shared/hash'
import { sha256 } from '@/shared/sha256'

/**
 * 指纹是存档隔离键，所以这里的断言只有一件事：**同一个输入永远得到同一个
 * 真摘要，不同输入永远不同**。任何「算不出来就返回常量」的退路都必须不存在。
 */

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function nodeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

function sample(length: number): Uint8Array {
  const out = new Uint8Array(length)
  let state = 0x9e3779b9
  for (let i = 0; i < length; i += 1) {
    // 线性同余：确定性、不依赖 Math.random，失败也能复现。
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    out[i] = state >>> 24
  }
  return out
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('纯 TS SHA-256', () => {
  it('FIPS 180-4 标准测试向量', () => {
    const cases: Array<[string, string]> = [
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      [
        'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
      ],
    ]
    for (const [input, expected] of cases) {
      expect(hex(sha256(new TextEncoder().encode(input)))).toBe(expected)
    }
  })

  it('跨块边界与随机长度都与 Node 一致', () => {
    // 补位边界是这类实现最容易错的地方：55/56/63/64/65 决定补几个零、长度写哪里。
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 127, 128, 129, 300, 4096, 100_000]) {
      const bytes = sample(length)
      expect(hex(sha256(bytes)), `length=${length}`).toBe(nodeSha256(bytes))
    }
  })

  it('不修改入参', () => {
    const bytes = sample(200)
    const copy = Uint8Array.from(bytes)
    sha256(bytes)
    expect(Array.from(bytes)).toEqual(Array.from(copy))
  })

  it('subarray 视图按自己的区间算，不带上外层字节', () => {
    const whole = sample(64)
    const slice = whole.subarray(10, 42)
    expect(hex(sha256(slice))).toBe(nodeSha256(slice))
  })
})

describe('内容指纹', () => {
  it('输出是 sha256:<64 位小写十六进制>', async () => {
    const value = await sha256Hex(sample(32))
    expect(value).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(value).toBe(`sha256:${nodeSha256(sample(32))}`)
  })

  it('不同内容不会撞到同一个指纹（占位串的真正危害）', async () => {
    const a = await sha256Hex(new TextEncoder().encode('game-a'))
    const b = await sha256Hex(new TextEncoder().encode('game-b'))
    expect(a).not.toBe(b)
    expect(a).not.toContain('unavailable')
  })

  it('没有 crypto.subtle 时结果不变', async () => {
    const bytes = sample(1024)
    const expected = await sha256Hex(bytes)

    // 非安全上下文（子路径部署的 http 页面）就是这个形态：crypto 在，subtle 不在。
    vi.stubGlobal('crypto', {} as Crypto)
    await expect(sha256Hex(bytes)).resolves.toBe(expected)
  })

  it('crypto.subtle 抛错时降级到内置实现，而不是放弃', async () => {
    const bytes = sample(4096)
    const expected = `sha256:${nodeSha256(bytes)}`
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    vi.stubGlobal('crypto', {
      subtle: {
        digest: () => Promise.reject(new Error('policy blocked')),
      },
    } as unknown as Crypto)

    await expect(sha256Hex(bytes)).resolves.toBe(expected)
    // 降级要留痕：这条路径不该经常发生，静默会让人以为一直在用原生实现。
    expect(warn).toHaveBeenCalled()
  })

  it('原生实现可用时优先走原生（纯实现是兜底，不是主路）', async () => {
    vi.stubGlobal('crypto', { subtle: webcrypto.subtle } as unknown as Crypto)
    const bytes = sample(128)
    const spy = vi.spyOn(webcrypto.subtle, 'digest')
    await expect(sha256Hex(bytes)).resolves.toBe(`sha256:${nodeSha256(bytes)}`)
    expect(spy).toHaveBeenCalled()
  })
})

describe('指纹格式校验', () => {
  it('只认 64 位小写十六进制', () => {
    expect(isFingerprint('sha256:' + 'a'.repeat(64))).toBe(true)
    expect(isFingerprint('sha256:' + 'A'.repeat(64))).toBe(false)
    expect(isFingerprint('sha256:' + 'a'.repeat(63))).toBe(false)
    expect(isFingerprint('sha256:')).toBe(false)
    expect(isFingerprint('md5:' + 'a'.repeat(64))).toBe(false)
  })

  it('历史占位串不算有效身份', () => {
    // 这是本轮修掉的东西：它等于「所有游戏共享一个存档键」。
    expect(isFingerprint('sha256:unavailable')).toBe(false)
    expect(isFingerprint('sha256:fixture')).toBe(false)
  })

  it('非字符串一律不认', () => {
    for (const value of [undefined, null, 0, {}, []]) {
      expect(isFingerprint(value)).toBe(false)
    }
  })
})

describe('无法计算时是硬失败', () => {
  it('HashUnavailableError 带可读原因，方便界面直接展示', () => {
    const error = new HashUnavailableError('当前环境无法计算内容指纹')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('HashUnavailableError')
    expect(error.message).toContain('无法计算')
  })
})
