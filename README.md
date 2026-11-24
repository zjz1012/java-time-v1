# JAVA时光 V1.0

网页版 J2ME（MIDlet）运行与管理工具。移动端竖屏优先，同时兼容 PC 浏览器。

> **状态**：阶段 0（来源审计与工程初始化）已完成；许可决策已定（ADR 0003）；
> 阶段 1 进行中 —— 真实内核已能启动出画，键位映射与虚拟键区已接入，
> 存档（按游戏隔离 + ZIP 进出）已实现，游戏库（104 款内置 + 本地导入）已上线，
> 发布验收工作流已就位（构建内核 → 真浏览器 e2e → 报告门禁），倍速与关于页待做。
> 仓库**不含可运行的模拟器产物**（`public/kernel/` 是本机构建输出），
> 但**含随包分发的内置游戏**（`public/games/`，来源逐条登记在
> [`docs/provenance/SOURCES.md`](docs/provenance/SOURCES.md) §5）与**自研 6 款的
> 完整源码**（`midlets/src/` —— 采用 GPL-2.0-or-later，对应源码随二进制一并提供）。

---

## 这是什么

用户在浏览器里导入本地的 `.jar` 文件，直接运行 J2ME 时代的手机程序；游戏库、键位、倍速、独立存档都在本地完成，不上传任何文件。

V1.0 是**独立重构版**，不继承旧版代码。模拟器内核由上游开源项目（PluotSorbet）的**源码自行编译**，
不依赖、不内嵌旧版所用的第三方私有实现与网络通道 —— 可复验证据见
[`docs/provenance/SOURCES.md`](docs/provenance/SOURCES.md) §1.1。
旧版的处置与不迁移清单见 [`docs/SOURCE_AUDIT.md`](docs/SOURCE_AUDIT.md)。

## 现在能跑什么

| 能力 | 状态 |
|---|---|
| 安装、构建、类型检查、单元测试 | ✅ 可用（289 项单元测试） |
| 运行时适配契约 + Mock 实现 | ✅ 契约测试覆盖成功/失败/超时/取消 |
| J2ME 内核（真实） | ✅ 能启动出画，有 Playwright 冒烟用例 |
| 键位映射 + 虚拟键区 | ✅ PC 键盘、多点触控、失焦抬键（诺基亚式竖屏键区） |
| 启动遮罩 / 失败提示 / 重试 | ✅ 导入时先验 JAR 结构，普通 ZIP 进不了库；`?jar=` 通道仍靠 15 秒超时兜底并给可读提示 |
| 存档：按游戏隔离 + ZIP 导出/导入 | ✅ 外壳托管；写失败不静默（提示条 + 退出拦截 + 重试 / 紧急导出 / 返回 / 放弃）；真内核 e2e 覆盖「写档→退出→重进读回」与「运行中导入→确认→重启」 |
| 游戏库：104 款内置 + 本地导入 | ✅ 搜索、分类筛选、「我导入的」、最近游玩；导入校验 manifest、`MIDlet-1` 与主类，标题取 `MIDlet-Name` |
| 许可与来源登记 | ✅ 104 款逐款 sha256 / 上游 commit / 版权人（`docs/provenance/games.json`）；自研 6 款源码入库且可重建比对 |
| 倍速 / 关于页 | ⛔ 未开始 |

内置的 104 款是自研 6 款加三批 MIT 作品（98 款），来源与许可逐条登记在
[`docs/provenance/SOURCES.md`](docs/provenance/SOURCES.md) §5。清单是生成物：
`node scripts/import-games.mjs` 从上游清单读、逐款重算指纹、复制资产，
`npm run check:games` 负责核对「清单 ↔ 资产 ↔ 真实字节」三者一致。

内核跑在独立 iframe 里（`public/runtime/host.html`），宿主只通过 postMessage 驱动它，
产品代码不接触内核的任何全局对象。启动契约（加载顺序、DOM、必需资源、出画判据）
是从产物实测反推的，见 [`docs/architecture/kernel-contract.md`](docs/architecture/kernel-contract.md)。

## 验收分几层

