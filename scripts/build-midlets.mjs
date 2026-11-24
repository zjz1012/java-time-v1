#!/usr/bin/env node
/**
 * 十二款自研 MIDlet 的构建与校验。
 *
 * 为什么要在仓库里能重建：整个项目按 GPL-2.0-or-later 分发，而 `public/games/*.data`
 * 是十二款自研游戏的**编译产物**。只有产物、没有源码和构建方式，等于「对应源码」
 * 拿不到 —— 那样一来，随包的 104 款游戏里就有六款是不能合法分发的。
 *
 * 默认动作是**校验**而不是安装：
 *   1. 结构校验（不需要 JDK）：源码在、类名对、产物里 `MIDlet-1` 指向它、
 *      主类 `*.class` 在包里、catalog 里有这个 id；
 *   2. 重编译比对（有 JDK + J2ME 类库时）：用源码重新编译并打包，与已提交的
 *      产物**逐条目**比字节。
 *
 * 为什么默认不安装：替换 `.data` 会改变内容指纹，而指纹是存档的隔离键 ——
 * 六款游戏的存档会全部读不回来。要换产物必须显式 `--install`，并且接受
 * 「catalog 要重新生成」这件事。
 *
 * 用法：
 *   node scripts/build-midlets.mjs             结构校验 + 重编译比对（不写文件）
 *   node scripts/build-midlets.mjs --structural 只做结构校验（CI 没有 JDK 时用）
 *   node scripts/build-midlets.mjs --install   把重编译的结果写回 public/games/
 *
 * 前置（只影响第 2 步）：javac / jar（JDK 8+）与 `public/kernel/java/classes.data`
 * （内核构建产物，见 scripts/build-kernel.sh）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findEntry, parseManifest, readEntries, readEntry, readEntryText } from './lib/jar.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'midlets/src')
const CONFIG = join(ROOT, 'midlets/games.json')
const GAMES_DIR = join(ROOT, 'public/games')
const CATALOG = join(ROOT, 'src/library/catalog.ts')
const WORK = join(ROOT, '.work/midlets')

const args = new Set(process.argv.slice(2))
const INSTALL = args.has('--install')
const STRUCTURAL_ONLY = args.has('--structural')

/** `jar` 会自动加这一行，两个 JDK 的版本号不同，比对时忽略。 */
const VOLATILE_KEYS = new Set(['created-by'])

const problems = []
const fail = (message) => problems.push(message)

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function readGameConfig() {
  if (!existsSync(CONFIG)) {
    console.error(`[fail] 找不到构建清单：${CONFIG}`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(CONFIG, 'utf8'))
}

/** 一份 manifest 文本：与 `j2me/toy` 时期 build.sh 写出来的字段一致。 */
function manifestFor(config, game) {
  return [
    'Manifest-Version: 1.0',
    `MIDlet-Name: ${game.name}`,
    'MIDlet-Version: 1.0',
    `MIDlet-Vendor: ${config.vendor}`,
    `MIDlet-1: ${game.name},,${game.main}`,
    `MicroEdition-Configuration: ${config.profile.configuration}`,
    `MicroEdition-Profile: ${config.profile.profile}`,
    '',
  ].join('\r\n')
}

/** 解析产物里的 manifest，并核对三件事：名字、主类、主类条目。 */
function inspectArtifact(game) {
  const file = join(GAMES_DIR, `${game.id}.data`)
  if (!existsSync(file)) {
    fail(`${game.id}: 缺少产物 public/games/${game.id}.data`)
    return
  }

  let entries
  let values
  try {
    const buffer = readFileSync(file)
    entries = readEntries(buffer)
    const manifest = findEntry(entries, 'META-INF/MANIFEST.MF')
    if (!manifest) {
      fail(`${game.id}: 产物里没有 META-INF/MANIFEST.MF`)
      return
    }
    values = parseManifest(readEntryText(buffer, manifest))
  } catch (error) {
    fail(`${game.id}: 产物读不出来（${error.message}）`)
    return
  }

  const expected = `${game.name},,${game.main}`
  const actual = values.get('MIDlet-1') ?? ''
  if (actual !== expected) {
    fail(`${game.id}: MIDlet-1 是「${actual}」，按清单应为「${expected}」`)
  }
  if ((values.get('MIDlet-Vendor') ?? '') !== game.vendor) {
    fail(`${game.id}: MIDlet-Vendor 是「${values.get('MIDlet-Vendor') ?? ''}」，应为「${game.vendor}」`)
  }
  if (!entries.some((entry) => entry.name === `${game.main}.class`)) {
    fail(`${game.id}: 产物里没有主类 ${game.main}.class`)
  }
}

// ---------------------------------------------------------------- 1 结构校验
const config = readGameConfig()
const catalog = existsSync(CATALOG) ? readFileSync(CATALOG, 'utf8') : ''
if (!catalog) fail('缺少 src/library/catalog.ts')

const sources = existsSync(SRC) ? readdirSync(SRC).filter((name) => name.endsWith('.java')) : []

for (const game of config.games) {
  game.vendor = config.vendor

  const source = join(SRC, `${game.main}.java`)
  if (!existsSync(source)) {
    fail(`${game.id}: 缺少源码 midlets/src/${game.main}.java`)
  } else {
    const text = readFileSync(source, 'utf8')
    // 只认类声明，不认注释里的同名片段。
    if (!new RegExp(`public\\s+(?:final\\s+)?class\\s+${game.main}\\s+extends\\s+MIDlet`).test(text)) {
      fail(`${game.id}: 源码里没有「public class ${game.main} extends MIDlet」`)
    }
  }

  /*
   * 「先有产物才登记，还是先登记才产物」——加一款新游戏时这个顺序是死结：
   * catalog.ts 由 import-games 从产物生成，而这里又要求 catalog 里有 id。
   * 所以在 --install 模式下允许缺：安装本身就会写出产物，之后重跑 import-games
   * 补齐登记。不带 --install 时仍然要 fail（那说明清单与 catalog 真的脱节了）。
   */
  if (catalog && !catalog.includes(`id: '${game.id}'`)) {
    if (INSTALL) console.log(`[新增] ${game.id}: catalog.ts 里还没有，安装后需要重新生成清单`)
    else fail(`${game.id}: src/library/catalog.ts 里没有这个 id`)
  }

  if (INSTALL && !existsSync(join(GAMES_DIR, `${game.id}.data`))) {
    console.log(`[新增] ${game.id}: public/games/ 里还没有产物，安装时写入`)
  } else {
    inspectArtifact(game)
  }
}

// 反向：src 下的每个文件都必须属于清单，否则就是「有源码但没登记」。
const declared = new Set(config.games.map((game) => `${game.main}.java`))
for (const name of sources) {
  if (!declared.has(name)) fail(`midlets/src/${name} 不在 midlets/games.json 里`)
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`[fail] ${problem}`)
  console.error(`\n共 ${problems.length} 项不一致。`)
  process.exit(1)
}

