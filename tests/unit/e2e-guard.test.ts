import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
const RELEASE = join(ROOT, '.github/workflows/release.yml')
const CI = join(ROOT, '.github/workflows/ci.yml')
const VERIFY = join(ROOT, 'scripts/verify-e2e-report.mjs')

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

/**
 * `playwright test` 对「用例全部 skip」的退出码是 0 —— 于是「缺产物所以没跑」
 * 和「跑通了」在 CI 上都是绿色。下面从两个方向钉住这件事：
 * 报告校验脚本的行为（真跑它），以及工作流里确实用了它。
 */
describe('「没跑」不能显示成「跑过了」', () => {
  function runVerify(report: unknown): { status: number | null; output: string } {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-report-'))
    const file = join(dir, 'e2e.json')
    writeFileSync(file, JSON.stringify(report))
    const result = spawnSync(process.execPath, ['scripts/verify-e2e-report.mjs', file], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    rmSync(dir, { recursive: true, force: true })
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  }

  const passed = {
    suites: [
      {
        title: 'kernel-smoke.spec.ts',
        specs: [{ title: '启动：内核跑起来', ok: true }],
        suites: [],
      },
    ],
    stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
  }

  it('全过 → 0，并列出实际执行的用例', () => {
    const { status, output } = runVerify(passed)
    expect(status).toBe(0)
    expect(output).toContain('[ok]')
    expect(output).toContain('启动：内核跑起来')
  })

  it('全部跳过 → 非 0（这是最容易骗过人的一种绿）', () => {
    const { status, output } = runVerify({
      suites: [],
      stats: { expected: 0, skipped: 9, unexpected: 0, flaky: 0 },
    })
    expect(status).toBe(1)
    expect(output).toContain('没有任何用例真正执行')
    expect(output).toContain('跳过不等于通过')
  })

  it('有 flaky → 非 0（重试后才过，发布前要知道）', () => {
    const { status, output } = runVerify({
      suites: [],
      stats: { expected: 8, skipped: 0, unexpected: 0, flaky: 1 },
    })
    expect(status).toBe(1)
    expect(output).toContain('flaky')
  })

  it('报告不存在 → 非 0（测试根本没启动，而不是「没有失败」）', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/verify-e2e-report.mjs', 'test-results/definitely-missing.json'],
      { cwd: ROOT, encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('读不到 E2E 报告')
  })

  it('发布工作流真的跑 E2E，并强制校验报告', () => {
    expect(existsSync(RELEASE), '发布验收工作流被删了？').toBe(true)
    expect(existsSync(VERIFY), '报告校验脚本被删了？').toBe(true)
    const release = readFileSync(RELEASE, 'utf8')
    expect(release).toContain('npx playwright test')
    expect(release).toContain('verify-e2e-report.mjs')
    // 报告校验必须是「无论前面成败都跑」，否则前一步失败时它会被跳过。
    expect(release).toMatch(/校验 E2E 报告[\s\S]{0,200}if: always\(\)/)
    // 缺产物要显式失败，而不是「跳过然后绿」。
    expect(release).toContain('REQUIRE_KERNEL')
    expect(release).toContain('exit 1')
  })

  it('缺测试包要在构建内核之前就失败', () => {
    // 缺 JAR 是发布验收最常见的失败（首次跑、换 runner、secret 没配），
    // 而构建内核要 20 分钟。把检查排在构建之后，等于让人等 20 分钟才知道
    // 「少了东西」—— 这种失败顺序本身就在劝人别跑发布验收。
    const release = readFileSync(RELEASE, 'utf8')
    // 用步骤名精确匹配：文件头的注释里也写着「构建内核」。
    const jar = release.indexOf('- name: 准备测试程序包')
    const build = release.indexOf('- name: 构建内核')
    expect(jar, '找不到「准备测试程序包」步骤').toBeGreaterThan(-1)
    expect(build, '找不到「构建内核」步骤').toBeGreaterThan(-1)
    expect(jar).toBeLessThan(build)
  })

  it('常态 CI 的 job 名写明「只做加载校验」，不冒充内核验收', () => {
    const ci = readFileSync(CI, 'utf8')
    expect(ci).toContain('仅加载校验')
    expect(ci).toContain('release.yml')
  })
})

