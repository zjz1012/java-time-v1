# 内核启动契约

> 本文不是抄上游文档，而是**从自建产物里实测反推**：对象是
> `public/kernel/j2me.js`（600 756 B）、`native.js`（125 017 B）、`main-all.js`（593 941 B）。
> 抽取方式为静态扫描 `getElementById` / `querySelector` / `config.*` / 全局声明，
> 再在真实浏览器里逐项验证。
> 凡本文没写的，就是扫描里没出现的 —— 不要凭印象补。
>
> **2026-11-23 修订**：首版有 5 处错误（加载顺序、DOM 数量、`config.main` 取值、
> 必需资源只列了 4 件、出画判据），全部是「照文档写就会踩」的那类。修订记录见文末。
> 同日第二次修订补了 §12（输入通路），并改掉了 §11 里「键盘 = `keydown`」的错误表述 ——
> 那是第 6 处，而且是最贵的一处：它看起来最不需要验证。

## 1. 加载顺序（首版写反了）

```
native.js        Boehm GC / Relooper / wasm 导出（同步 wasm，加载即可用）
  ↓
j2me.js          JVM + 运行时，定义 JVM / Native / J2ME / MIDP
  ↓
main-all.js      外壳胶水 + 启动链，末尾立即执行
```

**`native.js` 必须最先。** 首版写的是 `j2me → native`，实测不成立：`ASM`（wasm 导出对象）
是 j2me.js 一启动就要摸的东西，native 在后就会 `ReferenceError: ASM is not defined`，
而这个错误会把 `Native` 表打断，后续 `main-all.js` 里所有 `Native[...] = ...` 全部变成
`Cannot set properties of undefined`。

旁证：旧宿主页的装载器 `load-versioned.js` 里，`bld/native.js` 一直排在 `bld/j2me.js` 之前。

`main-all.js` 末尾不是函数声明，而是**顶层语句**：加载完就 `Promise.all(loadingPromises).then(start)`。
所以前面两件必须已经就位，否则解析期就 ReferenceError。

## 2. 四个全局对象：少一个就静默失败

内核依赖四个**全局**（不是 module 作用域），缺任何一个的症状都不是「报错」，而是「卡住」。

| 全局 | 谁提供 | 缺失症状 |
|---|---|---|
| `config` | 宿主 | 解析期就炸，相对好查 |
| `APP_BASE_DIR` | 宿主 | `initFS` 里 `load(APP_BASE_DIR + "certs/_main.ks")` 抛 ReferenceError → `Loading failed`，页面上什么都没有 |
| `MIDlet` | 宿主 | 内核的短信/后台服务实现读 `MIDlet.SMSDialog*`，缺了这一支会抛错 |
| `ASM` | **由 native.js 的 `Module.asm` 转接** | `ASM._gcMalloc` 全挂，内核无法分配对象 |

★ `ASM` 是 wasm 化之后唯一需要宿主补的桥：上游 asm.js 产物会自己生成 `ASM` 全局，
而 `emcc 2.x` 的 wasm 产物只挂 `Module["asm"]`。宿主必须在 native.js 加载后、j2me.js 之前做：

```js
if (typeof window.ASM === 'undefined' && window.Module && window.Module.asm) {
  window.ASM = window.Module.asm
}
```

★ `config` 必须是**经典脚本**定义的全局。用 ES module 时 `var config` 不进全局，
`main-all.js` 读不到；`window.config = {...}` 或顶层 `var config = {...}` 都行。

## 3. `config` 字段全表

`main-all.js` 消费（20 个）：

