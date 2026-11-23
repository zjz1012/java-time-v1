# 内核启动契约

> 本文不是抄上游文档，而是**从自建产物里实测反推**得到：对象是
> `public/kernel/j2me.js`（600 756 B）、`main-all.js`（593 331 B）、`native.js`。
> 抽取方式为静态扫描 `getElementById` / `querySelector` / `config.*` / 全局声明。
> 凡本文没写的，就是扫描里没出现的 —— 不要凭印象补。

## 1. 加载顺序（不可换）

```
config 脚本（定义全局 var config）
  ↓
j2me.js       JVM + 运行时
  ↓
native.js     Boehm GC / Relooper（同步 wasm，加载即可用）
  ↓
main-all.js   外壳胶水 + 启动链，末尾立即执行
```

`main-all.js` 末尾不是函数声明，而是**顶层语句**：加载完就 `Promise.all(loadingPromises).then(start)`。
所以前面三件必须已经就位，否则解析期就 ReferenceError。

## 2. 全局 `config`：必须在 `main-all.js` 之前存在

扫描到的全部字段（20 个）：

| 字段 | 本项目的取值 | 说明 |
|---|---|---|
| `main` | 由运行时填 | 主类名或 JAR 名，进 `jvm.startIsolate0(config.main, config.args)` |
| `midletClassName` | 留空 | 留空时由 `inferMidletClassName()` 从 `MIDlet-1` 推断（本地补丁） |
| `jars` | `"/games/<name>.data"` | **冒号分隔**，每项走 `load()`；写绝对路径可避开相对基准问题 |
| `args` | `""` | 传给 MIDlet 的参数 |
| `deferStartup` | `0` | 非 0 则 `setTimeout` 延后 `run()` |
| `gamepad` | `"no"` | 非 `no`/`0` 时给 `<html>` 加 `gamepad` 类 |
| `downloadJAD` | `""` | 置空即不走下载路径 |
| `autosize` / `fontSize` / `language` / `platform` | 默认 | 影响布局与本地化 |
| 其余 `chRegistered*` / `customEmojiImageFormat` / `ignoredFiles` / `js` / `ts` / `jad` | 不用 | 开发者或测试面板相关 |

★ `config` 是 `var` 声明（非 `window.config` 赋值），必须是**全局脚本**定义，
不能用 ES module —— module 作用域下 `var` 不进全局，`main-all.js` 读不到。

## 3. DOM：13 个 id + 4 个选择器

`j2me.js` 里 `getElementById` 出现 **0 次** —— 所有 DOM 耦合都在 `main-all.js`。

| id | 次数 | 缺失后果 |
|---|---|---|
| `sidebar` | 3 | 抽屉式侧栏，读写频繁 |
| `main` | 3 | 主容器 |
| `display_title` | 2 | 标题文本（FPS 也挂这里） |
| `canvas` | 2 | **渲染目标，缺失即无法出画面** |
| `display` | 1 | canvas 的父层 |
| `display-container` | 1 | 再上一层 |
| `drawer` | 1 | 侧栏抽屉 |
| `back-button` | 1 | 返回 |
| `header-drawer-button` | 1 | 抽屉开关 |
| `header-ok-button` | 1 | 确认键 |
| `exit-screen` | 1 | 退出确认层 |
| `lcdui-alert` | 1 | `Alert` 弹出层 |
| `hidden-textarea-editor` | 1 | `TextBox` 输入承载 |

选择器：`header`、`nav ul`（2 处）、`progress`、`head`（插样式）。

> 旧宿主页有约 50 个 id，多出来的那些属于**外壳**（键盘、摇杆、软键条、下载对话框），
> 不是内核要求。新版按需实现，不必凑齐。

## 4. 相对路径基准（最容易踩的一个）

`load()` 是 `xhr.open("GET", file)`，`file` 原样传入：

```js
loadingPromises.push(load("java/classes.data", "arraybuffer")…)
```

`java/classes.data` 是**写死的相对路径**，按文档 base URL 解析。因此：

- 类库必须与宿主页同目录结构：`<base>/java/classes.data`
- 宿主页放在哪，内核产物就得整体放在哪一层
- `config.jars` 用绝对路径（`/games/x.data`）可绕开，但类库这条绕不开

**决定**：宿主页放在内核产物目录内（`public/runtime/`），产物安装时整体铺平到同级，
`public/runtime/{j2me.js, native.js, main-all.js, java/, config/}`。

## 5. 启动链与补丁点

```
loadingPromises = [initFS, load(classes.data)]
loadingMIDletPromises = [getMobileInfo, ...jars.map(load)]
  ↓ Promise.all
start() → hideDownloadScreen() → jvm.startIsolate0(config.main, config.args)
```

四处本地补丁必须同时存在，少一个就「零报错不启动」：

| 补丁 | 不打的症状 |
|---|---|
| `getMobileInfo` 立即 resolve | 等宿主应答，`start()` 永不执行 |
| `inferMidletClassName` | 主类为空 → 跑成 `com.ismyway.anyview.Anyview` 之类 |
| `hideDownloadScreen()` 进 `start()` | 下载层不消失，画面被盖 |
| `load("java/classes.data")` | 请求 `classes.jar`，404 |

## 6. 网络：`DumbPipe` 是硬边界

- 上游 socket / HTTP 走 `DumbPipe.open(...)`，需要**宿主实现**
- 无宿主时不会抛错，而是**永不回调** —— MIDlet 会静默挂起
- 旧版的 `evalNative` + `qq.zixing.fun` 通道**不重建**（规划 §1.3）

因此适配层必须：网络类请求一律在**超时**内失败并给出可读提示，
不能让它无限等待（`RuntimeErrorCode` 里的 `TIMEOUT` 就是为此）。

## 7. 外壳必须提供 / 内核提供

| 归外壳 | 归内核 |
|---|---|
| 13 个 id 的节点与布局 | JVM、类加载、字节码执行 |
| 键盘 / 触控键区（键码→`keydown`） | 渲染到 `#canvas` |
| 速度档位（改 `config` 或包时钟） | 音频解码与输出 |
| 存档读写与隔离 | RMS 语义 |
| 游戏库、导入、关于页 | JAR → 类解析 |
| 网络层实现（V1.0 只做拒绝+提示） | `DumbPipe` 协议形状 |
