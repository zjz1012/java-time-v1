#!/usr/bin/env node
/**
 * 内核产物自检。
 *
 * 目的不是复现构建（那是 build-kernel.sh 的事），而是拦住两类事故：
 *   1. 产物是从别处拷来的旧版本 —— 用特征字符串识别；
 *   2. 产物里混进了应当排除的私有网络层。
 *
 * public/kernel/ 不存在时视为「尚未构建」，直接通过（CI 里不构建内核）。
 *
 * 退出码：0 通过；1 有问题。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KERNEL_DIR = join(ROOT, 'public/kernel')

const ARTIFACTS = [
  { name: 'j2me.js', path: 'j2me.js', minBytes: 100_000, mustInclude: ['JVM', 'MIDlet'] },
  { name: 'native.js', path: 'native.js', minBytes: 100_000, mustInclude: ['Relooper', 'Module.buffer'] },
  { name: 'main-all.js', path: 'main-all.js', minBytes: 300_000, mustInclude: ['inferMidletClassName'] },
  // 路径是内核写死的：main-all.js 里 load("java/classes.data")，相对宿主页的 <base>。
  { name: 'java/classes.data', path: 'java/classes.data', minBytes: 500_000, mustInclude: [] },
]

/**
 * 必须不出现的字符串：
 *   - `evalNative`：旧版外壳的桥接函数，其契约结构不复用（ADR 0002）；
 *   - `zixing`：第三方私有网络层的域名片段（`qq.zixing.fun`），新版零依赖。
 */
const FORBIDDEN = ['evalNative', 'zixing']

if (!existsSync(KERNEL_DIR)) {
  console.log('[skip] public/kernel/ 不存在，视为未构建内核。')
  console.log('       需要时运行：bash scripts/fetch-upstream.sh && bash scripts/build-kernel.sh')
  process.exit(0)
}

const problems = []
const rows = []

// 旧布局仍在时给出明确提示：内核会按 load("java/classes.data") 请求，放错位置就是 404，
// 而 404 的表现是 loadingPromises 被 reject —— 页面停在启动层，不报可见错误。
if (existsSync(join(KERNEL_DIR, 'classes.data'))) {
  problems.push('检测到旧布局 public/kernel/classes.data，应位于 java/classes.data')
}

// 这两类资源缺失的症状都不指向自己，所以必须单独检查：
//   certs/_main.ks 缺失 → initFS reject，start() 不执行，只在控制台留一行 Loading failed；
//   style/emoji 缺失   → gainedForeground0 里的 Promise.all 永不完成，
//                        Java 线程挂起，画布一次 refresh 都没有，表现为「启动成功但全黑」。
for (const [label, rel] of [
  ['MIDP 证书库', 'certs/_main.ks'],
  ['emoji 图集', 'style/emoji/emoji0.png'],
]) {
  if (!existsSync(join(KERNEL_DIR, rel))) {
    problems.push(`缺少${label}（${rel}），内核会停在启动阶段且不报可见错误`)
  }
}

for (const spec of ARTIFACTS) {
  const path = join(KERNEL_DIR, spec.path)
  if (!existsSync(path)) {
    problems.push(`缺少 ${spec.name}`)
    continue
  }
  const size = statSync(path).size
  if (size < spec.minBytes) {
    problems.push(`${spec.name} 体积异常（${size} < ${spec.minBytes}），可能未完整构建`)
  }

  const buf = readFileSync(path)
  const latin = buf.toString('latin1')
  const text = spec.name.endsWith('.data') ? '' : latin

  for (const needle of spec.mustInclude) {
    if (!text.includes(needle)) {
      problems.push(`${spec.name} 缺少特征「${needle}」，疑似来自其他构建`)
    }
  }

  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) {
      problems.push(`${spec.name} 含禁止字符串「${needle}」—— 产物来源不对`)
    }
  }

  const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16)
  const entries = spec.name.endsWith('.data') ? countZipEntries(buf) : null
  // WebSocket 计数作为「是否夹带回连通道」的可见指标，不参与判定：
  // 不同 emscripten 版本可能在运行时装库里出现该词，硬判会误报。
  const sockets = (text.match(/WebSocket/g) ?? []).length
  rows.push({ name: spec.name, size, sha, entries, sockets })
}

/**
 * 读 zip 的中央目录结束记录（EOCD）拿条目总数。
 * 只读 22 字节的固定尾部，不解析每个条目 —— 这里只需要一个数量级判据。
 */
function countZipEntries(buf) {
  const SIG = 0x06054b50
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i -= 1) {
    if (buf.readUInt32LE(i) === SIG) {
      return buf.readUInt16LE(i + 10)
    }
  }
  return null
}

let socketTotal = 0
for (const r of rows) {
  socketTotal += r.sockets
  const extra = r.entries === null ? '' : `  ${r.entries} 个 zip 条目`
  console.log(`  ${r.name.padEnd(18)} ${String(r.size).padStart(9)} B  sha256:${r.sha}${extra}`)
}
console.log(`  WebSocket 计数合计：${socketTotal}${socketTotal === 0 ? '（无回连通道）' : '（请确认来源）'}`)

if (problems.length > 0) {
  console.error('')
  for (const p of problems) console.error(`[fail] ${p}`)
  process.exit(1)
}

console.log('[ok] 内核产物自检通过（无旧版私有通道残留）')
