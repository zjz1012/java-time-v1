import { describe, expect, it } from 'vitest'

import { BUILTIN_BY_ID, BUILTIN_GAMES, CATEGORIES } from '@/library/catalog'
import { jarPath, shotPath } from '@/library/entries'

/**
 * 清单是脚本生成的，所以这里断言的是「生成结果本身成立」，而不是某几款游戏的
 * 具体内容 —— 具体内容会随上游清单变，这些性质不会。
 */

describe('内置清单（F17）', () => {
  it('104 款、11 个分类，与来源登记一致', () => {
    expect(BUILTIN_GAMES).toHaveLength(104)
    expect(CATEGORIES).toHaveLength(11)
  })

  it('id 唯一且只含 URL 安全字符', () => {
    const ids = BUILTIN_GAMES.map((game) => game.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    }
  })

  it('指纹唯一 —— 否则两款游戏会共用一份存档', () => {
    // 这条是存档隔离的地基：指纹就是仓储的键（ADR 0005 决策 5）。
    // 重复不会报错，只会让两款游戏的进度混在一起，所以必须在这里拦住。
    const fingerprints = BUILTIN_GAMES.map((game) => game.fingerprint)
    expect(new Set(fingerprints).size).toBe(fingerprints.length)
  })

  it('每个指纹都是完整的 sha256 格式', () => {
    for (const game of BUILTIN_GAMES) {
      expect(game.fingerprint, game.id).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  it('分类都在分类表里，且每个分类都有游戏', () => {
    const known = new Set(CATEGORIES.map((category) => category.id))
    for (const game of BUILTIN_GAMES) {
      expect(known.has(game.category), `${game.id} 的分类 ${game.category}`).toBe(true)
    }
    for (const category of CATEGORIES) {
      const count = BUILTIN_GAMES.filter((game) => game.category === category.id).length
      expect(count, `分类 ${category.name} 是空的`).toBeGreaterThan(0)
    }
  })

  it('标题非空、包体大小为正', () => {
    for (const game of BUILTIN_GAMES) {
      expect(game.title.trim(), game.id).not.toBe('')
      expect(game.bytes, game.id).toBeGreaterThan(0)
    }
  })

  it('id → 游戏 的索引与清单一致', () => {
    expect(BUILTIN_BY_ID.size).toBe(BUILTIN_GAMES.length)
    for (const game of BUILTIN_GAMES) {
      expect(BUILTIN_BY_ID.get(game.id)).toBe(game)
    }
  })

  it('资源路径由 id 推导，落到 /games 下', () => {
    expect(jarPath('snake')).toBe('/games/snake.data')
    expect(shotPath('snake')).toBe('/games/shots/snake.png')
  })
})
