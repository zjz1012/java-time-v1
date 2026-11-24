# 旧版事实核查（阶段 0）

> 本文件只记录**可核验的观测事实**，并区分「已核实」与「待核实」。
> 结论用于界定新版的可迁移边界，不构成法律意见。
> 核查日期：2026-11-23；核查人：开发方自身（委托方复核前视为未完成）。

---

## 1. 旧版实体定位

| 项 | 内容 |
|---|---|
| 代码位置 | 工作区 `j2me-52emu-feasibility/shiwan2/` |
| 版本控制 | **无 Git 历史**（该目录不在任何仓库中，仅有文件系统修改时间） |
| 公开分发状态 | 委托方声明已停止维护并下架（本次核查未独立验证下架状态） |
| 归档形式 | 未按 §2.1 建立只读归档；当前仍是可写工作目录 —— **列为待办** |

### 1.1 目录清单（实测体积）

| 路径 | 体积 | 性质 |
|---|---|---|
| `shiwan2/bld/` | 996 K | J2ME 内核产物（j2me.js / native.js / main-all.js） |
| `shiwan2/java/` | 1.3 M | MIDP 类库镜像 |
| `shiwan2/js/` | 2.0 M | 外壳层（19 个模块，含桥接、倍速、存档、音频、手柄、ZIP） |
| `shiwan2/style/` | 484 K | 样式与素材 |
| `shiwan2/index.html` / `index.js` | 32 K + 36 K | 主页面与主逻辑 |
| `shiwan2/keymap.js` / `keyboard-layouts.js` | 24 K + 12 K | 键位映射与布局定义 |
| `shiwan2/gamelist.js` | 12 K | 内置游戏清单 |

---

## 2. 与其它工程的同源性（哈希实测）

旧版内核产物与工作区另一工程 `j2me-toy`（main 分支）存在逐字节重合：

| 文件 | `shiwan2/` | `j2me-toy` main | 结论 |
|---|---|---|---|
| `bld/j2me.js` | `7d263a2b5ad7b4c73d32792209a30783` | 同左 | **完全相同** |
| `bld/native.js` | `39558e441facb32fe6aa4d4492e7c4c6` | 同左 | **完全相同** |
| `bld/main-all.js` | `5e5af00907de79e01d9deb21e1952b3e` | `c932f93088938ce28f1537850a9b1a75` | 不同（后者被改过） |

**含义**：这不是两个独立的来源问题，而是同一份第三方内核产物被两个工程继承。新版的来源治理只需解决一次，但**两个工程的内核都必须替换**，否则任何一侧继续分发都保留同样的问题。

---

## 3. 旧版内核的第三方网络层（关键发现）

`shiwan2/js/evalNative-bridge.js`（9.9 K）头部注释与常量：

```js
var WS_PATH = "/ws/tcp";
/** EdgeOne 同源 WS 不可用时，走 qq 反代到私服 */
var REMOTE_WS_HOST = "qq.zixing.fun";
```

配套的 `bld/main-all.js` 内 `evalNative` 命中 **11 处**（`DumbPipe` 命中 24 处，说明上游通道仍并存）。

**已核实结论**：旧版外壳层包含一条指向 `qq.zixing.fun` 的 WebSocket 回退通道，用于把 MIDlet 的 socket 请求转发出去。该端点不属于任何上游开源项目，其运营方、数据留存策略与合法性均未核实 —— **新版不复用、不重建、不探讨替代实现**，联网类 MIDlet 在 V1.0 按「不支持」处理（见 §6 与 `FEATURE_MATRIX.md`）。

---

## 4. 游戏资产的授权状况

> **本文档 2026-11-23 15:30 更正**：本节初版把 `shiwan2/gamelist.js` 的 45 条记录误判为
> 「旧版内置游戏」，并据此得出「V1.0 一律不内置游戏」。该判断错误，原因是**把目录清单
> 当成了随包内容**。下方为重新核查后的事实。

### 4.1 旧版（`shiwan2/`）：没有随包游戏

`shiwan2/gamelist.js` 确有 **45** 条记录，`publisher` 字段多为第三方发行商（Gameloft 9、
Electronic Arts 3、Nokia 2 等）。但这 45 条**只是清单，JAR 并不在包内**：

| 实测项 | 结果 |
|---|---|
| `j2me-52emu-feasibility/jars/` 文件数 | **1 个**：`koudai.data`（596 K） |
| `gamelist.js` 引用的 45 个 `jarName` 在此目录中存在数 | **0 个** |
| `koudai.data` 实际内容 | MIDlet-Name `口袋灵兽`，Vendor `lxs`，2008-10-14 构建，无任何许可文件 |

**结论（旧版）**：旧版可运行的游戏实际只有一份外来的 2008 年第三方 JAR（`口袋灵兽`），
来源与授权均不可考，**不迁入新版**；清单里那 44 条从未随包分发。旧版因此不存在
「内置了几十款商业游戏」的问题，本节初版的表述属于**过度推断**。

### 4.2 可复用资产（`j2me-toy`）：104 款，来源与许可齐全

本项目真正要沿用的是自己那个 Toy 的内置游戏，其来源在
`j2me-toy/public/licenses/SOURCES.md` 第五节有完整登记：

