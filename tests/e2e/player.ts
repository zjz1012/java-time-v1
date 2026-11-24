import { expect, type Page } from '@playwright/test'

import { PLAYER_URL } from './game'

/**
 * 真内核用例共用的几个动作。
 *
 * 抽出来的原因很实在：`openPlayer` 与 `writeSave` 都踩过坑（等徽标而不是等
 * 固定秒数；`fs.create` 不覆盖已存在路径，得先删），这些坑不该在两个文件里
 * 各写一遍 —— 复制出去的那份迟早会少一行注释，然后有人照着它改错。
 */

/** 打开运行页，等到内核真的出画面（徽标变「运行中」）。 */
export async function openPlayer(page: Page, url = PLAYER_URL): Promise<void> {
  await page.goto(url)
  await expect(page.locator('.badge')).toHaveText('运行中', { timeout: 90_000 })
}

/** 在内核里写一个文件并提交，模拟游戏存了一次档。 */
export async function writeSave(page: Page, path: string, bytes: number[]): Promise<void> {
  await page.evaluate(
    ({ target, payload }) => {
      const win = document.querySelector<HTMLIFrameElement>('.player__screen iframe')?.contentWindow as
        | (Window & { fs: Record<string, (...args: unknown[]) => unknown> })
        | null
      if (!win) throw new Error('iframe 不可用')
      const fs = win.fs
      ;(fs.mkdirp as (p: string) => unknown)('/RecordStore')
      // `fs.create` 对已存在的路径不会覆盖（内核的语义是「新建」），
      // 所以先删一次，让这个辅助函数可以重复写同一个路径。
      if ((fs.exists as (p: string) => boolean)(target)) {
        ;(fs.remove as (p: string) => unknown)(target)
      }
      ;(fs.create as (p: string, b: Blob) => unknown)(target, new Blob([new Uint8Array(payload)]))
      return new Promise((resolve) => {
        // 走真实的提交路径（RecordStoreFile.commitWrite 就是调这个）
        ;(fs.syncStore as (cb: () => void) => void)(() => resolve(true))
        setTimeout(() => resolve(false), 3000)
      })
    },
    { target: path, payload: bytes },
  )
}

/** 点「返回」：走真实退出路径（stop → 交快照 → 归档 → 导航）。 */
export async function exitPlayer(page: Page): Promise<void> {
  await page.locator('.player__exit').click()
  await page.waitForLoadState('load', { timeout: 20_000 })
  // 导航之后归档事务还要落盘，稍等一下再断言
  await page.waitForTimeout(600)
}
