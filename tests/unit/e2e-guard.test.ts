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
    // 缺产物要显式失败，而不是「跳过然后绿」。判据在脚本里，不在 YAML 里：
    // 工作流只负责把 REQUIRE_KERNEL=1 传下去，真正 exit 的是校验脚本。
    expect(release).toContain('REQUIRE_KERNEL')
    const check = readFileSync(join(ROOT, 'scripts/check-kernel-artifacts.mjs'), 'utf8')
    expect(check).toContain('REQUIRE_KERNEL')
    expect(check).toContain('process.exit(1)')
  })

  it('测试游戏必须在构建内核之前就核对过', () => {
    // 缺资产是发布验收最常见的失败（首次跑、换 runner、仓库不完整），
    // 而构建内核要 20 分钟。把检查排在构建之后，等于让人等 20 分钟才知道
    // 「少了东西」—— 这种失败顺序本身就在劝人别跑发布验收。
    const release = readFileSync(RELEASE, 'utf8')
    // 用步骤名精确匹配：文件头的注释里也写着「构建内核」。
    const games = release.indexOf('- name: 校验随包游戏资产')
    const build = release.indexOf('- name: 构建内核')
    expect(games, '找不到「校验随包游戏资产」步骤').toBeGreaterThan(-1)
    expect(build, '找不到「构建内核」步骤').toBeGreaterThan(-1)
    expect(games).toBeLessThan(build)
  })

  it('常态 CI 的 job 名写明「只做加载校验」，不冒充内核验收', () => {
    const ci = readFileSync(CI, 'utf8')
    expect(ci).toContain('仅加载校验')
    expect(ci).toContain('release.yml')
  })
})

/**
 * e2e 依赖的文件必须真的在仓库里。
 *
 * 这一组来自一个真实缺陷：用例要 `public/assets/sokoban.jar`，而
 * `.gitignore` 里有 `public/assets/*.jar` —— 本地那份是手工放的，所以
 * 本机永远绿；CI 上要靠一条「从 secret 还原测试包」的步骤补，还原出来的
 * 名字是 `e2e-test.jar`，与用例要的 `sokoban.jar` 又不一致。于是
 * **配了 secret 也照样找不到文件**，而失败信息只报「缺文件」。
 *
 * 只靠「路径写对了」不够，要能从仓库内容判断，所以这里直接问 git：
 * 用例里出现的每个 `public/...` 路径，要么被跟踪，要么落在文档化的
 * 构建产物目录（`public/kernel/`，GPL 产物不入库）里。
 */
describe('e2e 只依赖入库的文件', () => {
  const E2E_DIR = join(ROOT, 'tests/e2e')
  const FILES = ['game.ts', 'kernel-smoke.spec.ts', 'saves.spec.ts', 'library.spec.ts']

  /** 去掉注释再扫：注释里提到旧路径是合理的，那是在解释为什么不能那么写。 */
  function codeOf(file: string): string {
    return readFileSync(join(E2E_DIR, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
  }

  function isTracked(path: string): boolean {
    const result = spawnSync('git', ['ls-files', '--error-unmatch', path], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    return result.status === 0
  }

  it('用例引用的每个 public/ 路径要么入库、要么是构建产物', () => {
    const seen = new Set<string>()
    for (const file of FILES) {
      for (const match of codeOf(file).matchAll(/public\/[\w./-]+/g)) {
        seen.add(match[0].replace(/[./]+$/, ''))
      }
    }
    expect(seen.size, '一个 public/ 路径都没扫到，正则失效了？').toBeGreaterThan(0)

    const offenders = [...seen].filter((path) => {
      if (path.startsWith('public/kernel/')) return false // 内核产物，按设计不入库
      return !isTracked(path)
    })
    expect(
      offenders,
      `这些路径 e2e 要用，但没进仓库 —— 本地能过、CI 必挂：\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('不再要求「测试专用程序包」，也不再找 secret', () => {
    const release = readFileSync(RELEASE, 'utf8')
    const code = release.replace(/#[^\n]*/g, '')
    // 曾经的两条退路：secret 还原、通配已有 jar。两条都还原不出用例要的文件名。
    expect(code).not.toContain('E2E_TEST_JAR_B64')
    expect(code).not.toContain('准备测试程序包')
    expect(code).not.toContain('public/assets')
  })

  it('测试游戏用的是随包分发的那一款，两个 spec 共用一个常量', () => {
    const game = codeOf('game.ts')
    expect(game).toContain("'public/games/sokoban.data'")
    // 两个 spec 各写一遍路径正是这次缺陷的成因。允许经 `./player` 间接取
    // （那里放着共用的开/写/退动作），只要常量仍然只有 `game.ts` 一处。
    for (const file of ['kernel-smoke.spec.ts', 'saves.spec.ts']) {
      const code = codeOf(file)
      expect(code, `${file} 应该从 ./game 或 ./player 取测试游戏`).toMatch(
        /from '\.\/(game|player)'/,
      )
      expect(code, `${file} 不该自己写死游戏路径`).not.toContain('public/games')
    }
    // `player.ts` 自己也不许另立一份路径
    expect(codeOf('player.ts')).toContain("from './game'")
    expect(codeOf('player.ts')).not.toContain('public/games')
  })
})