| 字段 | 本项目的取值 | 说明 |
|---|---|---|
| `main` | **`"com/sun/midp/main/MIDletSuiteLoader"`** | **不是**游戏主类，是 MIDP 的启动器。首版写成「主类名或 JAR 名」是错的 |
| `midletClassName` | `""` | 留空时由 `inferMidletClassName()` 从 `MIDlet-1` 推断（本地补丁） |
| `jars` | 见 §4 | 类型契约是「有 `split` 方法的字符串」，不是普通字符串 |
| `args` | `[]` | **必须是数组**，`startIsolate0` 会取 `args.length` |
| `ignoredFiles` | `new Set()` | **必须是 Set**，内核会对它调 `.has()` |
| `autosize` | `""` | 空/`no`/`0` → 用 `#display` 的 clientWidth/Height。非空会走 `documentElement` 的 chrome 计算，那是给独立页面用的，iframe 里算错 |
| `gamepad` | `"no"` | 非 `no`/`0` 时给 `<html>` 加 `gamepad` 类 |
| `downloadJAD` / `jad` | `""` | 置空即不走下载路径 |
| `deferStartup` | 不设 | 非 0 则 `setTimeout` 延后 `run()` |
| `platform` | 不设 | 仅用于伪造 UA 字符串（`Nokia503/...`） |
| `fontSize` / `language` / `customEmojiImageFormat` | 不设 | 默认值可用 |
| `chRegistered*` / `ts` / `js` | 不设 | 开发者/测试面板相关 |

`j2me.js` 消费（4 个，**首版整组漏了**）：

| 字段 | 本项目的取值 | 不设的后果 |
|---|---|---|
| `invokeThreshold` | `10` | JIT 编译阈值恒为假，纯解释执行，帧率明显偏低 |
| `backwardBranchThreshold` | `10` | 同上 |
| `forceRuntimeCompilation` | 不设（falsy） | — |
| `ts` | 不设 | — |

## 4. `config.jars` 的坑：blob URL 自带冒号

内核的写法是：

```js
if (config.jars) { jars = jars.concat(config.jars.split(":")); }
```

分号是为了支持多包。但宿主用 `URL.createObjectURL` 生成的地址形如
`blob:http://host/uuid`，**自带两个冒号**，会被拆成 4 段、全部加载失败。
`data:` URL 同理。

**解法**：给 `config.jars` 传一个只有 `split` 的最小替身。内核只在这一处消费它。

```js
config.jars = { split: function () { return [objectUrl] } }
```

## 5. 必需资源共 5 类（首版只写了 4 件 JS）

| 资源 | 位置（相对产物根） | 缺失症状 |
|---|---|---|
| 三个 JS | `j2me.js` / `native.js` / `main-all.js` | 直接加载失败 |
| MIDP 类库 | **`java/classes.data`** | `load()` 404 → `initFS` reject → 停在启动层 |
| MIDP 证书库 | **`certs/_main.ks`** | 同上，且只在控制台留一行 `Loading failed` |
| emoji 图集 | **`style/emoji/emoji*.png`** | 见 §7，表现为「启动成功但画面全黑」 |

★ `java/classes.data` 的路径是**写死的**：`main-all.js` 里 `load("java/classes.data")`。
★ `certs/_main.ks` 与 `style/emoji/` 是构建脚本长期漏收集的两项，首版契约完全没提。

## 6. DOM：18 个 id（首版写 13 个）

`j2me.js` 里 `getElementById` 出现 **0 次** —— 所有 DOM 耦合都在 `main-all.js`。

**顶层无条件访问（缺了在解析期就抛）—— 15 个：**

| id | 次数 | 要求 |
|---|---|---|
| `display` | 5 | **必须有非零 clientWidth/clientHeight**（被当作物理屏幕尺寸），且是 `splash/download` 两个 screen 的父节点 |
| `sidebar` | 3 | 内部必须有 `nav ul`（软键菜单会被写进去） |
| `main` | 3 | 主容器 |
| `display_title` | 2 | 标题文本 |
| `canvas` | 2 | **渲染目标**，`main-all.js` 直接 `getContext("2d")` |
| `display-container` | 1 | canvas 定位基准（`offsetLeft/Top`） |
| `drawer` | 1 | 内部必须有 `header`（读 `offsetHeight`） |
| `back-button` | 1 | 返回 |
| `header-drawer-button` | 1 | 抽屉开关 |
| `header-ok-button` | 1 | 确认键 |
| `exit-screen` | 1 | 退出层 |
| `lcdui-alert` | 1 | **模板节点**，内部必须有 `h1.title` / `p.text` / `progress` |
| `hidden-textarea-editor` | 1 | 量文本高度用，**不能 display:none**（要读 offsetHeight） |
| `splash-screen` | 1 | ★ 首版漏了。`splashScreen.style.display = 'block'` 无空检查 |
| `download-screen` | 1 | ★ 首版漏了。同上，且内部需 `progress.pack-activity` |

