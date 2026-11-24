# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；
版本号遵循语义化版本。日期为实际提交日期，不做回填。

## [未发布]

### 新增

- **六款自研 Canvas 版，替掉主界面依赖 Form 渲染的第三方包**。被换下的 6 款
  （小蜜蜂 / 一路向前 / 猜数字 / 连连看 / 迷宫 / 扫雷）不是「难玩」，是画不出来：
  MIDlet 一启动就 `setCurrent(menuForm)`，而内核的 Form/Item 渲染层整层是空桩，
  补 native 也补不出画面（详见下面「修复」第一条）。新 6 款 —— `guess-number` /
  `link-pair` / `maze-run` / `mine-field` / `bee-shooter` / `runner-dash` ——
  全部 Canvas 自绘界面，不碰 Form，源码在 `midlets/src/*.java`、可重建。
  库仍是 104 款，构成变为**自研 12 + MIT 92**。
  - 旧 id 直接下架：开 `#/play/cute-bee` 这类地址会立刻说「这个游戏不在库里」，
    而不是转 9 秒再报错。e2e 钉住「旧 id 不在、新 id 在且真能出画」。
  - `build-midlets.mjs` 现在支持「加一款新游戏」：`public/games` 里还没有产物时
    不再直接失败，`--install` 下把「条目内容不一致」当作待写回而不是缺陷；
    反过来，**条目内容已一致的产物会跳过写入** —— 整包字节里含构建时间戳，
    重打一次必然不同，而指纹是存档隔离键，白改一次就让那几款的存档读不回来。

### 修复

- **「缺内核」的 6 款游戏查清了根因，并补了能补的部分**。根因不是「少一个方法」：
  pluotsorbet 的 `midp/gfx.js` 只对 Canvas 与 Alert 做了真实实现，Form 及其 item
  （`ItemLFImpl.show0` / `setSize0` / `getPreferredHeight0`、`FormLFImpl.showNativeResource0`
  等）**整层都是空桩**，`ChoiceGroupLFImpl` 更是 12 个 native 一个都没注册。
  所以宿主页在 `j2me.js` 之后、`main-all.js` 之前给这 13 个 implKey 装了桩
  （ChoiceGroup 12 个 + `setTicker0`）：启动不再卡在构造 Form，而是照常往下走。
  实测结论要如实说：**补桩没有让任何一款变得能玩** —— 6 款的主界面就是那个
  画不出来的列表菜单，补桩只做到「不卡死 + 说清原因」。
- **补桩后的失败文案不再被外壳的通用超时盖掉**。宿主原先 20 秒才判，而外壳
  兜底是 15 秒、文案是「启动超时 · 可能是程序包不完整」—— 我们查清的原因永远
  露不出来，用户会拿那句话去查包体大小，方向全错。现在补过桩就用 8 秒上限，
  实测 6 款在 8.9 秒报「这款游戏的主界面是列表选择菜单，内核没有实现它的绘制
  与按键；已做兼容处理，界面仍然出不来」。
- **全量体检脚本的两处假绿**（不改产品，但决定了上面这些数字可不可信）：
  ① 同一页面连续 `#/play/a → #/play/b` 只改 hash、**浏览器不重载**，上一款的
  错误覆盖层留在 DOM 里，下一款 0 秒就「命中选择器」—— 曾据此得出 mine-sweep
  「0 秒出画」的结论，截图一看是上一款的报错；现在每款开新 context。
  ② 等待的选择器写成 `.player__fail`，界面里根本没有这个类（真实的是
  `.player__overlay-msg--error`），于是「失败」永远等不到、被记成 no-boot。
  修正后重跑 104 款：89 款画面持续推进、7 款静态但按键有效、6 款明确失败、2 款无响应。