| 命令 | 覆盖什么 | 需要内核产物 |
|---|---|---|
| `npm run test` | 状态机、取消语义、键位表、协议一致性、页面结构、存档格式/隔离/导入时序/写失败出路、内容指纹、库页搜索/筛选/路由/导入边界/JAR 预检 | 否 |
| `npm run test:e2e` | 真内核：启动出画、方向输入进 JVM、退出、再次启动、存档写→退→重进、运行中导入→确认→重启、库页点开→退出→最近玩过、存档写失败四条出路 | **是** |
| `npm run check:games` | 内置游戏清单与 `public/games/*.data` 逐款一致（重算 sha256、数量、指纹唯一） | 否 |
| `npm run check:provenance` | 依赖与随包游戏逐款来源登记齐全（上游 commit、路径、版权人、许可），且哈希与产物相符 | 否 |
| `npm run check:midlets` | 自研 6 款的源码在、manifest 与产物对得上（不需要 JDK） | 否 |
| `npm run verify:midlets` | 有 JDK 时重编译自研 6 款，与随包产物逐条目比字节 | 否 |
| `npm run verify:e2e-report <报告>` | 证明 e2e **确实跑过**：0 通过 / 有跳过 / 有 flaky 一律失败 | — |

`test:e2e` 只需要 `public/kernel/`（不入库的构建产物）。测试游戏用的是**随包分发**
的自研推箱子 `public/games/sokoban.data` —— 入库文件，新克隆就直接有，不需要另配
secret，也不会出现「测试专用副本与线上文件不一致」。缺内核产物时用例会**显式跳过
并打印缺了哪个文件**，不会静默通过。

常态 CI（`.github/workflows/ci.yml`）只到第一层：内核产物按要求不入库，
它的 `kernel-smoke` job 名字里就写着「仅加载校验，不执行内核」——
那个绿**不代表**真内核跑通，只代表用例能加载（语法、导入路径、配置没坏）。

发布验收在 `.github/workflows/release.yml`（推 `v*` 标签或手动触发）：
装 emsdk 2.0.34 与 JDK 构建内核 → Chromium 跑全量 e2e → 校验报告。
**跑不到就不算通过**。四种情况都会让它失败：

| 情况 | 为什么会失败 |
|---|---|
| 内核产物缺失 | `REQUIRE_KERNEL=1` 让 `check:kernels` 直接报错，不再「跳过通过」 |
| 随包游戏缺失或指纹不符 | 构建之前先跑 `check:games`，104 款逐款重算 sha256 |
| 自研源码与产物对不上 | 构建之前先跑 `check:midlets`：源码缺失、类名 / `MIDlet-1` / 主类条目不一致都红 |
| 用例被跳过 | `playwright test` 对「全部 skip」的退出码是 **0**，只看退出码会把「没跑」当成「跑通了」 |
| 有 flaky | 重试才过说明存在偶发问题，发布前要知道 |

所以「发布验收通过」这个结论只有一种来源：真内核 e2e 实际执行并通过。

## 快速开始

```bash
npm install
npm run dev        # 开发服务器（默认 5183）
npm run typecheck  # 类型检查
npm run test       # 单元 / 集成测试
npm run lint       # 代码检查
npm run test:e2e   # 真内核冒烟（先构建内核；产物缺失时跳过）
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/e2e.json npm run test:e2e -- --reporter=list,json
npm run verify:e2e-report test-results/e2e.json   # 证明「真的跑了」（发布验收用）
npm run build      # 生产构建
```

需要 Node.js ≥ 20.19。

### 直接开一个程序包（不走游戏库）

库页已经随包内置 104 款，打开首页就能玩。要试自己的包，有两条路：
在库里点「导入游戏」选一个 `.jar`（存在本机浏览器里），或者用开发通道：

```bash
npm run dev
# 打开 http://localhost:5183/?jar=/games/sokoban.data&name=推箱子
```

`?jar=` 是给排查内核问题用的：它不需要库条目，也不写游玩记录。路径可以直接指向
随包分发的某一款（`public/games/*.data`），也可以把任意 `.jar` 放到 `public/` 下的
临时目录再指过去 —— 但那种文件不入库，只适合本机。导入游戏请走库页的「导入游戏」，
它会做 JAR 预检并算出存档指纹。

