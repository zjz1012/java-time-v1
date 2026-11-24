import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { exitPlayer } from './player'

/**
 * F5 的量化部分：退出后重复启动 3 次，内存与定时器不累积。
 *
 * 这一条长期只有「行为」覆盖（退出、再启动、启动途中退出都能跑），没有数字 ——
 * 而「看起来做了」和「测过」是两件事。内核每轮要起一个 JVM + 14MB wasm，
 * 如果 iframe 或定时器没清干净，表现是玩家玩到第五六个游戏时手机变卡，
 * 而任何一次单局验收都看不出来。
 *
 * 判据分三层，从硬到软：
 *   1. **iframe 归零**：退出后 `document.querySelectorAll('iframe')` 必须是 0 个。
 *      留着就是整份内核内存还在。
 *   2. **定时器不累积**：注入探针统计活跃的 setTimeout / setInterval / rAF，
 *      轮次之间不增长。内核自己有轮询（静默期归档 2 秒一轮），退出后它们必须停。
 *   3. **堆内存有界**：每轮结束强制 GC 后读 JSHeapUsedSize，第 3 轮相对第 1 轮
 *      的增量必须落在阈值内。
 *
 * 关于第 3 层要说清楚：`JSHeapUsedSize` 量的是**外壳**所在的渲染进程堆，
 * 内核的 wasm 线性内存不在这份数字里（它在 iframe 自己的堆中）。所以
 * 「内核有没有被释放」的第一判据始终是 **iframe 归零**；堆这一层守的是另一件事
 * —— 外壳每轮都会新建 runtime、事件监听、闭包，如果忘了摘，泄漏就发生在这里，
 * 而它恰恰是 3.8MB 这个量级的数字里唯一能看出问题的部分。
 *
 * 实测（2026-11-24，本机 Chromium）：堆 3.8 / 4.2 / 4.3 MB，活跃定时器 0 / 0 / 0。
 * 阈值写死一个数字是有意的：它把这个项目的「可接受浪费」固定下来，
 * 免得下次换实现时靠感觉判断。
 */

const ROOT = process.cwd()
const REQUIRED = [join(ROOT, 'public/kernel/main-all.js')]
const missing = REQUIRED.filter((file) => !existsSync(file))
if (missing.length > 0) {
  test.skip(true, `缺少内核产物：${missing.join('、')}（重建方式见 scripts/README.md）`)
}

const ROUNDS = 3
/** 第 3 轮相对第 1 轮的堆增量上限。见文件头的说明。 */
const GROWTH_LIMIT_BYTES = 16 * 1024 * 1024
/** 轮次之间活跃定时器的允许增量（应用自己可能挂长期轮询，不该因此误报）。 */
const TIMER_SLACK = 2

declare global {
  interface Window {
    __probe?: {
      live(): { timers: number; frames: number }
      peak(): number
    }
  }
}

/**
 * 定时器探针。
 *
 * 包住三个排程 API，记下「还活着」的 id：timeout 触发即出表，interval 与 rAF
 * 要等 clear。count 只统计**还没结束**的，所以「退出后归零」是可判定的。
 *
 * 用 `addInitScript` 注入，每个 frame（含宿主 iframe）都会跑一遍；
 * 主 frame 的计数通过 `window.__probe` 读，iframe 拆掉时它的计数自然消失 ——
 * 这正是我们要的语义：连窗口一起没了，定时器也就不存在了。
 */
