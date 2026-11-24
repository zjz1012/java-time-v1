/**
 * 真内核 E2E 用的那一款测试游戏。
 *
 * ★ 只用**仓库里真实随包分发**的自研推箱子，不另外准备一份「测试专用」程序包。
 *
 * 曾经的写法要求 `public/assets/sokoban.jar` —— 那个路径被 `.gitignore` 忽略
 * （`public/assets/*.jar`），于是发布工作流得想办法把它变出来：配 secret
 * `E2E_TEST_JAR_B64`、还原成 `public/assets/e2e-test.jar`。两边文件名还写得不一致，
 * 结果就是「配了 secret 也照样找不到文件」。这类缺陷在本地永远看不见，因为
 * 本地那份 `sokoban.jar` 是手工放的，早就躺在磁盘上了。
 *
 * 换成 `public/games/sokoban.data` 之后同时解决三件事：
 *   1. 文件入库，新克隆的仓库直接就有，不需要 secret；
 *   2. E2E 验的是真正要发出去的那个文件，而不是一份可能与线上不同的副本；
 *   3. 两个 spec 共用一个常量，不会再各写各的路径。
 *
 * `.data` 与 `.jar` 字节完全相同 —— 只是后缀不同（平台会丢弃包内的 `.zip`/`.jar`，
 * 见 `scripts/build-midlets.mjs`）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/** 仓库相对路径、站点内 URL、显示名，三处都从这里取。 */
export const TEST_GAME = {
  file: 'public/games/sokoban.data',
  url: '/games/sokoban.data',
  name: '推箱子',
} as const

export const TEST_GAME_PATH = join(ROOT, TEST_GAME.file)

/** `?jar=` 开发通道：与库页点进去走的是同一条加载路径。 */
export const PLAYER_URL = `/?jar=${TEST_GAME.url}&name=${TEST_GAME.name}`

/**
 * 测试游戏缺失时的说明。
 *
 * 与内核产物不同，这个文件**不该**缺 —— 它入库。真缺了说明仓库被动过，
 * 应该是失败而不是跳过，所以调用方把它并进 `missing` 列表后由发布门禁判红。
 */
export const TEST_GAME_MISSING = !existsSync(TEST_GAME_PATH)
