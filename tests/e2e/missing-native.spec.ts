import { expect, test } from '@playwright/test'

/**
 * 「主界面依赖 Form 渲染」的六款已换成自研 Canvas 版（F23）。
 *
 * 为什么要留一条 e2e 守这件事：那六款不是「难玩」，是**内核的 Form 渲染层整层是空桩**
 * （`ItemLFImpl.show0`、`FormLFImpl.showNativeResource0` 全是 no-op，`ChoiceGroupLFImpl`
 * 的 12 个 native 一个都没注册），补桩只能做到「不卡死 + 说清原因」，画面永远出不来。
 * 换掉是唯一能让它们可玩的路线，所以「旧 id 不该再出现在库里」这件事必须被钉住 ——
 * 否则某次从上游重新导入，六款死游戏会悄无声息地回来，用户又要点进去干等 9 秒。
 */

/** 被替换掉的旧 id（主界面是 Form + ChoiceGroup）。 */
const REMOVED = ['cute-bee', 'escapee', 'guess-num', 'lianliankan', 'maze', 'mine-sweep']

/** 顶上的自研替代品。 */
const REPLACED = ['bee-shooter', 'runner-dash', 'guess-number', 'link-pair', 'maze-run', 'mine-field']

test('旧 id 已下架，直接开地址给出可回退的提示而不是干等', async ({ page }) => {
  await page.goto(`/#/play/${REMOVED[0]}`)
  // 库里没有这个 id —— 应当立刻说明，而不是转圈到启动超时。
  await expect(page.locator('.notice__title')).toHaveText('这个游戏不在库里')
})

test('替代品都在库里，且点进去真的出画', async ({ page }) => {
  await page.goto('/')
  const cards = page.locator('.game-card')
  await expect(cards.first()).toBeVisible({ timeout: 15_000 })

  for (const id of REPLACED) {
    await expect(page.locator(`.game-card[href="#/play/${id}"]`), `${id} 不在库里`).toHaveCount(1)
  }

  // 抽一款真的跑一遍：出画是「能玩」的最低证据。
  await page.goto(`/#/play/${REPLACED[0]}`)
  await expect(page.locator('.badge--ok')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.player__overlay-msg--error')).toHaveCount(0)
})
