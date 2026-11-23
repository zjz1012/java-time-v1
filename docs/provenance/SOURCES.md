# 来源登记台账

> 本文件是唯一可信的来源清单。任何未在此登记的第三方代码或素材，不得进入仓库。
> 「精确版本」不接受「最新版」这种写法；commit / 版本号 / 校验值三选一，必须可复核。
> 最近审核：2026-11-23

---

## 一、运行时内核（随应用分发）

### 1.1 PluotSorbet

| 字段 | 内容 |
|---|---|
| 组件名称 | PluotSorbet（J2ME / JVM 浏览器运行时） |
| 原作者 / 权利人 | Mozilla 及贡献者 |
| 上游仓库 | `https://github.com/mozilla/pluotsorbet` |
| 精确版本 | commit `46ee3e78a4fd9c3f09026cc5cbdcf76e94b7a398` |
| 许可证 | **GPL-2.0**（仓库根 `LICENSE` 为 GPL v2 全文，**无 "or later"**） |
| 使用方式 | 源码复制 → 本地修改 → 编译为 `j2me.js` / `native.js` / `classes.data` / `main-all.js` |
| 本地修改 | 见下方 1.1.1；全部由 `scripts/fixup-upstream.py` 幂等施加 |
| 证明材料 | 上游 `LICENSE`、commit 哈希、本仓库 `docs/provenance/license-texts/GPL-2.0.txt` |
| 责任人 / 日期 | 开发方 / 2026-11-23 |

#### 1.1.1 本地修改清单

| 文件 | 修改 | 原因 |
|---|---|---|
| `tools/preprocess-1.1.0/lib/preprocess.py` | 9 处 Python 2 → 3 语法 | `except X, e`、`0777`、`has_key`、`types.StringType`、`bytes.startswith(str)` |
| `vm/native/Boehm.js/include/private/gc_priv.h` | `void GC_noop();` → `void GC_noop(void*, ...);` | K&R 空参数声明在现代 clang 下等价 `(void)`，与调用点冲突 |
| `vm/native/Boehm.js/mark.c` | `void GC_noop() {}` → `void GC_noop(void *p, ...) {}` | 与上一条对齐，否则 wasm 运行到 `unreachable` |
| `vm/native/Boehm.js/config.sub`、`libatomic_ops/config.sub` | 放行 `wasm32-unknown-emscripten` 三元组 | configure 在交叉编译时不应执行 wasm conftest |
| `java/custom/java/lang/StringBuilder.java` | 新增（委托 `StringBuffer`） | 上游只有 `StringBuffer`，现代 javac 的字符串拼接生成 `StringBuilder` |
| `java/build-src/**/*.java` | `enum` 标识符 → `en` | Java 1.3 允许 `enum` 作标识符，javac 5+ 视为保留字 |
| `Makefile` | 优先静态库 `libgc.a`；收敛 emcc 开关；显式导出 `_memcpy` / `_memset` | 交叉编译只产 `.a`；emcc 2.x 移除了若干 `-s` 开关 |
| `config.ts` | `release = true`（由 `make RELEASE=1` 生成） | `release=false` 时 `assert(false, …)` 全部生效，而 `Debug.error` 直接 throw |

> GPL-2.0 要求分发衍生作品时提供对应完整源码。上述修改脚本与构建脚本均在本仓库内，
> 组合起来即可完整重建产物，满足「对应源码」的可获取性要求。

### 1.2 Boehm.js（Boehm GC 的 Emscripten 移植）

| 字段 | 内容 |
|---|---|
| 上游 | `https://github.com/marco-c/Boehm.js`（PluotSorbet 的 git submodule） |
| 精确版本 | submodule commit `712978aea8b6a30bee949d78275aafb0e8cbc887` |
| 许可证 | Boehm-Demers-Weiser GC 许可（宽松，类 MIT/X11） |
| 使用方式 | 静态链接进 `native.js` |
| 本地修改 | 见 1.1.1 中两条 `GC_noop` 与 `config.sub` |
| 证明材料 | 上游 `README` / 许可原文；submodule 哈希 |

### 1.3 Relooper

| 字段 | 内容 |
|---|---|
| 原作者 | Alon Zakai |
| 上游 | `https://github.com/kripken/Relooper`（随 PluotSorbet `jit/relooper/`） |
| 精确版本 | 随 1.1 的 commit |
| 许可证 | **MIT**（产物尾部保留 `// Relooper, (C) 2012 Alon Zakai, MIT license`） |
| 使用方式 | 编译进 `native.js` |

### 1.4 encoding.js（TextEncoder / TextDecoder polyfill）

| 字段 | 内容 |
|---|---|
| 原作者 | Joshua Bell |
| 位置 | PluotSorbet `libs/encoding.js` |
| 许可证 | **Apache-2.0**（文件头保留声明） |
| 使用方式 | 参与 `j2me.js` 拼接 |

### 1.5 Emscripten 运行时

| 字段 | 内容 |
|---|---|
| 版本 | emsdk 2.0.34 |
| 许可证 | MIT / UIUC |
| 使用方式 | 由 `emcc` 内联进 `native.js` |

---

## 二、构建期工具（不分发）

