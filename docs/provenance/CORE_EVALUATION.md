# J2ME 内核来源与许可证选型报告（阶段 0）

> 状态：**已选定，存在 2 项阻塞级待决问题**（见 §6）
> 核查日期：2026-11-23
> 本文件只陈述可复核的事实；结论性意见标注为「判断」。

---

## 1. 选定的内核

| 项 | 内容 |
|---|---|
| 项目 | PluotSorbet —— Mozilla 的 J2ME/JVM 浏览器运行时 |
| 仓库 | `https://github.com/mozilla/pluotsorbet` |
| 选定版本 | `46ee3e78a4fd9c3f09026cc5cbdcf76e94b7a398`（2017-01-05，`Merge pull request #1878`） |
| 许可证 | **GPL-2.0**，仓库根 `LICENSE` 为 GPL v2 全文，**无 "or later" 表述** |
| 使用方式 | 源码复制 + 本地修改后编译，产物随应用分发 |
| 上游状态 | 项目已归档，不再接受更新（判断：稳定但不会修 bug） |

### 1.1 产物构成

| 产物 | 来源 | 说明 |
|---|---|---|
| `j2me.js` | `references.ts` 及全部 `.ts`，经 `tsc 2.9.2 --target ES5` | JVM 主体 |
| `native.js` | `vm/native/native.cpp` + `jit/relooper/Relooper.cpp`，经 `emcc 2.0.34` | GC 与 JIT 的 wasm 后端 |
| `classes.data` | `java/` 下 `cldc1.1.1` / `vm` / `midp` / `custom` / `jsr-179`，经 Jpp + `javac -source 8 -target 8` | MIDP 类库镜像（jar 容器，改后缀规避部分平台丢弃 `.zip`/`.jar`） |
| `main-all.js` | 按上游 Makefile 的 `MAIN_JS_SRCS` 顺序拼接上述运行时 | 运行时整合包 |

### 1.2 依赖链

| 组件 | 版本 / Commit | 许可证 | 分发形态 |
|---|---|---|---|
| Boehm.js（Boehm GC 的 emscripten 移植） | 子模块 `712978aea8b6a30bee949d78275aafb0e8cbc887` | Boehm GC 许可（宽松，类 MIT/X11） | 编入 `native.js` |
| Relooper | 随上游 `jit/relooper/` | MIT（`(C) 2012 Alon Zakai`） | 编入 `native.js` |
| `libs/encoding.js`（TextEncoder/Decoder polyfill） | 随上游 | Apache-2.0（`Copyright 2014 Joshua Bell`） | 编入 `j2me.js` |
| Emscripten 运行时 | emsdk 2.0.34 | MIT / UIUC | 内联进 `native.js` |
| TypeScript 编译器 | 2.9.2 | Apache-2.0 | **仅构建期**，不分发 |

**判断**：依赖链清晰、全部为宽松或 GPL-2.0 兼容许可，无「来源不明」组件。

---

## 2. 与旧版产物的关系

| 项 | 旧版（第三方构建） | 自建 |
|---|---|---|
| `j2me.js` | `7d263a2b…` | `e2a7a5b9…` |
| `native.js` | `39558e44…` | `db17ded7…` |
| `main-all.js` | `5e5af009…` | `9cafd5b2…` |
| `classes.data` | `…`（1237 类） | `b975763f…`（967 类） |

四件产物逐字节不同。**判断**：新版内核产物不继承旧版任何字节，来源可完整追溯到上游源码 + 本仓库 `scripts/` 的补丁。

---

## 3. 旧版类库的来源分析（重要）

旧版 `classes.data` 含 1237 个 class，自建产物含 967 个 —— **缺 270 个**，分布在 32 个包中，且**没有任何旧版有而自建缺失之外的差异**（即自建产物是旧版的严格子集）。

缺失分布：

| 能力域 | 缺失包 | 缺失类数 | 推断来源 |
|---|---|---|---|
| 蓝牙 / OBEX（JSR-82） | `com/sun/jsr082/bluetooth`、`com/sun/jsr082/obex`、`javax/bluetooth`、`javax/obex` | 83 | freej2me |
| 移动 3D（JSR-184） | `javax/microedition/m3g`、`kemulator/m3g` | 51 | kemulator |
| Mascot Capsule 3D | `ru/woesss/j2me/micro3d`、`com/mascotcapsule/micro3d/v3` | 38 | ru/woesss |
| 无线消息（JSR-120） | `javax/wireless` | 7 | freej2me |
| GLES2 桥（JSR-239） | `pl/zb3/freej2me/bridge/gles2` | 10 | zb3/freej2me-web |
| 厂商扩展 | `com/siemens`、`com/vodafone`、`com/nokia`、`com/samsung`、`com/sprintpcs` | 46 | freej2me |
| 其它 | `com/sun/cldc/i18n/j2me` 等 | 35 | 上游 jsr 目录 |

