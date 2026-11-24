/**
 * 把内置清单与用户导入合成一份库，并提供「按 id 取 bytes」的唯一入口。
 *
 * 运行页不该知道游戏是内置的还是导入的 —— 它只需要「一个能读字节的东西
 * 和一个期望指纹」。把这个差异收在这里，运行页就只剩一条路径。
 */
import { BUILTIN_BY_ID, BUILTIN_GAMES } from './catalog'
import type { LibraryRepository } from './store'
import type { GameEntry } from './types'

/**
 * 内置游戏的静态资源路径。
 *
 * 由 id 推导而不是写进清单：104 条各多两个字段只是把同一份信息存了两遍，
 * 而路径规则（`/games/<id>.data`）是脚本生成资产时确定的，改一处即可。
 */
export const GAME_DIR = '/games'

export function jarPath(id: string): string {
  return `${GAME_DIR}/${id}.data`
}

export function shotPath(id: string): string {
  return `${GAME_DIR}/shots/${id}.png`
}

/** 内置游戏补上 `source`，之后与导入的游戏形状一致。 */
const BUILTIN_ENTRIES: readonly GameEntry[] = BUILTIN_GAMES.map((game) => ({
  ...game,
  source: 'builtin',
}))

export function builtinEntries(): readonly GameEntry[] {
  return BUILTIN_ENTRIES
}

/** 库页的全部内容：内置在前（固定顺序），导入的在后（导入时间倒序）。 */
export async function loadLibrary(repository: LibraryRepository): Promise<GameEntry[]> {
  const imported = await repository.listImported()
  return [...BUILTIN_ENTRIES, ...imported]
}

export function findBuiltin(id: string): GameEntry | undefined {
  const game = BUILTIN_BY_ID.get(id)
  return game ? { ...game, source: 'builtin' } : undefined
}

/**
 * 启动一个游戏需要的一切。
 *
 * `expectedFingerprint` 是可选的：内置与导入的游戏都有（来自清单/导入时算出的
 * 摘要），`?jar=` 这条开发通道没有 —— 它的指纹要等读到字节才知道。
 */
export interface GameLaunch {
  readonly id: string
  readonly title: string
  readonly expectedFingerprint: string | undefined
  /**
   * 是否计入「最近玩过」。缺省为 true。
   *
   * 开发通道要设成 false：它不是库里的条目，记下来只会在「最近玩过」里
   * 留一个点不开的卡片（id 不在库中，`recentGames` 会把它过滤掉，
   * 但那条记录会一直躺在库里）。
   */
  readonly trackPlay?: boolean
  readonly load: () => Promise<Uint8Array>
}

/**
 * 按 id 组装启动描述符。
 *
 * 返回 `null` 表示这款游戏不在库里（链接过期、导入的被删了）。调用方应该
 * 回库页并说明，而不是停在「正在启动」上 —— 那样看起来像卡死。
 */
export async function resolveLaunch(
  id: string,
  repository: LibraryRepository,
): Promise<GameLaunch | null> {
  const builtin = BUILTIN_BY_ID.get(id)
  if (builtin) {
    return {
      id: builtin.id,
      title: builtin.title,
      expectedFingerprint: builtin.fingerprint,
      load: () => fetchBytes(jarPath(builtin.id)),
    }
  }

  const imported = await repository.listImported()
  const game = imported.find((entry) => entry.id === id)
  if (!game) return null

  return {
    id: game.id,
    title: game.title,
    expectedFingerprint: game.fingerprint,
    load: async () => {
      const bytes = await repository.readBytes(id)
      if (!bytes) {
        throw new Error('这个游戏的数据已经不在了，可能是在别的标签页里删掉了')
      }
      return bytes
    },
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`程序包请求失败（HTTP ${response.status}）`)
  }
  return new Uint8Array(await response.arrayBuffer())
}
