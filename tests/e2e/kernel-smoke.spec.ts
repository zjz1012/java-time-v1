import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

/**
 * 真内核冒烟测试：把 JAR 真的喂进 PluotSorbet，走完
 * 「启动 → 方向输入 → 退出 → 再次启动」四条路径。
 *
 * 为什么需要它：单元测试全部用假实现（MockRuntime / 伪造的 postMessage），
 * 覆盖不到「内核到底能不能出画」「键码到底有没有进 JVM」这两件事。
 * 本仓库已经在这两处栽过 —— 一次是 `style/emoji/` 缺失导致启动成功但纯黑，
 * 一次是物理键的 `which` 落不进内核的设备键码表。这两类问题只有真跑才看得见。
 *
 * 前置：`public/kernel/`（npm run 构建脚本）与 `public/assets/sokoban.jar`。
 * 两者都不入库，缺失时整组跳过并打印原因。
 */

const ROOT = process.cwd()
const KERNEL_ENTRY = join(ROOT, 'public/kernel/main-all.js')
const EMULATOR_JS = join(ROOT, 'public/kernel/j2me.js')
const TEST_JAR = join(ROOT, 'public/assets/sokoban.jar')

const REQUIRED: ReadonlyArray<readonly [path: string, label: string]> = [
  [KERNEL_ENTRY, 'public/kernel/main-all.js'],
  [EMULATOR_JS, 'public/kernel/j2me.js'],
  [TEST_JAR, 'public/assets/sokoban.jar'],
]

const missing = REQUIRED.filter(([file]) => !existsSync(file)).map(([, label]) => label)

const PLAYER_URL = '/?jar=/assets/sokoban.jar&name=推箱子'

/** 打开运行页并等到内核交出首帧。 */
async function openPlayer(page: Page): Promise<void> {
  await page.goto(PLAYER_URL)
  await expect(page.locator('.badge')).toHaveText('运行中', { timeout: 90_000 })
}

/**
 * 画面指纹：把内核画布缩绘到 64×64 再统计颜色数与哈希。
 *
 * 不能直接在源画布上 `getContext('2d')` —— 那是抢渲染上下文，画面会掉到 0 FPS。
 * 也不能只比 `toDataURL` 长度：纯黑画面同样有几 KB。
 */
async function snapshot(page: Page): Promise<{ colors: number; hash: string }> {
  return page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('.player__screen iframe')
    // `instanceof HTMLCanvasElement` 在跨 realm 时恒为 false —— 拿到的元素属于
    // iframe 自己的 window，原型链不与外层共享。只能按能力判断。
    const canvas = frame?.contentDocument?.getElementById('canvas') as HTMLCanvasElement | null
    if (!canvas || typeof canvas.getContext !== 'function' || canvas.width === 0) {
      throw new Error('内核画布不存在或尺寸为 0')
    }

    const probe = document.createElement('canvas')
    probe.width = 64
    probe.height = 64
    const ctx = probe.getContext('2d')
    if (!ctx) throw new Error('拿不到离屏上下文')

    ctx.drawImage(canvas, 0, 0, 64, 64)
    const { data } = ctx.getImageData(0, 0, 64, 64)
    const colors = new Set<number>()
    let hash = 2166136261
    for (let i = 0; i < data.length; i += 4) {
      const rgb = ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0)
      colors.add(rgb)
      hash = Math.imul(hash ^ rgb, 16777619) >>> 0
    }
    return { colors: colors.size, hash: hash.toString(16) }
  })
}

/** 记录真正进了 JVM 的设备键码。这是本轮踩过的坑，必须单独盯着。 */
async function installKeyProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = document.querySelector<HTMLIFrameElement>('.player__screen iframe')?.contentWindow
    if (!win) throw new Error('iframe 不可用')
    const midp = (win as unknown as { MIDP?: Record<string, (code: number) => void> }).MIDP
    if (!midp) throw new Error('内核还没挂出 MIDP')

    const codes: number[] = []
    ;(window as unknown as { __keyCodes: number[] }).__keyCodes = codes
    const press = midp.sendKeyPress
    if (typeof press !== 'function') throw new Error('MIDP.sendKeyPress 不可用')
    midp.sendKeyPress = (code: number) => {
      codes.push(code)
      press.call(midp, code)
    }
  })
}