**按需访问（只在对应功能被触发时）：** `textarea-editor`、`nokia-fileui-prompt`、
`sms-listener-prompt`、`download-failure-dialog`。V1.0 不做这些功能，但保留空骨架，
避免某款游戏触发对应原生方法时因模板为 null 而中断。

> 旧宿主页有约 70 个 id。多出来的那些属于**外壳**（键盘、摇杆、软键条、下载对话框、
> 播放器控件），不是内核要求。

## 7. 启动链：卡点与补丁

```
loadingPromises = [initFS, load("java/classes.data")]
loadingMIDletPromises = [getMobileInfo, ...jars.map(load)]
  ↓ Promise.all
start() → hideDownloadScreen() → jvm.startIsolate0(config.main, config.args)
  ↓ MIDletSuiteLoader
new MIDlet() → startApp() → Display.setCurrent(canvas)
  ↓
DisplayDevice.gainedForeground0 → hideSplashScreen + 等 emoji
  ↓
Canvas.paint → Graphics.render → DisplayDevice.refresh0 → drawImage(offscreen → #canvas)
```

六个本地补丁必须同时存在，少一个就是「零报错不启动」：

| 补丁 | 不打补丁的症状 |
|---|---|
| `getMobileInfo` 立即 resolve | 等宿主应答，`start()` 永不执行 |
| `inferMidletClassName` | 主类为空 → `ClassNotFoundException: 'undefined'` |
| `hideDownloadScreen()` 进 `start()` | 下载层不消失，画面被盖 |
| `load("java/classes.data")` 路径 | 请求 `classes.jar`，404 |
| `removeChild` 父节点守卫 | splash/download 不在 `#display` 下时抛 NotFoundError |
| **父窗口无 DumbPipe 时不抛错** | ★ 新增。见 §9 |

## 8. 判定「出画面」：两条都不能错

1. **不能在源画布上 `getContext('2d')`。** 内核已持有该上下文，再取一次属于抢渲染上下文，
   会把画面顶成 0 FPS（本项目在旧宿主上踩过）。要读像素只能 `drawImage` 到离屏小画布再读。
2. **不能只看 `toDataURL().length`。** 旧结论「空白 PNG 只有几百字节」只对小画布成立：
   358×638 的**纯黑**画布也能压到 9 KB，长度判据会直接判成「已出画面」。

可靠判据：缩绘到 64×64 离屏画布，统计不同 RGB 的数量 —— 纯色（含纯黑）只有 1 种，
真实画面几十到几百种。实测 Arena Champion 首屏 **252 种**。

## 9. 网络：`DumbPipe` 是硬边界，且父窗口假设会炸

- 上游 socket / HTTP 走 `DumbPipe.open(...)`，需要**宿主实现**
- 无宿主时不会抛错，而是**永不回调** —— MIDlet 会静默挂起
- `libs/pipe.js` 里还有一段：iframe 中运行时把 `alert` / `prompt` 覆盖成
  `window.parent.DumbPipe.handleEvent(...)`。这是 Firefox OS `mozbrowser` 时代的约定，
  **现代 Web 的父窗口没有 `DumbPipe`**，于是 `TypeError: Cannot read properties of
  undefined (reading 'handleEvent')` —— 而这个调用点在启动链上，会直接打断 MIDlet。
  已由补丁 7 降级为 `console.warn`。

因此适配层必须：网络类请求一律在**超时**内失败并给出可读提示，
不能让它无限等待（`RuntimeErrorCode` 里的 `TIMEOUT` 就是为此）。

## 10. 路径：`<base>` 是唯一的耦合点

宿主页在 `/runtime/host.html`，产物在 `/kernel/`，而 `load("java/classes.data")` 走相对文档 base：

```html
<base href="../kernel/" />
```