键位：方向键 / WASD 移动，空格或回车确认，`[` `]` 或 F1 F2 左右软键，数字键直输，
退格是清除键。手机上用的是屏幕下方的虚拟键区，照诺基亚直板机排：软键 → 圆形导航盘
（含 OK）与右侧 C 键 → 3×4 数字键盘。为什么键盘不是靠 `keydown` 进内核的，见
[`docs/decisions/0004-input-path.md`](docs/decisions/0004-input-path.md)。

V1.0 只做竖屏，横屏不做适配。

### 重建 J2ME 内核（可选）

内核产物不在仓库里，需要本机工具链编译。见 [`scripts/README.md`](scripts/README.md)。
额外需要 Emscripten 2.0.34、JDK、Python 3。

自研那 6 款游戏反过来是「源码在仓库、产物也在仓库」，两者要能对上：
`npm run check:midlets` 只验结构（不需要 JDK），`npm run verify:midlets` 会重编译
并逐 class 比字节 —— 需要 JDK 和已经构建好的内核 classpath。见
[`midlets/README.md`](midlets/README.md)。

## 目录

```
src/
├── app/       应用装配、hash 路由与页面（库页 / 运行页）
├── runtime/   运行时适配契约（与内核之间唯一的接触面）
├── bridge/    应用层与运行时的消息协议          （待实现）
├── input/     键位表与 PC 键盘监听
├── speed/     模拟速率控制                      （待实现）
├── saves/     按游戏隔离的存档仓储 + ZIP 进出
├── library/   游戏库：内置清单、搜索筛选、导入、游玩记录
├── ui/        样式（app.css 通用 / library.css 库页）
└── shared/    无业务倾向的公共工具
public/
├── games/     内置游戏的包体与封面（随包分发，来源见 SOURCES.md §5）
├── runtime/   宿主页 host.html
└── assets/    本机临时放进去的程序包（不入库，只给 `?jar=` 调试用）
midlets/
├── src/       自研 6 款的完整 Java 源码（GPL-2.0-or-later 的对应源码）
└── games.json 源码 ↔ manifest 名字 ↔ 主类的对照（构建脚本读它）
docs/
├── provenance/  来源登记、第三方声明、内核评估
├── decisions/   架构决策记录（ADR）
├── architecture/ 模块与协议设计
├── testing/     测试策略与设备矩阵
└── releases/    版本说明
scripts/       构建与校验脚本（不含业务逻辑）
tests/         单元 / 集成 / E2E / 测试固件
```

## 许可与来源

产品代码与内核产物分开授权，因为二者许可不同：

- **本仓库自有代码**：`GPL-2.0-or-later`，全文见 [`LICENSE`](LICENSE)。
  即：可任选 GPLv2 或更新版本使用与再分发。
- **内核**（PluotSorbet 及其编译产物）：`GPL-2.0`（上游 LICENSE 无 "or later"），
  不在本仓库内，按 [`scripts/README.md`](scripts/README.md) 从上游源码重建；
  来源与 commit 见 [`docs/provenance/SOURCES.md`](docs/provenance/SOURCES.md)。
- **随包游戏**：自研 6 款（同本仓库许可，源码在 `midlets/src/`）+ MIT 98 款
  （各自保留原版权声明）。逐款的 commit、路径、版权人与哈希见
  [`docs/provenance/games.json`](docs/provenance/games.json)。

自有代码采用 `or-later` 而非 `only`，是为了与 v2-only 的内核能合法组成整体按 GPLv2
分发，同时保留日后整体升到 v3 的余地。完整推导与代价见
[`docs/decisions/0003-license.md`](docs/decisions/0003-license.md)。

第三方组件清单见 [`docs/provenance/THIRD_PARTY_NOTICES.md`](docs/provenance/THIRD_PARTY_NOTICES.md)。

## 已知限制

- 3D（JSR-184 / Mascot Capsule）、蓝牙（JSR-82）、无线消息（JSR-120）在自建内核下**不可用**。
- 不支持旧版存档与旧版键位配置的迁移（规划明确不做）。
- 随包游戏只收自研与 MIT：自研 6 款 + 第三方 MIT 98 款，逐条来源见
  `docs/SOURCE_AUDIT.md` §4.2；不收录任何缺少分发授权的商业 JAR。
