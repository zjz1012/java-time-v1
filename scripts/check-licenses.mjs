#!/usr/bin/env node
/**
 * 校验「随包分发的许可原文」与仓库里的正本逐字节一致。
 *
 * 为什么需要这一步：GPL 与 MIT 都要求分发时**附上许可原文**，而我们的分发物
 * 是打包出来的一堆静态文件。原文因此存在两份：
 *   - 正本：`LICENSE`、`docs/provenance/license-texts/*`、`docs/provenance/THIRD_PARTY_NOTICES.md`
 *   - 随包副本：`public/licenses/*`（Vite 会把 public/ 原样搬进 dist）
 *
 * 两份就意味着可能不一致。而这类不一致是**静默**的：改了正本、忘了同步副本，
 * 构建照常成功，站点照常上线，只有用户点开「许可原文」看到的是旧版本 ——
 * 这正是 GPL 处分最不想要的那种错。
 *
 * 所以这里只做一件事：逐字节比对。不一致就失败，并给出同步命令。
 * 同步是手动的（`node scripts/check-licenses.mjs --write`）：许可原文一年改不了
 * 一次，为它引入一个「构建时自动复制」的钩子，反而会让「副本什么时候变的」
 * 变得不可追溯。
 *
 * 用法：
 *   node scripts/check-licenses.mjs          # 校验（CI / 发布流程用）
 *   node scripts/check-licenses.mjs --write  # 用正本覆盖副本
 */

import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DIR = join(ROOT, 'public/licenses')

/**
 * 副本 ← 正本。
 *
 * `THIRD_PARTY_NOTICES` 的原名是 `.md`，副本用 `.txt`：站点把它当纯文本直接
 * 显示，`.md` 在多数静态服务器上会被当成下载文件。内容一字不改，所以比对
 * 仍然成立 —— 换扩展名不等于换内容。
 */
const PAIRS = [
  ['GPL-2.0.txt', 'LICENSE'],
  ['MIT.txt', 'docs/provenance/license-texts/MIT.txt'],
  ['THIRD_PARTY_NOTICES.txt', 'docs/provenance/THIRD_PARTY_NOTICES.md'],
]

const write = process.argv.includes('--write')

let failed = 0
for (const [copyName, sourceName] of PAIRS) {
  const copy = join(DIR, copyName)
  const source = join(ROOT, sourceName)

  if (!existsSync(source)) {
    console.error(`[fail] 正本不见了：${sourceName}`)
    failed += 1
    continue
  }

  if (write) {
    copyFileSync(source, copy)
    console.log(`[write] ${copyName} ← ${sourceName}`)
    continue
  }

  if (!existsSync(copy)) {
    console.error(`[fail] 缺少随包副本 public/licenses/${copyName}（正本 ${sourceName}）`)
    failed += 1
    continue
  }

  const a = readFileSync(copy)
  const b = readFileSync(source)
  if (!a.equals(b)) {
    // 指出哪个字节开始不同，比只说「不一致」有用：多半是有人在正本里补了一段。
    let at = 0
    while (at < a.length && at < b.length && a[at] === b[at]) at += 1
    console.error(
      `[fail] public/licenses/${copyName} 与 ${sourceName} 不一致` +
        `（副本 ${a.length} 字节 / 正本 ${b.length} 字节，第 ${at + 1} 字节起不同）`,
    )
    failed += 1
  }
}

if (write) {
  console.log('[ok] 已按正本覆盖随包副本')
  process.exit(0)
}

if (failed > 0) {
  console.error('')
  console.error('修法：node scripts/check-licenses.mjs --write')
  console.error('      （正本动了就该同步副本：许可原文是对用户的分发承诺，只在新版仓库里更新等于没兑现）')
  process.exit(1)
}

console.log(`[ok] 随包许可原文与正本一致：${PAIRS.length} 份`)
