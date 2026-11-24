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
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = join(ROOT, 'docs/provenance/SOURCES.md')
const NOTICES = join(ROOT, 'docs/provenance/THIRD_PARTY_NOTICES.md')
const GPL_TEXT = join(ROOT, 'docs/provenance/license-texts/GPL-2.0.txt')
const MIT_TEXT = join(ROOT, 'docs/provenance/license-texts/MIT.txt')
const GAMES_DIR = join(ROOT, 'public/games')
const CATALOG = join(ROOT, 'src/library/catalog.ts')

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
  ['license-texts/MIT.txt', MIT_TEXT],
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

// ---------------------------------------------------------------- 6 内置游戏
// 这里只查「登记层面」的三件事：许可正文在不在、台账有没有这一节、清单与
// 资产数量对不对得上。逐款指纹与字节是否一致由 `import-games.mjs --check`
// 负责（它要读 104 个包重算摘要，比本脚本重）。
if (!sources.includes('内置游戏')) {
  fail('SOURCES.md 未登记内置游戏（104 款随包分发，必须逐来源说明）')
}

// MIT 要求保留版权声明。三份授权版权人不同，缺任何一行都等于没遵守。
const mit = readFileSync(MIT_TEXT, 'utf8')
for (const [label, needle] of [
  ['j2me-100-games', 'Agneay B Nair'],
  ['my-j2me-projects', 'pisces312'],
  ['Shooter', 'Muhammad Rehan Saeed'],
]) {
  if (!mit.includes(needle)) {
    fail(`MIT.txt 缺少「${label}」的版权行 —— MIT 原文要求保留版权声明，不能只留正文`)
  }
}

if (!existsSync(CATALOG)) {
  fail('缺少 src/library/catalog.ts（内置游戏清单是生成物，见 scripts/import-games.mjs）')
} else {
  const catalog = readFileSync(CATALOG, 'utf8')
  // 只数游戏条目：分类表里也有 `id:`，用 `title:` 一起匹配才区分得开。
  const entries = catalog.match(/\{ id: '[^']+', title: /g) ?? []
  const onDisk = existsSync(GAMES_DIR)
    ? readdirSync(GAMES_DIR).filter((name) => name.endsWith('.data')).length
    : 0

  if (entries.length === 0) {
    fail('catalog 里没有任何内置游戏')
  }
  if (entries.length !== onDisk) {
    fail(
      `内置游戏数量不一致：catalog 登记 ${entries.length} 款，public/games 有 ${onDisk} 个 .data` +
        '（改过清单就重跑 node scripts/import-games.mjs）',
    )
  }

  const fingerprints = catalog.match(/fingerprint: '(sha256:[0-9a-f]{64})'/g) ?? []
  if (fingerprints.length !== entries.length) {
    fail(
      `有 ${entries.length - fingerprints.length} 款内置游戏的指纹不是合法的 sha256` +
        '（存档按它隔离，格式不对会落到非法键上）',
    )
  }
  const unique = new Set(fingerprints)
  if (unique.size !== fingerprints.length) {
    fail('catalog 里有重复的指纹 —— 两款游戏会共用同一份存档')
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
