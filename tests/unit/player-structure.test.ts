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
    // 重试必须让 effect 重跑：内核 iframe 的状态收不回来，只能整个重建。
    // 依赖里放 `launch.id` 而不是整个 `launch`：调用方每次渲染都可能重建
    // 那个对象，按对象比较会让 effect 反复重跑（游戏启动到一半又重启）。
    // 后面可以再跟稳定的回调（useCallback 空依赖），不影响这条性质。
    expect(player).toContain('}, [launch.id, attempt')
    expect(player).not.toMatch(/\}, \[[^\]]*\blaunch\b\s*\]/)
  })

  it('触屏上不显示物理键盘提示', () => {
    // 手指用户看不到键盘，那行「方向键/WASD…」只是噪音。
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.player__hint \{\s*display: none/)
  })

  it('启动前先验包，坏包不用等超时', () => {
    // 判据与导入共用 `inspectJar`：两套判据迟早走岔，而「导入时说能跑、
    // 点开说跑不了」是最难解释的错。
    expect(player).toContain("import { describeJarProblem, inspectJar } from '@/library/jar'")
    expect(player).toContain('await inspectJar(bytes)')
    expect(player).toContain('describeJarProblem(inspection.problem')
    expect(player).toContain('这个程序包无法启动：')

    // 顺序：先验结构再算指纹 —— 整包 sha256 不值得为坏包算一遍。
    const loaded = player.indexOf('await launch.load()')
    const inspected = player.indexOf('await inspectJar(bytes)')
    const hashed = player.indexOf('await sha256Hex(bytes)')
    expect(loaded).toBeGreaterThan(-1)
    expect(inspected).toBeGreaterThan(loaded)
    expect(hashed).toBeGreaterThan(inspected)
  })
})

describe('只做竖屏', () => {
  it('不引入横屏专用分支', () => {
    // V1.0 砍掉横屏适配。留半套横屏规则比完全不做更糟：它会在没人
    // 验证过的尺寸上生效，出问题也没人知道 —— 而横屏真要打磨，
    // 得先决定画面比例与键区分布，那是下一版的事。
    expect(css).not.toMatch(/orientation: landscape/)
    expect(css).not.toContain('display: contents')
  })

  it('画面不锁宽高比，交给游戏按可用面积自适应', () => {
    // 容器尺寸就是内核报告的物理屏幕，游戏普遍用 getWidth()/getHeight()
    // 重排。竖屏锁 3:4 只会白丢高度（实测 67px），换不来任何东西。
    // 只看声明不看注释 —— 上面那段注释里就写着这个词。
    expect(css).not.toMatch(/^\s*aspect-ratio:/m)
  })
})
