# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；
版本号遵循语义化版本。日期为实际提交日期，不做回填。

## [未发布]

### 新增

- 工程骨架：Vite 8 + TypeScript 5.9 + React 19，含 lint / typecheck / test / build 四条命令。
- 运行时适配契约 `RuntimeAdapter`：状态机、能力声明、强类型事件、统一错误类型；配套 `MockRuntime` 与 12 项契约测试。
- `docs/SOURCE_AUDIT.md`：旧版实体定位、与其它工程的同源哈希比对、内置游戏授权状况、迁移边界。
- `docs/provenance/CORE_EVALUATION.md`：内核选型（PluotSorbet @ `46ee3e7`）、依赖链许可、能力收缩实测、GPL 义务分析。
- `docs/provenance/SOURCES.md`、`THIRD_PARTY_NOTICES.md`：来源登记台账与第三方声明。
- `docs/FEATURE_MATRIX.md`：P0 功能矩阵与验收判据。

### 已知问题

- 内核未接入。阻塞项：3D/通信能力缺失与 GPL 分发形态需先决策（`CORE_EVALUATION.md` §6）。
- 自有代码的对外许可尚未确定。
