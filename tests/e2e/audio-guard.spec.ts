import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

/**
 * 音频异常不再杀死游戏线程。
 *
 * 病因：内核 TonePlayer 用 `current + duration - FADE_TIME`（FADE_TIME = 0.1）
 * 算淡出起点，短音效会算出负时间，WebAudio 抛 RangeError；而它抛出栈是
 * playTone → NativeTonePlayer.nPlayTone → interpret → **Thread.run**，
 * 异常从 Java 线程的 run 循环里逃逸，那条线程就没了 —— 画面冻结、按键无响应，
 * 但浏览器主线程空闲，所以现象是「游戏不动了」而不是「页面卡死」。
 *
 * 选 City Shield 当样本：它一进主菜单就播音效（选中提示音），修复前第一声就
 * 把自己钉在菜单上，19 秒画面一帧都没变。这类游戏不需要「玩很久」才复现。
 */
const AUDIO_GAME = 'city-shield'

const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 16)

test('会播短音效的游戏不会卡在菜单上', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto(`/#/play/${AUDIO_GAME}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.badge--ok')).toBeVisible({ timeout: 60_000 })

  const frame = page.locator('.player__screen iframe').first()
  await frame.waitFor({ timeout: 20_000 })
  // 焦点给画面（点 iframe 元素本身；里面的 canvas 由内核插入，选择器会随产物变）
  await page.locator('.player__screen iframe').first().click({ position: { x: 60, y: 60 } })

  /*
   * ★ 先按方向键，再按回车 —— 顺序不能反。
   *
   * 触发缺陷的是「菜单里移动选择」这个动作：它播短提示音（duration < 0.1s），
   * 于是算出负时间。直接按 Enter 进游戏反而绕过了这一声，测试会假绿。
   * 实测闭补丁时：按方向键 1 次即抛 RangeError，之后画面 7 秒不变；
   * 只按 Enter 则一路正常。
   */
  for (const key of ['ArrowDown', 'ArrowUp']) {
    await page.keyboard.press(key)
    await page.waitForTimeout(300)
  }
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)

  // 连续采样 3 秒：线程活着就一定在推进（这个游戏有导弹、太阳、波次的动画）。
  const seen: string[] = []
  for (let i = 0; i < 8; i += 1) {
    seen.push(digest(await frame.screenshot()))
    await page.waitForTimeout(400)
  }
  console.log('[audio-guard] frames =', seen.join(' '))

  // ① 音频路径不再抛错。修复前这里是 RangeError: ... non-negative number: -0.08
  expect(errors.filter((e) => /AudioParam|linearRamp|non-negative/i.test(e))).toEqual([])
  // ② 线程还活着：最后一帧和倒数第二帧必须不同。
  //    只断言「至少有两帧不同」是不够的 —— 卡死之前它本来就已经画了几帧。
  expect(seen[seen.length - 1]).not.toBe(seen[seen.length - 2])
})
