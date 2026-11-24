import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from 'react'

import { attachKeyboardInput } from '@/input/keyboard'
import { DEFAULT_KEYMAP, KEYMAP_HINT } from '@/input/keymap'
import { LIBRARY_HASH, type GameLaunch } from '@/library'
import { describeJarProblem, inspectJar } from '@/library/jar'
import { libraryRepository } from '@/library/instance'
import {
  PluotSorbetRuntime,
  RuntimeFailure,
  describeErrorCode,
  describeFailure,
  type InputControl,
  type KeyPhase,
  type RuntimeState,
  type SaveFile,
} from '@/runtime'
import {
  archiveFailureOf,
  canImport,
  describeArchiveFailure,
  importSavePackage,
  needsRestart,
} from '@/saves'
import type { ArchiveFailure, ImportOutcome, UnpackResult } from '@/saves'
import { saveService } from '@/saves/instance'
import { sha256Hex } from '@/shared/hash'
import { Keypad } from './Keypad'

interface PlayerScreenProps {
  /**
   * 启动一款游戏需要的一切：标题、期望指纹、以及「怎么把字节读出来」。
   *
   * 运行页刻意不知道自己玩的是内置包还是用户导入的 —— 两者的差异收在
   * `library/entries.ts` 里，这里只剩一条路径。
   */
  readonly launch: GameLaunch
}

const STATE_LABEL: Record<RuntimeState, string> = {
  idle: '空闲',
  loading: '加载中',
  ready: '已就绪',
  starting: '启动中',
  running: '运行中',
  paused: '已暂停',
  stopping: '正在停止',
  stopped: '已停止',
  failed: '失败',
}

/** 遮罩上要说人话：用户关心的是「还要不要等」，不是状态机的状态名。 */
const STATE_HINT: Record<RuntimeState, string> = {
  idle: '正在准备…',
  loading: '正在启动…',
  ready: '正在启动…',
  starting: '正在启动…',
  running: '正在启动…',
  paused: '已暂停',
  stopping: '正在停止…',
  stopped: '已停止',
  failed: '启动失败',
}

/**
 * 运行页。
 *
 * 它承担的职责只有「把一个程序包送进内核，然后让按键有地方可去」。
 * 游戏库、搜索、筛选都在库页；这里只认一个 `GameLaunch`。
 */
