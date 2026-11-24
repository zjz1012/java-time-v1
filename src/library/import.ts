/**
 * 导入本地 JAR。
 *
 * 这是用户能自己塞文件进来的入口，所以和存档导入一样按「不可信输入」处理：
 * 先看体积、再看魔数、再算指纹，全部通过才写库。**不解析 JAR 里的类结构** ——
 * 内核自己会做类解析并给出可读的失败，我们在这里重复一遍只会多一套错误码。
 *
 * 唯一的例外是 `META-INF/MANIFEST.MF`：读它只为拿显示名（`MIDlet-Name`）。
 * 用户导入 `sokoban.jar` 时卡片上写「sokoban」很怪，包里的真名是「推箱子」。
 * 这件事放在 `manifest.ts` 里，任何一步不合预期都退回文件名，绝不打断导入。
 */
import { isFingerprint, sha256Hex } from '@/shared/hash'

import { readMidletInfo } from './manifest'
import { IMPORTED_CATEGORY } from './types'
import type { ImportDraft } from './store'

/**
 * 单个导入包的上限。
 *
 * 实测那 104 款内置游戏的包体在 10~60 KB 之间；J2ME 时代的商业作品也很少
 * 超过 2 MB。给到 16 MiB 是「明显异常」的分界线，而不是「用户真的存了很多」。
 */
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024

/** 标题来自文件名，别让一个超长文件名把卡片撑破。 */
const MAX_TITLE_CHARS = 64
const DEFAULT_TITLE = '未命名程序'
const DEFAULT_AUTHOR = '本地导入'

export type ImportErrorCode = 'empty' | 'too-large' | 'not-archive' | 'id-conflict'

export class ImportError extends Error {
  readonly code: ImportErrorCode

  constructor(code: ImportErrorCode, message: string) {
    super(message)
    this.name = 'ImportError'
    this.code = code
  }
}

/** 导入游戏的 id：`user-` + 指纹前 16 位十六进制。 */
export function importedId(fingerprint: string): string {
  return `user-${fingerprint.slice('sha256:'.length, 'sha256:'.length + 16)}`
}

/**
 * 清洗一个候选标题：去控制字符、折叠空白、限长。
 *
 * 空结果返回空串而不是默认名 —— 调用方需要区分「这里本来没名字」与
 * 「清理之后没名字」，前者要退回另一个来源（文件名）。
 */
function cleanTitle(value: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned.length > MAX_TITLE_CHARS ? `${cleaned.slice(0, MAX_TITLE_CHARS - 1)}…` : cleaned
}

/**
 * 文件名 → 标题（manifest 里没有名字时的兜底）。
 *
 * 去掉扩展名（`.jar` / `.jad` / `.data` 都算），折叠空白，去掉控制字符。
 * 全空时给一个默认名 —— 卡片上留白比写「未命名」更让人困惑。
 */
export function titleFromFilename(name: string): string {
  return cleanTitle(name.replace(/\.(jar|jad|data|zip)$/i, '')) || DEFAULT_TITLE
}

/**
 * JAR 就是 ZIP，本地文件头固定以 `PK\x03\x04` 开头。
 *
 * 只认这四字节而不是「尝试解析整个 ZIP」：目的只是把「用户选错了文件」
 * （图片、文档、空文件）在写库之前挡掉，具体类能不能跑是内核的事。
 */
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

export interface ParsedImport extends ImportDraft {
  /** 库里已有同 id 但指纹不同的游戏时为 true，调用方据此决定是覆盖还是拒绝。 */
  readonly replacesExisting: boolean
}

/**
 * 读文件、校验、算指纹。**不写库** —— 写不写由调用方决定。
 *
 * 指纹算不出来就拒绝导入，而不是先用文件名凑合：指纹是存档的隔离键，
 * 没有它就等于这款游戏的存档没有名字。
 */
export async function parseJarFile(file: File, existingIds: readonly string[]): Promise<ParsedImport> {
  if (file.size === 0) {
    throw new ImportError('empty', '这个文件是空的')
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportError(
      'too-large',
      `程序包超过上限（${(file.size / 1024 / 1024).toFixed(1)} MB > ${MAX_IMPORT_BYTES / 1024 / 1024} MB）`,
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!looksLikeZip(bytes)) {
    throw new ImportError('not-archive', '这不是 JAR 文件（JAR 本质是 ZIP，文件头不符）')
  }

  const fingerprint = await sha256Hex(bytes)
  if (!isFingerprint(fingerprint)) {
    // 理论上不会发生（sha256Hex 要么给真摘要、要么抛错），但指纹格式一旦
    // 放宽，存档就会落到非法键上 —— 这条断言比事后排查便宜。
    throw new ImportError('not-archive', '无法确定这个程序包的身份指纹')
  }

  const id = importedId(fingerprint)

  /*
   * 显示名优先用 manifest 里的 MIDlet-Name，读不到再退回文件名。
   *
   * 顺序不能反：文件名是用户随手起的（`sokoban.jar`），manifest 才是作者写的
   * （「推箱子」）。反过来会让同一个包在不同人机器上显示成不同名字。
   */
  const info = await readMidletInfo(bytes)
  const title = cleanTitle(info?.name ?? '') || titleFromFilename(file.name)
  const author = cleanTitle(info?.vendor ?? '') || DEFAULT_AUTHOR

  return {
    id,
    title,
    subtitle: '本地导入',
    author,
    category: IMPORTED_CATEGORY,
    fingerprint,
    importedAt: Date.now(),
    bytes,
    replacesExisting: existingIds.includes(id),
  }
}

/**
 * 写入前检查 id 冲突。
 *
 * 同一个 id 且同一个指纹 = 用户又导了一遍同一个包，覆盖即可（无副作用）。
 * 同一个 id 但指纹不同 = 16 位前缀撞了，两款的存档键不同却会共用一个库条目，
 * 覆盖就会让其中一款的「最近游玩」挂到另一款头上 —— 直接拒绝，让人重命名文件。
 *
 * 只要求 id 与指纹两个字段：调用方在「已经拿到 ParsedImport」和「正在校验
 * 一份草稿」两种时机都会用到它，收窄参数比多造一个类型实在。
 */
export function assertNoConflict(
  candidate: { readonly id: string; readonly fingerprint: string },
  existing: readonly { readonly id: string; readonly fingerprint: string }[],
): void {
  const sameId = existing.find((game) => game.id === candidate.id)
  if (sameId && sameId.fingerprint !== candidate.fingerprint) {
    throw new ImportError(
      'id-conflict',
      '这款程序包的内部标识与已导入的另一款冲突，请改个文件名后重试',
    )
  }
}