用相对值而非 `/kernel/`，是为了子路径部署（GitHub Pages 项目页）也能解析。
宿主自己的脚本全部**内联**，避免被 base 改写到产物目录。

## 11. 外壳必须提供 / 内核提供

| 归外壳 | 归内核 |
|---|---|
| 18 个 id 的节点与布局 | JVM、类加载、字节码执行 |
| 键位策略（物理键 → 逻辑控制名，见 §12） | 渲染到 `#canvas` |
| 速度档位（改 `config` 或包时钟） | 音频解码与输出 |
| 存档读写与隔离 | RMS 语义 |
| 游戏库、导入、关于页 | JAR → 类解析 |
| 网络层实现（V1.0 只做拒绝+提示） | `DumbPipe` 协议形状 |

> 首版这里写的是「键盘 / 触控键区（键码→`keydown`）」—— **错的**，
> 和 §1 的加载顺序一样属于「照文档写就会踩」。键盘不是靠 `keydown` 进内核的，见 §12。

## 12. 输入：游戏动作只能由「设备键码」触发

`main-all.js`（`midp/midp.js`）里有两张对称的表：

```js
var keyMap  = { 1: 119, 2: 97, 5: 100, 6: 115, 8: 32, 9: 113, 10: 101, 11: 122, 12: 99 }
var gameKeys = { 119: 1, 97: 2, 115: 6, 100: 5, 32: 8, 113: 9, 101: 10, 122: 11, 99: 12 }
```

左边是 MIDP 的游戏动作（`UP=1` `LEFT=2` `RIGHT=5` `DOWN=6` `FIRE=8` …），
右边是**设备键码**。注意右边这些值是 `w a s d 空格 q e z c` 的 **ASCII 码**，
不是方向键的键码，也不是字母键的 `ev.which`。

| 现象 | 数值 | 结论 |
|---|---|---|
| 按 ↑ 时 `ev.which` | 38 | 不在 `gameKeys` 里 |
| 按 D 时 `ev.which` | **68**（大写 ASCII） | 不在 `gameKeys` 里（表里是 100） |
| 按 5 时 `ev.which` | 53 | 不在 `gameKeys` 里，但 53 恰好 = `KEY_NUM5`，数字键能用 |

所以**原生键盘通路产生不了任何方向动作**。实测（Sokoban，`Canvas` + `getGameAction`）：

```
焦点确认在 iframe 内，按 ↑ ↓ ← → W A S D  → 画面均无变化
内核收到的物理键事件: KeyD which=68 / ArrowUp which=38
注入 119 / 115 / 100 → 均有动作
```

唯一可靠的通路是内核自己暴露的注入接口（`midp.js` 的 return 对象，
全局 `MIDP`）：

```js
MIDP.sendKeyPress(119)      // 等价于 gameAction UP
MIDP.sendKeyRelease(119)
```

上游的屏幕方向键 `game-ui.js` 就是这么写的 —— 那张「小写字母码」的表本来就是
给它用的，不是给物理键盘用的。

### 12.1 宿主页的键码表

| 逻辑控制 | 设备键码 | 依据 |
|---|---|---|
| `up` / `down` / `left` / `right` | 119 / 115 / 97 / 100 | `gameKeys` |
| `fire` | 32 | `gameKeys` → FIRE |
| `num0`~`num9` | 48~57 | MIDP `KEY_NUM*` |
| `star` / `pound` | 42 / 35 | MIDP `KEY_STAR` / `KEY_POUND` |
| `clear` | 8 | `systemKeyMap` → `SYSTEM_KEY_CLEAR` |
| `soft1` / `soft2` | -6 / -7 | MIDP `KEY_SOFTKEY1/2`。★ 本内核的构建里**没有导出**这两个常量，但游戏普遍直接比较 -6 / -7（自研推箱子就是），所以原样送 |
| `gameA`~`gameD` | 113 / 101 / 122 / 99 | `gameKeys`，暂未映射物理键 |

### 12.2 三条必须同时成立的约束

