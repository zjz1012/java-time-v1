import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { PLAYER_URL } from './game'

/**
 * 归档写不进去时，界面必须**当场**说，并且给得出出路。
 *
 * 为什么只能真跑：这个缺陷的形状是「什么都没有发生」—— 用户照常退出，
 * 库页照常出现，只是进度没存上。单测能证明 `describeArchiveFailure` 的
 * 分支对不对，证明不了「这句话真的出现在屏幕上、退出真的被拦住」。
 *
 * 制造失败的方式：把 `IDBObjectStore.put` 换成抛 `QuotaExceededError`。
 * 只改 `put` 不改 `get`，所以启动时恢复旧档、读归档这些路径仍然正常 ——
 * 失败面被收窄到「写」这一件事上，与真实的配额耗尽一致。
 */

const ROOT = process.cwd()
const missing = [join(ROOT, 'public/kernel/main-all.js')].filter((file) => !existsSync(file))

test.skip(missing.length > 0, `缺少内核产物：${missing.join('、')}`)

const SAVE_PATH = '/RecordStore/fail-save.db'
const PATTERN = [7, 8, 9]

/** 装一个「写必炸」的开关，默认关着（关着时行为与原生一致）。 */
async function installFailSwitch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put
    ;(window as unknown as { __failArchiveWrite?: boolean }).__failArchiveWrite = false
    IDBObjectStore.prototype.put = function patched(
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if ((window as unknown as { __failArchiveWrite?: boolean }).__failArchiveWrite) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      return original.apply(this, args)
    } as IDBObjectStore['put']
  })
}

async function setFail(page: Page, fail: boolean): Promise<void> {
  await page.evaluate((value) => {
    ;(window as unknown as { __failArchiveWrite?: boolean }).__failArchiveWrite = value
  }, fail)
}

async function openPlayer(page: Page): Promise<void> {
  await page.goto(PLAYER_URL)
  await expect(page.locator('.badge')).toHaveText('运行中', { timeout: 90_000 })
}

/** 在内核里写一个文件并提交，模拟游戏存了一次档。 */
async function writeSave(page: Page, path: string, bytes: number[]): Promise<void> {
  await page.evaluate(
    ({ target, payload }) => {
      const win = document.querySelector<HTMLIFrameElement>('.player__screen iframe')?.contentWindow as
        | (Window & { fs: Record<string, (...args: unknown[]) => unknown> })
        | null
      if (!win) throw new Error('iframe 不可用')
      const fs = win.fs
      ;(fs.mkdirp as (p: string) => unknown)('/RecordStore')
      if ((fs.exists as (p: string) => boolean)(target)) {
        ;(fs.remove as (p: string) => unknown)(target)
      }
      ;(fs.create as (p: string, b: Blob) => unknown)(target, new Blob([new Uint8Array(payload)]))
      return new Promise((resolve) => {
        ;(fs.syncStore as (cb: () => void) => void)(() => resolve(true))
        setTimeout(() => resolve(false), 3000)
      })
    },
    { target: path, payload: bytes },
  )
}

/** 等静默看门狗把快照发上来，并且归档那次写失败。 */
async function waitForFailure(page: Page): Promise<void> {
  // 静默看门狗 2 秒一轮、连续两轮无变化才读，留足余量。
  await expect(page.locator('.player__alert')).toBeVisible({ timeout: 25_000 })
  await expect(page.locator('.player__alert')).toContainText('存储空间不足')
}

test.describe('归档写不进去', () => {
  test('运行时就有提示，退出被拦，能导出这份进度', async ({ page }) => {
    await installFailSwitch(page)
    await openPlayer(page)
    await writeSave(page, SAVE_PATH, PATTERN)

    await setFail(page, true)
    await waitForFailure(page)

    // 退出：先停、等归档队列、发现写失败 —— 这时不能把人放走。
    await page.locator('.player__exit').click()
    const dialog = page.locator('.player__dialog')
    await expect(dialog).toBeVisible({ timeout: 25_000 })
    await expect(dialog).toContainText('存档没有保存成功')
    // 空间不足时给的动作要和「存储坏了」不同。
    await expect(dialog).toContainText('清理')

    // 紧急导出：走的是内存里的快照，不读仓储（仓储正是坏的那个）。
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.locator('button', { hasText: '导出这次进度' }).click(),
    ])
    const file = await download.path()
    expect(file).toBeTruthy()
    const bytes = readFileSync(file as string)
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    // 导出用的是 STORE（不压缩），所以原始字节能在包里直接找到。
    expect(bytes.includes(Buffer.from(PATTERN))).toBe(true)

    // 反悔：回到游戏，**游戏还在跑**。只断言「对话框没了」不够 ——
    // 先停再问的实现也能让对话框消失，只是人回到一个已经关掉的游戏。
    await dialog.locator('button', { hasText: '返回游戏' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.badge')).toHaveText('运行中')

    // 再退出一次，仍然拦住 —— 失败没被「点过一次」就当成处理完了。
    await page.locator('.player__exit').click()
    await expect(dialog).toBeVisible({ timeout: 25_000 })

    // 明确放弃才走。
    await dialog.locator('button', { hasText: '放弃并退出' }).click()
    await expect(page.locator('.game-card').first()).toBeVisible({ timeout: 30_000 })
  })

  test('空间恢复后重试保存，进度真的落盘了', async ({ page }) => {
    await installFailSwitch(page)
    await openPlayer(page)
    await writeSave(page, SAVE_PATH, PATTERN)

    await setFail(page, true)
    await waitForFailure(page)

    await page.locator('.player__exit').click()
    const dialog = page.locator('.player__dialog')
    await expect(dialog).toBeVisible({ timeout: 25_000 })

    // 用户去清了空间，回来点重试。
    await setFail(page, false)
    await dialog.locator('button', { hasText: '重试保存' }).click()

    // 存上了就直接走人，不再问第二遍。
    await expect(page.locator('.game-card').first()).toBeVisible({ timeout: 30_000 })

    // 判据是「真的写进了库」，不是「界面没报错」。
    const archived = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const request = indexedDB.open('java-time-saves', 1)
          request.onsuccess = () => {
            const db = request.result
            const query = db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll()
            query.onsuccess = () => {
              const records = query.result as Array<{ files: Array<{ path: string; bytes: ArrayBuffer }> }>
              const hit = records
                .flatMap((record) => record.files)
                .find((item) => item.path === '/RecordStore/fail-save.db')
              resolve(hit ? Array.from(new Uint8Array(hit.bytes)) : [])
            }
            query.onerror = () => resolve([])
          }
          request.onerror = () => resolve([])
        }),
    )
    expect(archived).toEqual(PATTERN)
  })
})
