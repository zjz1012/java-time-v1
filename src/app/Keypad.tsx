import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import type { InputControl, KeyPhase } from '@/runtime'

interface KeypadProps {
  readonly onControl: (control: InputControl, phase: KeyPhase) => void
}

type PadHandler = (event: ReactPointerEvent<HTMLButtonElement>) => void

interface NumpadKey {
  readonly control: InputControl
  readonly digit: string
  readonly letters: string
  readonly label: string
}

/**
 * 3×4 数字键盘。字母不是装饰 —— J2ME 的 TextBox 只靠 `keyPressed` 收字符，
 * 用户得知道哪个键能打出哪个字母；真机上这层提示就印在键面上。
 */
const NUMPAD: readonly NumpadKey[] = [
  { control: 'num1', digit: '1', letters: '', label: '数字 1' },
  { control: 'num2', digit: '2', letters: 'ABC', label: '数字 2 ABC' },
  { control: 'num3', digit: '3', letters: 'DEF', label: '数字 3 DEF' },
  { control: 'num4', digit: '4', letters: 'GHI', label: '数字 4 GHI' },
  { control: 'num5', digit: '5', letters: 'JKL', label: '数字 5 JKL' },
  { control: 'num6', digit: '6', letters: 'MNO', label: '数字 6 MNO' },
  { control: 'num7', digit: '7', letters: 'PQRS', label: '数字 7 PQRS' },
  { control: 'num8', digit: '8', letters: 'TUV', label: '数字 8 TUV' },
  { control: 'num9', digit: '9', letters: 'WXYZ', label: '数字 9 WXYZ' },
  { control: 'star', digit: '*', letters: '+', label: '星号 加号' },
  { control: 'num0', digit: '0', letters: '空格', label: '数字 0 空格' },
  { control: 'pound', digit: '#', letters: 'aA', label: '井号 切换输入' },
]

/**
 * 虚拟键区，形态照诺基亚直板机：
 *
 *   软键行   左软键 ……… 右软键   ← 贴画面两角，位置对应游戏自己画的软键提示
 *   导航区      ▲
 *             ◀ OK ▶     [C]     ← 圆形导航键居中，C 键在右侧
 *               ▼
 *   数字区    1 2 3 / 4 5 6 / 7 8 9 / * 0 #
 *
 * 上一版是掌机逻辑：十字键偏左、功能键占右边、数字键要点一下才出来。
 * 手机不是这么用的 —— 数字键盘是常驻的一整块，拇指的位置感来自
 * 「上面导航、下面数字」这个固定的物理排布，藏起来就没有位置感了。
 *
 * 三条硬要求，都不是「感觉该这样」，而是功能矩阵里的验收项：
 *
 *   1. **多点同按**（F8）：按指针（pointerId）记账，不按「当前按下的键」记账。
 *      用一根全局标记的写法会在第二根手指按下时把第一根的状态覆盖掉。
 *   2. **不卡键**（F10）：`pointercancel` / `lostpointercapture` / 窗口失焦 /
 *      页面隐藏 / 组件卸载，五条路都要抬键。触屏上 pointercancel 很常见
 *      （来电、手势返回、系统弹窗），少一条就会留下按下的键。
 *   3. **不误触滚动**：靠 CSS 的 `touch-action: none` + pointer capture，
 *      手指滑出按钮范围也仍然算这个键，抬起时才结束。
 */
