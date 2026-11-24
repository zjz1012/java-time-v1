import { Buffer } from 'node:buffer'

import { expect, test } from '@playwright/test'

import { buildZip } from '../unit/fixtures/zip'

/**
 * 坏包在**启动前**就被拒（F6）。
 *
 * 这条用例守的是一个具体的体验：坏包曾经要转十几秒，然后给一句「启动超时。
 * 可能是程序包不完整、文件过大，或设备性能不足」—— 三句话，没有一句告诉用户
 * 「你选错文件了」。现在启动前先验结构，判据与导入共用 `inspectJar`。
 *
 * 所以断言里既有**文案**（说得清是哪里的问题），也有**耗时**（不用等超时）。
 * 只断言文案的话，「等 15 秒再报同样的文案」也能通过。
 */

/** 走 `?jar=` 通道：它不过导入预检，是真正需要运行页自己验的那条路。 */
test('普通 ZIP 被拒：指出缺 MANIFEST.MF，且不用等启动超时', async ({ page }) => {
  // 一个结构完好、但没有任何 MIDlet 信息的压缩包
  const bytes = buildZip([{ name: 'readme.txt', data: '这不是游戏', deflate: true }])
  await page.route('**/not-a-midlet.jar', (route) =>
    route.fulfill({
      status: 200,
      body: Buffer.from(bytes),
      headers: { 'content-type': 'application/java-archive' },
    }),
  )

  const startedAt = Date.now()
  await page.goto('/?jar=/not-a-midlet.jar&name=普通压缩包')

  const message = page.locator('.player__overlay-msg--error')
  await expect(message).toBeVisible({ timeout: 10_000 })
  await expect(message).toContainText('META-INF/MANIFEST.MF')

  // 15 秒是内核超时兜底的量级；预检应该在一秒内给出结论。
  // 阈值取 8 秒：留足冷启动与 CI 抖动的余量，但仍远小于超时路径。
  expect(Date.now() - startedAt).toBeLessThan(8_000)

  // 明确没有进到「运行中」：判定失败时内核根本没启动
  await expect(page.locator('.badge')).not.toHaveText('运行中')
})

test('根本不是 ZIP 的文件说「不是 JAR 包」，而不是「设备性能不足」', async ({ page }) => {
  // 直接指向站内已有的一个纯文本文件：它一定能 200，但一定不是包。
  await page.goto('/?jar=/licenses/MIT.txt&name=一个文本文件')

  const message = page.locator('.player__overlay-msg--error')
  await expect(message).toBeVisible({ timeout: 10_000 })
  await expect(message).toContainText('不是 JAR 包')
})