function installProbe(): void {
  const timeouts = new Set<number>()
  const intervals = new Set<number>()
  const frames = new Set<number>()
  let peak = 0
  let nextFake = 1

  const total = (): number => timeouts.size + intervals.size + frames.size
  const note = (): void => {
    const value = total()
    if (value > peak) peak = value
  }

  const rawTimeout = window.setTimeout.bind(window)
  const rawInterval = window.setInterval.bind(window)
  const rawClearTimeout = window.clearTimeout.bind(window)
  const rawClearInterval = window.clearInterval.bind(window)
  const rawRaf = window.requestAnimationFrame.bind(window)
  const rawCancelRaf = window.cancelAnimationFrame.bind(window)

  // 用自增的假 id 记账，回调里按假 id 出表，再映射回真 id。
  const timeoutIds = new Map<number, number>()
  const intervalIds = new Map<number, number>()
  const rafIds = new Map<number, number>()

  window.setTimeout = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) => {
    const fake = nextFake++
    const real = rawTimeout(
      (...args: unknown[]) => {
        timeouts.delete(fake)
        if (typeof handler === 'function') (handler as (...a: unknown[]) => void)(...args)
      },
      delay,
      ...rest,
    )
    timeouts.add(fake)
    timeoutIds.set(fake, real)
    note()
    return real
  }) as typeof window.setTimeout

  window.clearTimeout = ((id?: number) => {
    for (const [fake, real] of timeoutIds) {
      if (real === id) {
        timeouts.delete(fake)
        timeoutIds.delete(fake)
      }
    }
    return rawClearTimeout(id)
  }) as typeof window.clearTimeout

  window.setInterval = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) => {
    const fake = nextFake++
    const real = rawInterval(handler as () => void, delay, ...rest)
    intervals.add(fake)
    intervalIds.set(fake, real)
    note()
    return real
  }) as typeof window.setInterval

  window.clearInterval = ((id?: number) => {
    for (const [fake, real] of intervalIds) {
      if (real === id) {
        intervals.delete(fake)
        intervalIds.delete(fake)
      }
    }
    return rawClearInterval(id)
  }) as typeof window.clearInterval

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const fake = nextFake++
    const real = rawRaf((time) => {
      frames.delete(fake)
      rafIds.delete(fake)
      callback(time)
    })
    frames.add(fake)
    rafIds.set(fake, real)
    note()
    return real
  }) as typeof window.requestAnimationFrame

  window.cancelAnimationFrame = ((id: number) => {
    for (const [fake, real] of rafIds) {
      if (real === id) {
        frames.delete(fake)
        rafIds.delete(fake)
      }
    }
    return rawCancelRaf(id)
  }) as typeof window.cancelAnimationFrame

  window.__probe = {
    live: () => ({ timers: total(), frames: frameElement === null ? 0 : 1 }),
    peak: () => peak,
  }
}

/** 强制 GC 后读堆大小。不 GC 的话，读到的是「还没回收的垃圾」，会假报警。 */
async function heapUsed(page: Page): Promise<number> {
  const client = await page.context().newCDPSession(page)
  await client.send('Performance.enable')
  await client.send('HeapProfiler.collectGarbage')
  const { metrics } = await client.send('Performance.getMetrics')
  await client.detach()
  const found = metrics.find((metric) => metric.name === 'JSHeapUsedSize')
  return found?.value ?? 0
}

test('进出 3 次：iframe 归零、定时器不累积、堆增量有界', async ({ page }) => {
  test.setTimeout(240_000)
  await page.addInitScript(installProbe)

  const heaps: number[] = []
  const timers: number[] = []

  await page.goto('/')
  await expect(page.locator('.game-card').first()).toBeVisible()

  for (let round = 1; round <= ROUNDS; round += 1) {
    await page.locator('.game-card').first().click()
    await expect(page.locator('.badge')).toHaveText('运行中', { timeout: 90_000 })
    await exitPlayer(page)

    // 1) 内核 iframe 必须真的被摘掉。留着就是整份内核内存还在。
    await expect(page.locator('.player__screen iframe')).toHaveCount(0)
    await expect(page.locator('iframe')).toHaveCount(0)

    // 2) 定时器：等一个静默期（宿主 2 秒一轮的归档轮询要在这一轮里停掉）
    await page.waitForTimeout(2_500)
    const live = await page.evaluate(() => window.__probe?.live().timers ?? -1)
    timers.push(live)
    heaps.push(await heapUsed(page))

    // 回到库页状态，下一轮从头开始
    await expect(page.locator('.game-card').first()).toBeVisible()
  }

  // 定时器不随轮次增长
  const firstTimers = timers[0] ?? 0
  const lastTimers = timers[timers.length - 1] ?? 0
  // 数字打出来：这些值要写进 FEATURE_MATRIX 的 F5，也要能跟下次对比。
  console.log(
    `[memory] 堆：${heaps.map((value) => `${(value / 1024 / 1024).toFixed(1)}MB`).join(' / ')}` +
      ` · 活跃定时器：${timers.join(' / ')}`,
  )
  expect(
    lastTimers,
    `活跃定时器从 ${firstTimers} 涨到 ${lastTimers}（各轮：${timers.join(' / ')}）`,
  ).toBeLessThanOrEqual(firstTimers + TIMER_SLACK)

  // 堆增量有界
  const firstHeap = heaps[0] ?? 0
  const lastHeap = heaps[heaps.length - 1] ?? 0
  const growth = lastHeap - firstHeap
  expect(
    growth,
    `堆从 ${(firstHeap / 1024 / 1024).toFixed(1)} MB 涨到 ${(lastHeap / 1024 / 1024).toFixed(1)} MB` +
      `（各轮：${heaps.map((value) => `${(value / 1024 / 1024).toFixed(1)} MB`).join(' / ')}）`,
  ).toBeLessThan(GROWTH_LIMIT_BYTES)
})
