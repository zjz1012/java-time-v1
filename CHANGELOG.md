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

### 变更

- 自有代码许可由 `GPL-3.0-only` 改为 **`GPL-2.0-or-later`**，`LICENSE` 换为 GPL-2.0 全文，
  ADR 0003 同步重写。变更原因是 `GPL-3.0-only` 与 GPL-2.0-only 的内核无法合法组成整体分发，
  会卡住发版；改后组合作品可整体按 GPLv2 分发，同时保留日后升 v3 的余地。
- 「方案未定前不得分发组合产物」的限制随之解除（ADR 0003「后果」）。
- 更正内置游戏授权结论：旧版 45 条仅为清单、JAR 未随包；可复用资产为自研 6 + MIT 98 = 104 款。

### 已知问题

- 内核未接入。阻塞项：3D/通信能力缺失与分发形态需先决策（`CORE_EVALUATION.md` §6）。
- 内核为 v2-only，组合作品的天花板是 v2：若日后补 3D 需要引入 GPL-3.0 的 freej2me，
  冲突会回归，只能靠隔离为独立程序或换内核解决，换许可无用（ADR 0003 末节）。