- **播短音效的游戏会永久卡住**（P0）。报的是「很多游戏能跑起来，但实际玩会卡住」。
  查下来是内核 TonePlayer 用 `current + duration - FADE_TIME`（FADE_TIME = 0.1）
  算淡出起点，播短于 100ms 的音效时算出负时间，WebAudio 抛 RangeError，而它的
  抛出栈是 `playTone → NativeTonePlayer.nPlayTone → interpret → Thread.run` ——
  **异常从 Java 线程的 run 循环里逃逸，那条线程就没了**。浏览器主线程是空闲的，
  所以现象不是「页面卡死」而是「游戏不动了」。实测 City Shield 在菜单里按一次
  方向键（播选中提示音）就钉死，19 秒画面一帧没变。现在在宿主页加载内核前把
  AudioParam 的时间参数钳到合法范围；不改内核产物（上游 GPL 构建物、不入库）。
- **缺 native 实现的游戏不再干等 20 秒**。6 款的 MIDlet 构造 Form 时就撞上未实现
  的方法（ChoiceGroup 5 款、Ticker 1 款），内核把这句话打印成 `console.error`
  后继续跑，画面永远不出来，外壳只能等满 20 秒报「启动超时」。现在听这句错误，
  给 3 秒宽限，仍未出画就按 `UNSUPPORTED_CAPABILITY` 失败，并把缺失的控件
  翻成人话：「这款游戏用到了列表选择控件（ChoiceGroup），内核没有实现它。」
- `fail()` 现在留一行 `[host] fail: <code> · <message>`；宿主页的失败原因只出现
  一次且常被外壳换成面向用户的措辞，排查时不能靠猜。
- `UNSUPPORTED_CAPABILITY` 开始透传 detail（原先只有 `SAVE_RESTORE_FAILED` 透传），
  否则「缺的是哪个控件」到不了界面。
- **内核构建被仓库根的 `@types` 污染**（P0）。发布验收第一次真跑到「构建内核」，
  然后 tsc 报了 3216 处语法错误 —— 错的全是 `node_modules` 里的 `.d.ts`
  （`undici-types`、`@types/chai`、`@types/react`），没有一处是上游代码。
  原因不是上游：tsc 在不给 `--types` 时会把「被编译文件往上每一层
  `node_modules/@types`」整段自动引入，而上游放在 `vendor/pluotsorbet`，
  往上第二层就是仓库根，于是这个 2018 年的编译单元读进了 2024 年的类型声明。
  现在给 `--typeRoots` 指一个空目录，把环境类型整段关掉（上游 `references.ts`
  只用 `/// <reference path=...>`，不依赖任何 `@types` 包）。
  不选「升级 `@types` / 加 `--skipLibCheck`」：前者治不住（下一个带 `@types`
  的包还会犯），后者只跳过类型检查、语法错照样报。验证不靠「本地跑通」——
  把上游按钉定 commit 浅拉到同样层级下跑同一条命令：修前 3216 处（其中 3159 处
  来自 `@types`），修后 0 处。顺带把失败信息从「只有条数」改成「前 8 条 + 日志
  路径」，并新增 5 项守卫（flag 在、位置在 `references.ts` 之前、没退回
  `--skipLibCheck`、脚本 `bash -n` 通过）。
- **发布门禁不再等一个不存在的测试包**（P0）。`release.yml` 曾经从 secret 还原
  `public/assets/e2e-test.jar`，而 e2e 要的是 `public/assets/sokoban.jar` ——
  两个名字都对不上仓库：前者的路径被 `.gitignore` 忽略，后者从来没存在过。
  所以配了 secret 也会在「准备测试程序包」这一步失败，后面的内核构建与 E2E 根本
  没执行（实际失败的发布任务正是这样）。现在**删掉整个准备步骤与 secret**，直接
  用随包分发的 `public/games/sokoban.data`（它本来就是 JAR，只是换了后缀以避免
  平台把 `.zip` 系文件当嵌套包丢弃），并在构建内核之前跑一次 `check:games`。
  另加守卫测试：e2e 引用的每个 `public/...` 路径都必须被 `git ls-files` 认得，
  「本地绿、CI 挂」这一类问题从此有自动化兜底。
