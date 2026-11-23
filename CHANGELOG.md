# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；
版本号遵循语义化版本。日期为实际提交日期，不做回填。

## [未发布]

### 新增

- `tests/e2e/kernel-smoke.spec.ts` + `playwright.config.ts`：**真内核冒烟测试**。
  把 JAR 真的喂进 PluotSorbet，覆盖启动出画、方向输入（键码真的进 JVM）、退出、
  再次启动、启动途中退出五个场景。缺内核产物时显式跳过并打印缺了哪个文件。
- `tests/unit/runtime-abort.test.ts`：取消语义的回归测试 —— 等待中的 `load` / `start`
  被 `dispose` 打断时必须拿到 `ABORTED`，而不是永远挂着的 Promise。
- `tests/unit/e2e-guard.test.ts`：钉住 e2e 的存在性与判据（四个场景齐全、
  出画判据用颜色数而非 `toDataURL` 长度），防止它因长期 skip 被悄悄删掉。
- `RuntimeState` 新增 `starting`：启动指令发出到首帧之间是独立状态。
  有了它，运行页才能在「已请求启动」阶段继续盖遮罩。
- CI 新增 `kernel-smoke` job：检测内核产物，有则真跑 e2e，无则只校验用例可加载
  并输出 notice。内核产物按要求不入库，这是有意的取舍，不装作覆盖了真内核。
- 运行页界面：启动遮罩（转圈 + 「首次启动要加载内核，约 5~10 秒」）、失败态文案与「重试」。
  遮罩盖在画面上而不是另起一块，避免挤掉画面高度。
- `tests/unit/keypad-structure.test.ts`：钉住五条抬键路径，以及数字键盘常驻、12 键带 T9 字母、
  `clear` 独立于软键。
- `tests/unit/player-structure.test.ts`：钉住遮罩覆盖条件、失败必须可重试、触屏隐藏键盘提示、
  不引入横屏分支。
- 输入系统：逻辑按键（`up`/`down`/`left`/`right`/`fire`/`soft1`/`soft2`/数字/`*`/`#`/`clear`）、
  物理键位表（`src/input/keymap.ts`）、外壳键盘监听（`src/input/keyboard.ts`）、
  虚拟键区（`src/app/Keypad.tsx`，Pointer Events，支持多点同按）。
- 运行页 `src/app/PlayerScreen.tsx`：画面 + 键区 + 状态，阶段 1 由 `?jar=<url>&name=<名>` 唤起。
- `RuntimeAdapter.sendKey(control, phase): boolean`（同步，返回是否送达）与
  `RuntimeCapabilities.keyInput`。`MockRuntime` 同步实现并记录按键，供契约测试断言。
- `tests/unit/input-keymap.test.ts`：外壳键位表与宿主页 `CONTROL_CODES` 表的一致性；
  钉住 `119/115/97/100/32` 这几个来自内核源码的取值。
- `tests/unit/input-keyboard.test.ts`：成对送出、自动重复不转发、一对多物理键配对、
  失焦抬键、输入框放行。
- `tests/unit/runtime-input.test.ts`：`sendKey` 在各状态下的送达语义。
- `docs/decisions/0004-input-path.md`：为什么注入设备键码而不是合成键盘事件。
- `docs/architecture/kernel-contract.md` §12「输入」：设备键码表、三条必需约束、
  `GameCanvas(true)` 的已知限制。
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

- **拆实例时主动拒绝挂起的等待**：`#teardown()` 现在以 `ABORTED` 结束正在等的
  `load` / `start`，不再只清计时器。旧写法留下的 Promise 永不 settle ——
  组件卸载后闭包还握着 runtime 与 JAR 字节，「等加载完再继续」的代码再也不执行，
  而界面上看不出任何异常。
- **`start()` 不再提前把状态标成 `running`**：改为先 `starting`，收到宿主的
  `first-paint` 才进 `running`。旧写法会让运行页的遮罩条件（`!running`）提前失效，
  用户看到 2~4 秒纯黑，与「已经挂了」无法区分。
- 启动期间宿主发来的 `loading` 不再把状态退回 `loading`：那是它自己的装配阶段，
  退回去只会让徽标闪一下。
- 虚拟键区改为**诺基亚直板机形态**：上方左/右软键贴住画面两角，中间是圆形导航盘
  （四方向 + 圆形 OK），右侧 C 清除键，下方 3×4 数字键盘**常驻**并带 T9 字母。
  上一版是掌机逻辑（十字键偏左、功能键占右侧、数字键要点一下才出来），在手机上
  读不出来 —— 拇指的位置感来自「上面导航、下面数字」这个固定排布。
- 数字键行高独立于导航盘（44px）。与导航盘等高时每行只剩 37px，低于可点下限。
- 运行页顶栏合并成一行（标题 + 状态徽标 + 返回），省下的一行还给画面。
- **只做竖屏**：横屏适配整段移除。留半套横屏规则比完全不做更糟 —— 它会在没人验证过的
  尺寸上生效。横屏真要打磨，得先定画面比例与键区分布，那是独立的一轮设计。
- 启动超时默认值由 30s 降到 **15s**。坏包（非 JAR、无 `MIDlet-1`）不会让内核报错，
  它只是永远不出画 —— 30 秒的等待在用户看来就是一个转不完的圈。
- `TIMEOUT` 的用户文案补上「程序包不完整」这个更常见的原因，不再只说文件过大 / 性能不足。
- 物理键盘提示只在 `pointer: fine` 下显示。
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

- 存档、倍速、游戏库、产品界面均未接入；运行页目前由 `?jar=` 参数唤起。
- 无效的程序包只能靠**超时**判失败：内核遇到非 JAR 或缺少 `MIDlet-1` 时不报错、也不出画，
  外壳除了等满 15 秒之外没有别的信号可用。真正的「包无效」识别要等 F6 做 JAR 预检。
- 构造 `GameCanvas(true)` 的游戏不可控：内核把 `setSuppressKeyEvents` 实现成全局开关，
  连 `getKeyStates()` 的键掩码都不再更新（与 JSR 规范不符，见 `kernel-contract.md` §12.3）。
- `#`（`pound`）没有默认物理键（US 布局上是 Shift+3，与 `Digit3` 撞车），只能在小键盘面板按。
- 能力缺口：3D（JSR-184 / M3G / M3D）、蓝牙（JSR-82）、无线消息（JSR-120）在自建产物下不可用，
  取舍见 `CORE_EVALUATION.md` §6。
- 内核为 v2-only，组合作品的天花板是 v2：若日后补 3D 需要引入 GPL-3.0 的 freej2me，
  冲突会回归，只能靠隔离为独立程序或换内核解决，换许可无用（ADR 0003 末节）。
