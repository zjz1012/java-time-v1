# ADR 0004：输入通路——注入设备键码，而不是合成键盘事件

- 状态：已接受
- 日期：2026-11-23
- 相关：`docs/architecture/kernel-contract.md` §12、`docs/FEATURE_MATRIX.md` F7/F8/F10

## 背景

要让 J2ME 游戏收到按键，看起来有两条路：**合成 `KeyboardEvent`** 让内核自己的
`window.addEventListener("keydown")` 去处理，或者**直接调内核的注入接口**。
第一版契约（`kernel-contract.md` §11）写的是前者：「键盘 / 触控键区（键码→`keydown`）」。

实测这条路走不通，原因在内核的旧写法里：

```js
// main-all.js（midp/midp.js）
window.addEventListener("keydown", function (ev) { sendKeyPress(ev.which) })

// 而它期待的是「设备键码」，两张表都是小写字母的 ASCII 码：
var gameKeys = { 119: 1 /*UP*/, 97: 2 /*LEFT*/, 115: 6 /*DOWN*/, 100: 5 /*RIGHT*/, 32: 8 /*FIRE*/ }
```

浏览器给字母键的 `ev.which` 是**大写** ASCII（按 D 得到 68），方向键给的是 37~40。
两者都不在表里，所以：

| 输入 | 内核看到 | 结果 |
|---|---|---|
| 按 ↑ | `which = 38` | `getGameAction(38) = 0` → 没有动作 |
| 按 D | `which = 68` | `getGameAction(68) = 0` → 没有动作 |
| 注入 100 | 100 | `getGameAction(100) = RIGHT` → 有动作 |
| 按 5 | `which = 53` | `getGameAction(53) = 0`，但 `keyPressed(53)` 恰好等于 `KEY_NUM5` → 数字能用 |

实测数据（Sokoban，自研 MIDlet，`Canvas` + `getGameAction`）：

```
物理键（焦点确认在 iframe 内）→ 画面变化: false      // ↑ ↓ ← → WASD 全部无效
内核收到的物理键事件: KeyD which=68 / ArrowUp which=38
注入 119 / 115 / 100 → 画面变化: true
```

也就是说：**方向控制在原生通路上完全不存在**。上游自己是靠 `game-ui.js`
里写死 `MIDP.sendKeyPress(119)` 的屏幕方向键绕过去的 —— 这也是为什么它的
`gameKeys` 表用「小写字母码」这种奇怪的取值：那张表本来就是给虚拟键区用的。

合成事件也救不了：`new KeyboardEvent('keydown', { keyCode: 119 })` 改不动
`which`（它在多数浏览器里由 `keyCode` 派生且 init 不接受），只能靠
`Object.defineProperty` 硬改，而那等于在别人的事件对象上做手脚 —— 换浏览器版本就碎。

## 决策

### 1. 按键走**独立指令**，不走 DOM 事件

```
外壳 ──runtime:key { control, phase }──▶ 宿主页 ──MIDP.sendKeyPress(设备键码)──▶ JVM
```

- 外壳只认识**逻辑控制名**（`up` / `fire` / `soft1` / `num5` …），不认识设备键码。
- 「控制名 → 设备键码」的表只在宿主页里有一份（`CONTROL_CODES`）。它是内核的实现细节，
  换内核就变，不该泄漏到产品代码。
- `sendKey` 是**同步**的，返回是否送达。输入路径不该为每次按键分配 Promise。

### 2. 宿主页接管物理键盘，且必须掐断内核自己那次

宿主页在**捕获阶段**监听 `keydown`/`keyup`，只拦映射表里的键，然后
`preventDefault()` + `stopImmediatePropagation()`。

不掐断的后果不是「多一个无害事件」：数字键会被原生送一次（53）、注入一次（53），
表现成**按一下走两步**。实测这一条可以验：

```
焦点在画面内，按一次 → 进 JVM 的键码: [100]        // 干净，没有 39
按一次数字 5        → 进 JVM 的键码: [53]          // 没有双发
按一次 W            → 进 JVM 的键码: [119]         // 不是 87
```

### 3. 键位表放在外壳，随启动指令下发

物理键 → 控制名的映射是**策略**（用户可改），不该写死在宿主页。
所以它只有一份（`src/input/keymap.ts`），通过启动指令的 `keymap` 字段交给宿主页。

这同时解决了「焦点在哪」的问题：键盘事件只落在有焦点的那一侧 ——

| 焦点 | 谁在听 | 通路 |
|---|---|---|
| 游戏画面（iframe 内） | 宿主页 | 物理键 → 设备键码 → `MIDP.sendKeyPress` |
| 外壳页面（刚点过按钮） | `attachKeyboardInput` | 物理键 → `runtime.sendKey()` → 同一条 |

两条路互斥，不会双发。少了任何一条，用户都会遇到「按了没反应、点一下画面又好了」
这种没法解释的现象。

### 4. 自动重复不转发

长按的连续移动应由游戏 `getKeyStates()` 轮询（掩码在抬起前一直有效），
而不是靠操作系统的 30 次/秒重复率去驱动「按一下走一步」的游戏。

## 后果

- 宿主页多了一张 20 行的键码表，必须与内核源码保持一致。用测试钉住
  `119/115/97/100/32` 这几个值（`tests/unit/input-keymap.test.ts`），
  挡住「看起来更合理」的改动（比如把 `up` 改成 38）。
- 键盘事件在 iframe 内被拦下，`TextField` 的原生输入会受影响 —— 已加
  「输入框激活时不拦」的判断，但 V1.0 的文本输入本身还没做，这条要等存档/输入框那一轮复核。
- **`GameCanvas(true)` 的游戏仍然不可控**：内核把 `suppressKeyEvents` 实现成了
  全局开关，一旦某款游戏构造 `GameCanvas(true)`，`sendKeyPress` 会整个短路 ——
  连 `getKeyStates()` 的掩码都不会更新。这是上游的实现与 JSR 规范不符之处
  （规范说只抑制「游戏键」，实际抑制的是全部）。本轮不修，记为已知限制；
  真要修得改内核产物，属于下一轮的事。
- `#`（`pound`）没有默认物理键：US 布局上它是 Shift+3，与 `Digit3` 撞车。
  只能在小键盘面板里按 —— 宁可少一个键，也不要一个按了会出错的键。

## 未采纳的方案

| 方案 | 未采纳原因 |
|---|---|
| 合成 `KeyboardEvent` | 改不动 `which`；靠 `defineProperty` 硬改属于在别人对象上做手脚 |
| 让用户按 WASD，因为「内核认 w/a/s/d」 | 内核认的是**小写码 119**，而浏览器给的 `which` 是大写 87，照样不成立 |
| 由外壳统一在父页面听键，再转发 | 焦点在 iframe 内时父页面收不到任何事件 |
| 在 iframe 上盖一层透明输入层 | 会挡掉内核的画布指针事件（`midp.js` 里有 `mousedown`/`touchstart` 处理） |
| 把键位表写死在宿主页 | 用户改键位就得改内核侧文件，且外壳与宿主会出现两份策略 |
