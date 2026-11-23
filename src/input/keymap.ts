import type { PhysicalKeymap } from '@/runtime'

/**
 * 默认键位表：物理键（`KeyboardEvent.code`）→ 逻辑控制名。
 *
 * ★ 用 `code` 而不是 `key`。
 *   `key` 会随输入法与键盘布局变（俄文布局下按同一个位置得到 `ы`），
 *   `code` 表达的是「物理上哪个键」，这才是玩家认知里的键位。
 *
 * ★ 这份表只有一份，两处消费：
 *     1. 焦点在游戏画面上时 —— 由宿主页（iframe 内）查表并注入；
 *     2. 焦点在外壳页面上时 —— 由 `attachKeyboardInput` 查表并注入。
 *   两种情况互斥（键盘事件只落在有焦点的那一侧），不会双发。
 *
 * 数字键 0~9、空格、退格在内核的原生通路上本来就是对的（`ev.which` 恰好等于
 * 设备键码），但这里仍然显式映射：只要在表里，宿主页就会**拦下**原生那次，
 * 只走注入通路。统一成一条路，才不会出现「有的键走原生、有的键走注入」这种
 * 一半对一半错的状态。
 */
export const DEFAULT_KEYMAP: PhysicalKeymap = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'fire',
  Enter: 'fire',
  NumpadEnter: 'fire',
  BracketLeft: 'soft1',
  F1: 'soft1',
  BracketRight: 'soft2',
  F2: 'soft2',
  Backspace: 'clear',
  Digit0: 'num0',
  Digit1: 'num1',
  Digit2: 'num2',
  Digit3: 'num3',
  Digit4: 'num4',
  Digit5: 'num5',
  Digit6: 'num6',
  Digit7: 'num7',
  Digit8: 'num8',
  Digit9: 'num9',
  Numpad0: 'num0',
  Numpad1: 'num1',
  Numpad2: 'num2',
  Numpad3: 'num3',
  Numpad4: 'num4',
  Numpad5: 'num5',
  Numpad6: 'num6',
  Numpad7: 'num7',
  Numpad8: 'num8',
  Numpad9: 'num9',
  NumpadMultiply: 'star',
  // pound（#）没有默认物理键：US 布局上它是 Shift+3，与 Digit3 撞车，
  // 只能在小键盘面板里按。宁可缺一个键，也不要一个按了会出错的键。
}

/** 给用户看的说明文案。键位表改了这里要跟着改，所以放在一起。 */
export const KEYMAP_HINT =
  '方向键/WASD 移动 · 空格或回车确认 · [ ] 或 F1 F2 左右软键 · 数字键直输'