test.describe('真实内核冒烟', () => {
  test.skip(missing.length > 0, `缺少 ${missing.join('、')}，先构建内核再跑（见 README）`)

  test('启动：内核跑起来，画面不是纯黑', async ({ page }) => {
    await openPlayer(page)
    // 出画之后遮罩必须撤掉，否则用户永远看的是「正在启动…」。
    await expect(page.locator('.player__overlay')).toHaveCount(0)
    const shot = await snapshot(page)
    // 纯黑只有 1 种颜色。实测正常画面是 200+ 种。
    expect(shot.colors).toBeGreaterThan(1)
  })

  test('方向输入：按键进 JVM，画面随之变化', async ({ page }) => {
    await openPlayer(page)
    await installKeyProbe(page)

    const before = await snapshot(page)
    let moved = false
    for (const control of ['left', 'up', 'right', 'down']) {
      await page.locator(`.pad[data-control="${control}"]`).click()
      await page.waitForTimeout(400)
      if ((await snapshot(page)).hash !== before.hash) {
        moved = true
        break
      }
    }
    expect(moved, '四个方向都没能改变画面，说明输入通路断了').toBe(true)

    const codes = await page.evaluate(
      () => (window as unknown as { __keyCodes: number[] }).__keyCodes,
    )
    // 设备键码：left=97 up=119 right=100 down=115（内核 gameKeys 表的取值）
    expect(codes.some((code) => [97, 119, 100, 115].includes(code))).toBe(true)
    // 浏览器方向键的 which 是 37~40，进到 JVM 就说明走的还是原生通路
    expect(codes.some((code) => code >= 37 && code <= 40)).toBe(false)
  })

  test('退出：返回后 iframe 被移除', async ({ page }) => {
    await openPlayer(page)
    expect(await page.locator('.player__screen iframe').count()).toBe(1)

    await page.locator('.player__exit').click()
    await expect(page.locator('.player__screen iframe')).toHaveCount(0)
  })

  test('再次启动：退出后重新进入仍能出画', async ({ page }) => {
    await openPlayer(page)
    expect((await snapshot(page)).colors).toBeGreaterThan(1)

    await page.locator('.player__exit').click()
    await expect(page.locator('.player__screen iframe')).toHaveCount(0)

    await openPlayer(page)
    expect((await snapshot(page)).colors).toBeGreaterThan(1)
  })

  test('启动途中退出：遮罩盖着，退出后不留 iframe，也不抛未捕获异常', async ({ page }) => {
    // 对应用户真实动作：点了游戏，等不及加载完就返回。
    // 旧实现在这里会把等待中的 Promise 静静丢掉，永不 settle。
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    // 把 JAR 拖慢 3 秒，把「启动中」这个窗口撑开。
    // 本机内核 1 秒就能出画，不拖慢的话根本采不到这个状态。
    await page.route('**/assets/sokoban.jar', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      try {
        await route.continue()
      } catch {
        // 页面已经跳走了，这次请求不再需要继续
      }
    })

    await page.goto(PLAYER_URL)
    // 启动期间必须盖着遮罩：不盖的话用户看到的是纯黑，
    // 与「已经挂了」长得一样，而这两件事该做的反应相反。
    await expect(page.locator('.player__overlay')).toBeVisible()
    await expect(page.locator('.player__spinner')).toBeVisible()

    await page.locator('.player__exit').click()
    await expect(page.locator('.player__screen iframe')).toHaveCount(0)
    await page.waitForTimeout(1500)
    expect(errors).toEqual([])
  })
})
