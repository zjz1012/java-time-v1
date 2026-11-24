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
  canImport,
  createIdbRepository,
  createSaveService,
  importSavePackage,
  needsRestart,
} from '@/saves'
import type { ImportOutcome, UnpackResult } from '@/saves'
import { sha256Hex } from '@/shared/hash'
import { Keypad } from './Keypad'

/**
 * 仓储是模块级单例：`createIdbRepository` 只建闭包，不打开数据库
 * （首次读写才 open），所以放在模块顶层不会拖慢首屏，也不会在
 * 没有 IndexedDB 的环境里立刻炸。
 */
const saveService = createSaveService(createIdbRepository())

interface PlayerScreenProps {
  /** 程序包地址。阶段 1 由 URL 参数指定，阶段 2 由游戏库提供 */
  readonly jarUrl: string
  readonly displayName: string
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
 * 运行页。阶段 1 的形态：画面 + 键区 + 状态。
 *
 * 它承担的职责只有「把一个 JAR 送进内核，然后让按键有地方可去」。
 * 游戏库、存档、倍速都在后面，这里刻意不做。
 */
export function PlayerScreen({ jarUrl, displayName }: PlayerScreenProps) {
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

        const response = await fetch(jarUrl)
        if (!response.ok) {
          throw new Error(`程序包请求失败（HTTP ${response.status}）`)
        }
        const bytes = new Uint8Array(await response.arrayBuffer())

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
            .catch((cause: unknown) => {
              console.warn('[saves] 归档写入失败', cause)
            })
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
  }, [jarUrl, displayName, attempt])

  const sendKey = useCallback((control: InputControl, phase: KeyPhase) => {
    runtimeRef.current?.sendKey(control, phase)
  }, [])

  /**
   * 退出。
   *
   * 顺序不能省：`stop()` 会让宿主先把快照发出来，归档写入排在
   * `archiveChain` 里；不等它清空就导航，最后一份快照会随页面卸载丢掉。
   */
  const handleExit = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    void (async () => {
      try {
        await runtimeRef.current?.stop()
      } catch {
        // 停不下来也得让用户走：内核没有优雅退出路径，卸载时 dispose 兜底。
      }
      await archiveChain.current
      window.location.href = location.pathname
    })()
  }, [])

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
        <a className="player__exit" href={location.pathname} onClick={handleExit}>
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
    </main>
  )
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