1. **必须在捕获阶段拦下物理键**，并 `stopImmediatePropagation()`。内核自己在冒泡阶段
   也有 `keydown` 监听，会把 `ev.which` 当设备键码送进去；不掐断，数字键会被送两次，
   表现成「按一下走两步」。实测拦断后：按数字 5 只有 `[53]`，按 W 只有 `[119]`（不是 87）。
2. **只拦映射表里的键**，其余放行 —— 否则 `TextField` 的输入与浏览器快捷键全废。
3. **失焦 / 页面隐藏要抬键**。按住方向键切走窗口时 `keyup` 永远不会到达，
   JVM 里那只键会一直是按下态，回到游戏角色会自己往一个方向跑。

### 12.3 已知限制：`GameCanvas(true)` 的游戏不可控

内核把 `setSuppressKeyEvents` 实现成了**全局开关**：一旦某款游戏构造
`GameCanvas(true)`（只用 `getKeyStates()` 轮询、不要 `keyPressed` 回调），
`sendKeyPress` 会整个短路 —— 连 `getKeyStates()` 依赖的键掩码都不再更新。

JSR 规范说的是「只抑制**游戏键**的 keyPressed 回调」，实现抑制的是全部按键事件。
这是上游与规范不符之处，本轮不修（要改就得改内核产物）；遇到这类游戏的表现是
「画面正常但完全无法操作」。

## 13. 画面：容器尺寸**就是**游戏的逻辑屏幕

内核不认「设备型号」，它拿 `#display` 的 `clientWidth/clientHeight` 当物理屏幕尺寸。
`Display.getWidth()` / `Canvas.getWidth()` 返回的就是这两个值。

这意味着**外壳的 CSS 不是外观问题，而是输入给游戏的参数**：

| 外壳做了什么 | 游戏看到什么 |
|---|---|
| 容器 370×560 | 逻辑屏幕 370×560，`getWidth()` 直接返回 370 |
| 容器 500×136（横屏、不限宽） | 逻辑屏幕 500×136，游戏按 3.7:1 排版，格子小到看不清 |
| 容器为 0 | 画布 0×0，无报错，只是什么都不出来 |

实测过的两个后果：

1. **竖屏不需要锁比例。** 游戏普遍按 `getWidth()/getHeight()` 自适应（自研推箱子用
   `cell = Math.min((w-10)/cols, (h-top-bottom)/rows)`），容器给多大就用多大，
   锁死 3:4 反而白白丢掉高度（实测丢了 67px）。
2. **键区才是高度的真正竞争者。** 手机键盘常驻会吃掉近一半屏幕：390×844 上画面只剩
   370×382。这不是布局没压紧，真机就是这样 —— J2ME 时代屏幕 176×208，键区占的面积
   比屏幕本身还大。

V1.0 **只做竖屏**，横屏不做适配。但先把结论记在这里：横屏一旦要做，就必须限宽 ——
横屏宽裕的是宽度、稀缺的是高度，不限宽时游戏会拿到一个 500×136 的极扁屏幕
（实测格子小到看不清），而限宽之后键区怎么摆是另一轮设计。

配套的两条外壳约束：

- **容器尺寸为 0 必须当成错误报出来**，不能让它变成一张黑图 —— 黑图与「内核挂了」
  在界面上无法区分。`PlayerScreen` 在 `start()` 之前会检查一次容器尺寸。
- **画面尺寸变化会触发整屏重排**，所以运行页整页不滚动。滚动条的存在与否会让
  可用高度在「刚好」和「差 2px」之间反复跳，而每次跳都是一次游戏内重排。

## 14. 存档：RMS 能跑通，但存不住，也不分游戏

RMS 的**语义**是完整可用的：`RecordStore.openRecordStore` / `setRecord` / `getRecord`
都能跑，自研 MIDlet 实测读写正常。问题在三处实现细节，且全都不报错。

### 14.1 路径：恒为 `/RecordStore/<name>.<ext>`，不含游戏身份

```js
// MIDletSuiteStorage.getSecureFilenameBase
return J2ME.newString("")          // 上游注释：we only run a single midlet per installation
// MIDletSuiteLoader
var suiteId = (config.midletClassName === "internal") ? -1 : 1
```