| 组件 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| Node.js | ≥ 20.19 | MIT | 构建脚本宿主 |
| TypeScript | 2.9.2（内核） / 5.9.3（应用） | Apache-2.0 | 编译 |
| Emscripten | 2.0.34 | MIT / UIUC | C++ → wasm |
| JDK | 8 ~ 27 | GPL-2.0 + Classpath Exception | 编译 MIDP 类库 |
| Python | 3.x | PSF | 上游预处理脚本 |

JDK 的 Classpath Exception 意味着编译产物不受 GPL 传染 —— 但**MIDP 类库本身是 PluotSorbet 的源码**，其许可由 1.1 决定，与 JDK 无关。

---

## 三、应用依赖（npm，锁定在 `package-lock.json`）

| 包 | 版本 | 许可证 | 用途 | 分发形态 |
|---|---|---|---|---|
| `react` | 19.3.1 | MIT | UI | 打包进 bundle |
| `react-dom` | 19.3.1 | MIT | UI | 打包进 bundle |
| `vite` | 8.3.8 | MIT | 构建 | 仅构建期 |
| `@vitejs/plugin-react` | 6.3.0 | MIT | 构建 | 仅构建期 |
| `typescript` | 5.9.3 | Apache-2.0 | 类型检查 | 仅构建期 |
| `vitest` | 5.1.1 | MIT | 单元测试 | 仅测试 |
| `jsdom` | 31.0.1 | MIT | 测试环境 | 仅测试 |
| `eslint` | 10.15.0 | MIT | 静态检查 | 仅构建期 |
| `typescript-eslint` | 8.73.0 | MIT | 静态检查 | 仅构建期 |
| `@eslint/js` | 10.0.1 | MIT | 静态检查 | 仅构建期 |
| `@playwright/test` | 1.65.1 | Apache-2.0 | E2E | 仅测试 |
| `@types/*` | 见 lock | MIT | 类型声明 | 仅构建期 |

传递依赖的完整清单以 `package-lock.json` 为准；新增直接依赖必须补登本表。

---

## 四、素材

| 素材 | 来源 | 授权状态 |
|---|---|---|
| `src/ui/app.css` | 本项目自写 | 自有 |
| 测试用 MIDlet | **尚未创建**，将由本仓库 `tests/fixtures/` 源码编译 | 自有 |

**当前仓库不含任何第三方图片、字体、音乐、游戏 JAR。**

---

## 五、明确不登记（已排除）

以下内容经核查后**不进入**本仓库，登记在此仅为留痕：

| 对象 | 排除理由 |
|---|---|
| 旧版 `shiwan2/` 全部内容 | 来源不可追溯，见 `docs/SOURCE_AUDIT.md` §6.1 |
| `qq.zixing.fun` 通道及其实现 | 私有网络层，运营方与合法性均未核实 |
| 旧版 45 条游戏清单与 `jars/koudai.data` | 清单引用的 45 个 JAR 均未随包（实测 `jars/` 仅 1 个文件）；该文件为 2008 年 `口袋灵兽`，Vendor `lxs`，无任何许可文件 |
| freej2me（GPL-3.0）/ kemulator / ru/woesss | 未纳入自建产物；若将来补回 3D 能力，须重新登记并单独评估 GPL-2.0-only 与 GPL-3.0 的组合问题 |

### 5.1 隔离验证：自建产物与旧版实现的区别（可复验）

「不含旧版第三方实现」不靠声明，靠下面四项证据。任何一项失效即视为回潮。

| 证据 | 方法 | 当前结果 |
|---|---|---|
| 产物来自上游自建 | `shasum -a 256 public/kernel/*`，与 `j2me-toy` 分支 `feat/upstream-kernel` 的同名产物逐字节比对 | 四件全部一致 |
| 无私有回连通道 | `npm run check:kernels` 打印各产物 WebSocket 计数 | 合计 **0** |
| 无硬编码远端地址 | 提取产物内全部 `http(s)://` / `ws(s)://` 字面量 | 仅注释中的规范文档与开源项目链接 |
| 宿主页不夹带旧版外壳 | `public/` 目录内容 | 仅 `kernel/` 四件产物 |

产物指纹（sha256 前 16 位）：

| 产物 | 大小 | sha256 |
|---|---|---|
| `j2me.js` | 600,756 B | `36ba05ede2b61505` |
| `native.js` | 125,017 B | `d78d910c73b6973a` |
| `main-all.js` | 593,331 B | `491748e7200fc429` |
| `classes.data` | 1,779,855 B（1103 个 zip 条目） | `ba3ad8ed20286561` |

两点说明：

1. `public/kernel/` 不入库（`.gitignore`），上表用于**本地重建后核对**；重建流程见 `scripts/README.md`。
   哈希变化不等于出问题 —— 换编译器版本或改补丁都会变，但「与自建产物一致」这条判据要求
   与重建结果对齐，不能与来历不明的二进制对齐。
2. 产物内唯一保留的 `XMLHttpRequest` 出现在 `load(file)`，用于读取 `java/classes.data` 等
   **本地**资源，URL 由调用方传入，产物本身没有写死任何远端地址。

---

## 六、登记纪律

1. 新增第三方代码前先登记，后写代码。未登记不予合并。
2. 版本号写精确值；用 git 依赖的写 commit 全哈希。
3. 许可必须核对**仓库内的原文**，不以 README 的一句话或二手资料为准。
4. 「上游说可以商用」不算证明，`LICENSE` 文件才算。
