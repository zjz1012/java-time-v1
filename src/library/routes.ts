/**
 * 极简 hash 路由。
 *
 * 用 hash 而不是 path，是因为这个站要能放在 GitHub Pages 的子路径下直接打开：
 * path 路由刷新时服务器找不到对应文件（404），得靠 404.html 兜底重写，
 * 而 hash 永远只请求 index.html 一个文件。
 *
 *   #/                 库页
 *   #/play/<gameId>    运行页
 *   #/about            关于页（版本 / 来源 / 许可原文 / 源码获取方式）
 *
 * 解析与生成成对写在同一个文件里，是为了让「拼出来的串一定解析得回去」
 * 这件事能被测试直接验证，而不是靠两处手写格式碰巧一致。
 */

export type Route =
  | { readonly name: 'library' }
  | { readonly name: 'play'; readonly gameId: string }
  | { readonly name: 'about' }

/**
 * 库内 id 的字符集。
 *
 * 内置 id 来自 `catalog.ts`（小写字母数字与连字符）；导入的 id 是
 * `user-` + 16 位十六进制。这里放宽到大小写与下划线，避免以后换命名规则时
 * 老链接整片失效 —— 路由的职责是搬运，不是校验它认不认识这个游戏。
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/

export const LIBRARY_HASH = '#/'

/** 关于页。GPL 要求分发时给出许可原文与源码获取方式，入口不能只藏在页脚一行字里。 */
export const ABOUT_HASH = '#/about'

export function playHash(gameId: string): string {
  return `#/play/${encodeURIComponent(gameId)}`
}

/**
 * 解析 hash。认不出的形状一律回库页 —— 一条坏链接不该让页面白屏，
 * 也不该被当成「正在加载」而卡住。
 */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const path = raw.split('?')[0] ?? ''
  const segments = path.split('/').filter((segment) => segment !== '')
  if (segments.length === 1 && segments[0] === 'about') return { name: 'about' }
  if (segments.length !== 2) return { name: 'library' }
  const [head, tail] = segments
  if (head !== 'play' || !tail) return { name: 'library' }

  let gameId: string
  try {
    gameId = decodeURIComponent(tail)
  } catch {
    // 半个百分号编码（`%E4`）会让 decodeURIComponent 抛错。
    return { name: 'library' }
  }
  if (!ID_PATTERN.test(gameId)) return { name: 'library' }
  return { name: 'play', gameId }
}

/** 当前地址对应的路由。测试里传 `location.hash`，运行时代码直接调用。 */
export function currentRoute(): Route {
  return parseRoute(window.location.hash)
}