`RecordStoreFile.openRecordStoreFile` 拼的是
`RECORD_STORE_BASE + "/" + filenameBase + "/" + name + "." + ext`，
`filenameBase` 是空串、`RECORD_STORE_BASE` 是 `"/RecordStore"`，所以**两个游戏
用同名 store 就是同一个文件**。隔离必须由外壳做（ADR 0005）。

### 14.2 持久化：写内存，落盘要等，而且兜底是假的

```
RecordStoreFile.writeBytes → fs.write（只标 dirty）
RecordStoreFile.commitWrite → fs.flush（写进内存 store）
每 5 秒 flushAll → syncStore（才写 IndexedDB）
```

定时器是 `setTimeout(() => setInterval(flushAll, 5000), 20000)` —— **启动 20 秒后**
才开始。而看起来像保险的那行：

```js
window.addEventListener("pagehide", flushAll)
```

在 iframe 被摘除/整页导航时**不生效**：实测 pagehide 回调里才发起的 IDB 事务
既不 complete 也不 abort，数据读回是 `null`。真内核端到端复核同样：

| 操作 | IDB 里有记录吗 |
|---|---|
| 写完立刻退出 | 没有 |
| 写后等 26 秒再退出 | 有 |
| 写后显式 `fs.syncStore()` 再退出 | 有 |

★ 这一条是「外壳托管存档」的全部理由。别指望改 `pagehide` 写法来修 ——
内核产物是 GPL-2.0 的编译结果，`check:provenance` 锁定了它是哪个 commit，
自己打补丁就等于 fork 一个内核，代价远大于在外壳侧多导一次快照。

### 14.3 读：`fs` 是全局，内存态可直接读

`main-all.js` 里是 `var fs = (function(){ ... })()`，经典脚本下就是 `window.fs`。
宿主页能同步用这些：

| 接口 | 语义 |
|---|---|
| `fs.list(dir)` | 返回 `basename` / `basename/`（目录带尾斜杠）；目录不存在时 **throw** |
| `fs.stat(path)` | `{ isDir, mtime, size }`，同步 |
| `fs.getBlob(path)` | 返回**已提交**的 Blob；正在写、未 flush 的拿到旧值（这正是快照要的语义） |
| `fs.syncStore(cb)` | 立即落盘，回调在事务完成后触发 |
| `fs.exportStore(cb)` | 整库导出成 JSON（字节变成数字数组，体积膨胀）；`importStore` 会**先 `map.clear()` + `objectStore.clear()`**，会把 `/_main.ks` 与内建根目录一起清掉，**不要用它做单游戏恢复** |

### 14.4 写：直写 `asyncStorage`，但别盲目 `open(ver)`

启动前恢复只能写 IndexedDB —— 内核没有「已 init、MIDlet 未跑」的插入点。
库名 `asyncStorage`、版本 `4`、表 `fs4`、`keyPath: pathname`：

```js
// 文件
{ pathname: '/RecordStore/save.db', isDir: false, parentDir: '/RecordStore',
  size: 6, mtime: Date.now(), data: Blob }
// 目录（必须补，否则 fs.exists 查不到父目录）
{ pathname: '/RecordStore', isDir: true, parentDir: '/', mtime: Date.now() }
```

★ **不能盲目 `indexedDB.open('asyncStorage', 4)`**：库不存在时它会创建一个
版本号是 4 却没有任何表的空库，内核随后 open 同版本不会触发 `upgradeneeded`，
`transaction('fs4')` 直接抛 `NotFoundError` —— 表现是「启动层不动、控制台无报错」。
宿主页先用 `indexedDB.databases()` 探测存在性，探测不到时放弃本次恢复（`host.html`
里 `openKernelStore` 这一段有完整注释）。

### 14.5 外壳的两条职责

1. **启动前**：清掉 `fs4` 里 `/RecordStore` 前缀的全部记录，写入该游戏的快照。
   即使快照为空也要清 —— 空的含义是「这款游戏没有存档」，不是「别动上一款」。
2. **退出前**：先读快照、发给外壳，再回 `stopped`。外壳收到 `stopped` 就会拆
   iframe，顺序反了这份快照就发不出来。

