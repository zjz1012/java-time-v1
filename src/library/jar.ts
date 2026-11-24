/**
 * 导入前的 JAR 预检。
 *
 * 这条边界上进来的是**用户自己塞的文件**，所以判据不能只是「文件头是 PK」：
 * 一个普通 ZIP、一个把 manifest 删掉的包、一个 `MIDlet-1` 指向不存在主类的包，
 * 都能通过「是不是 ZIP」这一关。它们的共同下场是——库里出现一张正常卡片，
 * 点进去一直转圈，十几秒后给一句「启动超时」。用户不知道是自己选错了文件。
 *
 * 所以这里要求三件事，缺一件就拒：
 *   1. `META-INF/MANIFEST.MF` 存在；
 *   2. `MIDlet-1` 形如 `名称,图标,主类`（MIDP 规定的三段），主类名合法；
 *   3. 主类真的在包里（`pkg.Cls` → `pkg/Cls.class`）。
 *
 * 另外给 manifest 的解压加一条硬上限。ZIP 里声明几 KB、实际解出几百 MB 的
 * 包是现成的攻击手法，而 `DecompressionStream` 会把结果全部攒进内存 ——
 * 这里边读边数，超了立刻放弃，不等它解完。
 *
 * 不做的事：不解析 class 文件、不校验 MIDP API 用法。那些是内核的判断，
 * 我们在这里重复一遍只会多一套错误码，还可能与内核的结论不一致。
 */

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
/** EOCD 固定 22 字节，后面跟最多 65535 字节注释。 */
const EOCD_MIN = 22
const EOCD_MAX_COMMENT = 0xffff
const MANIFEST_NAME = 'META-INF/MANIFEST.MF'

/**
 * manifest 解压后的上限。
 *
 * 规范里 manifest 只有几百字节到几 KB（含分条目属性）。64 KiB 是「明显异常」
 * 的分界线：真有程序把资源塞进 manifest 也到不了这个量级。
 */
const MAX_MANIFEST_BYTES = 64 * 1024
/** 压缩后的上限：先挡一层，免得上限还没生效就先把大块数据读进内存。 */
const MAX_MANIFEST_COMPRESSED = 256 * 1024
/** 中央目录最多看这么多条。J2ME 包通常不到 200 条，上千条只可能是构造出来的。 */
const MAX_ENTRIES = 2048

export type JarProblem =
  | 'not-zip'
  | 'no-manifest'
  | 'manifest-too-large'
  | 'no-midlet'
  | 'bad-midlet'
  | 'missing-class'

export interface MidletInfo {
  readonly name: string
  readonly vendor: string
  /** 主类全名（点分），`MIDlet-1` 的第三段。 */
  readonly mainClass: string
}

export interface JarInspection {
  readonly ok: boolean
  readonly problem: JarProblem | null
  readonly info: MidletInfo | null
}

/** 把问题翻成用户能看懂、并且知道下一步做什么的话。 */
export function describeJarProblem(problem: JarProblem | null, mainClass = ''): string {
  switch (problem) {
    case 'not-zip':
      return '这个文件不是 JAR 包（找不到 ZIP 目录），可能选错了文件'
    case 'no-manifest':
      return '包里没有 META-INF/MANIFEST.MF，不是可启动的 J2ME 程序'
    case 'manifest-too-large':
      return `MANIFEST.MF 超过 ${MAX_MANIFEST_BYTES / 1024} KB，拒绝解压`
    case 'no-midlet':
      return 'MANIFEST.MF 里没有 MIDlet-1，这个包没有可启动的程序'
    case 'bad-midlet':
      return 'MIDlet-1 写得不对，应形如「名称,图标,主类」'
    case 'missing-class':
      return `MIDlet-1 指向的主类 ${mainClass || '（空）'} 不在包里，启动只会等到超时`
    default:
      return '这个程序包无法识别'
  }
}

interface CentralEntry {
  readonly name: string
  readonly method: number
  readonly compressedSize: number
  readonly localOffset: number
}

/**
 * 找 EOCD。从尾部往前扫，并且要求「注释长度正好到文件末尾」。
 *
 * 只看签名不够：压缩数据里也可能凑巧出现这四个字节，加上长度校验之后，
 * 假阳性要再满足一个等式才会被误认。
 */
