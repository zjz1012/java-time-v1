import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const player = readFileSync(join(process.cwd(), 'src/app/PlayerScreen.tsx'), 'utf8')
const css = readFileSync(join(process.cwd(), 'src/ui/app.css'), 'utf8')

describe('运行页的失败出路', () => {
  it('启动中盖遮罩，运行中不盖', () => {
    // 内核启动有 2~4 秒纯黑。没有遮罩的话，「还在加载」和「已经挂了」
    // 长得一模一样，而这两种情况该做的事完全相反。
    expect(player).toContain("const covered = !running && state !== 'paused'")
    expect(player).toMatch(/\{covered \? \(/)
  })

  it('失败时给出可点的重试，而不是只有返回', () => {
    // 坏包会一直不出画，撑到超时。用户此时唯一的动作应该是换一个包重来。
    expect(player).toContain('player__retry')
    expect(player).toContain('setAttempt((n) => n + 1)')
    // 重试必须让 effect 重跑：内核 iframe 的状态收不回来，只能整个重建
    expect(player).toMatch(/\}, \[jarUrl, displayName, attempt\]\)/)
  })

  it('触屏上不显示物理键盘提示', () => {
    // 手指用户看不到键盘，那行「方向键/WASD…」只是噪音。
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.player__hint \{\s*display: none/)
  })
})

describe('画面尺寸的约束', () => {
  it('横屏下画面按竖屏比例收窄', () => {
    // 横屏宽裕的是宽度、稀缺的是高度。不限宽的话内核会拿一个 500×136 的
    // 「屏幕」，游戏照这个比例排版，格子小到看不清（实测过，确实如此）。
    expect(css).toMatch(/orientation: landscape/)
    // 同一条规则里宽度自适应、高度占满、比例锁 3:4
    expect(css).toMatch(/\.player__screen \{[^}]*width: auto;[^}]*height: 100%;[^}]*aspect-ratio: 3 \/ 4;/)
  })

  it('键区两块在横屏下分列画面左右', () => {
    expect(css).toMatch(/\.keypad \{\s*display: contents;/)
    expect(css).toMatch(/'pad bar stage aux'|'pad stage aux'/)
  })
})
