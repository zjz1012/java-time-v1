import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { exitPlayer, openPlayer, writeSave } from './player'

/**
 * 库页「本机数据」面板（F15 的延续）。
 *
 * 配额不足的提示条让用户「清理一些浏览器存储」，而产品里原本没有那个动作 ——
 * 提示把问题推回给了用户。这块面板就是它，所以这里必须证明两件事：
 *   1. 份数是**真的**（玩一局、退出，数字从 0 变 1）；
 *   2. 「清空」是**二次确认**后真的删干净（而不是只把界面清零）。
 *
 * 第二点尤其要紧：存档在这台设备上是唯一一份，删掉不可恢复。如果只断言
 * 「点完显示 0 份」，一个「把 state 设成 0 但没删库」的实现也能通过。
 */

const ROOT = process.cwd()
const REQUIRED = [join(ROOT, 'public/kernel/main-all.js')]
const missing = REQUIRED.filter((file) => !existsSync(file))
if (missing.length > 0) {
  test.skip(true, `缺少内核产物：${missing.join('、')}（重建方式见 scripts/README.md）`)
}

const SAVE_PATH = '/RecordStore/library-clear.db'

test('玩一局 → 退出 → 库页显示存档数 → 清空 → 归零', async ({ page }) => {
  // 先确认起点干净：上一个用例可能留下过存档
  await page.goto('/')
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const request = indexedDB.open('java-time-saves')
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('snapshots', 'readwrite')
        tx.objectStore('snapshots').clear()
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => resolve()
      }
      request.onerror = () => resolve()
    })
  })

  await openPlayer(page)
  await writeSave(page, SAVE_PATH, [1, 2, 3, 4])
  await exitPlayer(page)

  const line = page.locator('.library__data-line')
  await expect(line).toContainText('存档 1 份')

  await page.getByRole('button', { name: '清空全部存档' }).click()

  // 二次确认：先说清后果，再给两个按钮
  await expect(page.locator('.library__data-warn')).toContainText('没有云端备份')

  await page.getByRole('button', { name: /确认清空 1 份/ }).click()
  await expect(page.locator('.library__data-note')).toHaveText('已清空 1 份存档')
  await expect(line).toContainText('存档 0 份')

  // 真的删了：刷新一次仍然 0 份（只看界面清零的话，「刷新又回来」会漏掉）
  await page.reload()
  await expect(page.locator('.library__data-line')).toContainText('存档 0 份')
  // 0 份时不该再提供「清空全部存档」这个动作
  await expect(page.getByRole('button', { name: '清空全部存档' })).toHaveCount(0)
})
