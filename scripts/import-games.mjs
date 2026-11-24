#!/usr/bin/env node
/**
 * 把内置游戏从 j2me-toy 迁进本项目，并生成 `src/library/catalog.ts`。
 *
 * 为什么要写成脚本而不是「复制一遍就完事」：
 *   1. 清单里的指纹必须**与真实字节一致**。手写或复制旧值，一旦某个 .data
 *      被换过，指纹就会指向别的文件 —— 而存档是按指纹隔离的，结果是两款不同
 *      的游戏共用一份存档（详见 ADR 0005 决策 5）。所以这里重算，不抄。
 *   2. 指纹必须**两两不同**。同一个包出现两次就等于两个 id 指向一个存档键。
 *      这一条在这里当硬错误处理，不留给运行时发现。
 *   3. 下次加游戏时，改上游清单再跑一遍即可；`catalog.ts` 是生成物，
 *      文件头写明不要手改。
 *
 * 用法：
 *   node scripts/import-games.mjs                       # 默认从 ../j2me-toy/public/games 读
 *   node scripts/import-games.mjs --from <目录>          # 指定来源
 *   node scripts/import-games.mjs --check                # 只校验现有 catalog.ts 与文件是否一致
 *
 * 退出码：0 通过；1 有问题。
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEST = join(ROOT, 'public/games')
const CATALOG = join(ROOT, 'src/library/catalog.ts')

/** id 会成为 URL 的一部分，也会进存档键的注释，所以只允许安全字符。 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const fromIndex = args.indexOf('--from')
const SOURCE = fromIndex >= 0 ? resolve(args[fromIndex + 1] ?? '') : resolve(ROOT, '../j2me-toy/public/games')

const problems = []
const fail = (msg) => problems.push(msg)

/**
 * 生成单引号字符串字面量。
 *
 * 不能直接 `JSON.stringify`：那会产出双引号，和仓库里其余代码的风格不一致
 * （也没有格式化工具统一它）。先借 JSON 做好转义，再换外层引号 ——
 * 顺序不能反，否则 `\"` 会被提前还原成裸引号。
 */
function jsString(value) {
  const json = JSON.stringify(String(value))
  const inner = json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")
  return `'${inner}'`
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// ------------------------------------------------------------------ 1 读源清单
if (!existsSync(join(SOURCE, 'manifest.json'))) {
  console.error(`[fail] 找不到源清单：${join(SOURCE, 'manifest.json')}`)
  console.error('       用 --from <目录> 指定 j2me-toy 的 public/games 目录。')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(SOURCE, 'manifest.json'), 'utf8'))
const rawGames = manifest.games
if (!Array.isArray(rawGames) || rawGames.length === 0) {
  console.error('[fail] 源清单里没有 games 数组')
  process.exit(1)
}

const categories = Array.isArray(manifest.categories) ? manifest.categories : []
if (categories.length === 0) fail('源清单缺少 categories，界面的分类筛选会没有标签')

// ------------------------------------------------------------------ 2 逐条校验
const games = []
const seenId = new Set()
const seenFp = new Map()

for (const raw of rawGames) {
  const id = raw.id
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    fail(`id 不合法：${JSON.stringify(id)}`)
    continue
  }
  if (seenId.has(id)) {
    fail(`id 重复：${id}`)
    continue
  }
  seenId.add(id)

  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : ''
  if (!title) fail(`${id}: 缺少 title`)
  const file = typeof raw.file === 'string' ? raw.file : ''
  if (!file) {
    fail(`${id}: 缺少 file`)
    continue
  }
  if (!file.endsWith('.data')) {
    // 平台与内核都按内容读，扩展名只是约定；但 .zip/.jar 在静态托管上
    // 会被当成「可下载的压缩包」，某些环境直接 404。所以坚持 .data。
    fail(`${id}: file 必须是 .data 结尾（当前 ${file}）`)
  }

  const srcJar = join(SOURCE, file)
  if (!existsSync(srcJar)) {
    fail(`${id}: 源文件不存在 ${file}`)
    continue
  }

  const shot = typeof raw.shot === 'string' ? raw.shot : ''
  if (!shot) fail(`${id}: 缺少封面 shot`)
  else if (!existsSync(join(SOURCE, shot))) fail(`${id}: 封面不存在 ${shot}`)

  const category = categories.some((c) => c.id === raw.category) ? raw.category : ''
  if (!category) fail(`${id}: category 不在分类表里（${String(raw.category)}）`)

  // 指纹按真实字节重算，不抄源清单里的任何值（源清单里本来也没有）。
  const fingerprint = `sha256:${sha256File(srcJar)}`
  if (seenFp.has(fingerprint)) {
    fail(
      `${id}: 与 ${seenFp.get(fingerprint)} 是同一个包（指纹相同）——` +
        '两款游戏会共用同一份存档，必须去掉其中一个',
    )
    continue
  }
  seenFp.set(fingerprint, id)

  games.push({
    id,
    title,
    subtitle: typeof raw.subtitle === 'string' ? raw.subtitle.trim() : '',
    category,
    author: typeof raw.author === 'string' && raw.author.trim() ? raw.author.trim() : '未登记',
    file,
    shot,
    bytes: statSync(srcJar).size,
    fingerprint,
  })
}

