import { afterEach, describe, expect, it } from 'vitest'

import { attachKeyboardInput, isEditableTarget } from '@/input/keyboard'
import type { InputControl, KeyPhase } from '@/runtime'

type Sent = [InputControl, KeyPhase]

function setup(keymap?: Record<string, InputControl>) {
  const sent: Sent[] = []
  const detach = attachKeyboardInput({
    ...(keymap ? { keymap } : {}),
    send: (control, phase) => {
      sent.push([control, phase])
      return true
    },
  })
  return { sent, detach }
}

function key(type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('外壳键盘监听', () => {
  it('按下与抬起成对送出', () => {
    const { sent, detach } = setup()
    window.dispatchEvent(key('keydown', 'ArrowUp'))
    window.dispatchEvent(key('keyup', 'ArrowUp'))
    expect(sent).toEqual([
      ['up', 'press'],
      ['up', 'release'],
    ])
    detach()
  })

  it('拦下事件的默认行为（否则方向键会滚动页面）', () => {
    const { detach } = setup()
    const down = key('keydown', 'ArrowDown')
    window.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)

    const unmapped = key('keydown', 'KeyZ')
    window.dispatchEvent(unmapped)
    expect(unmapped.defaultPrevented).toBe(false)
    detach()
  })

  it('自动重复只拦事件、不重复送键', () => {
    const { sent, detach } = setup()
    window.dispatchEvent(key('keydown', 'ArrowLeft'))
    window.dispatchEvent(key('keydown', 'ArrowLeft', { repeat: true }))
    window.dispatchEvent(key('keydown', 'ArrowLeft', { repeat: true }))
    expect(sent).toEqual([['left', 'press']])
    detach()
  })

  it('一个控制名对应多个物理键时，抬起要等最后一个', () => {
    const { sent, detach } = setup()
    // ↑ 与 W 都是「上」：先按 ↑ 再按 W，只应有一次 press
    window.dispatchEvent(key('keydown', 'ArrowUp'))
    window.dispatchEvent(key('keydown', 'KeyW'))
    expect(sent).toEqual([['up', 'press']])

    // 放开 ↑ 时 W 还按着，不能发 release
    window.dispatchEvent(key('keyup', 'ArrowUp'))
    expect(sent).toEqual([['up', 'press']])

    // 最后放开 W 才发 release
    window.dispatchEvent(key('keyup', 'KeyW'))
    expect(sent).toEqual([
      ['up', 'press'],
      ['up', 'release'],
    ])
    detach()
  })

  it('没有配对的抬起不重复发 release', () => {
    const { sent, detach } = setup()
    window.dispatchEvent(key('keyup', 'ArrowRight'))
    expect(sent).toEqual([])
    detach()
  })

  it('失焦时把按下的键全部抬起来', () => {
    const { sent, detach } = setup()
    window.dispatchEvent(key('keydown', 'ArrowUp'))
    window.dispatchEvent(key('keydown', 'ArrowLeft'))
    window.dispatchEvent(new Event('blur'))

    expect(sent).toEqual([
      ['up', 'press'],
      ['left', 'press'],
      ['up', 'release'],
      ['left', 'release'],
    ])
    detach()
  })

  it('解绑时也会抬键，并停止监听', () => {
    const { sent, detach } = setup()
    window.dispatchEvent(key('keydown', 'Space'))
    detach()
    expect(sent).toEqual([
      ['fire', 'press'],
      ['fire', 'release'],
    ])

    window.dispatchEvent(key('keydown', 'Space'))
    expect(sent).toHaveLength(2)
  })

  it('输入框里的按键交给输入框', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    expect(isEditableTarget(input)).toBe(true)

    const { sent, detach } = setup()
    input.dispatchEvent(key('keydown', 'ArrowUp'))
    expect(sent).toEqual([])
    detach()
  })

  it('未映射的键一律放行', () => {
    const { sent, detach } = setup()
    for (const code of ['KeyQ', 'Escape', 'Tab', 'F5']) {
      window.dispatchEvent(key('keydown', code))
    }
    expect(sent).toEqual([])
    detach()
  })

  it('自定义表生效', () => {
    const { sent, detach } = setup({ KeyJ: 'left', KeyK: 'right' })
    window.dispatchEvent(key('keydown', 'KeyJ'))
    window.dispatchEvent(key('keydown', 'ArrowUp'))
    expect(sent).toEqual([['left', 'press']])
    detach()
  })
})

describe('isEditableTarget', () => {
  it('识别可编辑元素', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const div = document.createElement('div')
    for (const element of [input, textarea, select]) {
      expect(isEditableTarget(element)).toBe(true)
    }
    expect(isEditableTarget(div)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(new EventTarget())).toBe(false)
  })
})
