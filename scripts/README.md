# 内核构建管線

内核产物（`j2me.js` / `native.js` / `main-all.js` / `classes.data`）**不入库**，由本目录的脚本从上游源码重建。
重建结果必须与 `docs/provenance/SOURCES.md` 的登记一致。

## 为什么需要这些脚本

上游 PluotSorbet 最后活跃于 2017–2018 年，其构建链假设 Python 2.7、JDK 5/6、当年的 Emscripten。
直接 `make` 在今天的机器上必然失败。这里的三份脚本各自解决一段：

| 脚本 | 作用 |
|---|---|
| `fetch-upstream.sh` | 按钉定 commit 拉取源码 + submodule，并校验哈希 |
| `fixup-upstream.py` | 把上游改到能在现代工具链编译（**幂等**，可反复跑） |
| `build-kernel.sh` | 依次执行：适配 → 配置 → 本地化 → 类库 → JVM → native → 拼接 → 收集 |
| `build-main-all.py` | 严格按 Makefile 的 `MAIN_JS_SRCS` 顺序拼接运行时，并打外壳适配补丁 |
| `files/StringBuilder.java` | 上游缺失的类，由 `fixup-upstream.py` 注入 |

## 前置工具

| 工具 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 20 | 脚本宿主；`tsc` 由 npx 拉取 |
| Python | 3.x | 上游 `preprocess` 脚本已改造为 Python 3 |
| JDK | 8 ~ 21 推荐 | 编译 MIDP 类库；JDK 27 可用但 `-source 8` 会告警 |
| Emscripten | 2.0.34 | 必须，其他版本未验证 |

`emsdk` 默认放在 `.work/emsdk`，可用 `EMSDK_DIR` 覆盖。安装：

```bash
git clone https://github.com/emscripten-core/emsdk.git .work/emsdk
cd .work/emsdk && ./emsdk install 2.0.34 && ./emsdk activate 2.0.34
```

> 网络慢时 `emsdk install` 容易在下载阶段反复失败。可直接用 `curl -C -` 把
> 包下载到 `emsdk/downloads/` 再 install，实测比内置下载器快一个数量级。

## 步骤

```bash
bash scripts/fetch-upstream.sh     # 1. 拉源码，校验 commit
bash scripts/build-kernel.sh       # 2. 全量重建，产物到 public/kernel/
```

只改 JS 侧时跳过 Java（省约 3 分钟）：

```bash
SKIP_JAVA=1 bash scripts/build-kernel.sh
```

## 踩过的坑（都已固化进脚本）

这些现象看起来毫不相关，实际都来自工具链代差。记在这里是为了下次不重查。

| # | 症状 | 原因与修法 |
|---|---|---|
| 1 | 产物能启动，但报 `Cannot read properties of null (reading 'superClass')` | emcc 2.x 把 `memcpy`/`memset` 从 `library.js` 移进 libc，不再自动导出 → 内存操作静默损坏。**必须显式导出** `_memcpy` / `_memset` |
| 2 | configure 报 `libatomic_ops is required` / `EEXIST: mkdir out` / `confdefs.h 不存在` | 当 PATH 前面有删除拦截 shim 时，configure 的清理步骤被拦，conftest 残留。脚本开头把 shim 目录从 PATH 摘掉 |
| 3 | configure 报 `cannot run C compiled programs` | emcc 产出的 conftest 是 wasm，configure 想执行它；Node 24 的 `fetch` 不接受裸路径。修法 = 给两份 `config.sub` 放行 `wasm32-unknown-emscripten` + 显式 `--host` |
| 4 | `bld/native.js` 目标永远不存在，每次都重新 configure | 交叉编译只产 `.libs/libgc.a`，而 Makefile 在 macOS 上找 `.dylib`。用 wildcard 判断优先静态库 |
| 5 | 编译通过但类库缺 `com.sun.j2me.location` | `java/Makefile` 的 `SRC_DIRS` 在 `JSR_179=1` 时多一项 `jsr-179`，脚本必须跟它一致 |
| 6 | 图标与本地化字符串在运行期取不到 | `jar cf0` 之后还要 `jar uf0` 追加 EXTRA（png / bin / l10n json） |
| 7 | 内核零报错但不启动 | `MAIN_JS_SRCS += main.js` 在 Makefile 里是**无条件追加**，位于续行清单之后，只解析续行块会漏掉启动入口 |
| 8 | 类库加载后立刻断言失败 | `config.ts` 的 `release` 默认 `false`，此时 `assert(false, …)` 全部生效而 `Debug.error` 直接 throw。必须 `make RELEASE=1` |
| 9 | `tsc` 退出码非 0 但产物是好的 | 上游代码在 TS 2.9 下有 2 处已知类型错（`jit/analyze.ts` TS2365、`vm/parser.ts` TS2540），`noEmitOnError=false` 仍完整输出。脚本做白名单，**不能简单 `|| true`** |

## 产物与许可

四件产物是 PluotSorbet（GPL-2.0）的衍生作品。分发时必须同时提供：

1. GPL-2.0 全文（`docs/provenance/license-texts/GPL-2.0.txt`）
2. 对应源码的获取方式 —— 即上游 commit + 本目录的补丁脚本（合起来可完整重建）

因此这些脚本**不是开发便利工具，是许可义务的一部分**，不要删除或简化到不可重建。