function findEocd(view: DataView): number | null {
  const length = view.byteLength
  const stop = Math.max(0, length - EOCD_MIN - EOCD_MAX_COMMENT)
  for (let i = length - EOCD_MIN; i >= stop; i -= 1) {
    if (view.getUint32(i, true) !== EOCD_SIG) continue
    const commentLength = view.getUint16(i + 20, true)
    if (i + EOCD_MIN + commentLength === length) return i
  }
  return null
}

/**
 * 读中央目录。结构不对就返回 null —— 这是「不是 JAR」与「JAR 坏了」共同的出口。
 *
 * 必须整份读完而不是找到 manifest 就停下：主类校验要查任意条目名。
 */
function readCentralDirectory(view: DataView, eocd: number): CentralEntry[] | null {
  const count = view.getUint16(eocd + 10, true)
  if (count > MAX_ENTRIES) return null
  let offset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const entries: CentralEntry[] = []

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > view.byteLength) return null
    if (view.getUint32(offset, true) !== CENTRAL_SIG) return null

    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const nameStart = offset + 46
    if (nameStart + nameLength > view.byteLength) return null

    entries.push({
      name: decoder.decode(new Uint8Array(view.buffer, view.byteOffset + nameStart, nameLength)),
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localOffset: view.getUint32(offset + 42, true),
    })

    offset = nameStart + nameLength + extraLength + commentLength
  }
  return entries
}

/** 按本地头算出真实数据起点 —— 中央目录里的偏移指的是本地头，不是数据。 */
function readEntryData(view: DataView, entry: CentralEntry): Uint8Array | null {
  const head = entry.localOffset
  if (head + 30 > view.byteLength) return null
  if (view.getUint32(head, true) !== LOCAL_SIG) return null

  const nameLength = view.getUint16(head + 26, true)
  const extraLength = view.getUint16(head + 28, true)
  const start = head + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > view.byteLength) return null

  return new Uint8Array(view.buffer, view.byteOffset + start, entry.compressedSize)
}

/**
 * 解压 deflate-raw，**边读边数**。
 *
 * 不用 `new Response(stream).arrayBuffer()`：那是「先全部解完再看多大」，
 * 一个声明 4 KB、实际几百 MB 的包会先把内存吃掉。这里超限就 `cancel()`。
 *
 * 返回 `'too-large'` 与 `null`（解不开）分开，是因为两者对用户的意义不同：
 * 一个是包有问题，一个是包坏了。
 */
async function inflateLimited(
  raw: Uint8Array,
  limit: number,
): Promise<Uint8Array | 'too-large' | null> {
  if (typeof DecompressionStream === 'undefined' || typeof ReadableStream === 'undefined') {
    return null
  }
  try {
    /*
     * 用 `ReadableStream` 手工喂数据，而不是 `new Blob([...]).stream()`：
     * jsdom 的 Blob 没有 `stream()`（测试环境会静默降级成「读不到名字」），
     * 而 ReadableStream 是 DecompressionStream 的原生搭档，两处都能用。
     *
     * 元素类型取 `BufferSource` 而不是 `Uint8Array`：DOM 类型里
     * `DecompressionStream` 的可写端收的是 `BufferSource`。
     */
    const source = new ReadableStream<BufferSource>({
      start(controller) {
        // 复制一份再喂：`bytes.buffer` 可能是带偏移的视图底下的整块内存，
        // 直接交出去会把 manifest 之外的数据也送进解压流。
        controller.enqueue(new Uint8Array(raw))
        controller.close()
      },
    })
    const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader()
    const chunks: Uint8Array[] = []
    let total = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        return 'too-large'
      }
      chunks.push(value)
    }

    const out = new Uint8Array(total)
    let at = 0
    for (const chunk of chunks) {
      out.set(chunk, at)
      at += chunk.byteLength
    }
    return out
  } catch {
    // 数据不是合法的 deflate。
    return null
  }
}

/**
 * 把续行拼回逻辑行。
 *
 * 规范要求值超过 72 字节时折行，续行以单个空格开头。不处理的话长名字会被
 * 截掉一截 —— 表现出来是「导入后名字少了几个字」，很难联想到是折行。
 *
 * 空行表示主属性结束（后面是分条目属性，每个 MIDlet 一段），到这里就够了。
 * 这里先折叠、再解析，解析那一步就不需要「记住上一行的 key」这种状态。
 */
