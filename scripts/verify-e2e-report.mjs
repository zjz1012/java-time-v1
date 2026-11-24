#!/usr/bin/env node
/**
 * 校验 Playwright 的 JSON 报告，证明**真内核 E2E 真的跑过且全过**。
 *
 * 为什么需要这一步：`playwright test` 在「用例全部被 skip」时退出码是 0。
 * 而 e2e 用例会因为缺内核产物 / 缺测试 JAR 而 skip —— 于是「没跑」和
 * 「跑通了」在 CI 上长得一模一样，都是绿色。发布验收不能建立在这种信号上。
 *
 * 判据（任一不满足即失败）：
 *   1. 通过数 > 0；
 *   2. 失败数 = 0；
 *   3. 跳过数 = 0；
 *   4. flaky = 0 —— 重试后才过，说明存在偶发问题，发布前要知道。
 *
 * 用法：
 *   playwright test --reporter=json   （配合 PLAYWRIGHT_JSON_OUTPUT_NAME）
 *   node scripts/verify-e2e-report.mjs [报告路径]
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const file = resolve(process.argv[2] ?? 'test-results/e2e.json')

let report
try {
  report = JSON.parse(readFileSync(file, 'utf8'))
} catch (cause) {
  console.error(`[fail] 读不到 E2E 报告：${file}`)
  console.error(`       ${cause instanceof Error ? cause.message : String(cause)}`)
  console.error('       报告不存在通常意味着测试根本没启动（构建失败 / 端口占用 / 用例加载报错）。')
  process.exit(1)
}

const stats = report.stats ?? {}
const passed = Number(stats.expected ?? 0)
const skipped = Number(stats.skipped ?? 0)
const failed = Number(stats.unexpected ?? 0)
const flaky = Number(stats.flaky ?? 0)

const problems = []
if (passed === 0) problems.push('没有任何用例真正执行 —— 全部被跳过，或一个都没匹配到')
if (failed > 0) problems.push(`${failed} 个用例失败`)
if (skipped > 0) problems.push(`${skipped} 个用例被跳过 —— 跳过不等于通过`)
if (flaky > 0) problems.push(`${flaky} 个用例是重试后才通过的（flaky）`)

/** 只收「通过」的用例标题，作为「确实跑过这些」的证据。 */
function collect(suites, out) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      if (spec.ok) out.push(spec.title)
    }
    collect(suite.suites, out)
  }
  return out
}

const titles = collect(report.suites, [])

if (problems.length > 0) {
  console.error('')
  for (const problem of problems) console.error(`[fail] ${problem}`)
  console.error('')
  console.error('发布验收要求真内核 E2E 全部真实执行并通过。')
  process.exit(1)
}

console.log(`[ok] 真内核 E2E：${passed} 个用例通过，0 跳过，0 失败，0 flaky`)
for (const title of titles) console.log(`     ✓ ${title}`)
