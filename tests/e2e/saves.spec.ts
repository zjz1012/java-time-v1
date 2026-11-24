import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

/**
 * 真内核存档链路：写档 → 退出 → 重新进入 → 读回。
 *
 * 为什么必须真跑：这条链路跨越了四个时刻（内核写 RMS、宿主读快照、
 * 外壳写归档、启动前灌回 IDB），任何一环断掉都表现为「存档不见了」，
 * 而单测全部用假实现，看不到内核自己的落盘行为（它的 pagehide 兜底
 * 实测是失效的，见 ADR 0005）。
 */

const ROOT = process.cwd()
const REQUIRED = [
  join(ROOT, 'public/kernel/main-all.js'),
  join(ROOT, 'public/assets/sokoban.jar'),
]
const missing = REQUIRED.filter((file) => !existsSync(file))
if (missing.length > 0) {
  test.skip(true, `缺少内核产物：${missing.join('、')}（重建方式见 scripts/README.md）`)
}

const PLAYER_URL = '/?jar=/assets/sokoban.jar&name=推箱子'
const SAVE_PATH = '/RecordStore/probe-save.db'
const SAVE_BYTES = [11, 22, 33, 44, 55, 66, 77, 88]

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

/** 从内核里读回文件内容。不存在返回 null。 */
async function readSave(page: Page, path: string): Promise<number[] | null> {
  return page.evaluate(async (target) => {
    const win = document.querySelector<HTMLIFrameElement>('.player__screen iframe')?.contentWindow as
      | (Window & { fs: Record<string, (...args: unknown[]) => unknown> })
      | null
    if (!win) throw new Error('iframe 不可用')
    const fs = win.fs
    if (!(fs.exists as (p: string) => boolean)(target)) return null
    const blob = (fs.getBlob as (p: string) => Blob | null)(target)
    if (!blob) return null
    const buffer = await blob.arrayBuffer()
    return Array.from(new Uint8Array(buffer))
  }, path)
}

/** 读外壳的归档库，直接看它有没有真的写进去。 */
async function readArchives(page: Page): Promise<Array<{ fingerprint: string; files: unknown[] }>> {
  return page.evaluate(
    () =>
      new Promise<Array<{ fingerprint: string; files: unknown[] }>>((resolve) => {
        const request = indexedDB.open('java-time-saves', 1)
        request.onupgradeneeded = () => {
          request.result.createObjectStore('snapshots', { keyPath: 'fingerprint' })
        }
        request.onsuccess = () => {
          const db = request.result
          try {
            const query = db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll()
            query.onsuccess = () => resolve((query.result ?? []) as never)
            query.onerror = () => resolve([])
          } catch {
            resolve([])
          }
        }
        request.onerror = () => resolve([])
      }),
  )
}

/** 点「返回」：走真实退出路径（stop → 交快照 → 归档 → 导航）。 */
async function exitPlayer(page: Page): Promise<void> {
  await page.locator('.player__exit').click()
  await page.waitForLoadState('load', { timeout: 20_000 })
  // 导航之后归档事务还要落盘，稍等一下再断言
  await page.waitForTimeout(600)
}

test.describe('存档', () => {
  test('写档 → 退出 → 重新进入，内容原样还在', async ({ page }) => {
    await openPlayer(page)
    await writeSave(page, SAVE_PATH, SAVE_BYTES)
    expect(await readSave(page, SAVE_PATH)).toEqual(SAVE_BYTES)

    await exitPlayer(page)

    // 外壳归档必须真的有这条记录 —— 只断言「重进能看到」不够：
    // 那也可能是内核自己落盘成功，掩盖了归档没写的问题。
    const archives = await readArchives(page)
    expect(archives.length).toBeGreaterThan(0)
    expect(archives[0]?.files.length).toBeGreaterThan(0)

    await openPlayer(page)
    expect(await readSave(page, SAVE_PATH)).toEqual(SAVE_BYTES)
  })

  test('不点退出也会归档（兜直接关页面 / 刷新）', async ({ page }) => {
    await openPlayer(page)
    await writeSave(page, '/RecordStore/idle-save.db', [1, 2, 3])

    // 静默看门狗是 2 秒一轮、连续两轮无变化才读，留足余量。
    await page.waitForTimeout(9_000)

    const archives = await readArchives(page)
    expect(archives.length).toBeGreaterThan(0)
    expect(archives[0]?.files.length).toBeGreaterThan(0)

    // 直接刷新（不点返回）：能读到自己刚写的档，说明归档没有随页面丢失。
    await page.reload()
    await expect(page.locator('.badge')).toHaveText('运行中', { timeout: 90_000 })
    expect(await readSave(page, '/RecordStore/idle-save.db')).toEqual([1, 2, 3])
  })

  test('运行中导入：先确认，重启后内核读到的就是导入的档', async ({ page }) => {
    await openPlayer(page)
    await writeSave(page, SAVE_PATH, [99])

    await page.locator('.player__save').click()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.player__saves-item', { hasText: '导出存档' }).click(),
    ])

    const zipPath = await download.path()
    expect(zipPath).toBeTruthy()
    const head = readFileSync(zipPath as string).subarray(0, 4)
    // PK\x03\x04：本地文件头签名
    expect(Array.from(head)).toEqual([0x50, 0x4b, 0x03, 0x04])

    /*
     * 把内核里的档改成别的值，再导入刚才导出的包。
     *
     * 只断言「提示说已导入」是不够的：以前那种「直接写归档」的做法也能提示成功，
     * 而退出快照随后会把档覆盖回 [1,1,1]。所以最终判据是**重启后内核里读到什么**。
     */
    await writeSave(page, SAVE_PATH, [1, 1, 1])
    expect(await readSave(page, SAVE_PATH)).toEqual([1, 1, 1])

    await page.locator('.player__saves input[type=file]').setInputFiles(zipPath as string)

    // 游戏还在跑：不能直接覆盖，必须先问一句。
    await expect(page.locator('.player__saves-confirm')).toBeVisible()
    await page.locator('.player__saves-confirm button', { hasText: '替换并重启' }).click()

    // 先确认它真的停了，否则「运行中」可能只是还没开始停的旧状态。
    await expect(page.locator('.badge')).not.toHaveText('运行中', { timeout: 15_000 })
    await expect(page.locator('.badge')).toHaveText('运行中', { timeout: 90_000 })
    await expect(page.locator('.player__saves-note')).toContainText('已导入')

    expect(await readSave(page, SAVE_PATH)).toEqual([99])
  })

  test('导入损坏的包被拒绝，且原存档不动', async ({ page }) => {
    await openPlayer(page)
    await writeSave(page, SAVE_PATH, [7, 7, 7])

    // 先归档一次，确保有「原存档」
    await exitPlayer(page)
    await openPlayer(page)

    await page.locator('.player__save').click()
    await page
      .locator('.player__saves input[type=file]')
      .setInputFiles({
        name: 'broken.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]),
      })

    // 校验失败要说出来，不能静默
    await expect(page.locator('.player__saves-note')).not.toHaveText('')

    // 重新进入，原档还在
    await page.locator('.player__exit').click()
    await page.waitForLoadState('load', { timeout: 20_000 })
    await openPlayer(page)
    expect(await readSave(page, SAVE_PATH)).toEqual([7, 7, 7])
  })
})