function unfoldContinuationLines(text: string): string[] {
  const lines: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') break
    if (raw.startsWith(' ') && lines.length > 0) {
      const last = lines.length - 1
      lines[last] = `${lines[last] ?? ''}${raw.slice(1)}`
      continue
    }
    lines.push(raw)
  }
  return lines
}

function parseManifest(text: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of unfoldContinuationLines(text)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    values.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  return values
}

/** manifest 里允许带引号（`MIDlet-1: "name", , "pkg.Cls"`），统一剥掉。 */
function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0]) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/** Java 全限定类名。放宽到 `$`（内部类）与数字开头之外的一切合法标识符。 */
const CLASS_NAME = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/

interface MidletOne {
  readonly name: string
  readonly mainClass: string
}

/**
 * 解析 `MIDlet-1`。
 *
 * MIDP 规定三段：`名称, 图标, 主类`。图标可以为空，但两个逗号必须在 ——
 * 只有两段的写法（省略图标）是错的，内核读到的也会是错的东西，所以拒掉。
 */
function parseMidletOne(value: string): MidletOne | null {
  const parts = value.split(',')
  if (parts.length !== 3) return null
  const mainClass = unquote(parts[2] ?? '')
  if (!mainClass || mainClass.length > 200 || !CLASS_NAME.test(mainClass)) return null
  return { name: unquote(parts[0] ?? ''), mainClass }
}

/** `pkg.Cls` 在包里就是 `pkg/Cls.class`。大小写不敏感地兜一次。 */
function hasMainClass(entries: readonly CentralEntry[], mainClass: string): boolean {
  const wanted = `${mainClass.replace(/\./g, '/')}.class`
  if (entries.some((entry) => entry.name === wanted)) return true
  const lower = wanted.toLowerCase()
  return entries.some((entry) => entry.name.toLowerCase() === lower)
}

function fail(problem: JarProblem): JarInspection {
  return { ok: false, problem, info: null }
}

/**
 * 检查一个 JAR。
 *
 * 只读 `META-INF/MANIFEST.MF` 一个条目的内容，其余条目只取名字 ——
 * 大类库不会被解压，所以「一个 16 MB 的包里有 3000 个 class」不会拖慢导入。
 */
export async function inspectJar(bytes: Uint8Array): Promise<JarInspection> {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const eocd = findEocd(view)
    if (eocd === null) return fail('not-zip')

    const entries = readCentralDirectory(view, eocd)
    if (!entries) return fail('not-zip')

    // JAR 规范写的是全大写，但确实存在小写实现。
    const manifest = entries.find((entry) => entry.name.toUpperCase() === MANIFEST_NAME)
    if (!manifest) return fail('no-manifest')
    if (manifest.compressedSize > MAX_MANIFEST_COMPRESSED) return fail('manifest-too-large')

    const raw = readEntryData(view, manifest)
    if (!raw) return fail('no-manifest')

    let data: Uint8Array | 'too-large' | null
    if (manifest.method === 0) {
      data = raw.byteLength > MAX_MANIFEST_BYTES ? 'too-large' : raw
    } else if (manifest.method === 8) {
      data = await inflateLimited(raw, MAX_MANIFEST_BYTES)
    } else {
      // 其他压缩方法（bzip2 / lzma）在 J2ME 包里几乎不存在；
      // 真遇到就当读不出来，不值得为它引解压器。
      return fail('no-manifest')
    }
    if (data === 'too-large') return fail('manifest-too-large')
    if (!data) return fail('no-manifest')

    const values = parseManifest(new TextDecoder().decode(data))
    const midletOne = values.get('MIDlet-1')
    if (!midletOne) return fail('no-midlet')
    const parsed = parseMidletOne(midletOne)
    if (!parsed) return fail('bad-midlet')
    if (!hasMainClass(entries, parsed.mainClass)) return fail('missing-class')

    const name = (values.get('MIDlet-Name') ?? '').trim() || parsed.name
    return {
      ok: true,
      problem: null,
      info: {
        name,
        vendor: unquote(values.get('MIDlet-Vendor') ?? ''),
        mainClass: parsed.mainClass,
      },
    }
  } catch {
    // 结构畸形（越界、长度不符、签名乱）都走这里。
    return fail('not-zip')
  }
}