| 类别 | 款数 | 许可 | 来源 |
|---|---|---|---|
| 自研（`midlets/src/*.java`） | 12 | **GPL-2.0-or-later** | Breakout / Drop / 2048 / Memory / Snake / Sokoban / 猜数字 / 连连看 / 迷宫 / 扫雷 / 小蜜蜂 / 一路向前（旧版的 `HelloMidlet` 只用来冒烟，新版改用推箱子，故未迁入。后 6 款是 Canvas 重写，替掉主界面依赖 Form 渲染、内核画不出来的 6 个第三方包） |
| j2me-100-games | 90 | **MIT** | https://github.com/agneay/j2me-100-games |
| my-j2me-projects | 1 | **MIT** | https://github.com/pisces312/my-j2me-projects |
| Shooter | 1 | **MIT** | https://github.com/RehanSaeed/Shooter |
| **合计** | **104** | | `public/games/*.data` 实测 104 个文件，与登记一致 |

三份 MIT 是**各自独立授权**（版权人不同），许可正文已随 `SOURCES.md` 收录。
MIT 只要求保留版权与许可声明，**允许商用与再分发**，因此这批资产可以整体迁入 V1.0。

**结论（新版）**：V1.0 **可以内置游戏**，范围为「自研 12 款 + 上述 92 款 MIT」。
需继续遵守的只有一条边界：**不收录任何缺少分发授权的商业 JAR**（规划 §1.3）——
这与旧版清单无关，是对新增来源的约束。迁移时须把 `SOURCES.md` 第五节的登记与
MIT 正文一并带入新仓库的 `docs/provenance/`。

**迁移结果**：已落地。`docs/provenance/SOURCES.md` §5 与
`docs/provenance/games.json` 逐款记录了三件事 —— 整包 sha256（证明产物没被替换）、
上游 40 位 commit 与文件路径、版权人与许可（证明**这是谁的东西**）。哈希与来源
不能互相代替：前者说明「没换过」，后者说明「有权分发」。自研 12 款的对应源码已随
仓库提交在 `midlets/src/`，`npm run verify:midlets` 重编译后与产物逐 class 比字节。

---

## 5. 许可与来源文件缺失

| 应有文件 | 旧版实际 |
|---|---|
| `LICENSE` / `COPYING` | **不存在** |
| `NOTICE` | **不存在** |
| `licenses/SOURCES.md` | **不存在**（规划 §2.2 提到的该文件在本工作区不可得） |
| 第三方依赖声明 | **不存在** |

`shiwan2/js/` 下至少包含 19 个模块，其中可识别为第三方的有 `jszip.min.js`、`FileSaver.js`、`PicoAudio.js`、`webaudio-tinysynth.min.js`、`rawinflate.js`、`BenzAMRRecorder.min.js`、`gamepadHandlerWithRightStick.js` 等，**均无版本号、无许可声明、无来源链接**。

> 说明：规划 §2.2 记载 `licenses/SOURCES.md`「曾出现不准确的原创声明」。本次核查未见该文件本体，无法独立复核该陈述 —— 标记为**委托方待补证**。

---

## 6. 新版迁移边界（据此定案）

### 6.1 明确禁止迁入

| 类别 | 具体对象 | 依据 |
|---|---|---|
| 内核产物 | `shiwan2/bld/*.js`、`shiwan2/java/*` | 第三方构建产物，来源链含私有网络层 |
| 外壳桥接 | `js/evalNative-bridge.js` | 私有 API 契约 + 定向端点 |
| 键位 / 倍速 / 存档 | `keyboard-layouts.js`、`js/emulator-speed.js`、`js/savemanager.js` | 规划 §2.2 列明需重新设计 |
| 游戏与素材 | `gamelist.js` 全部条目、`img/`、`style/` 素材 | 授权不明 |
| 第三方库 | `js/` 下 19 个模块 | 无版本、无许可，无法登记 |

### 6.2 允许迁入

只有**开发方自己产出、且来源可自证**的内容：

| 对象 | 说明 |
|---|---|
| `scripts/` 内核构建管线 | 开发方为把 mozilla/pluotsorbet 源码在现代工具链上编译而自行编写的适配脚本；上游许可与自身改动均已登记 |
| `docs/provenance/` 全部文档 | 本仓库自产 |
| 自编测试 MIDlet | 由本仓库 `tests/fixtures/` 源码编译，无第三方内容 |

### 6.3 不可复用、必须重写

外壳层四项（键位、倍速、存档、桥接）按规划 §2.3 执行：新版开发只依据「功能需求 + 浏览器标准 + 已核实可用的上游技术资料」，不参照旧版实现。

---

## 7. 待核实项（阻塞或半阻塞）

| # | 事项 | 状态 | 影响 |
|---|---|---|---|
| A1 | 旧版是否已实际下架 | 未验证（委托方声明） | 不阻塞开发，阻塞「合规结案」 |
| A2 | 旧版只读归档由谁保管、是否限制访问 | 未落实 | 阻塞 §2.1 要求 |
| A3 | 规划 §2.2 所述 `licenses/SOURCES.md` 原文 | 本工作区不可得 | 需委托方补证 |
| A4 | `qq.zixing.fun` 运营方与合法性 | 不予核实、不接触 | 新版已绕开 |
| A5 | 旧版 19 个第三方库的确切版本 | 无法确定（已压缩混淆） | 新版一律重新选型，不再追查 |
