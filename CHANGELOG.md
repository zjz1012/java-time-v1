# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；
版本号遵循语义化版本。日期为实际提交日期，不做回填。

## [未发布]

### 新增

- 宿主页 `public/runtime/host.html`：在 iframe 内装配内核所需的 DOM 与全局对象，
  按 `native → j2me → main-all` 顺序加载，用 postMessage 与外壳通信。
- `PluotSorbetRuntime`：`RuntimeAdapter` 的真实实现。内核跑在 iframe 里，能力如实声明
  （暂停/续跑/调速一律 `UNSUPPORTED_CAPABILITY`，不做假成功）。
- `tests/unit/host-protocol.test.ts`：外壳与宿主页的协议一致性（版本号、指令名、事件名）
  与宿主实现约束（base 层级、jars 替身、不在源画布取上下文）。
- `docs/architecture/kernel-contract.md` 全面修订，修正首版 5 处错误。
- 工程骨架：Vite 8 + TypeScript 5.9 + React 19，含 lint / typecheck / test / build 四条命令。
- 运行时适配契约 `RuntimeAdapter`：状态机、能力声明、强类型事件、统一错误类型；配套 `MockRuntime` 与 12 项契约测试。
- `docs/SOURCE_AUDIT.md`：旧版实体定位、与其它工程的同源哈希比对、内置游戏授权状况、迁移边界。
- `docs/provenance/CORE_EVALUATION.md`：内核选型（PluotSorbet @ `46ee3e7`）、依赖链许可、能力收缩实测、GPL 义务分析。
- `docs/provenance/SOURCES.md`、`THIRD_PARTY_NOTICES.md`：来源登记台账与第三方声明。
- `docs/FEATURE_MATRIX.md`：P0 功能矩阵与验收判据。

### 变更

- 产物布局改为内核硬编码要求的形态：类库落在 `java/classes.data`，新增 `certs/_main.ks`
  与 `style/emoji/` 的收集。后两者缺失时内核会停在启动阶段且不报可见错误。
- 新增补丁 7：`libs/pipe.js` 里「父窗口必须有 DumbPipe」的假设改为容错降级，
  否则现代浏览器下 `TypeError: ... reading 'handleEvent'` 会打断启动链。
- 自有代码许可由 `GPL-3.0-only` 改为 **`GPL-2.0-or-later`**，`LICENSE` 换为 GPL-2.0 全文，
  ADR 0003 同步重写。变更原因是 `GPL-3.0-only` 与 GPL-2.0-only 的内核无法合法组成整体分发，
  会卡住发版；改后组合作品可整体按 GPLv2 分发，同时保留日后升 v3 的余地。
- 「方案未定前不得分发组合产物」的限制随之解除（ADR 0003「后果」）。
- `npm run check:kernels` 增加 WebSocket 计数输出，使「产物内是否存在回连通道」每次构建可见。
- `docs/provenance/SOURCES.md` 新增 §5.1「隔离验证」：以产物指纹、WebSocket 计数、
  网络字面量提取、`public/` 目录清单四项证据，记录自建产物与旧版第三方实现的区别。
- 更正内置游戏授权结论：旧版 45 条仅为清单、JAR 未随包；可复用资产为自研 6 + MIT 98 = 104 款。

### 已知问题

- 只验证了「能启动、能出画面」。键位映射、虚拟键区、存档、倍速、游戏库均未接入。
- 能力缺口：3D（JSR-184 / M3G / M3D）、蓝牙（JSR-82）、无线消息（JSR-120）在自建产物下不可用，
  取舍见 `CORE_EVALUATION.md` §6。
- 内核为 v2-only，组合作品的天花板是 v2：若日后补 3D 需要引入 GPL-3.0 的 freej2me，
  冲突会回归，只能靠隔离为独立程序或换内核解决，换许可无用（ADR 0003 末节）。
