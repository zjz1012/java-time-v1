import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 宿主页的音频时间钳制。
 *
 * 这条缺陷没法靠「跑一遍 e2e 没崩」长期防住 —— 它只在游戏**播短音效**时才发作，
 * 而短音效的时长由每款游戏自己决定。所以除了 e2e 的现场验证，还要把「这段补丁
 * 必须在、且必须挂在内核加载之前」钉成结构断言。
 */
const ROOT = join(import.meta.dirname, '..', '..')
const host = readFileSync(join(ROOT, 'public/runtime/host.html'), 'utf8')

describe('宿主页的音频补丁', () => {
  it('钳制了 linearRampToValueAtTime 的时间参数', () => {
    expect(host).toContain('function clampAudioParamTimes')
    expect(host).toContain('linearRampToValueAtTime')
    // 时间出口必须归一化，而不是把负值原样传下去
    expect(host).toMatch(/isFinite\(time\) && time > 0 \? time : 0/)
  })

  it('覆盖了内核实际会调的其它定时接口', () => {
    // 只补 linearRamp 是治标：同一段 TonePlayer 里还有 setValueAtTime / setTarget 系列。
    for (const name of ['exponentialRampToValueAtTime', 'setValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime']) {
      expect(host, `缺少 ${name} 的保护`).toContain(name)
    }
  })

  it('在内核加载之前执行', () => {
    const patch = host.indexOf('clampAudioParamTimes()')
    const loadKernel = host.indexOf("loadScript('main-all.js')")
    expect(patch).toBeGreaterThan(-1)
    expect(loadKernel).toBeGreaterThan(-1)
    // 晚于 main-all.js 就等于没打：TonePlayer 已经拿着旧的原型方法了。
    expect(patch).toBeLessThan(loadKernel)
  })

  it('是幂等的，不会重复套壳', () => {
    // 每次启动都会重跑一遍；重复包会让调用栈无限长，且 guardedTime 判断失效。
    expect(host).toContain('original.guardedTime')
    expect(host).toContain('wrapped.guardedTime = true')
  })

  it('只改时间参数，不改音量', () => {
    // 顺手「修」音量会改变听感，而这是内核的音色，不是我们的。
    expect(host).toMatch(/fn\.call\(this, value, safe\)/)
  })

  it('注释里写清了它防的是什么', () => {
    // 这段代码看起来像「多余的保护」，没有上下文的人会删掉它。
    expect(host).toContain('Thread.run')
    expect(host).toContain('FADE_TIME')
  })
})

describe('缺 native 实现时不让人等满超时', () => {
  it('听得见内核吞掉的那句 console.error', () => {
    // 这句错误内核自己打印后继续跑，不会冒成 error 事件 —— 只能包 console.error。
    expect(host).toContain('rawConsoleError')
    expect(host).toContain("text.indexOf('is native but does not have an implementation')")
  })

  it('给一点宽限再判失败，不立刻杀', () => {
    // 少数游戏碰一次缺实现后能降级到 Canvas 继续跑，出画就赢。
    expect(host).toContain('MISSING_NATIVE_GRACE_MS')
    expect(host).toMatch(/MISSING_NATIVE_GRACE_MS\s*=\s*\d+/)
  })

  it('出画优先于缺实现判定', () => {
    // 顺序写反会让「能降级跑起来」的游戏被误判成不支持。
    const painted = host.indexOf('if (probePainted(canvas))')
    const judgement = host.indexOf('missingNativeMessage && Date.now() - missingNativeAt')
    expect(painted).toBeGreaterThan(-1)
    expect(judgement).toBeGreaterThan(painted)
  })

  it('把缺失的能力翻成人话，而不是把 implKey 甩给用户', () => {
    expect(host).toContain('ChoiceGroupLFImpl')
    expect(host).toContain('列表选择控件')
    expect(host).toContain('滚动字幕')
  })

  it('失败时留一行可查的日志', () => {
    // 宿主页的失败原因只出现一次，且常被外壳换成面向用户的措辞。
    expect(host).toContain("[host] fail: ")
  })
})