**已核实结论**：旧版内核 = PluotSorbet + freej2me（GPL-3.0）+ kemulator M3G + ru/woesss M3D + zb3/freej2me-web 的**混合体**。自建产物是纯 PluotSorbet。

**这一条推翻了一个此前的假设**：不是「换掉构建产物就等价」。实际能力是**收缩**的（见 §4）。

---

## 4. 实测能力对照

在相同外壳参数下用 4 款 MIDlet 做回归（画面取色数作为判据）：

| 样本 | 类型 | 旧内核 | 自建内核 | 结论 |
|---|---|---|---|---|
| Arena Champion | 2D 动作 | 1326 色 | 1333 色 | 正常，差异来自 `release=true` 后行为微变 |
| Box Claim | 2D 益智 | 819 | 868 | 正常 |
| Dungeon Quest | 2D RPG | 1008 | 1032 | 正常 |
| Snake | 2D 休闲 | 1333 | 1333 | 完全一致 |

**2D 结论**：等价可用。

**3D / 通信结论**：**不可用**。任何依赖 JSR-184（M3G）、Mascot Capsule、JSR-239（GLES2）、JSR-82（蓝牙）、JSR-120（WMS）的 MIDlet 在自建内核下会直接 `NoClassDefFoundError`。旧版 `gamelist.js` 中至少有 `3D赛车`、`Burnout(横冲直撞3D)`、`拉力大师Pro(3D)`、`GTA5`、`Minecraft` 等属于该范围。

---

## 5. 许可证义务（判断，非法律意见）

PluotSorbet 为 **GPL-2.0-only**。以源码修改 + 编译产物随 Web 应用分发的方式使用，判断会产生：

1. 分发 `j2me.js` / `native.js` / `classes.data` / `main-all.js` 时须附带 **GPL-2.0 全文**；
2. 须提供**对应的完整源码**（含本仓库对上游的修改），且获取方式须在应用内可见；
3. 若整个前端被打包为单一不可分割的作品分发，GPL 的传染范围需要单独评估 —— **不能默认「只公开四个 JS 文件就够了」**。

**规避冲突的设计决定**：内核产物与产品代码**物理分离**，内核以独立静态资源形式加载（非打包进 bundle），产品层通过适配器调用而不静态链接内核实现。此决定不能免除 GPL 义务，但使义务边界可界定。

### 5.1 已消除的风险

旧版类库混入 freej2me（**GPL-3.0**）与 PluotSorbet（**GPL-2.0-only**）。GPL-2.0-only 与 GPL-3.0 的组合在分发时存在兼容性争议，规划 §6.2 明确要求不得混为一谈。**自建产物已不含任何 GPL-3.0 代码，该冲突在产物层已消除** —— 这是本次重构的直接收益之一。

### 5.2 新增的风险

若要补回 3D 能力，须重新引入 freej2me / kemulator / ru/woesss 的代码，**GPL-2.0-only + GPL-3.0 冲突会立即回归**。因此 §6 的决策不是纯技术问题。

---

## 6. 阻塞级待决问题

| # | 问题 | 影响 | 可选路线 |
|---|---|---|---|
| **B1** | 3D 能力是否必须？ | 决定是否需要重新引入 GPL-3.0 组件 | ①V1.0 明确不支持 3D，在兼容性说明中如实记录；②补回 M3G/M3D，接受许可冲突并做单独评估；③寻找许可兼容的独立 M3G 实现 |
| **B2** | 分发形态（整体打包 vs 内核独立资源） | 决定 GPL 源码开放义务的范围 | 需委托方确认是否接受「应用整体以 GPL 兼容方式开源」 |

**建议（判断）**：V1.0 走路线 ①。理由：3D MIDlet 在目标用户中的占比低，而许可冲突是硬性否决项；先交付一个来源干净、2D 完整的版本，3D 作为 V1.1 的独立立项，届时再做许可评估。

---

## 7. 工具链（可复现性）

| 工具 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 20.19（实测 22.22 / 24.x） | 构建脚本运行环境 |
| TypeScript | 2.9.2（`npx -p typescript@2.9.2`） | 上游代码无法用新版 tsc 编译 |
| Emscripten | 2.0.34 | asm.js 已不可产出，改用同步 wasm（`SINGLE_FILE=1` + `WASM_ASYNC_COMPILATION=0`） |
| JDK | 8 ~ 21 推荐；27 可用（`-source 8` 会告警） | MIDP 类库编译 |
| Python | 3.x | 上游 `preprocess` 脚本已改造为 Python 3 |

完整步骤见 `scripts/README.md`。

---

## 8. 结论

**内核层已被替换为来源可完整追溯的单一上游实现，2D 能力等价，许可冲突已消除。**

但这不是「等价替换」：3D、蓝牙、无线消息、厂商扩展共 270 个类不再存在。这一点必须在产品页与兼容性说明中**明确告知用户**，不得宣称「完整支持 J2ME」。

V1.0 能否开始开发，取决于 §6 B1/B2 的决策。
