import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

/**
 * 游戏库（F17）的真浏览器验收。
 *
 * 与单测的分工：单测证明「筛选/排序/路由这些纯函数算得对」，这里只证明
 * **用户真能走通**——卡片画得出来、点进去内核能跑、退出来回到库页、
 * 「最近玩过」真的记住了。这几件事串不起来时，单测全绿也说明不了什么。
 *
 * 前置：`public/kernel/`（构建产物）。缺了整组跳过并打印原因，不静默通过。
 */

const ROOT = process.cwd()
const KERNEL_ENTRY = join(ROOT, 'public/kernel/main-all.js')

const missing = !existsSync(KERNEL_ENTRY) ? ['public/kernel/main-all.js'] : []

test.skip(missing.length > 0, `缺少真内核产物：${missing.join('、')}`)

test.beforeEach(async ({ page }) => {
  // 每条用例都从干净地址进：上一条的 hash 会带到下一条。
  await page.goto('/')
  await expect(page.locator('.game-card').first()).toBeVisible()
})

/** 等内核对这幅画面出帧 —— 与 kernel-smoke 用同一个判据（徽标变「运行中」）。 */
async function waitRunning(page: Page): Promise<void> {
  await expect(page.locator('.badge')).toHaveText('运行中', { timeout: 90_000 })
}

test.describe('游戏库', () => {
  test('首屏列出全部内置游戏，分类计数与清单一致', async ({ page }) => {
    await expect(page.locator('.game-card')).toHaveCount(104)

    // 「全部」上的数字必须等于卡片数：两者由同一份清单算出来，
    // 一旦有人只改了一边，用户会看到「全部 104」但只有 90 张卡。
    const allChip = page.locator('.chip', { hasText: /^全部/ })
    await expect(allChip).toContainText('104')

    // 11 个分类 + 全部 = 12 个 chip。
    await expect(page.locator('.chip')).toHaveCount(12)
  })

  test('点卡片进运行页，内核出画，退出回库页并进「最近玩过」', async ({ page }) => {
    await page.locator('.game-card', { hasText: '贪吃蛇' }).click()

    // 地址是 hash 路由，不是整页跳转 —— 整页刷新会让返回慢好几秒。
    await expect(page).toHaveURL(/#\/play\/snake$/)
    await expect(page.locator('.player__title')).toHaveText('贪吃蛇')
    await waitRunning(page)

    await page.locator('.player__exit').click()

    await expect(page).toHaveURL(/#\/$/)
    await expect(page.locator('.game-card').first()).toBeVisible()
    // 这一条是库页与运行页之间唯一的「记忆」，也是最容易漏接的一环。
    await expect(page.locator('.library__recent .mini-card')).toHaveCount(1)
    await expect(page.locator('.mini-card__title')).toHaveText(['贪吃蛇'])
  })

  test('搜索与分类筛选同时生效，清空后恢复全部', async ({ page }) => {
    const cards = page.locator('.game-card')

    await page.fill('.library__search-input', '推箱子')
    await expect(cards).toHaveCount(1)

    // 换到「街机」分类：同一个词在两个分类里是「与」的关系，不是「或」。
    await page.locator('.chip', { hasText: '街机' }).click()
    await expect(cards).toHaveCount(0)
    await expect(page.locator('.library__empty')).toBeVisible()

    await page.locator('.library__empty-action').click()
    await expect(cards).toHaveCount(104)
  })

  test('直接开运行页地址也能玩（刷新 / 分享链接不白屏）', async ({ page }) => {
    // 用户在运行页按了刷新，或者把地址发给人 —— 这时 App 里没有任何内存状态，
    // 全靠地址把游戏还原出来。
    await page.goto('/#/play/g2048')
    await expect(page.locator('.player__title')).toHaveText('2048')
    await waitRunning(page)
  })

  test('库里没有的 id 给出可回退的提示，而不是一直转圈', async ({ page }) => {
    await page.goto('/#/play/not-a-real-game')
    await expect(page.locator('.notice__title')).toHaveText('这个游戏不在库里')
    await page.locator('.notice__action').click()
    await expect(page.locator('.game-card').first()).toBeVisible()
  })
})
