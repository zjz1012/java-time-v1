import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 真内核冒烟用例的守卫。
 *
 * 它守的是一件很容易发生的事：e2e 因为缺内核产物长期 skip，渐渐地没人再跑，
 * 最后被删掉也没人发现 —— 那时 CI 照样全绿，而「能启动、能出画」的保证已经
 * 悄悄消失了。这里钉住文件在、四个场景在、判据不是「纯黑也算」。
 */

const ROOT = process.cwd()
const SPEC = join(ROOT, 'tests/e2e/kernel-smoke.spec.ts')
const CONFIG = join(ROOT, 'playwright.config.ts')

describe('真内核冒烟的存在性', () => {
  it('用例与配置都在仓库里', () => {
    expect(existsSync(SPEC), 'e2e 用例被删了？真内核就没有任何自动化验收了').toBe(true)
    expect(existsSync(CONFIG)).toBe(true)
  })

  it('四个基本功都覆盖：启动 / 输入 / 退出 / 再次启动', () => {
    const spec = readFileSync(SPEC, 'utf8')
    expect(spec).toContain('启动：内核跑起来')
    expect(spec).toContain('方向输入')
    expect(spec).toContain('退出：返回后')
    expect(spec).toContain('再次启动')
  })

  it('缺产物时显式跳过，不静默通过', () => {
    // 静默跳过等于假装跑过了。跳过必须带原因，日志里能看见缺的是哪个文件。
    const spec = readFileSync(SPEC, 'utf8')
    expect(spec).toContain('test.skip(missing.length > 0')
    expect(spec).toContain('missing.join')
  })

  it('出画判据不是「纯黑也算」', () => {
    const spec = readFileSync(SPEC, 'utf8')
    // 只断言真正会执行的代码：文件头注释里就写着「不能只比 toDataURL 长度」，
    // 直接匹配全文会把这段解释当成违规用法。
    const code = spec.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    // toDataURL 的长度、画布非空都能被纯黑满足（358×638 的纯黑 PNG 也有 9KB）。
    // 只有颜色种类能区分「出画」与「没出画」。
    expect(code).toContain('colors).toBeGreaterThan(1)')
    expect(code).not.toContain('toDataURL')
  })

  it('方向输入要验到键码真的进了 JVM', () => {
    // 只断言「画面变了」不够：画面变化可能来自定时器。真正踩过的坑是
    // 物理键的 which（37~40 / 大写 ASCII）压根不在内核的设备键码表里。
    const spec = readFileSync(SPEC, 'utf8')
    expect(spec).toContain('sendKeyPress')
    expect(spec).toContain('97, 119, 100, 115')
  })
})
