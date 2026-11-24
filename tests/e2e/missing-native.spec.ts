import { expect, test } from '@playwright/test'

/**
 * 内核缺 Form/ChoiceGroup 渲染时，用户看到的是什么（F23）。
 *
 * 这 6 款（小蜜蜂 / 一路向前 / 猜数字 / 连连看 / 迷宫 / 扫雷）的 MIDlet 一启动就
 * `setCurrent(menuForm)`，而内核的 Form 渲染层整层是空桩 —— 画面永远不出来。
 * 之前的表现是「转 15 秒，然后说『启动超时，可能是程序包不完整』」，方向全错。
 *
 * 现在宿主给 13 个 native 装了桩，于是能走到「补了桩也画不出来」这条专门分支，
 * 在 8 秒左右报出真正的缺失。这条用例同时守三件事：
 *   1. 桩真的装上了（否则内核会打印 `is native but does not have an implementation`）；
 *   2. 原因说得具体（提到列表选择菜单），不是通用超时文案；
 *   3. 结论比外壳 15 秒兜底来得早 —— 否则我们查清的原因会被那句通用文案盖掉。
 */

test('缺列表选择控件的游戏：8 秒内说清原因，而不是「程序包不完整」', async ({ page }) => {
  const missingNative: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('is native but does not have an implementation')) missingNative.push(m.text())
  })

  const startedAt = Date.now()
  await page.goto('/#/play/cute-bee')

  const message = page.locator('.player__overlay-msg--error')
  await expect(message).toBeVisible({ timeout: 15_000 })
  await expect(message).toContainText('列表选择菜单')
  await expect(message).not.toContainText('启动超时')

  // 外壳兜底是 15 秒；宿主补桩后的判定是 8 秒。阈值留到 12 秒，兼顾 CI 抖动，
  // 但仍能区分「我们自己的判定」与「外壳的通用超时」。
  expect(Date.now() - startedAt).toBeLessThan(12_000)

  // 桩没装上时内核会把这句打印 13 次 —— 一条都不该有。
  expect(missingNative, '有 native 桩没装上，内核仍在报缺实现').toEqual([])
})