- **存档写入失败不再静默**（P0）。`PlayerScreen.tsx` 里归档写入失败只有
  `console.warn`，配额不足时用户照常回库页，不知道最新存档没进去。现在分三处
  交代：运行时在画面底部浮一条提示（绝对定位，**不参与布局** —— 运行区高度就是
  J2ME 屏幕分辨率，挤一行会让内核按新尺寸重排，实测被压掉 46px）；点退出先被
  拦下并弹框；框里四个动作 —— 「重试保存 / 导出这次进度 / 返回游戏 / 放弃并退出」。
  顺序是**先问再停**：确认放弃才真的 `stop()`，所以「返回游戏」是真的能继续玩；
  「导出这次进度」直接打包内存里的快照（走 `exportZip` 会读到旧档）。
  配额错误同时识别 `QuotaExceededError`、旧 WebKit/IDB 的 `code 22`、
  Firefox 的 `1014` 与 message 关键词；而清空归档（空快照）失败不算「没保存成功」，
  只让旧档多留一局 —— 报错要看这次写没写进去，不看历史上有没有失败过。
- **导入本地游戏前先验 JAR 结构**（P1）。原先只验体积与 `PK\x03\x04` 四字节，
  普通 ZIP 也能进库：卡片显示正常，点进去转十几秒，给一句「启动超时」。
  现在要求 `META-INF/MANIFEST.MF` 存在、`MIDlet-1` 形如「名称,图标,主类」、
  主类条目真的在包里，缺一件就拒，并把理由翻成「不是可启动的 J2ME 程序」
  「主类 X 不在包里」这种能照着排查的话。manifest 解压加硬上限（解压后 64 KiB、
  压缩态 256 KiB、中央目录 2048 条），用 `ReadableStream` 边读边数，超限立刻
  `cancel()` —— `Response.arrayBuffer()` 是「先解完再看大小」，等看到就晚了。
- **存档指纹不再有常量退路**（P0）。`sha256Hex` 在 `crypto.subtle` 缺失时曾返回
  固定串 `sha256:unavailable`，注释还写着「退化后仍能隔离」。这是错的：所有游戏
  拿到同一个指纹就等于共享同一个存档键，装第二个游戏会覆盖第一个的存档。
  现在：安全上下文用 WebCrypto，否则用 `src/shared/sha256.ts` 的纯 TS 实现
  （与 Node 的 SHA-256 逐字节对拍），**两者都不可用时抛 `HashUnavailableError` 并
  拒绝启动**。`isFingerprint()` 也把占位串挡在导入之外，存档服务的四个入口
  （`restore` / `archive` / `exportZip` / `applyImport`）各自再查一次 —— 非法键
  写进去不是「这次没存上」而是「串档」，两者的后果不对称。
- **启动前恢复失败会中止启动**（P0）。原先 `restoreIntoIdb()` 的失败结果被
  `console.warn` 后继续装载内核，后果链是「游戏在空档/残留档上跑 → 退出时把错数据
  写回归档 → 原存档没了」。现在只有「库不存在且快照为空」可以继续，其余一律
  `SAVE_RESTORE_FAILED` 并带出原因（库被占用 / 版本不符 / 不支持 IDB）。宿主侧
  还额外校验快照（越界路径、重复、32 个文件 / 4 MiB / 8 MiB）。
- **运行中导入不再被退出快照覆盖**（P0）。原先运行中导入是「直接写归档」，内核里
  仍是旧档，随后的静默期/退出快照会把导入结果盖回去 —— 界面提示成功，退出后进度
  回到导入前。现在固定为 `停 → 等归档清空 → 写导入 → 重启`，并在写入期间挂起
  旧实例的迟到快照。运行中会先弹确认，并提供「先导出当前存档」。
