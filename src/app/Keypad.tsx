import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { InputControl, KeyPhase } from '@/runtime'

interface KeypadProps {
  readonly onControl: (control: InputControl, phase: KeyPhase) => void
}

type PadHandler = (event: ReactPointerEvent<HTMLButtonElement>) => void

/**
 * 虚拟键区。
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
  const [padOpen, setPadOpen] = useState(false)

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

  const button = (control: InputControl, label: string, extraClass = '') => (
    <button
      type="button"
      className={`pad${held.includes(control) ? ' pad--held' : ''}${extraClass ? ' ' + extraClass : ''}`}
      aria-label={label}
      data-control={control}
      {...bind(control)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </button>
  )

  return (
    <div className="keypad" role="group" aria-label="虚拟键区">
      <div className="keypad__dpad">
        <div className="keypad__cell keypad__cell--up">{button('up', '↑', 'pad--arrow')}</div>
        <div className="keypad__cell keypad__cell--left">{button('left', '←', 'pad--arrow')}</div>
        <div className="keypad__cell keypad__cell--fire">{button('fire', 'OK')}</div>
        <div className="keypad__cell keypad__cell--right">{button('right', '→', 'pad--arrow')}</div>
        <div className="keypad__cell keypad__cell--down">{button('down', '↓', 'pad--arrow')}</div>
      </div>

      <div className="keypad__aux">
        {button('soft1', '左软键', 'pad--soft')}
        {button('soft2', '右软键', 'pad--soft')}
        <button
          type="button"
          className={`pad pad--soft${padOpen ? ' pad--held' : ''}`}
          aria-expanded={padOpen}
          onClick={() => setPadOpen((open) => !open)}
        >
          数字
        </button>
      </div>

      {padOpen ? (
        <div className="keypad__num" role="group" aria-label="数字键">
          {(['num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9'] as const).map(
            (control, index) => button(control, String(index + 1), 'pad--num'),
          )}
          {button('star', '*', 'pad--num')}
          {button('num0', '0', 'pad--num')}
          {button('pound', '#', 'pad--num')}
        </div>
      ) : null}
    </div>
  )
}