console.log(`[ok] 结构校验通过：${config.games.length} 款，源码 / 产物 / 清单 / catalog 四处一致`)

if (STRUCTURAL_ONLY) process.exit(0)

// ------------------------------------------------------- 2 重编译比对（需 JDK）
const CLASSES = join(ROOT, 'public/kernel/java/classes.data')
const classesAlt = join(ROOT, 'public/kernel/java/classes.jar')
const classlib = existsSync(CLASSES) ? CLASSES : existsSync(classesAlt) ? classesAlt : null
const hasJavac = spawnSync('javac', ['-version'], { encoding: 'utf8' }).status === 0

if (!classlib || !hasJavac) {
  const why = !hasJavac ? '没有 javac' : '缺少 public/kernel/java/classes.data'
  console.log(`[skip] ${why}，跳过重编译比对（结构校验已通过）。`)
  console.log('       要跑完整比对：装 JDK 8+，并先构建内核（bash scripts/build-kernel.sh）。')
  process.exit(0)
}

rmSync(WORK, { recursive: true, force: true })

/** 重编译一款，返回产物路径。 */
function build(game) {
  const dir = join(WORK, game.id)
  const out = join(dir, 'out')
  mkdirSync(out, { recursive: true })

  execFileSync(
    'javac',
    ['--release', '8', '-nowarn', '-encoding', 'UTF-8', '-cp', classlib, '-d', out, join(SRC, `${game.main}.java`)],
    { stdio: 'inherit' },
  )

  const manifest = join(dir, 'MANIFEST.MF')
  // `jar cfm` 期望 manifest 以换行结尾，否则最后一行会被吞。
  writeFileSync(manifest, `${manifestFor(config, game)}\r\n`)

  const jar = join(dir, `${game.id}.jar`)
  execFileSync('jar', ['cfm', jar, manifest, '-C', out, '.'], { stdio: 'inherit' })
  return jar
}

