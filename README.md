# JAVA时光 V1.0

网页版 J2ME（MIDlet）运行与管理工具。移动端竖屏优先，同时兼容 PC 浏览器。

> **状态**：阶段 0（来源审计与工程初始化）已完成，阶段 1 待核心许可问题决策后开始。
> 当前仓库**不含可运行的模拟器**，只含工程骨架、运行时适配契约与内核构建管线。

---

## 这是什么

用户在浏览器里导入本地的 `.jar` 文件，直接运行 J2ME 时代的手机程序；游戏库、键位、倍速、独立存档都在本地完成，不上传任何文件。

V1.0 是**独立重构版**，不继承旧版代码。旧版的处置与不迁移清单见 [`docs/SOURCE_AUDIT.md`](docs/SOURCE_AUDIT.md)。

## 现在能跑什么

| 能力 | 状态 |
|---|---|
| 安装、构建、类型检查、单元测试 | ✅ 可用 |
| 运行时适配契约 + Mock 实现 | ✅ 12 项契约测试 |
| J2ME 内核（真实） | ⛔ 未接入，见下 |
| 游戏导入 / 键位 / 倍速 / 存档 / UI | ⛔ 未开始 |

内核不接入的原因不是技术障碍，而是一个必须先拍板的许可决策：内核层已能用上游源码自建并通过 2D 回归，但会丢失 3D 与通信类能力（270 个类）。详见
[`docs/provenance/CORE_EVALUATION.md`](docs/provenance/CORE_EVALUATION.md) §6。

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

### 重建 J2ME 内核（可选）

内核产物不在仓库里，需要本机工具链编译。见 [`scripts/README.md`](scripts/README.md)。
额外需要 Emscripten 2.0.34、JDK、Python 3。

## 目录

```
src/
├── app/       应用装配与页面框架
├── runtime/   运行时适配契约（与内核之间唯一的接触面）
├── bridge/    应用层与运行时的消息协议          （待实现）
├── input/     虚拟键盘与 PC 按键映射            （待实现）
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

- **内核**（PluotSorbet 及其编译产物）：`GPL-2.0`，对应源码获取方式见 [`docs/provenance/SOURCES.md`](docs/provenance/SOURCES.md)。
- **本仓库自有代码**：许可待委托方确认后填入，当前不得视为已授权分发。

第三方组件清单见 [`docs/provenance/THIRD_PARTY_NOTICES.md`](docs/provenance/THIRD_PARTY_NOTICES.md)。

## 已知限制

- 3D（JSR-184 / Mascot Capsule）、蓝牙（JSR-82）、无线消息（JSR-120）在自建内核下**不可用**。
- 不支持旧版存档与旧版键位配置的迁移（规划明确不做）。
- 不内置任何商业游戏；只有本地导入一条路径。
