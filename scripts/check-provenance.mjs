#!/usr/bin/env node
/**
 * 来源登记自检。
 *
 * 检查的是「登记是否完整、是否与仓库现状一致」，不是法务判断。
 * 覆盖三类容易漏的情况：
 *   1. package.json 里新增了直接依赖，但 SOURCES.md 没登记；
 *   2. 关键 commit / 许可标识被改动或删掉；
 *   3. 随包分发的许可原文被替换（用 GPL-2.0 的标准 md5 兜底）。
 *
 * 退出码：0 通过；1 有阻塞问题。
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = join(ROOT, 'docs/provenance/SOURCES.md')
const NOTICES = join(ROOT, 'docs/provenance/THIRD_PARTY_NOTICES.md')
const GPL_TEXT = join(ROOT, 'docs/provenance/license-texts/GPL-2.0.txt')

/** GNU GPL v2 全文的公认 md5（文本本身从未改版）。 */
const GPL2_MD5 = 'b234ee4d69f5fce4486a80fdaf4a4263'

const problems = []
const warnings = []

function fail(msg) {
  problems.push(msg)
}
function warn(msg) {
  warnings.push(msg)
}

// ---------------------------------------------------------------- 1 文件存在
for (const [label, path] of [
  ['SOURCES.md', SOURCES],
  ['THIRD_PARTY_NOTICES.md', NOTICES],
  ['license-texts/GPL-2.0.txt', GPL_TEXT],
]) {
  if (!existsSync(path)) fail(`缺少 ${label}`)
}

if (problems.length > 0) {
  report()
  process.exit(1)
}

const sources = readFileSync(SOURCES, 'utf8')
const notices = readFileSync(NOTICES, 'utf8')

// ---------------------------------------------------------------- 2 关键登记项
const REQUIRED_MARKERS = [
  ['上游仓库地址', 'github.com/mozilla/pluotsorbet'],
  ['内核 commit', '46ee3e78a4fd9c3f09026cc5cbdcf76e94b7a398'],
  ['内核许可', 'GPL-2.0'],
  ['Boehm submodule commit', '712978aea8b6a30bee949d78275aafb0e8cbc887'],
  ['Relooper 许可', 'MIT'],
]
for (const [label, needle] of REQUIRED_MARKERS) {
  if (!sources.includes(needle)) fail(`SOURCES.md 未登记「${label}」（找不到 ${needle}）`)
}

if (!notices.includes('4ee3e78') && !notices.includes('46ee3e78')) {
  warn('THIRD_PARTY_NOTICES.md 未写明上游 commit，用户难以定位对应源码')
}

// ---------------------------------------------------------------- 3 依赖是否登记
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const directDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
const unregistered = directDeps.filter((name) => {
  if (name.startsWith('@types/')) return false // 类型声明单独一行说明即可
  return !sources.includes(`\`${name}\``)
})
if (unregistered.length > 0) {
  fail(`以下直接依赖未在 SOURCES.md 登记：${unregistered.join(', ')}`)
}

// ---------------------------------------------------------------- 4 许可原文完整性
const gpl = readFileSync(GPL_TEXT)
const gplMd5 = createHash('md5').update(gpl).digest('hex')
if (gplMd5 !== GPL2_MD5) {
  fail(`GPL-2.0.txt 与官方全文不一致（md5 ${gplMd5}），可能被改动`)
}

// ---------------------------------------------------------------- 5 禁止项
const FORBIDDEN_IN_NOTICES = [
  ['旧版私有通道', 'zixing'],
  ['旧版桥接函数', 'evalNative'],
]
for (const [label, needle] of FORBIDDEN_IN_NOTICES) {
  if (notices.includes(needle)) {
    warn(`THIRD_PARTY_NOTICES.md 出现「${label}」字样，确认这是有意的排除说明`)
  }
}

report()

function report() {
  for (const w of warnings) console.warn(`[warn] ${w}`)
  if (problems.length === 0) {
    console.log(`[ok] 来源登记完整：${directDeps.length} 个直接依赖，GPL 原文校验通过`)
    return
  }
  for (const p of problems) console.error(`[fail] ${p}`)
  console.error(`\n共 ${problems.length} 项阻塞问题`)
}
process.exit(problems.length === 0 ? 0 : 1)