/** 逐条目比字节：压缩后的大小、时间戳都不参与，只比内容。 */
function compare(game, builtJar) {
  const target = join(GAMES_DIR, `${game.id}.data`)
  /*
   * 还没安装过的新游戏没有可比对的产物。
   *
   * 这里返回 0 而不是报错：脚本的职责包括「加一款新游戏」——要求先手工放一个
   * 占位产物才能编译，等于逼人跳过校验。真正的安装步骤在后面，会写进
   * public/games/ 并由指纹校验兜住。
   */
  if (!existsSync(target)) {
    console.log(`  ${game.id.padEnd(12)} 新增 · public/games/ 里还没有产物，本次不比对`)
    return { compared: 0, dirty: true }
  }
  const expected = readFileSync(target)
  const actual = readFileSync(builtJar)
  /** 有任一条目与源码不一致（且是在 --install 下被放行的）——这种不能算「已一致」。 */
  let dirty = false

  const expectedEntries = readEntries(expected)
  const actualEntries = readEntries(actual)
  const names = (entries) => entries.map((entry) => entry.name).sort()

  const missing = names(expectedEntries).filter((name) => !names(actualEntries).includes(name))
  const extra = names(actualEntries).filter((name) => !names(expectedEntries).includes(name))
  if (missing.length > 0) fail(`${game.id}: 重编译后缺少条目 ${missing.join('、')}`)
  if (extra.length > 0) fail(`${game.id}: 重编译后多出条目 ${extra.join('、')}`)

  let compared = 0
  for (const entry of actualEntries) {
    const twin = expectedEntries.find((candidate) => candidate.name === entry.name)
    if (!twin) continue

    if (entry.name.toUpperCase() === 'META-INF/MANIFEST.MF') {
      const before = parseManifest(readEntryText(expected, twin))
      const after = parseManifest(readEntryText(actual, entry))
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        if (VOLATILE_KEYS.has(key.toLowerCase())) continue
        if ((before.get(key) ?? '') !== (after.get(key) ?? '')) {
          const detail = `${game.id}: manifest 的 ${key} 不一致（产物「${before.get(key)}」/ 源码「${after.get(key)}」）`
          // --install 的语义就是「让产物跟上源码」，此处不一致是要写回的对象，不是缺陷。
          if (INSTALL) { console.log(`[更新] ${detail}`); dirty = true }
          else fail(detail)
        }
      }
      continue
    }

    const left = readEntry(expected, twin)
    const right = readEntry(actual, entry)
    if (!left.equals(right)) {
      const detail = `${game.id}: ${entry.name} 与源码编译结果不一致（产物 ${left.length} 字节 / 源码 ${right.length} 字节）`
      /*
       * 不带 --install 时这是硬错误（产物是生成物，被人手改过或忘了重打包）。
       * 带 --install 时它就是「这次要写回的东西」——正是这个参数存在的理由。
       */
      if (INSTALL) { console.log(`[更新] ${detail}`); dirty = true }
      else fail(detail)
      continue
    }
    compared += 1
  }
  return { compared, dirty }
}

console.log(`\n重编译并比对（javac: ${(spawnSync('javac', ['-version'], { encoding: 'utf8' }).stdout || '').trim()}）：`)

let totalEntries = 0
/** 条目内容与产物完全一致的 id —— 安装时跳过它们，别白白改指纹。 */
const identical = new Set()
for (const game of config.games) {
  const jar = build(game)
  const result = compare(game, jar)
  const entries = result.compared
  // 必须「全部条目一致」才算可跳过：只要有一条要更新，写回才有意义。
  if (entries > 0 && !result.dirty) identical.add(game.id)
  totalEntries += entries
  const target = join(GAMES_DIR, `${game.id}.data`)
  const before = existsSync(target) ? sha256(target) : '(新)'
  const after = sha256(jar)
  const same = before === after ? '整包字节相同' : before === '(新)' ? '新增' : '整包字节不同（时间戳/压缩差异，条目内容已逐一对齐）'
  console.log(`  ${game.id.padEnd(9)} ${String(entries).padStart(2)} 个条目一致 · ${same}`)
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`[fail] ${problem}`)
  console.error(`\n共 ${problems.length} 项不一致：产物与 midlets/src 下的源码对不上。`)
  console.error('手动改过产物、或源码更新后忘了重新打包，都会这样。')
  process.exit(1)
}

console.log(`\n[ok] 十二款自研游戏的产物可由 midlets/src 重现：${totalEntries} 个 class 逐字节一致`)

if (!INSTALL) {
  console.log('     （默认不写回 public/games：换产物会改内容指纹，存档会读不回来）')
  process.exit(0)
}

// ------------------------------------------------------------------ 3 安装
console.log('\n写回 public/games/（内容指纹会变，catalog 需要重新生成）：')
for (const game of config.games) {
  const target = join(GAMES_DIR, `${game.id}.data`)
  /*
   * 条目内容已经一致就别写回。
   *
   * jar 里有构建时间戳，重打一次整包字节必然不同；而**指纹是存档的隔离键**
   * （ADR 0005 决策 5）—— 白白换一次，用户这六款的存档就全读不回来了。
   */
  if (identical.has(game.id)) {
    console.log(`  ${game.id.padEnd(12)} 跳过（条目内容与产物一致，不换指纹）`)
    continue
  }
  const before = existsSync(target) ? sha256(target).slice(0, 12) : '(新)'
  copyFileSync(join(WORK, game.id, `${game.id}.jar`), target)
  const after = sha256(target).slice(0, 12)
  console.log(`  ${game.id.padEnd(12)} ${before} → ${after}${before === after ? '（未变）' : ''}`)
}
console.log('\n下一步：重新生成清单指纹（会改动 src/library/catalog.ts），并告知用户旧存档无法读回。')
