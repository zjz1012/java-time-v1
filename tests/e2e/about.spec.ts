import { expect, test } from '@playwright/test'

/**
 * 关于页（F19）与许可随包分发（F3）的真浏览器验收。
 *
 * 单测只能证明「文件在仓库里、链接字符串对得上」，证明不了**用户点得到、
 * 服务器真的把原文发出来了**。而这两件事恰好是最容易坏的那部分：
 * Vite 只搬 `public/`，路径写错一个字母就是 404，而 404 的许可原文
 * 在合规上等于没有。
 *
 * 这组用例不需要内核产物：它只碰静态文件。
 */

test.describe('关于页', () => {
  test('从库页页脚进关于页，三份许可原文都能真的打开', async ({ page, request }) => {
    await page.goto('/')
    await expect(page.locator('.game-card').first()).toBeVisible()

    await page.getByRole('link', { name: '关于与许可' }).click()
    await expect(page).toHaveURL(/#\/about$/)
    await expect(page.locator('.about__title')).toHaveText('关于')

    // 版本来自 package.json 的注入，形如「JAVA时光 · v0.1.0」
    await expect(page.locator('.about__sub')).toContainText(/JAVA时光 · v\d+\.\d+\.\d+/)

    // 内核 commit 是构建期注入的 40 位哈希 —— 手抄写错的话这里会露馅
    await expect(page.locator('.about__section', { hasText: '源码与许可原文' })).toContainText(
      /[0-9a-f]{40}/,
    )

    for (const name of ['GPL-2.0.txt', 'MIT.txt', 'THIRD_PARTY_NOTICES.txt']) {
      await expect(page.locator(`.about__files a[href="licenses/${name}"]`)).toBeVisible()

      const response = await request.get(`/licenses/${name}`)
      expect(response.status(), `${name} 取不到，链接指向了不存在的位置`).toBe(200)
      expect((await response.body()).length).toBeGreaterThan(500)
    }

    // 命中正文而不是某个占位页：GPL 的标题行必须在
    const gpl = await (await request.get('/licenses/GPL-2.0.txt')).text()
    expect(gpl).toContain('GNU GENERAL PUBLIC LICENSE')

    // 回得去。关于页不该是一条单行道。
    await page.getByRole('link', { name: '回到游戏库' }).click()
    await expect(page.locator('.game-card').first()).toBeVisible()
  })

  test('直接打开 #/about 也出得来（分享这个地址给用户时不该白屏）', async ({ page }) => {
    await page.goto('/#/about')
    await expect(page.locator('.about__title')).toHaveText('关于')
    await expect(page.locator('.about__licenses')).toContainText('GPL-2.0-or-later')
    await expect(page.locator('.about__licenses')).toContainText('MIT')
  })
})
