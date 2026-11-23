import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 键区的这些性质没有「看起来对不对」的替代品 —— 少一条就是真实的卡键 bug，
 * 而卡键在自动截图里看不出来。这里用静态断言把它们钉住：
 * 改动布局时很容易顺手删掉某个清理分支，删完之后一切照常跑，只有玩家会中招。
 */
const source = readFileSync(join(process.cwd(), 'src/app/Keypad.tsx'), 'utf8')

/** 去掉注释，只断言真正会执行的代码。 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('虚拟键区的抬键路径', () => {
  it('每根指针都会配对释放', () => {
    // 按 pointerId 记账，而不是按「当前按下的键」——后者会让第二根手指
    // 按下时覆盖第一根的状态，松开时漏发一次 release。
    expect(code).toContain('Map<number, InputControl>')
    expect(code).toMatch(/onPointerUp\s*:\s*\(event\)\s*=>\s*\{\s*release\(event\.pointerId\)/)
  })

  it('pointercancel 与 lostpointercapture 都抬键', () => {
    // 触屏上 pointercancel 很常见（来电、手势返回、系统弹窗）。
    // 少这一条，键会一直按着，游戏里表现为角色自己往前走。
    expect(code).toMatch(/onPointerCancel\s*:\s*\(event\)\s*=>\s*\{\s*release\(event\.pointerId\)/)
    expect(code).toMatch(/onLostPointerCapture\s*:\s*\(event\)\s*=>\s*\{\s*release\(event\.pointerId\)/)
  })

  it('窗口失焦、页面隐藏、组件卸载都会全量抬键', () => {
    expect(code).toContain("window.addEventListener('blur', releaseAll)")
    expect(code).toContain("document.addEventListener('visibilitychange'")
    // 卸载分支里必须调用 releaseAll，否则退出运行页时仍按着的键会漏掉
    expect(code).toMatch(/return \(\) => \{[\s\S]*?releaseAll\(\)[\s\S]*?removeEventListener\('blur'/)
  })

  it('切换到数字模式时抬键', () => {
    // 切模式会卸载一批按钮，它们的 pointerup 永远不会再来。
    // 这条 effect 是唯一能兜住「按着方向键去点数字」的路径。
    expect(code).toMatch(/useEffect\(\(\) => \{\s*releaseAll\(\)\s*\}, \[padOpen, releaseAll\]\)/)
  })
})

describe('虚拟键区的布局契约', () => {
  it('数字面板是模式切换，不是追加展开', () => {
    // 追加式的做法每按一次都会把画面顶上去一段，正在打的时候很难受。
    // 两种模式共用同一个槽位，键区高度不变。
    expect(code).toMatch(/padOpen \? \(/)
    expect(code).toContain('keypad__slot')
    expect(code).not.toMatch(/padOpen \? \(\s*<>/)
  })

  it('同一根手指的重复 pointerdown 只算一次按下', () => {
    expect(code).toMatch(/if \(pointers\.current\.has\(pointerId\)\) return/)
  })
})
