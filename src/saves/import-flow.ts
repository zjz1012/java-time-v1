/**
 * 「导入存档」的编排。
 *
 * 单独抽出来是因为它有一条**顺序不能错**的时序，而错法的表现是「界面说
 * 导入成功，退出后存档又变回去了」——看上去像导入没生效，实际是旧数据在
 * 退出时把新数据覆盖了：
 *
 *   游戏还在跑 → 内核里是旧存档 → 写归档（新）
 *   → 静默期/退出快照（旧）→ 覆盖归档
 *
 * 所以只要游戏在跑，就必须先停下来、等最后一份快照归档完，再写导入、
 * 再重启恢复。写成纯函数是为了让这个顺序能被测试钉住，而不是只靠注释。
 */
import type { RuntimeState } from '@/runtime/types'

import type { UnpackResult } from './format'

/**
 * 「内核正在占用」的状态 —— 导入必须先把它们停下来。
 *
 * `starting` 也算：此时内核已经在装配，退出时同样会交快照。
 * `stopping` 也算：停止正在进行，此时写归档会被随后到达的退出快照覆盖。
 *
 * `loading` / `ready` 不在内：那一刻内核的 fs 还没装配，停它只会让宿主交一份
 * **空**快照，把归档删掉。运行页对这两个状态直接拒绝导入（提示「等画面出来」），
 * 而不是在这里硬撑。
 */
const LIVE_STATES: readonly RuntimeState[] = ['starting', 'running', 'paused', 'stopping']

export interface ImportHandlers {
  /** 让当前运行停下来，并**等退出快照写完归档**。 */
  readonly stop: () => Promise<void>
  /** 把已校验的包写进归档。 */
  readonly apply: () => Promise<void>
  /** 重新启动，让内核从刚写入的归档恢复。 */
  readonly relaunch: () => void
}

export type ImportOutcome =
  /** 包属于别的游戏：只写归档，不动当前这局。 */
  | { readonly kind: 'foreign'; readonly displayName: string }
  /** 包属于当前游戏且游戏在跑：已停下、写入并重启。 */
  | { readonly kind: 'restarted'; readonly displayName: string }
  /** 包属于当前游戏但游戏没在跑：写完等下次启动生效。 */
  | { readonly kind: 'pending'; readonly displayName: string }

/**
 * 这次导入会不会影响正在运行的游戏。
 *
 * 界面用它决定「选完文件就直接导入」还是「先弹确认再导入」：
 * 后者会打断用户当前的进度，必须由人点一下头。
 */
export function needsRestart(
  state: RuntimeState,
  currentFingerprint: string,
  parsed: Pick<UnpackResult, 'manifest'>,
): boolean {
  return (
    parsed.manifest.fingerprint === currentFingerprint && LIVE_STATES.includes(state)
  )
}

/**
 * 这个状态下能不能导入存档。
 *
 * `idle` / `loading` / `ready` 都拒绝：内核的 fs 还没装配，停它只会拿到一份
 * 空快照（那会把归档删掉），而继续跑则会在启动完成后用旧档覆盖导入结果。
 * 这两种结局都比「等一下再导入」糟，所以运行页直接提示等画面出来。
 */
export function canImport(state: RuntimeState): boolean {
  return state !== 'idle' && state !== 'loading' && state !== 'ready'
}

/**
 * 执行导入。
 *
 * 调用前提：包已经过 `unpackSave` 校验（**校验通过之前不碰归档**），
 * 且 `canImport(state)` 为 true。
 * 顺序：stop → apply → relaunch，三步都不能调换：
 *   - 先 apply 再 stop：退出快照会把刚写入的档覆盖回去；
 *   - 先 relaunch 再 apply：新实例恢复的还是旧归档。
 */
export async function importSavePackage(
  parsed: UnpackResult,
  currentFingerprint: string,
  state: RuntimeState,
  handlers: ImportHandlers,
): Promise<ImportOutcome> {
  const displayName = parsed.manifest.displayName

  if (parsed.manifest.fingerprint !== currentFingerprint) {
    // 别的游戏的档：存到它自己名下，当前这局完全不受影响，也不需要重启。
    await handlers.apply()
    return { kind: 'foreign', displayName }
  }

  if (LIVE_STATES.includes(state)) {
    await handlers.stop()
    await handlers.apply()
    handlers.relaunch()
    return { kind: 'restarted', displayName }
  }

  await handlers.apply()
  return { kind: 'pending', displayName }
}