- **ZIP 导入加上界**（P1）：包体 12 MiB、32 个文件、单文件 4 MiB、总量 8 MiB、
  路径 ≤128 字符；拒绝重复条目、`..`、反斜杠、控制字符、非 UTF-8、目录条目；
  manifest 逐字段查类型并拒绝未知字段。导出侧用同一套上限。

### 新增

- **游戏库（F17）**：104 款内置游戏随包（自研 6 + MIT 98），支持搜索、
  分类筛选、「我导入的」视图、最近游玩，以及导入本地 JAR。见 ADR 0006。
  - 清单 `src/library/catalog.ts` 是**生成物**：`node scripts/import-games.mjs`
    从上游清单读、逐款重算 SHA-256、复制资产。指纹同时是存档隔离键，
    也是「文件有没有被换过」的校验值 —— 运行页 fetch 后重算比对，不符即拒绝启动。
  - `npm run check:games` 核对「catalog ↔ `public/games` ↔ 真实字节」，
    多一个少一个都失败（CI 每次跑）。
  - 路由改成 hash（`#/`、`#/play/<id>`），静态托管放子路径也不会 404；
    `?jar=` 保留为开发通道，不写游玩记录。
  - 搜索是「空格分词 + 全部命中」，不做拼音（宁可搜不到，也不要搜出一堆无关结果）。
  - 导入按不可信输入处理：体积上限 16 MiB、ZIP 魔数、**JAR 结构预检**
    （manifest / 三段式 `MIDlet-1` / 主类在包里，见「修复」）、指纹格式、id 冲突；
    标题优先取 `META-INF/MANIFEST.MF` 的 `MIDlet-Name`（导入 `sokoban.jar`
    显示「推箱子」），读不到才退回文件名。解压只用 `DecompressionStream`，
    任何异常都降级，不打断导入。
  - 导入的游戏存 IndexedDB，元数据与字节分两个 store —— 否则列表页的
    `getAll()` 会把所有包的字节一起读进内存。
- **发布验收工作流** `.github/workflows/release.yml`：推 `v*` 标签或手动触发时
  构建内核（emsdk 2.0.34 + JDK）→ 真浏览器跑全量 e2e → `scripts/verify-e2e-report.mjs`
  校验报告。**0 通过、有跳过、有 flaky 都判失败** —— 因为 `playwright test` 对
  「全部 skip」的退出码是 0，「没跑」和「跑过了」不能都是绿色。
  `check-kernel-artifacts.mjs` 新增 `REQUIRE_KERNEL=1`：缺产物直接失败，不再跳过。
  `check:games` 排在构建内核**之前** —— 随包游戏缺失或指纹不符是最常见的失败，
  而构建要 20 分钟，排后面等于让人等 20 分钟才知道仓库不完整。
- `tests/unit/host-restore.test.ts`：把 `host.html` 的脚本放进 `vm` 跑，证明
  「恢复失败 → `SAVE_RESTORE_FAILED` → 一个内核脚本都不加载」。
- `tests/unit/saves-import.test.ts`：导入时序（`stop → apply → relaunch`）与
  状态判定（同游戏 + 运行中才重启）。
- `tests/unit/hash.test.ts`：FIPS 向量、跨块边界、与 Node 差分、无 `subtle` 时
  结果不变、`subtle` 抛错时降级。
- `tests/unit/saves-archive.test.ts` 新增「指纹门禁」一组：占位串 / 空串 / 无前缀 /
  大写十六进制 / 非法长度在读、写、导出、导入四个入口都被拒，且**归档被拒时
  不会覆盖别的游戏** —— 这与「串档之后界面一切正常」正好相反，所以要单独钉住。
