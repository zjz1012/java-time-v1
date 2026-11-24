/**
 * 游戏库的数据模型。
 *
 * 库里有两类东西：随包内置的（编译期清单，见 `catalog.ts`）和用户自己导入的
 * （运行时存在 IndexedDB 里）。它们对界面来说必须是同一种东西 —— 否则每处
 * 展示都要写两个分支，写着写着就会出现「内置的能搜、导入的搜不到」这种
 * 前后不一致。
 *
 * 所以统一成 `GameEntry`，用 `source` 区分来源；两者的 `fingerprint` 语义
 * 完全相同：都是 JAR 字节的 `sha256:` 摘要，也就是存档的隔离键。
 */

export type GameSource = 'builtin' | 'imported'

export interface Category {
  readonly id: string
  readonly name: string
}

/**
 * 内置游戏。`catalog.ts` 由脚本生成，字段要少 —— 104 条每多一个字段就是
 * 一份重复数据。
 */
export interface BuiltinGame {
  /** URL 与资源路径都用它：`/games/<id>.data`、`/games/shots/<id>.png` */
  readonly id: string
  readonly title: string
  /** 一行操作说明，卡片副标题 */
  readonly subtitle: string
  readonly category: string
  /** 版权归属串，直接来自来源登记，界面上原样显示 */
  readonly author: string
  readonly bytes: number
  readonly fingerprint: string
}

/** 界面与筛选统一用这个形状。 */
export interface GameEntry extends BuiltinGame {
  readonly source: GameSource
}

/** 用户导入的游戏。多一个 `updatedAt` 用于排序与「同一款重导」的覆盖判断。 */
export interface ImportedGame extends GameEntry {
  readonly source: 'imported'
  readonly importedAt: number
}

/**
 * 游玩记录。
 *
 * 与存档分开存：存档可以不存在（没存过档的游戏照样有游玩记录），
 * 而「最近玩过」是库页排序的依据。
 */
export interface PlayRecord {
  readonly gameId: string
  /** 毫秒时间戳。同一款只保留最后一次 —— 库只要「最近一次」。 */
  readonly lastPlayedAt: number
  /** 累计次数，界面上显示「玩过 N 次」 */
  readonly plays: number
}

/** 库页当前的选择。做成不可变对象，筛选就是纯函数，好测。 */
export interface LibraryQuery {
  readonly text: string
  /** 分类 id；`null` 表示全部，`'imported'` 表示只看自己导入的 */
  readonly category: string | null
}

export const ALL_CATEGORY = null
/** 伪分类：不是真的游戏分类，而是「我导入的」这个视图。 */
export const IMPORTED_CATEGORY = 'imported'
