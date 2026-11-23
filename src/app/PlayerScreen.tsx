import { useCallback, useEffect, useRef, useState } from 'react'

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
} from '@/runtime'
import { Keypad } from './Keypad'

interface PlayerScreenProps {
  /** 程序包地址。阶段 1 由 URL 参数指定，阶段 2 由游戏库提供 */
  readonly jarUrl: string
  readonly displayName: string
}

const STATE_LABEL: Record<RuntimeState, string> = {
  idle: '空闲',
  loading: '加载中',
  ready: '已就绪',
  running: '运行中',
  paused: '已暂停',
  stopping: '正在停止',
  stopped: '已停止',
  failed: '失败',
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

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let detachKeyboard: (() => void) | undefined
    let runtime: PluotSorbetRuntime | null = null

    void (async () => {
      try {
        setState('loading')
        setMessage(null)

        const response = await fetch(jarUrl)
        if (!response.ok) {
          throw new Error(`程序包请求失败（HTTP ${response.status}）`)
        }
        const bytes = new Uint8Array(await response.arrayBuffer())
        const fingerprint = await sha256(bytes)
        if (disposed) return

        runtime = new PluotSorbetRuntime({ container: host, keymap: DEFAULT_KEYMAP })
        runtimeRef.current = runtime
        runtime.on('statechange', (event) => {
          if (!disposed) setState(event.current)
        })
        runtime.on('error', (event) => {
          if (!disposed) setMessage(describeErrorCode(event.code))
        })

        // 先挂键盘再启动：启动过程有几秒是黑屏，用户这时候按方向键
        // 不该被当成「网页滚了一下」。
        detachKeyboard = attachKeyboardInput({
          keymap: DEFAULT_KEYMAP,
          send: (control, phase) => runtime?.sendKey(control, phase) ?? false,
        })

        await runtime.load({ fingerprint, displayName, bytes })
        if (disposed) return

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
      runtimeRef.current = null
      void runtime?.dispose()
    }
  }, [jarUrl, displayName])

  const sendKey = useCallback((control: InputControl, phase: KeyPhase) => {
    runtimeRef.current?.sendKey(control, phase)
  }, [])

  const running = state === 'running'

  return (
    <main className="player">
      <header className="player__bar">
        <div className="player__meta">
          <h1>{displayName}</h1>
          <p>
            <span className={`badge badge--${running ? 'ok' : state === 'failed' ? 'bad' : 'wait'}`}>
              {STATE_LABEL[state]}
            </span>
          </p>
        </div>
        <a className="player__exit" href={location.pathname}>
          返回
        </a>
      </header>

      {message ? (
        <p className="player__error" role="alert">
          {message}
        </p>
      ) : null}

      <div className="player__stage">
        {/* 内核会被注入到这个 div 里。它的尺寸就是 J2ME 屏幕的分辨率。 */}
        <div className="player__screen" ref={hostRef} />
      </div>

      <Keypad onControl={sendKey} />

      <p className="player__hint">{KEYMAP_HINT}</p>
    </main>
  )
}

/** 内容指纹：用于将来的存档隔离与去重，现在只算不用。 */
async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) return 'sha256:unavailable'
  // Uint8Array 可能是更大 buffer 的视图；digest 要的是整块 ArrayBuffer。
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
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