- **六款自研游戏的对应源码入库**（F21）。采用 GPL-2.0-or-later 就该随二进制一起
  提供对应源码，而仓库此前只有 `public/games/*.data`。现在 `midlets/src/` 下是
  六份完整源码（Snake / Breakout / Memory / Game2048 / Sokoban / Drop，约 1300 行），
  `midlets/games.json` 记录每款的 manifest 名字与主类，`scripts/build-midlets.mjs`
  用 `javac --release 8 -cp public/kernel/java/classes.data` 重编译再 `jar cfm`
  打包，与随包产物**逐条目比字节**（manifest 忽略 `Created-By`）—— 实测 6 款
  共 18 个 class 全部一致。默认只校验、不写回：换产物就是换内容指纹，等于让已有的
  存档键和 catalog 指纹一起失效，所以 `--install` 必须显式给。命令是
  `npm run check:midlets`（结构，无需 JDK）/ `npm run verify:midlets`（重编译比对）。
- **104 款游戏逐款来源登记**（F20）。`docs/provenance/games.json` 每款记
  `sha256`（整包）、class 清单、上游 `repo` / 40 位 `commit` / 文件 `path`、
  `copyright`、`license`，以及这次是怎么得到产物的 —— `self`（自研，另带
  `sourcePath` 与构建方式）、`upstream-source`（97 款，编译上游源码）、
  `upstream-jar`（1 款，仅删两个条目）。`check:provenance` 新增 §7：与 catalog
  双向对齐、逐款重算哈希、核对每个 commit 都在 `SOURCES.md` 出现。哈希和来源
  是两件事：前者证明「没被换过」，后者证明「有权分发」，缺哪个都不算完整。
  一个副产物：pisces312 那 7 款不能记成「重打包上游 jar」—— 上游 `dist/*.jar`
  是混淆产物（`a.class`、`b.class`），本项目用的是 `src/` 的原名类。
- **关于页与许可原文随包分发**（F19 / F3 / F22）。分发物里带着别人的 GPL 代码与
  别人授权的游戏，二者都要求「分发时附上许可原文、说明来源」。源码在仓库里、
  许可见 `LICENSE`，但产品里没有入口，用户拿到的就是一个说不清自己是什么的网页。
  - 新增 `#/about` 路由与 `AboutScreen`：许可分层逐项列清（自有代码
    GPL-2.0-or-later / 内核四件产物 GPL-2.0 **非** or-later / 自研 6 款 /
    MIT 98 款 / 界面依赖），给出上游 commit 与完整构建方法的位置，以及源码地址。
  - 版本、内核 commit、随包款数**全部构建期注入**：`vite.config.ts` 从
    `package.json`、`fetch-upstream.sh` 的 `PIN`、`games.json` 读，读不到直接让
    构建失败。手抄的版本号写错比不写更糟，而关于页正是用户拿来核对分发内容的那页。
  - `public/licenses/` 放三份原文（GPL 全文、MIT 全文与三份版权行、第三方声明），
    Vite 原样搬进 `dist`。`scripts/check-licenses.mjs` 与正本逐字节比对，不一致时
    指出「从第几个字节起不同」并给出 `--write`；这类漂移是静默的 —— 改了正本忘了
    同步副本，构建照常成功，只有用户点开的是旧许可。
  - 库页页脚改成「关于与许可」入口（原来那句指的是 `docs/provenance/GAMES.md`，
    仓库里只有 `games.json`，打包后路径也不可达）。
  - 测试：`about-page` 6 项（原文都在、逐字节一致、数字来自注入而非手抄）、
    路由 +1、e2e 2 项（页脚 → 关于页 → 三份原文真的返回 200 且正文命中 → 回库页；
    直接开 `#/about` 不白屏）。
- **运行页启动前也验包**（F6）。导入通道早已预检，但还有两条路会送进坏包：
  `?jar=` 开发通道、以及库里的包体事后被截断/替换（部署换了文件、磁盘写了一半）。
  这两条路上坏包的表现是「转十几秒，然后一句『启动超时。可能是程序包不完整、
  文件过大，或设备性能不足』」—— 三句话没有一句说「你选错文件了」。
  现在启动前用同一个 `inspectJar` 验一遍，1 秒内给出「不是 JAR 包」
  「缺 `META-INF/MANIFEST.MF`」「主类 X 不在包里」。15 秒超时保留为最后一道：
  它现在只负责「包看着没问题但内核确实起不来」。e2e 2 项，其中一个直接断言
  「从打开到报错 < 8 秒」—— 只断言文案的话，「等 15 秒再报同样的文案」也能通过。