静默期归档（每 2 秒比对 `list + stat`，连续两轮无变化才读）是为了兜
「直接关页面 / 刷新」，代价是约 4 秒滞后。要求「连续两轮无变化」是因为一次存档
可能跨 `.db` 与 `.idx` 两个文件，中途读会得到索引与数据不一致的快照。

### 14.6 恢复失败 = 启动失败

宿主页在装载内核之前必须把快照写进 `fs4`。**这一步失败时唯一的正确做法是中止启动**，
不能「跳过恢复继续启动」，也不能「沿用库里现有的数据」。后两者的后果是同一条链：

```
游戏在空档 / 上一款游戏的残留档上运行
  → 退出时把这份错数据当作快照发出去
  → 外壳写归档，原来的存档被覆盖
```

用户看到的只是「游戏能玩，存档没了」，而这正是托管存档要防的事。所以
`host.html` 把恢复结果分成三态并只在一种情况下继续：

| 情形 | 结果 |
|---|---|
| 库不存在（全新安装）+ 快照为空 | 继续（没有旧数据可清，也无需恢复） |
| 库不存在 + 快照非空 | **SAVE_RESTORE_FAILED**（浏览器把库清掉了，恢复无从谈起） |
| 库存在但 `transaction('fs4')` 抛错 / 事务 abort / cursor 报错 | **SAVE_RESTORE_FAILED**（清理是否成功未知，不能当作成功） |
| 库版本低于内核（`upgradeneeded` 且 `oldVersion > 0`） | **SAVE_RESTORE_FAILED**（不知道该版本的记录形状，无法保证清空） |
| 事务 `complete` | 继续（`restored` / `cleared`） |

★ 事务的 `complete` 是唯一可信的成功信号：单个 `put` 成功时数据还没提交。

★ 外壳下发的 `restore` 也要在宿主侧再校验一遍（路径必须落在 `/RecordStore`、
不许 `..`、不许重复、32 个文件 / 4 MiB 单个 / 8 MiB 总量）。宿主是最后一道写
内核文件系统的关，越界路径改的就不是存档，而是内核自己的文件 —— 例如证书库。

## 修订记录（2026-11-23）

| 首版写法 | 实测 | 怎么发现的 |
|---|---|---|
| 顺序 `j2me → native → main-all` | native 必须最先 | `ASM is not defined` + `Native` 表未定义 |
| `config.main` 是「主类名或 JAR 名」 | 固定为 `MIDletSuiteLoader` | 读 `startIsolate0` 参数用途 |
| DOM 13 个 | 顶层必需 15 个（漏了 splash/download） | 用单引号扫描才发现，双引号正则漏匹配 |
| config 20 个字段 | 另有 j2me.js 侧 4 个 | 两个文件分开扫描 |
| 产物 4 件 | 另有 `certs/_main.ks`、`style/emoji/` | 依次撞上 `initFS reject` 与「全黑但已启动」 |
| 键盘「键码 → `keydown`」（§11） | 必须注入设备键码，见 §12 | 按方向键画面不动，注入 119 才有动作 |
| 存档「内核自己会持久化」（首版假设） | 必须由外壳托管，见 §14 | 写完立刻退出，IDB 里查不到；pagehide 里的事务不完成 |
| 恢复失败「跳过就好，玩不了更糟」 | 必须中止启动，见 §14.6 | 跳过时内核会自己建空库，游戏在空档上跑并在退出时覆盖归档 |

## 修订记录（2026-11-24）

| 首版写法 | 实测 | 怎么发现的 |
|---|---|---|
| `openKernelStore` 返回 `null` 就「跳过恢复」 | 只有「库不存在且快照为空」才能继续，其余一律中止 | 复查：跳过 → 内核建空库 → 游戏在空档上跑 → 退出覆盖归档 |
| 宿主侧越界路径「丢弃并继续」 | 整次启动失败（少恢复一个文件比不恢复更危险） | 同上：缺一块的存档被写回，等于逐步损坏 |
| 恢复文件不做规模校验 | 32 个文件 / 4 MiB 单个 / 8 MiB 总量 | 宿主是最后一道写内核文件系统的关 |
