import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 库页「本机数据」面板的守卫。
 *
 * 这一块的风险不在功能，而在**误伤**：它删的是用户唯一的进度，而且
 * 没有云端、没有回收站。所以这里钉的不是「按钮在」，是几件容易做错的事：
 *   - 有没有二次确认；
 *   - 有没有说清「清空后无法恢复」；
 *   - 是不是把「读不到」显示成了「0 份」（那会让人以为档没了）；
 *   - 有没有顺手把导入的游戏也删了。
 */

const library = readFileSync(join(process.cwd(), 'src/app/LibraryScreen.tsx'), 'utf8')
const css = readFileSync(join(process.cwd(), 'src/ui/library.css'), 'utf8')

describe('本机数据面板', () => {
  it('显示存档份数，且「读不到」不与「0 份」混为一谈', () => {
    expect(library).toContain('saveCount === null')
    expect(library).toContain("saveCount === null ? '读不到'")
    // 读失败时必须停在 null，不能退化成 0
    expect(library).toMatch(/catch \{\s*setSaveCount\(null\)/)
  })

  it('清空要二次确认，并说清不可恢复', () => {
    expect(library).toContain('清空全部存档')
    expect(library).toContain('确认清空')
    expect(library).toContain('没有云端备份')
    // 不用 window.confirm：它会阻塞渲染，且在部分 WebView 里被静默忽略 ——
    // 那种情况下「确认」形同不存在，一点就删。
    expect(library).not.toContain('window.confirm')
    expect(library).not.toMatch(/(^|[^.\w])confirm\(/)
  })

  it('只清存档，不碰导入的游戏', () => {
    // 只调 `clearAll`（逐个删 snapshots store），不做 deleteDatabase 之类的整库操作。
    expect(library).toContain('saveService.clearAll()')
    expect(library).not.toContain('deleteDatabase')
    expect(library).not.toContain('clearLibrary')
  })

  it('存档服务是单例：两个页面共用同一份', () => {
    // 各建一个也能跑，但「清理」与「写档」就成了两条独立连接，
    // 容易出现「刚清完、运行页手里还攥着旧快照」的时序问题。
    const player = readFileSync(join(process.cwd(), 'src/app/PlayerScreen.tsx'), 'utf8')
    expect(library).toContain("import { saveService } from '@/saves/instance'")
    expect(player).toContain("import { saveService } from '@/saves/instance'")
    expect(player).not.toContain('createSaveService(createIdbRepository())')
  })

  it('清空按钮满足触控下限', () => {
    // 手机上 13px 高的一行按钮点不中，44px 是 WCAG 的最小值。
    expect(css).toMatch(/\.library__data-btn \{[^}]*min-height: 44px/)
  })
})