- **库页「本机数据」：终于有地方清理存档**（F15 延续）。配额不足的提示条写着
  「清理一些浏览器存储后重试」，而产品里没有那个动作 —— 用户只能自己去开发者
  工具里翻。现在库页底部一块面板给出「导入的游戏 N 款 · 存档 M 份」，并提供
  「清空全部存档」：二次确认、明说「这是唯一一份、没有云端备份」、只删存档
  （整库 `clear()` 会把导入的游戏一起带走，那是另一件事）。
  两个细节：`saveCount === null`（读不到）与 `0 份` 必须分开显示，否则用户会
  以为存档没了；「读不到」时不给清理按钮，而不是给一个点了没反应的。
  `SaveService` 补了 `remove` / `clearAll`（前者照样守指纹门禁 —— 删错键同样
  不可逆），存档服务收成 `src/saves/instance.ts` 单例，两个页面共用一份连接。
  测试：`saves-clear` 4 项（份数、幂等、只删存档、门禁）、`library-data` 5 项
  （读不到≠0、二次确认、不碰导入的游戏、单例、44px 触控）、e2e 1 项
  「玩一局 → 1 份 → 二次确认清空 → 刷新仍为 0 份」。
- **退出后重复启动的量化**（F5）。这一条长期只有行为覆盖（退出、再启动、
  启动途中退出都能跑），没有数字 —— 而「看起来做了」和「测过」是两件事。
  新增 `memory.spec.ts`：进出 3 次，每次退出后断言 **iframe 数为 0**、注入探针
  统计活跃 `setTimeout`/`setInterval`/`rAF`、每轮强制 GC 后读 `JSHeapUsedSize`。
  实测：堆 3.8 / 4.2 / 4.3 MB，活跃定时器 0 / 0 / 0。
  判据的层次写进了用例头部：`JSHeapUsedSize` 只量外壳所在渲染进程，内核的 wasm
  线性内存不在这份数字里，所以「内核有没有被释放」的第一判据是 iframe 归零，
  堆那一层守的是「外壳每轮新建的 runtime / 监听 / 闭包有没有摘掉」。
- 单元测试总数 110 → 302；其中 `saves-format` 11 → 30（构造包全覆盖）、
  `saves-archive` 9 → 18（指纹门禁）、`e2e-guard` 5 → 15（新增「e2e 只依赖
  入库的文件」三条），新增 `hash` 13 / `host-restore` 9 / `saves-import` 11 /
  `saves-failure` 11（配额五种错误形态、空快照不报错、紧急导出不读仓储）/
  `player-save-failure` 7（先问再停的顺序、四个出口、提示条不进 flex 流）/
  `library-catalog` 8 / `library-routes` 11 / `library-filter` 16 /
  `library-store` 11 / `library-import` 20 / `library-jar` 24
  （取代 `library-manifest` 15，含「随包 104 款全部通过预检」）/
  `kernel-build-script` 5（内核 tsc 的 `--typeRoots` 守卫）/ `about-page` 6。
  真内核 e2e 9 → 22 项，新增 `library.spec.ts` 5 项、`save-failure.spec.ts` 2 项
  （配额报错全流程、重试成功后字节真的进 IndexedDB）、`about.spec.ts` 2 项、
  `bad-jar.spec.ts` 2 项（坏包在启动前被拒 + 耗时断言）、`library-data.spec.ts` 1 项、
  `memory.spec.ts` 1 项（进出 3 次的堆与定时器）。

