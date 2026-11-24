import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 宿主页给内核补的 native 桩。
 *
 * 这类代码最容易在「看起来没用」的时候被删掉，或者被改错一个字符还看不出来：
 * `implKey in Native` 是**字符串精确匹配**，签名里少一个分号，桩就等于没写，
 * 而失败现象与「完全没补」一模一样 —— 卡在同一个地方，报同一句话。
 * 所以这里把签名逐条钉住。
 *
 * 签名来源：pluotsorbet 的 `java/midp/javax/microedition/lcdui/ChoiceGroupLFImpl.java`
 * 与 `DisplayableLFImpl.java` 里的 `private native` 声明。改内核版本时要重新对照。
 */
const ROOT = join(import.meta.dirname, '..', '..')
const host = readFileSync(join(ROOT, 'public/runtime/host.html'), 'utf8')

/** 这 12 个方法是一个整体：漏一个就会在下一个方法上重新卡住。 */
const CHOICE_GROUP_KEYS = [
  'javax/microedition/lcdui/ChoiceGroupLFImpl.createNativeResource0.(ILjava/lang/String;III[Ljavax/microedition/lcdui/ChoiceGroup$CGElement;II)I',
  'javax/microedition/lcdui/ChoiceGroupLFImpl.insert0.(IILjava/lang/String;Ljavax/microedition/lcdui/ImageData;Z)V',
  'javax/microedition/lcdui/ChoiceGroupLFImpl.delete0.(III)V',
  'javax/microedition/lcdui/ChoiceGroupLFImpl.deleteAll0.(I)V',
  'javax/microedition/lcdui/ChoiceGroupLFImpl.set0.(IILjava/lang/String;Ljavax/microedition/lcdui/ImageData;Z)V',
  'javax/microedition/lcdui/ChoiceGroupLFImpl.setSelectedIndex0.(IIZ)V',
  'javax/microedition/lcdui/ChoiceGroupLFImpl.setSelectedFlags0.(I[ZI)V',
  'javax/microedition/lcdui/ChoiceGroupLFImpl.setFitPolicy0.(II)V',
  'javax/microedition/lcdui/ChoiceGroupLFImpl.setFont0.(IIIII)V',
  'javax/microedition/lcdui/ChoiceGroupLFImpl.getSelectedIndex0.(I)I',
  'javax/microedition/lcdui/ChoiceGroupLFImpl.getSelectedFlags0.(I[ZI)I',
  'javax/microedition/lcdui/ChoiceGroupLFImpl.isSelected0.(II)Z',
]

const TICKER_KEY = 'javax/microedition/lcdui/DisplayableLFImpl.setTicker0.(ILjava/lang/String;)V'

describe('内核缺失 native 的补桩', () => {
  it('12 个 ChoiceGroup 方法一条不少，签名逐字符对得上', () => {
    for (const key of CHOICE_GROUP_KEYS) {
      expect(host, `缺少 ${key}`).toContain(key)
    }
  })

  it('补了 Ticker —— 它缺了会让整个启动卡死，而它只是个滚动字幕', () => {
    expect(host).toContain(TICKER_KEY)
  })

  it('桩的键格式与内核 implKey 一致', () => {
    // 形如 `javax/microedition/lcdui/X.y.(签名)返回类型`，中间那个点是 implKey 的分隔符。
    const all = [...CHOICE_GROUP_KEYS, TICKER_KEY]
    for (const key of all) {
      expect(key, `${key} 不是合法的 implKey`).toMatch(/^[A-Za-z0-9/$_]+(\.[A-Za-z0-9_]+)+\.\(.*\).$/)
      expect(host).toContain(key)
    }
  })

  it('只填空，不覆盖内核自己的实现', () => {
    // 内核 gfx.js 已经注册了 Canvas/Alert/Form 的一批桩，覆盖它们会把能跑的游戏弄坏。
    expect(host).toContain('if (typeof Native[key] === \'function\') return')
  })

  it('在 Native 表建好之后、main-all.js 之前安装', () => {
    // Native 是 j2me.js 顶层的 `var Native = Object.create(null)`；
    // main-all.js（含 midp/*.js 的注册）执行时 MIDlet 就可能开始构造 Form。
    // 注意匹配的是**调用**那一行（行尾直接换行），不是 `function installNativeShims() {` 定义。
    const install = host.indexOf('installNativeShims()\n')
    const loadKernel = host.indexOf("loadScript('j2me.js')")
    const loadMain = host.indexOf("loadScript('main-all.js')")
    expect(install).toBeGreaterThan(loadKernel)
    expect(install).toBeLessThan(loadMain)
  })

  it('没有元素时返回 -1，而不是 0', () => {
    // 返回 0 会让 Java 层去取第 0 个元素，直接 ArrayIndexOutOfBounds。
    expect(host).toMatch(/elementCounts\[nativeId\] \? 0 : -1/)
  })

  it('补过桩之后用更短的上限，不能让外壳的通用超时盖掉真实原因', () => {
    // 外壳的兜底是 15 秒、文案是「程序包不完整」。宿主若等到 20 秒才判，
    // 用户看到的就是那句会把人带偏的话。
    expect(host).toMatch(/SHIMMED_START_TIMEOUT_MS\s*=\s*\d+/)
    const value = Number(/SHIMMED_START_TIMEOUT_MS\s*=\s*(\d+)/.exec(host)?.[1])
    expect(value).toBeGreaterThan(0)
    expect(value).toBeLessThan(15_000)
  })

  it('补桩后仍不出画，报的是「内核缺列表菜单」而不是「超时」', () => {
    expect(host).toContain('describeShimmedDeadEnd')
    expect(host).toContain('列表选择菜单')
    // 判定顺序：补过桩就走专门分支，别落到通用 TIMEOUT 上。
    const shimmed = host.indexOf('if (shimmedNatives.length) {')
    const timeout = host.indexOf("fail('TIMEOUT'")
    expect(shimmed).toBeGreaterThan(-1)
    expect(shimmed).toBeLessThan(timeout)
  })

  it('注释写清了这条路的天花板', () => {
    // 补桩能救「不卡死」，救不了「列表能选」—— 不写清楚，下一个人会以为已经修好了。
    expect(host).toContain('ItemLFImpl.show0')
    expect(host).toContain('不会有人替我们实现')
  })
})
