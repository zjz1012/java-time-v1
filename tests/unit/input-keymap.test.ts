import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DEFAULT_KEYMAP, KEYMAP_HINT } from '@/input/keymap'
import { INPUT_CONTROLS, isInputControl } from '@/runtime'

const hostHtml = readFileSync(join(process.cwd(), 'public/runtime/host.html'), 'utf8')
const hostCode = hostHtml
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 从宿主页里抠出 `CONTROL_CODES` 这张表。
 *
 * 宿主页是经典脚本，没法 import 外壳的常量 —— 两张表只能各写一份。
 * 于是「两边不同步」就成了一个纯靠人记的问题，而它的症状是「某个键没反应」，
 * 极难定位。这个断言把这件事挪到 CI 里。
 */
function readHostControlCodes(): Record<string, number> {
  const block = /var CONTROL_CODES = \{([\s\S]*?)\n {8}\}/.exec(hostCode)
  if (!block) throw new Error('宿主页里找不到 CONTROL_CODES 表')
  const out: Record<string, number> = {}
  for (const line of (block[1] ?? '').matchAll(/^\s*([a-zA-Z0-9]+):\s*(-?\d+),?$/gm)) {
    out[line[1] ?? ''] = Number(line[2])
  }
  return out
}

describe('逻辑按键集合', () => {
  it('没有重复项', () => {
    expect(new Set(INPUT_CONTROLS).size).toBe(INPUT_CONTROLS.length)
  })

  it('isInputControl 只认表内的名字', () => {
    expect(isInputControl('up')).toBe(true)
    expect(isInputControl('fire')).toBe(true)
    expect(isInputControl('UP')).toBe(false)
    expect(isInputControl('teleport')).toBe(false)
    expect(isInputControl(42)).toBe(false)
    expect(isInputControl(null)).toBe(false)
  })
})

describe('宿主页的设备键码表', () => {
  const codes = readHostControlCodes()

  it('覆盖全部逻辑按键', () => {
    expect(Object.keys(codes).sort()).toEqual([...INPUT_CONTROLS].sort())
  })

  /**
   * 这几个值不是随便挑的，是从内核源码的两张表反查出来的：
   *   gameKeys[119]=UP, [97]=LEFT, [115]=DOWN, [100]=RIGHT, [32]=FIRE
   * 也就是**小写字母的 ASCII 码**，不是方向键的键码。
   *
   * 把它们钉住，是为了挡住「看起来更合理」的改动：把 up 改成 38（↑ 的键码）
   * 会让所有游戏失去方向控制，而且没有任何报错。
   */
  it('方向与确认键用内核认识的小写字母码', () => {
    expect(codes.up).toBe(119) // 'w'
    expect(codes.left).toBe(97) // 'a'
    expect(codes.down).toBe(115) // 's'
    expect(codes.right).toBe(100) // 'd'
    expect(codes.fire).toBe(32) // 空格
  })

  it('数字与符号用 MIDP 常量值', () => {
    expect(codes.num0).toBe(48)
    expect(codes.num9).toBe(57)
    expect(codes.star).toBe(42)
    expect(codes.pound).toBe(35)
    expect(codes.clear).toBe(8)
  })

  it('软键用 MIDP 的 -6 / -7', () => {
    expect(codes.soft1).toBe(-6)
    expect(codes.soft2).toBe(-7)
  })
})

describe('物理键位表', () => {
  it('每个值都是合法的逻辑按键', () => {
    for (const [code, control] of Object.entries(DEFAULT_KEYMAP)) {
      expect(isInputControl(control), `${code} → ${control}`).toBe(true)
    }
  })

  it('方向至少有方向键与 WASD 两套', () => {
    expect(DEFAULT_KEYMAP.ArrowUp).toBe('up')
    expect(DEFAULT_KEYMAP.KeyW).toBe('up')
    expect(DEFAULT_KEYMAP.ArrowLeft).toBe('left')
    expect(DEFAULT_KEYMAP.KeyA).toBe('left')
    expect(DEFAULT_KEYMAP.ArrowDown).toBe('down')
    expect(DEFAULT_KEYMAP.KeyS).toBe('down')
    expect(DEFAULT_KEYMAP.ArrowRight).toBe('right')
    expect(DEFAULT_KEYMAP.KeyD).toBe('right')
  })

  it('确认键覆盖空格、回车与小键盘回车', () => {
    expect(DEFAULT_KEYMAP.Space).toBe('fire')
    expect(DEFAULT_KEYMAP.Enter).toBe('fire')
    expect(DEFAULT_KEYMAP.NumpadEnter).toBe('fire')
  })

  it('十个数字键在两种键盘上都能打出来', () => {
    for (let i = 0; i <= 9; i += 1) {
      expect(DEFAULT_KEYMAP[`Digit${i}`]).toBe(`num${i}`)
      expect(DEFAULT_KEYMAP[`Numpad${i}`]).toBe(`num${i}`)
    }
  })

  it('井号不占物理键（与 Digit3 撞车），只由键区提供', () => {
    expect(Object.values(DEFAULT_KEYMAP)).not.toContain('pound')
  })

  it('说明文案里提到的键都在表里', () => {
    // 文案说「方向键/WASD」「空格或回车」「[ ] 或 F1 F2」——抽出来核对，
    // 避免改了表忘了改提示，用户在设置页找不到键。
    for (const key of ['ArrowUp', 'KeyW', 'Space', 'Enter', 'BracketLeft', 'BracketRight', 'F1', 'F2']) {
      expect(DEFAULT_KEYMAP[key], key).toBeDefined()
    }
    expect(KEYMAP_HINT.length).toBeGreaterThan(0)
  })
})