export function PlayerScreen({ launch }: PlayerScreenProps) {
  const { title: displayName, expectedFingerprint } = launch
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<PluotSorbetRuntime | null>(null)
  const [state, setState] = useState<RuntimeState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  // 重试靠递增这个 key 让下面的 effect 重跑一遍 —— 比 location.reload() 轻，
  // 而且会先 dispose 掉上一个实例（内核的 iframe 必须整个重建，状态收不回来）。
  const [attempt, setAttempt] = useState(0)

  const [fingerprint, setFingerprint] = useState<string | null>(null)
  const [canSave, setCanSave] = useState(false)
  const [savesOpen, setSavesOpen] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  /** 已校验、但在等用户确认「这会结束当前这局」的包。 */
  const [pendingImport, setPendingImport] = useState<UnpackResult | null>(null)
  /**
   * 最近一次归档写入失败。
   *
   * 不为空就意味着「界面上显示的进度」比「磁盘上的进度」新。这时候返回库页
   * 等于默默丢掉这一段，所以退出要先经过它（见 handleExit）。
   */
  const [archiveFailure, setArchiveFailure] = useState<ArchiveFailure | null>(null)
  /** 因为上次没存上，正在问「确定要放弃吗」。 */
  const [exitPrompt, setExitPrompt] = useState(false)
  /**
   * 问的时候游戏是不是已经停了。
   *
   * 两种时机走的是同一个对话框，但能给的出口不同：先问再停，用户还能「返回游戏」；
   * 停完才发现没存上，那就只剩下重试、导出、放弃 —— 这时候还摆一个「返回游戏」
   * 是骗人，内核已经关掉了。
   */
  const [exitStopped, setExitStopped] = useState(false)

  /**
   * 当前状态的最新值。
   *
   * 事件回调里的 `state` 是渲染时闭包捕获的：读文件/校验可能花几百毫秒，
   * 期间游戏可能从「加载中」变成「运行中」。用旧值判断「要不要先停下游戏」
   * 就会漏掉重启，于是导入被随后的退出快照覆盖回去。
   */
  const stateRef = useRef(state)
  stateRef.current = state

  /**
   * 归档写入是串行的。
   *
   * 必须串：静默期快照与退出快照可能前后脚到达，并发写同一个 key 会让
   * 「谁最后生效」取决于事务调度。串起来之后顺序就是事件顺序。
   * 退出时要等它清空才导航，否则最后一份快照会随页面卸载丢掉。
   */
  const archiveChain = useRef<Promise<void>>(Promise.resolve())
  /**
   * 开始写导入包之后，就不再归档旧实例的快照。
   *
   * `stop()` 等 `stopped` 只有 2 秒上限；万一超时返回，宿主那份「退出快照」
   * 可能晚到，把刚导入的档盖回去 —— 用户看到的是「导入成功，退出后又变回旧档」。
   */
  const suspendArchive = useRef(false)
  /**
   * 失败状态与退出询问的镜像。
   *
   * `handleExit` 的依赖数组是空的（它要能直接挂到 `<a>` 上，不该每次渲染都换一个
   * 函数引用），所以它读不到最新的 state。用 ref 读，才判得准「现在退出会不会
   * 丢进度」。
   */
  const archiveFailureRef = useRef<ArchiveFailure | null>(null)
  const exitPromptRef = useRef(false)
  exitPromptRef.current = exitPrompt

  /** 记一次失败。空快照走 `archiveFailureOf` 的 null 分支，只留日志。 */
  const recordArchiveFailure = useCallback((files: readonly SaveFile[], cause: unknown) => {
    const failure = archiveFailureOf(files, cause)
    if (!failure) {
      // 空快照 = 「删掉这个游戏的存档」，删不掉最多让旧档多留一局，
      // 不会丢数据 —— 不值得在界面上敲一声，但日志里要留。
      console.warn('[saves] 清空归档失败', cause)
      return
    }
    archiveFailureRef.current = failure
    setArchiveFailure(failure)
    console.warn('[saves] 归档写入失败', cause)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let detachKeyboard: (() => void) | undefined
    let detachSaves: (() => void) | undefined
    let runtime: PluotSorbetRuntime | null = null

    // 新一轮启动：恢复归档写入（上一轮可能因为「导入后重启」被挂起）。
    suspendArchive.current = false

    void (async () => {
      try {
        setState('loading')
        setMessage(null)

        const bytes = await launch.load()

        /*
         * 启动前先验包。走到这里的不只是「刚导入的包」—— 导入通道已经预检过，
         * 但还有两条路会送进坏包：
         *   1. `?jar=` 开发通道直接给一个路径，没人替它验；
         *   2. 库里的包体事后被截断或替换（部署换了文件、磁盘写了一半）。
         * 这两条路上，坏包的表现是「转十几秒，然后一句启动超时」，用户看不出
         * 是包的问题还是机器慢。判据与导入共用 `inspectJar`，不另写一套 ——
         * 两套判据迟早会走岔，而「导入时说能跑、点开说跑不了」是最难解释的错。
         *
         * 顺序也照导入那边：先验结构，再算指纹。整包 sha256 不值得为坏包算一遍。
         */
        const inspection = await inspectJar(bytes)
        if (disposed) return
        if (!inspection.ok) {
          throw new Error(
            `这个程序包无法启动：${describeJarProblem(inspection.problem, inspection.info?.mainClass)}`,
          )
        }

        /*
         * 指纹算不出来就**不要启动**，不是「先跑起来，存档以后再说」。
         *
         * 指纹是存档隔离键：没有它，恢复时不知道该灌哪份档，退出时也不知道该
         * 写到谁名下。跑起来的后果是游戏在别人的（或空的）档上玩，退出时再用
         * 这份错的数据覆盖归档 —— 比直接拒绝启动糟得多。
         */
        let contentHash: string
        try {
          contentHash = await sha256Hex(bytes)
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : '未知原因'
          throw new Error(
            `无法计算游戏内容指纹：${reason}。为避免不同游戏的存档互相覆盖，已停止启动。`,
            { cause },
          )
        }
        if (disposed) return

        /*
         * 与清单登记的指纹比对。
         *
         * 清单里的指纹是生成资产时算的。如果 `public/games` 下的文件被换过
         * （重新生成清单但没换资源、或者部署时缓存了旧文件），这里会不一致：
         * 继续启动的话，游戏会带着「新内容的指纹」去读「旧版本存的档」，
         * 两边结构不一定兼容。停在这里是唯一能保证不串档的位置。
         */
        if (expectedFingerprint && contentHash !== expectedFingerprint) {
          throw new Error(
            `程序包与清单登记的不一致（期望 ${briefHash(expectedFingerprint)}，` +
              `实际 ${briefHash(contentHash)}）。为避免读到别的版本留下的存档，已停止启动。`,
          )
        }
        setFingerprint(contentHash)

        /*
         * 取归档必须在启动之前，而且失败要**中止启动**而不是退化成一局空档。
         *
         * 退化看起来更友好，实际是破坏性的：空快照在宿主侧的含义是
         * 「清空内核现有的 RMS」，于是「读不到旧档」会变成「把旧档删了」。
         * 读不到就停下来说清楚，比默默把档抹掉好（F15 要求写失败不静默）。
         */
        const restore = await saveService.restore(contentHash)
        if (disposed) return

        runtime = new PluotSorbetRuntime({ container: host, keymap: DEFAULT_KEYMAP })
        runtimeRef.current = runtime
        runtime.on('statechange', (event) => {
          if (!disposed) setState(event.current)
        })
        runtime.on('error', (event) => {
          // 带上宿主给的原因：存档恢复失败时，「关掉别的标签页」和「清理站点数据」
          // 是完全不同的动作，只给一句「内部错误」等于让人无从下手。
          if (!disposed) setMessage(describeErrorCode(event.code, event.message))
        })

        // 快照可能来自三处：静默期、退出前、手动导出。全都落归档 ——
        // 这份归档就是下次启动时灌回内核的东西（见 ADR 0005）。
        detachSaves = runtime.on('saves', (event) => {
          // 已经在写导入的包了：这份迟到的快照属于旧局面，写进去会盖掉导入结果。
          if (suspendArchive.current) return
          const files = event.files
          archiveChain.current = archiveChain.current
            .then(() => saveService.archive(contentHash, displayName, files))
            .then(() => {
              /*
               * 只在「真的写进了东西」之后清掉失败标记。
               *
               * 空快照成功只说明「库里现在没有这份档」，不代表用户那份进度已经
               * 落盘 —— 内核在某次退出时读空 RMS 就会给出空快照。拿它清标记，
               * 等于用一次「什么都没写」证明「写成功了」。
               */
              if (files.length > 0) {
                archiveFailureRef.current = null
                setArchiveFailure(null)
              }
            })
            .catch((cause: unknown) => recordArchiveFailure(files, cause))
        })

        // 先挂键盘再启动：启动过程有几秒是黑屏，用户这时候按方向键
        // 不该被当成「网页滚了一下」。
        detachKeyboard = attachKeyboardInput({
          keymap: DEFAULT_KEYMAP,
          send: (control, phase) => runtime?.sendKey(control, phase) ?? false,
        })

        await runtime.load({ fingerprint: contentHash, displayName, bytes }, { restore })
        if (disposed) return
        // 能力在 host:ready 之后才准确，所以只能在这里读，不能在渲染时读。
        setCanSave(runtime.capabilities.saves)

        // 内核把 #display 的尺寸当作物理屏幕尺寸，容器为 0 会得到 0×0 画布。
        // 这里再确认一次，把「布局还没算完」变成一个可读的失败，而不是一张黑图。
        if (host.clientWidth === 0 || host.clientHeight === 0) {
          throw new Error('运行区尺寸为 0，无法确定屏幕分辨率')
        }

        await runtime.start()

        // 「玩过」记在启动成功之后：启动就失败的游戏不该出现在「最近玩过」里。
        // 不阻塞启动，失败也只是少一条记录 —— 不值得让画面等它。
        if (launch.trackPlay !== false) {
          void libraryRepository.recordPlay(launch.id, Date.now()).catch(() => {
            // 记录失败不影响玩；下一局还会再记一次。
          })
        }
      } catch (cause) {
        if (disposed) return
        setState('failed')
        setMessage(toUserMessage(cause))
      }
    })()

    return () => {
      disposed = true
      detachKeyboard?.()
      detachSaves?.()
      runtimeRef.current = null
      void runtime?.dispose()
    }
    // 依赖 `launch.id` 而不是整个 `launch`：调用方每次渲染都可能重建对象，
    // 按对象比较会让 effect 反复重跑，表现成「游戏启动到一半又重启」。
  }, [launch.id, attempt, recordArchiveFailure])

  const sendKey = useCallback((control: InputControl, phase: KeyPhase) => {
    runtimeRef.current?.sendKey(control, phase)
  }, [])

  /**
   * 退出。
   *
   * 顺序不能省：`stop()` 会让宿主先把快照发出来，归档写入排在
   * `archiveChain` 里；不等它清空就导航，最后一份快照会随页面卸载丢掉。
   *
   * 但**已知写不进去时先别停**：停了再问，用户点「返回游戏」也没有游戏可回。
   * 所以分两段判：进去先看已知失败，停完再看这一轮退出快照的结果。
   * `force` 只给「放弃并退出」用 —— 那是用户明确说不要这份进度了。
   */
  const leaveGame = useCallback(async (force = false) => {
    if (!force && archiveFailureRef.current) {
      setExitStopped(false)
      setExitPrompt(true)
      return
    }
    try {
      await runtimeRef.current?.stop()
    } catch {
      // 停不下来也得让用户走：内核没有优雅退出路径，卸载时 dispose 兜底。
    }
    await archiveChain.current
    if (!force && archiveFailureRef.current) {
      setExitStopped(true)
      setExitPrompt(true)
      return
    }
    goLibrary()
  }, [])

  const handleExit = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
      void leaveGame()
    },
    [leaveGame],
  )

  /**
   * 重试写入。成功就继续退出（如果是从退出询问里点的），失败则更新提示。
   *
   * 用 `failure.files` 而不是再去问内核要一份：内核此刻可能已经停了，
   * 而且我们要抢救的正是那一刻的快照。
   */
  const retryArchive = useCallback(async () => {
    const failure = archiveFailureRef.current
    if (!failure || !fingerprint) return
    setSaveBusy(true)
    setSaveNote(null)
    try {
      await saveService.archive(fingerprint, displayName, failure.files)
      archiveFailureRef.current = null
      setArchiveFailure(null)
      if (exitPromptRef.current) {
        // 存上了就接着走正常退出：还会再取一份退出快照，那条路也会照常判一次。
        setExitPrompt(false)
        await leaveGame()
        return
      }
      setSaveNote('存档已重新保存')
    } catch (cause) {
      // 失败要看得见：同一个对话框里如果不更新任何东西，用户会以为点没生效。
      recordArchiveFailure(failure.files, cause)
      setSaveNote(`重试仍然失败：${describeArchiveFailure(cause).message}`)
    } finally {
      setSaveBusy(false)
    }
  }, [fingerprint, displayName, recordArchiveFailure, leaveGame])

  /**
   * 紧急导出。
   *
   * 走 `exportFiles`（直接打包内存里那份快照），不碰仓储 —— 仓储正是刚刚
   * 写不进去的那个东西。要是绕回去读库，导出来的会是旧档：用户拿到一个
   * 「看起来救回来了」的文件，实际少了这一段进度。
   */
  const exportFailedSnapshot = useCallback(async () => {
    const failure = archiveFailureRef.current
    if (!failure || !fingerprint) return
    setSaveBusy(true)
    setSaveNote(null)
    try {
      const blob = await saveService.exportFiles(fingerprint, displayName, failure.files)
      downloadBlob(blob, `${displayName}-存档（未保存）.zip`)
      setSaveNote('已下载这份进度。留好它，之后可以从「导入存档」恢复')
    } catch (cause) {
      setSaveNote(`导出也失败了：${toUserMessage(cause)}`)
    } finally {
      setSaveBusy(false)
    }
  }, [fingerprint, displayName])

  /**
   * 确认放弃。
   *
   * 只有走到这里才算「用户知道要丢」。`force` 是有意的：清了标记再走一遍
   * 普通退出，退出快照仍会试着写一次，写失败还会把对话框弹回来 —— 那等于
   * 用户点了「放弃」却又被问一遍。
   */
  const confirmDiscard = useCallback(() => {
    archiveFailureRef.current = null
    setArchiveFailure(null)
    setExitPrompt(false)
    void leaveGame(true)
  }, [leaveGame])

  const cancelExit = useCallback(() => setExitPrompt(false), [])

  const handleExport = useCallback(async () => {
    if (!fingerprint) return
    setSaveBusy(true)
    setSaveNote(null)
    try {
      // 先让内核交一份实时快照：静默期归档有约 4 秒滞后，
      // 用户刚存完档就点导出时不能等那个周期。
      const runtime = runtimeRef.current
      if (runtime?.currentState() === 'running') {
        const files: readonly SaveFile[] = await runtime.snapshot()
        await saveService.archive(fingerprint, displayName, files)
      }

      const blob = await saveService.exportZip(fingerprint, displayName)
      if (!blob) {
        setSaveNote('这个游戏还没有写过存档')
        return
      }
      downloadBlob(blob, `${displayName}-存档.zip`)
      setSaveNote('存档已导出')
    } catch (cause) {
      setSaveNote(toUserMessage(cause))
    } finally {
      setSaveBusy(false)
    }
  }, [fingerprint, displayName])

  const handleImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      // 清空 value：同一个文件连选两次也要能再次触发 change。
      event.target.value = ''
      if (!file) return

      if (!fingerprint) {
        setSaveNote('游戏还在准备，稍后再导入')
        return
      }

      setSaveBusy(true)
      setSaveNote(null)
      setPendingImport(null)
      try {
        // 校验通过之前不碰归档（见 saves/format.ts 的说明）。
        const parsed = await saveService.readZip(file)

        /*
         * 内核还在装配：此时既不能写（会被启动后的旧档覆盖），也不能停
         * （宿主会交一份空快照，等于把归档删掉）。等一下再导入。
         */
        if (!canImport(stateRef.current)) {
          setSaveNote('游戏还在启动，等画面出来后再导入')
          return
        }

        /*
         * 会打断当前这局时，先问人再动手。
         *
         * 直接把档写进归档是「看起来成功」的做法：游戏还在跑，内核里是旧档，
         * 退出快照随后把刚写入的档覆盖回去 —— 用户第二天打开发现进度回到导入前。
         */
        if (needsRestart(stateRef.current, fingerprint, parsed)) {
          setPendingImport(parsed)
          return
        }

        const outcome = await importSavePackage(parsed, fingerprint, stateRef.current, {
          // 上面刚用同一个状态判断过「不需要重启」，这两个回调不会执行。
          stop: () => Promise.reject(new Error('当前不需要停止运行')),
          apply: () => saveService.applyImport(parsed.manifest, parsed),
          relaunch: () => undefined,
        })
        setSaveNote(importNote(outcome))
      } catch (cause) {
        setSaveNote(toUserMessage(cause))
      } finally {
        setSaveBusy(false)
      }
    },
    [fingerprint],
  )

  /**
   * 确认导入（会结束当前这局）。
   *
   * 顺序由 `importSavePackage` 固定：停 → 等退出快照归档 → 写导入 → 重启。
   * 这里只负责把「停」与「重启」接到运行时上。
   */
  const confirmImport = useCallback(async () => {
    const parsed = pendingImport
    if (!parsed || !fingerprint) return

    setSaveBusy(true)
    setSaveNote(null)
    try {
      const outcome = await importSavePackage(parsed, fingerprint, stateRef.current, {
        stop: async () => {
          try {
            await runtimeRef.current?.stop()
          } catch {
            // 停不下来也要继续：内核没有优雅退出路径，卸载时 dispose 兜底。
          }
          // `stop()` 只保证宿主发出了快照，落盘是异步的。不等它就写导入的话，
          // 退出快照会排在导入之后，把刚写入的档盖回旧内容。
          await archiveChain.current
        },
        apply: async () => {
          // 从这一刻起旧实例的迟到快照不再写归档（见 suspendArchive 的注释）。
          suspendArchive.current = true
          await saveService.applyImport(parsed.manifest, parsed)
        },
        relaunch: () => setAttempt((n) => n + 1),
      })
      setPendingImport(null)
      setSaveNote(importNote(outcome))
    } catch (cause) {
      setSaveNote(toUserMessage(cause))
    } finally {
      setSaveBusy(false)
    }
  }, [pendingImport, fingerprint])

  const cancelImport = useCallback(() => {
    setPendingImport(null)
    setSaveNote(null)
  }, [])

  const running = state === 'running'
  // 暂停时画面还有内容，遮住反而让人以为崩了；其余状态画面都是黑的。
  const covered = !running && state !== 'paused'

  return (
    <main className="player">
      <header className="player__bar">
        <h1 className="player__title">{displayName}</h1>
        {/* 状态和标题同一行：徽标本来只有两个字，独占一行等于从画面里切走 20px。 */}
        <span className={`badge badge--${running ? 'ok' : state === 'failed' ? 'bad' : 'wait'}`}>
          {STATE_LABEL[state]}
        </span>
        {/* 能力门禁：内核不声明存档能力就不显示这个入口，而不是让人点了才发现不行。 */}
        {canSave ? (
          <button
            type="button"
            className="player__save"
            aria-expanded={savesOpen}
            onClick={() => setSavesOpen((open) => !open)}
          >
            存档
          </button>
        ) : null}
        <a className="player__exit" href={LIBRARY_HASH} onClick={handleExit}>
          返回
        </a>
      </header>

      {savesOpen ? (
        <div
          className={`player__saves${pendingImport ? ' player__saves--wide' : ''}`}
          role="group"
          aria-label="存档"
        >
          <button type="button" className="player__saves-item" disabled={saveBusy} onClick={handleExport}>
            导出存档
          </button>
          <label className={`player__saves-item${saveBusy ? ' player__saves-item--busy' : ''}`}>
            导入存档
            <input type="file" accept=".zip,application/zip" onChange={handleImport} />
          </label>
          {/*
            导入了当前游戏、而它正在跑：不能直接写归档（会被退出快照盖回去），
            所以在这里停下来问一句。三个出口都给出来，包括「先导出当前进度」。
          */}
          {pendingImport ? (
            <div className="player__saves-confirm" role="alertdialog" aria-label="导入确认">
              <p className="player__saves-warn">
                导入会结束当前游戏并替换它的存档。尚未导出的进度会被覆盖。
              </p>
              <button
                type="button"
                className="player__saves-item"
                disabled={saveBusy}
                onClick={handleExport}
              >
                先导出当前存档
              </button>
              <button
                type="button"
                className="player__saves-item player__saves-item--danger"
                disabled={saveBusy}
                onClick={confirmImport}
              >
                替换并重启
              </button>
              <button
                type="button"
                className="player__saves-item"
                disabled={saveBusy}
                onClick={cancelImport}
              >
                取消
              </button>
            </div>
          ) : null}
          {saveNote ? <p className="player__saves-note">{saveNote}</p> : null}
        </div>
      ) : null}

      {/* 遮罩已经显示过错误了，这里只在「运行中途出错」时才需要一行提示。 */}
      {message && !covered ? (
        <p className="player__error" role="alert">
          {message}
        </p>
      ) : null}

      <div className="player__stage">
        {/* 内核会被注入到这个 div 里。它的尺寸就是 J2ME 屏幕的分辨率。 */}
        <div className="player__screen" ref={hostRef} />

        {/*
          启动到出画之间有 2~4 秒是纯黑。什么都不显示的话，用户没法区分
          「还在加载」和「已经挂了」—— 这两种情况该做的事完全相反。
          遮罩盖在画面上而不是画面上方另起一块，是为了不给画面挤出高度。
        */}
        {/*
          写档失败要在玩游戏的时候就看得见，不能等到退出才拦人。
          但**不能插进 flex 流**：画面高度就是 J2ME 屏幕分辨率，多一行就把内核
          重新按新尺寸排一次（存档面板当年就是踩了这个坑，才做成绝对定位）。
          所以它浮在画面底部 —— 离键区最近，不挡顶部标题栏，也不和存档面板抢位置。
        */}
        {archiveFailure && !exitPrompt ? (
          <div className="player__alert" role="alert">
            <span className="player__alert-text">{archiveFailure.message}</span>
            <button
              type="button"
              className="player__alert-action"
              disabled={saveBusy}
              onClick={retryArchive}
            >
              重试
            </button>
          </div>
        ) : null}

        {covered ? (
          <div className="player__overlay" role="status">
            {state === 'failed' ? (
              <>
                <p className="player__overlay-msg player__overlay-msg--error">
                  {message ?? STATE_LABEL.failed}
                </p>
                <button
                  type="button"
                  className="player__retry"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  重试
                </button>
              </>
            ) : (
              <>
                <span className="player__spinner" aria-hidden="true" />
                <p className="player__overlay-msg">{STATE_HINT[state]}</p>
                {/* 转圈超过两秒就会开始让人怀疑是不是死了，先把「在等什么」说出来。 */}
                <p className="player__overlay-sub">首次启动要加载内核，约 5~10 秒</p>
              </>
            )}
          </div>
        ) : null}
      </div>

      <Keypad onControl={sendKey} />

      <p className="player__hint">{KEYMAP_HINT}</p>

      {/*
        退出前的最后一道确认。
        只有「最新一次归档确实没写成功」时才会出现 —— 它不是常规流程，
        所以做成整屏遮罩：这时候玩家正要离开，任何角落里的提示都会被忽略。
      */}
      {exitPrompt ? (
        <div
          className="player__dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="save-failed-title"
        >
          <div className="player__dialog-card">
            <h2 className="player__dialog-title" id="save-failed-title">
              存档没有保存成功
            </h2>
            <p className="player__dialog-text">
              {`${archiveFailure?.message ?? '这一局的进度没能写入本地存储'}。${
                exitStopped
                  ? '游戏已经停止，这一段进度还没存下来。'
                  : '现在退出，这一段进度会丢失。'
              }`}
            </p>
            {archiveFailure?.quota ? (
              <p className="player__dialog-hint">
                可以清理一些浏览器存储（或换更大的空间）后点「重试保存」。
              </p>
            ) : (
              <p className="player__dialog-hint">
                可以把这份进度导出成文件，之后从「导入存档」恢复。
              </p>
            )}
            {saveNote ? <p className="player__dialog-note">{saveNote}</p> : null}
            <div className="player__dialog-actions">
              <button
                type="button"
                className="player__saves-item player__saves-item--primary"
                disabled={saveBusy}
                onClick={retryArchive}
              >
                重试保存
              </button>
              <button
                type="button"
                className="player__saves-item"
                disabled={saveBusy}
                onClick={exportFailedSnapshot}
              >
                导出这次进度
              </button>
              {/* 游戏已经停了就没有「回到游戏」可给，摆出来等于骗人。 */}
              {exitStopped ? null : (
                <button
                  type="button"
                  className="player__saves-item"
                  disabled={saveBusy}
                  onClick={cancelExit}
                >
                  返回游戏
                </button>
              )}
              <button
                type="button"
                className="player__saves-item player__saves-item--danger"
                onClick={confirmDiscard}
              >
                放弃并退出
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

/**
 * 回库页。
 *
 * 优先走 hash 而不是整页跳转：库页的 104 条清单与封面已经在浏览器缓存里，
 * 整页刷新会把内核也重新装配一遍，退出反而要等好几秒。
 *
 * `?jar=` 这条开发通道必须改成整页跳转 —— 只改 hash 的话查询串还在，
 * App 又会把这一页判断成运行页，表现成「点了返回没反应」。
 */
function goLibrary(): void {
  if (new URLSearchParams(window.location.search).has('jar')) {
    window.location.href = window.location.pathname + LIBRARY_HASH
    return
  }
  window.location.hash = LIBRARY_HASH
}

/** 指纹只在前 8 位有意义，完整 64 位放进错误提示会读不下去。 */
function briefHash(fingerprint: string): string {
  return fingerprint.replace(/^sha256:/, '').slice(0, 8)
}

/**
 * 触发一次下载。
 *
 * `revokeObjectURL` 不能紧跟着 `click()`：浏览器是异步取 blob 的，
 * 立刻撤销会让下载拿到一个空文件。给 10 秒足够，且不影响内存
 * —— 用户不太可能在 10 秒里导出上百次。
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * 导入结果的提示语。
 *
 * 三种结果对应三种不同的「接下来会发生什么」，不能合并成一句「已导入」：
 * 导入别的游戏的档之后当前这局什么都没变，说「重新进入游戏后生效」会让人白等。
 */
function importNote(outcome: ImportOutcome): string {
  switch (outcome.kind) {
    case 'foreign':
      // 包里有它自己的指纹，就还给它的游戏 —— 不强行塞进当前游戏，
      // 否则「导入别人的档」会变成「把当前游戏的档换成别人的」。
      return `这份存档属于「${outcome.displayName}」，已存到它名下`
    case 'restarted':
      return `已导入「${outcome.displayName}」的存档，正在重新启动…`
    case 'pending':
      return '已导入，重新进入游戏后生效'
  }
}

/**
 * 两类错误分开处理：适配层已经准备了面向用户的措辞，直接用；
 * 其余的是我们自己的前置检查（HTTP 状态、容器尺寸），消息本身就是给用户看的。
 */
function toUserMessage(cause: unknown): string {
  if (cause instanceof RuntimeFailure) return describeFailure(cause)
  if (cause instanceof Error) return cause.message
  return '启动失败'
}