export function Keypad({ onControl }: KeypadProps) {
  const pointers = useRef(new Map<number, InputControl>())
  const [held, setHeld] = useState<InputControl[]>([])

  const syncHeld = useCallback(() => {
    setHeld([...new Set(pointers.current.values())])
  }, [])

  const countOf = (control: InputControl): number => {
    let n = 0
    for (const value of pointers.current.values()) {
      if (value === control) n += 1
    }
    return n
  }

  const press = useCallback(
    (pointerId: number, control: InputControl) => {
      // 同一根手指的重复 pointerdown（触屏上偶发）不能算两次按下。
      if (pointers.current.has(pointerId)) return
      const alreadyHeld = countOf(control) > 0
      pointers.current.set(pointerId, control)
      // 两根手指按同一个键（例如两个方向键靠得近）只发一次 press，
      // 但抬起要先等最后一根手指离开，否则另一根手指还按着、游戏里却已经松了。
      if (!alreadyHeld) onControl(control, 'press')
      syncHeld()
    },
    [onControl, syncHeld],
  )

  const release = useCallback(
    (pointerId: number) => {
      const control = pointers.current.get(pointerId)
      if (!control) return
      pointers.current.delete(pointerId)
      if (countOf(control) === 0) onControl(control, 'release')
      syncHeld()
    },
    [onControl, syncHeld],
  )

  const releaseAll = useCallback(() => {
    const controls = [...new Set(pointers.current.values())]
    pointers.current.clear()
    for (const control of controls) onControl(control, 'release')
    syncHeld()
  }, [onControl, syncHeld])

  useEffect(() => {
    window.addEventListener('blur', releaseAll)
    const onVisibility = () => {
      if (document.hidden) releaseAll()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      // 卸载时也必须抬：退出运行页时手指还按着的情况是真实存在的。
      releaseAll()
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [releaseAll])

  const bind = (control: InputControl): { onPointerDown: PadHandler; onPointerUp: PadHandler; onPointerCancel: PadHandler; onLostPointerCapture: PadHandler } => ({
    onPointerDown: (event) => {
      event.preventDefault()
      // 抓住指针：手指滑出按钮范围后，事件仍然回到这个按钮，
      // 抬起时才能可靠地配对（否则会漏一次 release）。
      // 浏览器可能因为指针已经抬起而拒绝（InvalidPointerId），那不是致命问题：
      // 没有 capture 时 pointerup 只在按钮上方才触发，最坏情况是漏抬一次，
      // 由失焦/卸载的全量抬键兜底。
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // 忽略：capture 是「更可靠」，不是「必须」
      }
      press(event.pointerId, control)
    },
    onPointerUp: (event) => {
      release(event.pointerId)
    },
    onPointerCancel: (event) => {
      release(event.pointerId)
    },
    onLostPointerCapture: (event) => {
      release(event.pointerId)
    },
  })

  const button = (control: InputControl, label: ReactNode, extraClass = '', ariaLabel?: string) => (
    <button
      type="button"
      className={`pad${held.includes(control) ? ' pad--held' : ''}${extraClass ? ' ' + extraClass : ''}`}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : control)}
      data-control={control}
      {...bind(control)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </button>
  )

  return (
    <div className="keypad" role="group" aria-label="虚拟键区">
      <div className="keypad__soft">
        {button('soft1', '左软键', 'pad--soft')}
        {button('soft2', '右软键', 'pad--soft')}
      </div>

      <div className="keypad__nav">
        <div className="keypad__dpad" role="group" aria-label="导航键">
          <div className="keypad__cell keypad__cell--up">{button('up', '▲', 'pad--arrow', '上')}</div>
          <div className="keypad__cell keypad__cell--left">{button('left', '◀', 'pad--arrow', '左')}</div>
          <div className="keypad__cell keypad__cell--fire">{button('fire', 'OK', 'pad--fire', '确认')}</div>
          <div className="keypad__cell keypad__cell--right">{button('right', '▶', 'pad--arrow', '右')}</div>
          <div className="keypad__cell keypad__cell--down">{button('down', '▼', 'pad--arrow', '下')}</div>
        </div>
        {button('clear', 'C', 'pad--clear', '清除')}
      </div>

      <div className="keypad__num" role="group" aria-label="数字键">
        {NUMPAD.map((item) => (
          <div key={item.control} className="keypad__num-cell">
            {button(
              item.control,
              <>
                <span className="pad__digit">{item.digit}</span>
                {item.letters ? <span className="pad__letters">{item.letters}</span> : null}
              </>,
              'pad--num',
              item.label,
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