- **存档（F13 / F14 / F15）：外壳托管，内核文件系统只作运行期缓存**。见
  `docs/decisions/0005-saves.md`。
  - 四项实测依据：内核挂在 `pagehide` 上的 `flushAll` 在 iframe 被摘除时**不生效**
    （回调里才发起的事务既不 complete 也不 abort）；真内核里「写完立刻退出」
    的存档在 IDB 里查不到、等 26 秒则在；RMS 目录**不区分游戏**
    （`getSecureFilenameBase` 恒为空、`suiteId` 恒为 1）；外壳直写 `asyncStorage`
    的 `fs4` 能让内核启动时读到。
  - 宿主页：`runtime:launch` 新增 `restore`，在装载内核产物**之前**清空并写入
    `/RecordStore` 子树；静默期自动归档（2 秒一轮、连续两轮无变化才读，
    避开 `.db`/`.idx` 的半写状态）；`runtime:stop` 先发 `runtime:saves` 再回
    `stopped`，保证 iframe 拆掉之前快照已经交出去。
  - `src/saves/`：按内容指纹隔离的 IndexedDB 仓储；零依赖 ZIP（STORE + CRC32，
    任何解压工具都能打开）；manifest 校验（格式 / 版本 / 越界路径 /
    逐文件 sha256 / 清单之外的多余条目）。
  - 运行页：顶栏「存档」入口（导出 / 导入），由 `RuntimeCapabilities.saves` 门禁；
    导入的包若属于别的游戏，存到它自己名下而不是覆盖当前游戏。
  - 测试：`saves-format`（11）、`saves-archive`（9）、`runtime-saves`（6），
    以及 `tests/e2e/saves.spec.ts` —— 4 个真内核场景：写档→退出→重进读回、
    不点退出也能归档（兜刷新）、导出 ZIP 可解开并重新导入、损坏包被拒且原档不动。

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

- **`load()` 的语义变了**：现在会在启动前清空内核的 `/RecordStore`，再灌入
  `LoadOptions.restore` 给的快照（缺省为空 = 全部清空）。这是「外壳托管存档」的
  必然结果 —— 内核的 RMS 目录不区分游戏，不清就会串味（ADR 0005）。
  调用方从此有责任提供该游戏的快照，不给就等于「这款游戏没有存档」。
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

- 倍速、游戏库、产品界面均未接入；运行页目前由 `?jar=` 参数唤起。
- 存档的静默期归档有约 **4 秒滞后**（要等连续两轮无变化才敢读，避开半写状态）。
  点「返回」退出不受影响（退出前会强制导一次），直接杀进程/断网则可能丢这几秒。
- 归档写入失败目前只进 `console.warn`，界面不提示（导入失败是有提示的）。
  配额超限（`QuotaExceededError`）也没有专门的文案，属于 F15 的未完成部分。
- 无效的程序包只能靠**超时**判失败：内核遇到非 JAR 或缺少 `MIDlet-1` 时不报错、也不出画，
  外壳除了等满 15 秒之外没有别的信号可用。真正的「包无效」识别要等 F6 做 JAR 预检。
- 构造 `GameCanvas(true)` 的游戏不可控：内核把 `setSuppressKeyEvents` 实现成全局开关，
  连 `getKeyStates()` 的键掩码都不再更新（与 JSR 规范不符，见 `kernel-contract.md` §12.3）。
- `#`（`pound`）没有默认物理键（US 布局上是 Shift+3，与 `Digit3` 撞车），只能在小键盘面板按。
- 能力缺口：3D（JSR-184 / M3G / M3D）、蓝牙（JSR-82）、无线消息（JSR-120）在自建产物下不可用，
  取舍见 `CORE_EVALUATION.md` §6。
- 内核为 v2-only，组合作品的天花板是 v2：若日后补 3D 需要引入 GPL-3.0 的 freej2me，
  冲突会回归，只能靠隔离为独立程序或换内核解决，换许可无用（ADR 0003 末节）。
