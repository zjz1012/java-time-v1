import type { InputControl, KeyPhase, PhysicalKeymap } from '@/runtime'

import { DEFAULT_KEYMAP } from './keymap'

export interface KeyboardInputOptions {
  /** 物理键表，默认 `DEFAULT_KEYMAP` */
  readonly keymap?: PhysicalKeymap
  /** 送键。返回 false 表示没送达（游戏没在跑），此时仍然拦下事件 */
  readonly send: (control: InputControl, phase: KeyPhase) => boolean
  /** 事件源，默认当前窗口。测试时可传一个假的 EventTarget */
  readonly target?: Window
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * 判断按键是否该交给输入框。
 *
 * 外壳自己的表单、将来的搜索框都靠这一条活下来：拦掉它们的按键，
 * 用户会以为输入法坏了。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  if (EDITABLE_TAGS.has(element.tagName)) return true
  return element.isContentEditable === true
}

/**
 * 在外壳页面上接管物理键盘。
 *
 * 与宿主页（iframe 内）的监听互为补充，不重叠：键盘事件只会落在有焦点的那一侧。
 * 覆盖的是「用户刚点过外壳的按钮，焦点还没进游戏画面」这一段 ——
 * 少了它，用户点开始之后按方向键会毫无反应，而点一下画面又好了，很难解释。
 *
 * 返回解绑函数；解绑时会把仍按着的键全部抬起。
 */
export function attachKeyboardInput(options: KeyboardInputOptions): () => void {
  const keymap = options.keymap ?? DEFAULT_KEYMAP
  const source: Window = options.target ?? window
  const send = options.send

  /** 当前物理上按着的 code，用来把「同一个控制名有多个物理键」配对正确 */
  const pressedCodes = new Set<string>()

  const controlOf = (code: string): InputControl | undefined => keymap[code]

  const isHeld = (control: InputControl): boolean => {
    for (const code of pressedCodes) {
      if (controlOf(code) === control) return true
    }
    return false
  }

  const heldControls = (): InputControl[] => {
    const out: InputControl[] = []
    for (const code of pressedCodes) {
      const control = controlOf(code)
      if (control && !out.includes(control)) out.push(control)
    }
    return out
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const control = controlOf(event.code)
    if (!control) return
    if (isEditableTarget(event.target)) return

    event.preventDefault()
    // 自动重复只拦事件、不重复送键：长按的连续移动应由游戏轮询键状态，
    // 而不是靠操作系统的重复率（30 次/秒的「按一下走一步」会失控）。
    if (event.repeat) return
    if (pressedCodes.has(event.code)) return

    const alreadyHeld = isHeld(control)
    pressedCodes.add(event.code)
    if (!alreadyHeld) send(control, 'press')
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    const control = controlOf(event.code)
    if (!control) return
    if (isEditableTarget(event.target)) return

    event.preventDefault()
    if (!pressedCodes.delete(event.code)) return
    if (!isHeld(control)) send(control, 'release')
  }

  /**
   * 失焦 / 切后台时抬键。
   *
   * 按住方向键切走窗口，keyup 永远不会来 —— 不在这里补，
   * JVM 里那只键会一直是按下态，回到游戏角色会自己往一个方向跑。
   */
  const releaseAll = (): void => {
    const controls = heldControls()
    pressedCodes.clear()
    for (const control of controls) send(control, 'release')
  }

  const onVisibilityChange = (): void => {
    if (document.hidden) releaseAll()
  }

  // 捕获阶段：与外层（宿主页）保持同一套语义，也避免被中途 stopPropagation 的元素吞掉。
  source.addEventListener('keydown', onKeyDown as EventListener, true)
  source.addEventListener('keyup', onKeyUp as EventListener, true)
  source.addEventListener('blur', releaseAll)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    releaseAll()
    source.removeEventListener('keydown', onKeyDown as EventListener, true)
    source.removeEventListener('keyup', onKeyUp as EventListener, true)
    source.removeEventListener('blur', releaseAll)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
