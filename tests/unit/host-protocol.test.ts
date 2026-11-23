import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { HOST_PROTOCOL_VERSION, parseHostEvent } from '@/runtime/pluotsorbet/protocol'

/**
 * 宿主页是经典脚本，不能 import 本模块的常量，所以协议版本在两侧各写了一份字面量。
 * 这些断言就是为了让「两份字面量不一致」在 CI 里立刻失败 ——
 * 否则症状会是运行时静默丢弃消息，表现成「内核不启动」，极难定位。
 */
const hostHtml = readFileSync(join(process.cwd(), 'public/runtime/host.html'), 'utf8')

/**
 * 剥掉 HTML 与块注释后的可执行部分。
 * 注释里会提到被禁止的写法（用来解释为什么不能那么写），断言必须只看代码。
 */
const hostCode = hostHtml
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('宿主页与外壳的协议一致性', () => {
  it('协议版本号一致', () => {
    expect(hostHtml).toContain(`var PROTOCOL = ${HOST_PROTOCOL_VERSION}`)
  })

  it('宿主实现了外壳会发的全部指令', () => {
    // 指令名写成 case 分支是宿主页的既有写法；这里只要求它认得，不约束实现细节。
    expect(hostHtml).toContain("case 'runtime:launch':")
    expect(hostHtml).toContain("case 'runtime:stop':")
  })

  it('宿主会发出外壳监听的全部事件', () => {
    for (const type of ['host:ready', 'runtime:state', 'runtime:error']) {
      expect(hostHtml).toContain(`'${type}'`)
    }
  })

  it('宿主保留了内核硬编码的类库路径', () => {
    // main-all.js 里写死 load("java/classes.data")，靠 <base> 解析到产物目录。
    // 宿主页若把 base 改成别的层级，这条就会断，且症状是「停在启动层、无报错」。
    expect(hostHtml).toContain('<base href="../kernel/" />')
  })

  it('宿主用 split 替身绕开 blob URL 的冒号', () => {
    // 内核写的是 config.jars.split(":")，blob URL 自带冒号会被拆散。
    expect(hostHtml).toContain('split: function ()')
  })

  it('只在离屏探针画布上取 2d 上下文', () => {
    // 在内核持有的画布上再取一次上下文属于抢渲染上下文，会把画面顶成 0 FPS。
    // 出画判定只能在离屏小画布上做（drawImage 只读源画布）。
    expect(hostCode).not.toMatch(/\bcanvas\.getContext\(/)
    expect(hostCode).toContain('probeCanvas.getContext')
  })
})

describe('宿主页的输入通路', () => {
  it('认得按键指令', () => {
    expect(hostHtml).toContain("case 'runtime:key':")
  })

  it('按键通过 MIDP 的注入接口送进 JVM', () => {
    // 内核把 sendKeyPress / sendKeyRelease 挂在全局 MIDP 上（midp.js 的 return 对象）。
    // 这是唯一能产生游戏动作的入口 —— 内核自己的 keydown 监听读的是 ev.which，
    // 而它期待的是设备键码，两者对不上（见 kernel-contract.md §12）。
    expect(hostCode).toContain('MIDP.sendKeyPress(')
    expect(hostCode).toContain('MIDP.sendKeyRelease(')
  })

  it('物理键监听在捕获阶段，并掐断内核自己那次', () => {
    // 不掐断就是双发：数字键会被原生送一次（53）、我们注入一次（53），
    // 表现成按一下走两步。捕获阶段才能稳定抢在冒泡阶段之前。
    expect(hostCode).toMatch(/addEventListener\('keydown', onPhysicalKeyDown, true\)/)
    expect(hostCode).toMatch(/addEventListener\('keyup', onPhysicalKeyUp, true\)/)
    expect(hostCode).toContain('stopImmediatePropagation()')
  })

  it('失焦与页面隐藏时抬键', () => {
    // 按住方向键切走窗口，keyup 永远不会来；不补这一手，JVM 里那只键会一直按着。
    expect(hostCode).toMatch(/addEventListener\('blur', releaseAllControls\)/)
    expect(hostCode).toContain('document.hidden')
  })

  it('键位表来自启动指令，不是写死的', () => {
    expect(hostCode).toContain('normalizeKeymap(')
    expect(hostCode).toContain('options.keymap')
  })

  it('能力声明里承认支持按键', () => {
    // 声明为 true 外壳才会渲染键区；反过来，不声明就会显示一个按了没反应的键区。
    expect(hostCode).toMatch(/keyInput:\s*true/)
  })
})

describe('parseHostEvent', () => {
  it('接受版本一致的合法事件', () => {
    const event = {
      v: HOST_PROTOCOL_VERSION,
      type: 'runtime:state',
      payload: { state: 'running', reason: 'first-paint' },
    }
    expect(parseHostEvent(event)).toEqual(event)
  })

  it('版本不一致时丢弃', () => {
    expect(
      parseHostEvent({
        v: HOST_PROTOCOL_VERSION + 1,
        type: 'runtime:state',
        payload: { state: 'running', reason: 'x' },
      }),
    ).toBeNull()
  })

  it('结构非法时丢弃', () => {
    expect(parseHostEvent(null)).toBeNull()
    expect(parseHostEvent('host:ready')).toBeNull()
    expect(parseHostEvent({ v: HOST_PROTOCOL_VERSION, type: 'runtime:state' })).toBeNull()
    expect(parseHostEvent({ v: HOST_PROTOCOL_VERSION, type: 'runtime:state', payload: 1 })).toBeNull()
  })

  it('未知事件类型时丢弃', () => {
    expect(
      parseHostEvent({ v: HOST_PROTOCOL_VERSION, type: 'runtime:teleport', payload: {} }),
    ).toBeNull()
  })
})
