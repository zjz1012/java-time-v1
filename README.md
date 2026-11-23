# JAVA时光 V1.0

网页版 J2ME（MIDlet）运行与管理工具。移动端竖屏优先，同时兼容 PC 浏览器。

> **状态**：阶段 0（来源审计与工程初始化）已完成；许可决策已定（ADR 0003）；
> 阶段 1 进行中 —— 真实内核已能启动出画，键位映射与虚拟键区已接入，
> 存档、倍速与产品界面待做。
> 仓库**不含可运行的模拟器产物**（`public/kernel/` 是本机构建输出），
> 只含工程骨架、适配层与内核构建管线。

---

## 这是什么

用户在浏览器里导入本地的 `.jar` 文件，直接运行 J2ME 时代的手机程序；游戏库、键位、倍速、独立存档都在本地完成，不上传任何文件。

V1.0 是**独立重构版**，不继承旧版代码。模拟器内核由上游开源项目（PluotSorbet）的**源码自行编译**，
不依赖、不内嵌旧版所用的第三方私有实现与网络通道 —— 可复验证据见
[`docs/provenance/SOURCES.md`](docs/provenance/SOURCES.md) §5.1。
旧版的处置与不迁移清单见 [`docs/SOURCE_AUDIT.md`](docs/SOURCE_AUDIT.md)。

## 现在能跑什么

| 能力 | 状态 |
|---|---|
| 安装、构建、类型检查、单元测试 | ✅ 可用（70 项单元测试） |
| 运行时适配契约 + Mock 实现 | ✅ 契约测试覆盖成功/失败/超时 |
| J2ME 内核（真实） | ✅ 能启动出画（自研推箱子实测） |
| 键位映射 + 虚拟键区 | ✅ PC 键盘、多点触控、失焦抬键（诺基亚式竖屏键区） |
| 启动遮罩 / 失败提示 / 重试 | ✅ 坏包靠超时兜底，15 秒后给可读提示 |
| 存档 / 倍速 / 游戏库 / UI | ⛔ 未开始 |

内核跑在独立 iframe 里（`public/runtime/host.html`），宿主只通过 postMessage 驱动它，
产品代码不接触内核的任何全局对象。启动契约（加载顺序、DOM、必需资源、出画判据）
是从产物实测反推的，见 [`docs/architecture/kernel-contract.md`](docs/architecture/kernel-contract.md)。

## 快速开始

```bash
npm install
npm run dev        # 开发服务器（默认 5183）
npm run typecheck  # 类型检查
npm run test       # 单元 / 集成测试
npm run lint       # 代码检查
npm run build      # 生产构建
```

需要 Node.js ≥ 20.19。

### 跑一个真实程序包

阶段 1 还没有游戏库，运行页由显式参数唤起：

```bash
cp <任意 .jar> public/assets/game.jar      # public/assets/*.jar 不入库
npm run dev
# 打开 http://localhost:5183/?jar=/assets/game.jar&name=推箱子
```

键位：方向键 / WASD 移动，空格或回车确认，`[` `]` 或 F1 F2 左右软键，数字键直输，
退格是清除键。手机上用的是屏幕下方的虚拟键区，照诺基亚直板机排：软键 → 圆形导航盘
（含 OK）与右侧 C 键 → 3×4 数字键盘。为什么键盘不是靠 `keydown` 进内核的，见
[`docs/decisions/0004-input-path.md`](docs/decisions/0004-input-path.md)。

V1.0 只做竖屏，横屏不做适配。

### 重建 J2ME 内核（可选）

内核产物不在仓库里，需要本机工具链编译。见 [`scripts/README.md`](scripts/README.md)。
额外需要 Emscripten 2.0.34、JDK、Python 3。

## 目录

```
src/
├── app/       应用装配与页面框架
├── runtime/   运行时适配契约（与内核之间唯一的接触面）
├── bridge/    应用层与运行时的消息协议          （待实现）
├── input/     键位表与 PC 键盘监听
├── speed/     模拟速率控制                      （待实现）
├── saves/     按游戏隔离的存档仓储              （待实现）
├── library/   游戏库与导入                      （待实现）
├── ui/        展示组件                          （待实现）
└── shared/    无业务倾向的公共工具
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
- **随包游戏**：自研 6 款（同本仓库许可）+ MIT 98 款（各自保留原版权声明）。

自有代码采用 `or-later` 而非 `only`，是为了与 v2-only 的内核能合法组成整体按 GPLv2
分发，同时保留日后整体升到 v3 的余地。完整推导与代价见
[`docs/decisions/0003-license.md`](docs/decisions/0003-license.md)。

第三方组件清单见 [`docs/provenance/THIRD_PARTY_NOTICES.md`](docs/provenance/THIRD_PARTY_NOTICES.md)。

## 已知限制

- 3D（JSR-184 / Mascot Capsule）、蓝牙（JSR-82）、无线消息（JSR-120）在自建内核下**不可用**。
- 不支持旧版存档与旧版键位配置的迁移（规划明确不做）。
- 随包游戏只收自研与 MIT：自研 6 款 + 第三方 MIT 98 款，逐条来源见
  `docs/SOURCE_AUDIT.md` §4.2；不收录任何缺少分发授权的商业 JAR。
