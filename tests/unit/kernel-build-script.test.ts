import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 内核构建脚本的守卫。
 *
 * 起因很具体：发布验收第一次真跑，`tsc` 报了 3216 处「拼写都错」的错误，
 * 而错的全是 `node_modules/undici-types/*.d.ts` —— 一个 2024 年的类型声明包。
 * 上游代码没动过，是我们的 `@types/node@24` 从仓库根渗进了上游的编译单元：
 * tsc 在不给 `--types` 时会把「被编译文件往上每一层 node_modules/@types」全
 * 自动引入，上游正好放在 vendor/pluotsorbet。
 *
 * 这类缺陷单看代码完全合理（就是一条 tsc 命令），只有真跑才炸，而且一炸就是
 * 20 分钟之后。所以把「编译期掐掉环境类型」钉成约束：删掉这个 flag 会红。
 */

const ROOT = process.cwd()
const SCRIPT = join(ROOT, 'scripts/build-kernel.sh')

function script(): string {
  return readFileSync(SCRIPT, 'utf8')
}

/** 取出 tsc 那一段（从注释块到 TSC_RC），供逐条断言，避免误伤脚本别处。 */
function tscSection(): string {
  const text = script()
  const start = text.indexOf('== 4/7 JVM 主脚本')
  const end = text.indexOf('ls -lh bld/j2me.js', start)
  expect(start, '找不到 tsc 那一步，脚本结构变了').toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return text.slice(start, end)
}

describe('内核构建的 tsc 步骤', () => {
  it('编译时显式给 --typeRoots，不引入仓库根的环境 @types', () => {
    const section = tscSection()
    // 关键就是这一行：没有它，`@types/node` 会从 ../../node_modules/@types 被拉进来。
    expect(section).toMatch(/--typeRoots\s+"\$TSC_TYPES"/)
    // 参数必须出现在被编译文件之前，且确实交给了同一条 tsc 调用。
    expect(section.indexOf('--typeRoots')).toBeLessThan(section.indexOf('references.ts'))
    expect(section).toContain('TSC_TYPES="$(mktemp -d)"')
  })

  it('不退回「升级 @types / 加 --skipLibCheck」这类治不住的写法', () => {
    const section = tscSection()
    // --skipLibCheck 只跳过类型检查，语法错误（TS1005）照样报，救不了这个场景。
    expect(section).not.toContain('--skipLibCheck')
    // 空目录用完就删，别在 /tmp 里堆。
    expect(section).toContain('rmdir "$TSC_TYPES"')
  })

  it('失败时打印前几条错误，而不是只报一个条数', () => {
    const section = tscSection()
    // 3216 条日志里没有一条能直接看出「是 undici-types」，必须有摘录。
    expect(section).toContain('head -8 "$OTHERS_LOG"')
    expect(section).toContain('/tmp/kernel-tsc.log')
  })

  it('两处已知告警仍然放行（否则每次构建都红）', () => {
    const section = tscSection()
    expect(section).toMatch(/jit\/analyze\\\.ts\.\*TS2365/)
    expect(section).toMatch(/vm\/parser\\\.ts\.\*TS2540/)
  })

  it('脚本本身语法正确', () => {
    const result = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})
