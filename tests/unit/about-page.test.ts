import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 关于页的守卫。
 *
 * 这一页的实际内容是「合规承诺」：GPL 与 MIT 都要求分发时附许可原文、说明来源。
 * 承诺最容易在两种情况下悄悄失效：
 *   1. 页面上的链接指向一个不存在的文件（点开 404，等于没提供）；
 *   2. 页面写的版次/款数是手抄的，改代码时忘改（写错比不写更糟）。
 *
 * 所以这里测的不是「有没有这一页」，而是「这一页说的东西是不是真的」。
 */

const ROOT = process.cwd()
const ABOUT = join(ROOT, 'src/app/AboutScreen.tsx')
const APP = join(ROOT, 'src/app/App.tsx')
const LIBRARY = join(ROOT, 'src/app/LibraryScreen.tsx')
const VITE = join(ROOT, 'vite.config.ts')
const LICENSES = join(ROOT, 'public/licenses')

function text(path: string): string {
  return readFileSync(path, 'utf8')
}

/** 从 AboutScreen 里抽出 `LICENSE_FILES` 的每一条 `name`。 */
function licenseFiles(): string[] {
  const source = text(ABOUT)
  const block = source.slice(source.indexOf('LICENSE_FILES'), source.indexOf('] as const'))
  return [...block.matchAll(/name: '([^']+)'/g)].map((match) => match[1] ?? '')
}

describe('关于页的入口', () => {
  it('App 里有 about 分支，库页页脚有可点的入口', () => {
    expect(text(APP)).toContain("route.name === 'about'")
    const library = text(LIBRARY)
    expect(library).toContain('ABOUT_HASH')
    expect(library).toContain('关于与许可')
  })

  it('页脚不再指向不存在的文档', () => {
    // 旧页脚写的是 docs/provenance/GAMES.md（仓库里只有 games.json），
    // 而且路径在打包后根本不可达 —— 那是个只有开发者看得懂的死引用。
    expect(text(LIBRARY)).not.toContain('GAMES.md')
  })
})

describe('关于页的许可原文', () => {
  it('列出的每一份原文都真的随包存在', () => {
    const files = licenseFiles()
    expect(files.length).toBe(3)
    for (const name of files) {
      // 链接写成 `licenses/<name>`，对应 public/licenses/<name>
      expect(existsSync(join(LICENSES, name)), `public/licenses/${name} 不存在，链接会 404`).toBe(
        true,
      )
    }
  })

  it('随包原文与仓库正本逐字节一致', () => {
    // 与 scripts/check-licenses.mjs 同一组配对。这里再测一遍，是因为
    // `npm test` 是开发者更常跑的那一步：等 CI 才红，改动已经被推上去了。
    const pairs: [string, string][] = [
      ['GPL-2.0.txt', 'LICENSE'],
      ['MIT.txt', 'docs/provenance/license-texts/MIT.txt'],
      ['THIRD_PARTY_NOTICES.txt', 'docs/provenance/THIRD_PARTY_NOTICES.md'],
    ]
    for (const [copyName, sourceName] of pairs) {
      expect(readFileSync(join(LICENSES, copyName))).toEqual(readFileSync(join(ROOT, sourceName)))
    }
  })
})

describe('关于页上写的数字都来自正本', () => {
  it('版本、内核 commit、随包款数都是构建期注入，没有手抄', () => {
    const about = text(ABOUT)
    expect(about).toContain('__APP_VERSION__')
    expect(about).toContain('__KERNEL_COMMIT__')
    expect(about).toContain('__PACK_GAMES__.total')
    expect(about).toContain('__PACK_GAMES__.self')
    // 手抄的具体 commit / 款数只要出现一条，就说明有人绕过了注入
    expect(about).not.toContain('46ee3e78')
    expect(about).not.toMatch(/\b104 款/)
  })

  it('注入值确实取自正本（vite.config.ts 读的是那两个文件）', () => {
    const config = text(VITE)
    expect(config).toContain('package.json')
    expect(config).toContain('scripts/fetch-upstream.sh')
    expect(config).toContain('docs/provenance/games.json')
    // PIN 解析不出来要直接让构建失败，而不是渲染成空字符串
    expect(config).toContain('关于页无法展示内核版本')
  })

  it('第三方来源也是数出来的，不是抄上去的三个仓库名', () => {
    const about = text(ABOUT)
    expect(about).toContain('__PACK_GAMES__.sources')
    // 仓库名、款数一旦手写，加了游戏就会对不上，而这一页正是用来核对来源的
    for (const repo of ['j2me-100-games', 'pisces312', 'RehanSaeed']) {
      expect(about, `不要手写 ${repo}，用注入的 sources`).not.toContain(repo)
    }
  })
})