// 只保留真被用到的分类，按源清单顺序 —— 分类的顺序就是界面上的顺序。
const usedCategories = categories
  .filter((c) => games.some((g) => g.category === c.id))
  .map((c) => ({ id: c.id, name: c.name }))

if (problems.length > 0) {
  for (const p of problems) console.error(`[fail] ${p}`)
  console.error(`\n共 ${problems.length} 项，未写入任何文件。`)
  process.exit(1)
}

// ------------------------------------------------------------------ 3 --check：比对现状
if (checkOnly) {
  const stale = []
  if (!existsSync(CATALOG)) fail('缺少 src/library/catalog.ts')
  else {
    const text = readFileSync(CATALOG, 'utf8')
    for (const game of games) {
      if (!text.includes(`id: ${jsString(game.id)}`)) stale.push(`${game.id}: catalog 里没有`)
      else if (!text.includes(game.fingerprint)) stale.push(`${game.id}: 指纹与文件不符`)
    }
    for (const game of games) {
      if (!existsSync(join(DEST, `${game.id}.data`))) stale.push(`${game.id}: public/games 下缺少 .data`)
    }
    const onDisk = existsSync(DEST) ? readdirSync(DEST).filter((n) => n.endsWith('.data')) : []
    if (onDisk.length !== games.length) {
      stale.push(`public/games 有 ${onDisk.length} 个 .data，清单是 ${games.length} 个`)
    }
  }
  if (stale.length > 0) {
    for (const s of stale) console.error(`[fail] ${s}`)
    console.error(`\n共 ${stale.length} 项不一致，重跑 node scripts/import-games.mjs 即可同步。`)
    process.exit(1)
  }
  console.log(`[ok] 内置游戏与清单一致：${games.length} 款，${usedCategories.length} 个分类`)
  process.exit(0)
}

// ------------------------------------------------------------------ 4 复制资产
mkdirSync(join(DEST, 'shots'), { recursive: true })
for (const game of games) {
  // 落盘名用 id，而不是源文件名：源文件名带空格/大小写不一致时，
  // 静态托管的行为不统一，而 id 已经过 ID_PATTERN 校验。
  copyFileSync(join(SOURCE, game.file), join(DEST, `${game.id}.data`))
  if (game.shot) copyFileSync(join(SOURCE, game.shot), join(DEST, 'shots', `${game.id}.png`))
}

// ------------------------------------------------------------------ 5 写 catalog
const lines = []
lines.push('/**')
lines.push(' * 内置游戏清单。')
lines.push(' *')
lines.push(' * ★ 这是**生成物**，不要手改：由 `node scripts/import-games.mjs` 从')
lines.push(' *   `j2me-toy/public/games` 读源清单、重算指纹、复制资产后生成。')
lines.push(' *   要加游戏就改上游清单再跑一遍，否则手改的内容下次生成会丢。')
lines.push(' *')
lines.push(' * `fingerprint` 是 `sha256:` + 真实字节的摘要，也就是存档的隔离键')
lines.push(' * （见 ADR 0005 决策 5）。它同时充当「这个文件有没有被换过」的校验值：')
lines.push(' * 运行页 fetch 之后会重算一遍，不一致就拒绝启动 —— 换过包的游戏跑起来')
lines.push(' * 读到的会是旧包的存档。')
lines.push(' *')
lines.push(` * 共 ${games.length} 款；来源与许可见 \`docs/provenance/GAMES.md\`。`)
lines.push(' */')
lines.push("import type { BuiltinGame, Category } from './types'")
lines.push('')
lines.push('/** 有游戏的分类，顺序即界面顺序。 */')
lines.push('export const CATEGORIES: readonly Category[] = [')
for (const c of usedCategories) {
  lines.push(`  { id: ${jsString(c.id)}, name: ${jsString(c.name)} },`)
}
lines.push(']')
lines.push('')
lines.push('export const BUILTIN_GAMES: readonly BuiltinGame[] = [')
for (const g of games) {
  lines.push(
    '  {' +
      ` id: ${jsString(g.id)},` +
      ` title: ${jsString(g.title)},` +
      ` subtitle: ${jsString(g.subtitle)},` +
      ` category: ${jsString(g.category)},` +
      ` author: ${jsString(g.author)},` +
      ` bytes: ${g.bytes},` +
      ` fingerprint: ${jsString(g.fingerprint)} },`,
  )
}
lines.push(']')
lines.push('')
lines.push('/** id → 游戏。库页与运行页都按 id 取，避免 O(n) 查找散落各处。 */')
lines.push('export const BUILTIN_BY_ID: ReadonlyMap<string, BuiltinGame> = new Map(')
lines.push('  BUILTIN_GAMES.map((game) => [game.id, game]),')
lines.push(')')
lines.push('')

writeFileSync(CATALOG, lines.join('\n'), 'utf8')

const totalBytes = games.reduce((sum, g) => sum + g.bytes, 0)
console.log(
  `[ok] 迁入 ${games.length} 款（${(totalBytes / 1024 / 1024).toFixed(1)} MB），` +
    `${usedCategories.length} 个分类 → public/games/ 与 src/library/catalog.ts`,
)
