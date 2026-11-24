/**
 * 库页的搜索、筛选、最近游玩。
 *
 * 全是纯函数：不给它 DOM，也不读 IndexedDB。库页因此可以只负责「拿数据、
 * 画出来」，而「为什么这一款没出现」这类问题能在单测里复现。
 */
import { IMPORTED_CATEGORY, type GameEntry, type LibraryQuery, type PlayRecord } from './types'

/**
 * 一个词元是否命中某款游戏。
 *
 * 同时匹配标题、副标题、作者、id：id 让「snake」「2048」这类英文名可搜，
 * 作者让「pisces」能把那批 MIT 作品一次捞出来。
 */
function matchesToken(game: GameEntry, token: string): boolean {
  const needle = token.toLowerCase()
  return (
    game.title.toLowerCase().includes(needle) ||
    game.subtitle.toLowerCase().includes(needle) ||
    game.author.toLowerCase().includes(needle) ||
    game.id.toLowerCase().includes(needle)
  )
}

/**
 * 搜索：空格分词，**全部命中**才算命中（AND）。
 *
 * 不做模糊/拼音：拼音要带一张几万字的表，还会把「san guo」匹配到
 * 「三个蘑菇」这种无关结果上。中文用户输入的是字，子串匹配已经够用，
 * 而且「搜不到」比「搜出一堆」更容易理解。
 */
export function matchesQuery(game: GameEntry, text: string): boolean {
  const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  return tokens.every((token) => matchesToken(game, token))
}

function matchesCategory(game: GameEntry, category: LibraryQuery['category']): boolean {
  if (category === null) return true
  if (category === IMPORTED_CATEGORY) return game.source === 'imported'
  return game.category === category
}

/** 库页网格的内容。顺序沿用入参顺序（内置清单顺序 / 导入时间倒序）。 */
export function queryLibrary(games: readonly GameEntry[], query: LibraryQuery): GameEntry[] {
  return games.filter((game) => matchesCategory(game, query.category) && matchesQuery(game, query.text))
}

/**
 * 最近玩过。
 *
 * 不参与主网格的排序，而是单独一条横条：如果把它做成「玩过的排前面」，
 * 首屏会被七八款老游戏长期占住，找新游戏反而要先滚过它们。
 *
 * 记录里的 id 可能已经不存在（导入的游戏被删、内置清单改过），直接跳过 ——
 * 一条悬空记录不该让整个横条空掉或报错。
 */
export function recentGames(
  games: readonly GameEntry[],
  records: readonly PlayRecord[],
  limit = 6,
): GameEntry[] {
  const byId = new Map(games.map((game) => [game.id, game]))
  return [...records]
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .map((record) => byId.get(record.gameId))
    .filter((game): game is GameEntry => game !== undefined)
    .slice(0, limit)
}

/** 某个分类下有几款，用于在 chip 上显示计数。 */
export function countByCategory(games: readonly GameEntry[], category: string | null): number {
  return games.filter((game) => matchesCategory(game, category)).length
}
