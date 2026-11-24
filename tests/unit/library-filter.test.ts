import { describe, expect, it } from 'vitest'

import { countByCategory, matchesQuery, queryLibrary, recentGames } from '@/library/filter'
import { IMPORTED_CATEGORY, type GameEntry, type PlayRecord } from '@/library/types'

function game(overrides: Partial<GameEntry> & { id: string }): GameEntry {
  return {
    title: overrides.id,
    subtitle: '',
    category: 'arcade',
    author: '自研',
    bytes: 1024,
    fingerprint: `sha256:${'0'.repeat(64)}`,
    source: 'builtin',
    ...overrides,
  }
}

const LIBRARY: readonly GameEntry[] = [
  game({ id: 'snake', title: '贪吃蛇', subtitle: '方向键转向，5 开始', category: 'arcade' }),
  game({ id: 'g2048', title: '2048', subtitle: '滑动合成数字', category: 'puzzle' }),
  game({ id: 'sokoban', title: '推箱子', subtitle: '把箱子推到目标点', category: 'puzzle' }),
  game({
    id: 'user-0123456789abcdef',
    title: '本地小游戏',
    author: '本地导入',
    category: IMPORTED_CATEGORY,
    source: 'imported',
  }),
]

describe('搜索', () => {
  it('空文本不筛掉任何东西', () => {
    for (const text of ['', '   ', '\t\n']) {
      expect(matchesQuery(LIBRARY[0] as GameEntry, text)).toBe(true)
    }
  })

  it('匹配标题、副标题、作者与 id', () => {
    const snake = LIBRARY[0] as GameEntry
    expect(matchesQuery(snake, '贪吃')).toBe(true) // 标题
    expect(matchesQuery(snake, '方向键')).toBe(true) // 副标题
    expect(matchesQuery(snake, '自研')).toBe(true) // 作者
    expect(matchesQuery(snake, 'nake')).toBe(true) // id 子串
  })

  it('大小写不敏感', () => {
    const imported = LIBRARY[3] as GameEntry
    expect(matchesQuery(imported, 'ABCDEF')).toBe(true)
    expect(matchesQuery(imported, 'abcdef')).toBe(true)
  })

  it('多个词必须全部命中（AND），不是命中任一', () => {
    const snake = LIBRARY[0] as GameEntry
    expect(matchesQuery(snake, '贪吃蛇 方向键')).toBe(true)
    expect(matchesQuery(snake, '贪吃蛇 推箱子')).toBe(false)
  })

  it('跳过前后多余空白', () => {
    expect(matchesQuery(LIBRARY[1] as GameEntry, '  2048  ')).toBe(true)
  })

  it('搜不到就是搜不到，不做模糊匹配', () => {
    // 「tanshshe」之类的拼音缩写不该命中「贪吃蛇」——宁可搜不到，
    // 也不要让用户在一堆无关结果里找。
    expect(matchesQuery(LIBRARY[0] as GameEntry, 'tanshi')).toBe(false)
  })
})

describe('筛选', () => {
  it('全部分类显示所有来源', () => {
    expect(queryLibrary(LIBRARY, { text: '', category: null })).toHaveLength(4)
  })

  it('按分类筛', () => {
    const puzzle = queryLibrary(LIBRARY, { text: '', category: 'puzzle' })
    expect(puzzle.map((g) => g.id)).toEqual(['g2048', 'sokoban'])
  })

  it('「我导入的」只看 imported 来源，与 category 字段无关', () => {
    const mine = queryLibrary(LIBRARY, { text: '', category: IMPORTED_CATEGORY })
    expect(mine.map((g) => g.id)).toEqual(['user-0123456789abcdef'])
  })

  it('分类与搜索同时生效', () => {
    const result = queryLibrary(LIBRARY, { text: '推', category: 'puzzle' })
    expect(result.map((g) => g.id)).toEqual(['sokoban'])
    // 同一个词换到别的分类就查不到 —— 两个条件不是「或」。
    expect(queryLibrary(LIBRARY, { text: '推', category: 'arcade' })).toEqual([])
  })

  it('保持入参顺序，不重新排序', () => {
    // 内置清单的顺序是人工排的（自研在前），筛选不该打乱它。
    expect(queryLibrary(LIBRARY, { text: '', category: null }).map((g) => g.id)).toEqual(
      LIBRARY.map((g) => g.id),
    )
  })

  it('计数与筛选结果一致', () => {
    expect(countByCategory(LIBRARY, null)).toBe(4)
    expect(countByCategory(LIBRARY, 'puzzle')).toBe(2)
    expect(countByCategory(LIBRARY, IMPORTED_CATEGORY)).toBe(1)
    expect(countByCategory(LIBRARY, 'racing')).toBe(0)
  })
})

describe('最近游玩', () => {
  function play(gameId: string, lastPlayedAt: number): PlayRecord {
    return { gameId, lastPlayedAt, plays: 1 }
  }

  it('按时间倒序，最多 limit 个', () => {
    const records = [play('snake', 100), play('sokoban', 300), play('g2048', 200)]
    expect(recentGames(LIBRARY, records).map((g) => g.id)).toEqual(['sokoban', 'g2048', 'snake'])
    expect(recentGames(LIBRARY, records, 2).map((g) => g.id)).toEqual(['sokoban', 'g2048'])
  })

  it('悬空记录被跳过，不会让整条横条空掉', () => {
    // 导入的游戏被删掉后，记录还在 —— 这条不该让其余最近玩过的消失。
    const records = [play('deleted-game', 999), play('snake', 100)]
    expect(recentGames(LIBRARY, records).map((g) => g.id)).toEqual(['snake'])
  })

  it('没有记录时是空数组', () => {
    expect(recentGames(LIBRARY, [])).toEqual([])
  })

  it('不改动入参数组', () => {
    const records = [play('snake', 1), play('g2048', 2)]
    const snapshot = [...records]
    recentGames(LIBRARY, records)
    expect(records).toEqual(snapshot)
  })
})
