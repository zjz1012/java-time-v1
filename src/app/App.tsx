import { useEffect, useMemo, useState } from 'react'

import { LIBRARY_HASH, currentRoute, resolveLaunch, type GameLaunch, type Route } from '@/library'
import { libraryRepository } from '@/library/instance'

import { AboutScreen } from './AboutScreen'
import { LibraryScreen } from './LibraryScreen'
import { PlayerScreen } from './PlayerScreen'

/**
 * 装配层：把地址映射到页面。
 *
 * 三条入口：
 *   `#/`、`#/play/<id>`   正常产品入口（库页与运行页）
 *   `#/about`              关于页（许可原文与源码获取方式）
 *   `?jar=<url>`           开发/验证通道，直接跑一个程序包
 *
 * `?jar=` 保留是因为它让「内核能不能跑」这件事可以脱离游戏库复现 ——
 * e2e 与排查内核问题时都用它。它不写游玩记录：那不是库里的游戏，
 * 留一条记录只会在「最近玩过」里多一个点不开的卡片。
 */
export function App() {
  const route = useHashRoute()
  const dev = useDevLaunch()

  if (dev) return <PlayerScreen launch={dev} />
  if (route.name === 'play') return <GameRoute gameId={route.gameId} />
  if (route.name === 'about') return <AboutScreen />
  return <LibraryScreen />
}

/**
 * 订阅 hash 变化。
 *
 * 不用路由库：这个站只有两个页面，一条 `hashchange` 监听就够了，
 * 引入一个几十 KB 的依赖只为解析 `#/play/x` 并不划算。
 */
function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => currentRoute())

  useEffect(() => {
    const onChange = () => setRoute(currentRoute())
    // 首次挂载也同步一次：用户直接带 hash 打开页面时，初值可能还没算进去。
    onChange()
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}

function useDevLaunch(): GameLaunch | null {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const jar = params.get('jar')
    if (!jar) return null
    return {
      id: `dev:${jar}`,
      title: params.get('name') ?? '未命名程序',
      // 开发通道没有登记过指纹，等读到字节才知道；运行页会跳过比对。
      expectedFingerprint: undefined,
      trackPlay: false,
      load: async () => {
        const response = await fetch(jar)
        if (!response.ok) {
          throw new Error(`程序包请求失败（HTTP ${response.status}）`)
        }
        return new Uint8Array(await response.arrayBuffer())
      },
    }
  }, [])
}

/**
 * 按 id 取游戏再进运行页。
 *
 * 中间这一层是必要的：导入的游戏要先从 IndexedDB 把字节取出来，而
 * `PlayerScreen` 是个同步渲染的组件，不能在里面 await。
 */
function GameRoute({ gameId }: { readonly gameId: string }) {
  const [launch, setLaunch] = useState<GameLaunch | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLaunch(null)
    setMissing(false)

    void resolveLaunch(gameId, libraryRepository)
      .then((result) => {
        if (cancelled) return
        if (result) setLaunch(result)
        else setMissing(true)
      })
      .catch(() => {
        // 读不到就当作「不在库里」：链接过期、库被清、浏览器禁了 IndexedDB
        // 都会走到这里，对用户来说都是同一件事 —— 这款游戏现在打不开。
        if (!cancelled) setMissing(true)
      })

    return () => {
      cancelled = true
    }
  }, [gameId])

  if (missing) return <MissingScreen />
  if (!launch) {
    return (
      <main className="notice">
        <p className="notice__text">正在打开…</p>
      </main>
    )
  }
  return <PlayerScreen launch={launch} />
}

function MissingScreen() {
  return (
    <main className="notice">
      <p className="notice__title">这个游戏不在库里</p>
      <p className="notice__text">
        链接可能过期了，或者这款导入的游戏已经被删除。回到游戏库重新选一个试试。
      </p>
      <a className="notice__action" href={LIBRARY_HASH}>
        回到游戏库
      </a>
    </main>
  )
}
