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
})

describe('诺基亚式键区布局', () => {
  it('数字键盘常驻，不藏在模式切换后面', () => {
    // 手机的位置感来自「上面导航、下面数字」这个固定的物理排布。
    // 藏起来就退化成掌机：每次要按数字都得先找切换按钮。
    expect(code).not.toContain('padOpen')
    expect(code).not.toContain('keypad__slot')
    expect(code).toContain('className="keypad__num"')
  })

  it('12 个数字键都带 T9 字母', () => {
    // 只靠 keyPressed 收字符的游戏全靠这层提示 —— 真机上它印在键面上。
    expect((code.match(/control: '/g) ?? []).length).toBe(12)
    for (const letters of ['ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ']) {
      expect(code).toContain(`'${letters}'`)
    }
  })

  it('导航键是四方向 + 中键，另有独立的 C 键', () => {
    // clear 不能并进软键：软键由游戏自己定义语义，C 是系统的删除键。
    for (const control of ['up', 'down', 'left', 'right', 'fire', 'clear']) {
      expect(code).toContain(`'${control}'`)
    }
    expect(code).toContain('keypad__dpad')
    expect(code).toContain('pad--clear')
  })

  it('同一根手指的重复 pointerdown 只算一次按下', () => {
    expect(code).toMatch(/if \(pointers\.current\.has\(pointerId\)\) return/)
  })
})
