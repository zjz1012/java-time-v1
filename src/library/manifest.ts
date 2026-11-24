/**
 * 从 JAR 里读 `META-INF/MANIFEST.MF` 的 `MIDlet-Name` / `MIDlet-Vendor`。
 *
 * 为什么值得为此写一遍 ZIP 结构：用户导入 `sokoban.jar`，卡片上显示「sokoban」
 * 会很怪 —— 包里的真名明明是「推箱子」。文件名是用户随手起的，manifest 才是
 * 作者写的。
 *
 * 只做「读一个条目」这一件事，不建通用解压器：
 *   - 从 EOCD 拿中央目录，找 MANIFEST.MF 那一条；
 *   - 按它的本地头定位数据，STORE 直接用，DEFLATE 交给 `DecompressionStream`；
 *   - 任何一步不合预期就返回 null，**不抛错**。
 *
 * 失败一律降级到文件名。导入的主流程不能因为「这个 JAR 的 manifest 有点怪」
 * 而中断 —— 能不能跑是内核的判断，这里只是取个显示名。
 */

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
/** EOCD 固定 22 字节，后面跟最多 65535 字节注释。 */
const EOCD_MIN = 22
const EOCD_MAX_COMMENT = 0xffff
const MANIFEST_NAME = 'META-INF/MANIFEST.MF'

export interface MidletInfo {
  readonly name: string
  readonly vendor: string
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

interface LocatedEntry {
  readonly method: number
  readonly compressedSize: number
  readonly localOffset: number
}

/** 在中央目录里找 manifest 那一条。找不到返回 null。 */
function findManifestEntry(view: DataView, eocd: number): LocatedEntry | null {
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > view.byteLength) return null
    if (view.getUint32(offset, true) !== CENTRAL_SIG) return null

    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const nameStart = offset + 46
    if (nameStart + nameLength > view.byteLength) return null

    const name = decoder.decode(
      new Uint8Array(view.buffer, view.byteOffset + nameStart, nameLength),
    )
    // JAR 规范写的是全大写，但确实存在小写实现；反正这一步只是为了取名字。
    if (name.toUpperCase() === MANIFEST_NAME) {
      return {
        method: view.getUint16(offset + 10, true),
        compressedSize: view.getUint32(offset + 20, true),
        localOffset: view.getUint32(offset + 42, true),
      }
    }

    offset = nameStart + nameLength + extraLength + commentLength
  }
  return null
}

/** 按本地头算出真实数据起点 —— 中央目录里的偏移指的是本地头，不是数据。 */
function readEntryData(view: DataView, entry: LocatedEntry): Uint8Array | null {
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

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
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
        // 直接交出去会把 manifest 之外的数据也送进解压流。manifest 只有几百
        // 字节，这次复制的代价可以忽略。
        controller.enqueue(new Uint8Array(bytes))
        controller.close()
      },
    })
    const stream = source.pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    // 数据不是合法的 deflate：当作没有 manifest 处理，由调用方退回文件名。
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

/**
 * 读 MIDlet 信息。读不到就返回 null，由调用方用文件名兜底。
 */
export async function readMidletInfo(bytes: Uint8Array): Promise<MidletInfo | null> {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const eocd = findEocd(view)
    if (eocd === null) return null

    const entry = findManifestEntry(view, eocd)
    if (!entry) return null

    const raw = readEntryData(view, entry)
    if (!raw) return null

    let data: Uint8Array | null
    if (entry.method === 0) {
      data = raw
    } else if (entry.method === 8) {
      data = await inflateRaw(raw)
    } else {
      // 其他压缩方法（bzip2 / lzma）在 J2ME 包里几乎不存在；
      // 真遇到就当没有 manifest，不值得为它引解压器。
      return null
    }
    if (!data) return null

    const values = parseManifest(new TextDecoder().decode(data))
    const name = (values.get('MIDlet-Name') ?? '').trim()
    if (!name) return null
    return { name, vendor: (values.get('MIDlet-Vendor') ?? '').trim() }
  } catch {
    // 结构畸形（越界、长度不符、签名乱）都走这里。
    return null
  }
}
