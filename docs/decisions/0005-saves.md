# ADR 0005：存档由外壳托管，内核文件系统只作运行期缓存

- 状态：已接受
- 日期：2026-11-23
- 相关：`docs/architecture/kernel-contract.md` §13、`docs/FEATURE_MATRIX.md` F13/F14/F15
- 复现脚本：`.work/probe-pagehide-write.mjs`、`.work/probe-kernel-persistence.mjs`、
  `.work/probe-flush-window.mjs`、`.work/probe-idb-inject.mjs`（均为本地探针，不入库）

## 背景

立项时把存档当成「给用户加存档槽」。实测后发现不是：**内核有 RMS 语义，但保存不住，
而且不区分游戏**。四个实测结果：

### 1. 内核自己的 `pagehide` 兜底不生效

`main-all.js` 末尾有 `window.addEventListener("pagehide", flushAll)`，`flushAll` 里才调
`syncStore()` 写 IndexedDB。但在 `pagehide` 回调里**才发起**的 IDB 事务，在 iframe 被摘除后
既不 complete 也不 abort：

```
64 B   → pagehide-write-start 之后没有任何事件，读回 null
100 KB → 同上，读回 null
```

（脚本用「预先打开的连接 + pagehide 内开事务」复现，与 `store.sync` 的路径一致。）

### 2. 真内核端到端复核：写完就退会丢

往 `/RecordStore` 写文件后走运行页真实的「返回」（整页导航）：

| 操作 | IDB `asyncStorage/fs4` 里的结果 |
|---|---|
| 写完立刻退出 | **无此记录** |
| 写后等 26 秒再退出 | 有，size 对得上 |
| 写后显式 `fs.syncStore()` 再退出 | 有，size 对得上 |

读码可知定时落盘是 `setTimeout(() => setInterval(flushAll, 5000), 20000)`
——**启动 20 秒后**才开始。所以「存个档然后退出」正好落在最危险的窗口里。

### 3. RMS 不按游戏隔离

```js
// MIDletSuiteStorage.getSecureFilenameBase
return J2ME.newString("")     // 上游注释：we only run a single midlet per installation
// MIDletSuiteLoader
var suiteId = (config.midletClassName === "internal") ? -1 : 1
```

RMS 路径恒为 `/RecordStore/<name>.db`。两款游戏都存 `"save"` 就是同一个文件。

### 4. 外壳可以在启动前写 IDB，内核读得到

宿主页没有任何「内核已 init、MIDlet 还没跑」的插入点（`loadScript('main-all.js')` 的
回调在这之后）。但直接在父页面写 `asyncStorage` 的 `fs4` 是可行的：

| 操作 | 内核启动后 `fs.exists` |
|---|---|
| 写入 `/RecordStore/injected.db`（6 B） | **true**，size 6 |
| 删除 `/RecordStore/probe.db` | **false** |

记录形状：文件 `{pathname, isDir:false, parentDir, size, mtime, data: Blob}`，
目录 `{pathname, isDir:true, parentDir, mtime}`。

## 决策

### 1. 外壳的 IndexedDB 是唯一真相，内核 FS 是运行期缓存

存档生命周期：

```
归档（外壳 IDB） --启动前写入--> 内核 FS（asyncStorage）
                                    │  游戏正常读写 RMS
归档（外壳 IDB） <--静默期/退出前读-- 内核 FS
```

理由：内核的落盘不可靠（实测 1、2），隔离也没有（实测 3）。把真相放在内核里，
就必须依赖它的时钟；放在外壳里，落到 IDB 的时机由我们决定。

### 2. 快照单位是 `/RecordStore` 子树

只取 `/RecordStore` 下的文件（路径 → 字节）。不含 `/_main.ks`（内核证书库，随产物分发）
与 `/Phone`、`/Private` 等内核自建的根目录。

理由：那两类不是用户数据；带上它们会让「清空重灌」必须区分「能删的」和「不能删的」，
徒增出错面。实测 4 的 dump 里这些目录都在，说明整库 `clear()` 会误伤它们。

### 3. 启动前恢复：写在 IDB，不写在页面上

`runtime:launch` 指令多一个 `restore` 字段（快照文件列表）。宿主在加载三件内核产物
**之前**完成：删掉 `fs4` 里 `/RecordStore` 前缀的全部记录 → 写入恢复文件 → 再走原有装载顺序。

代价是宿主页要认识内核的 IDB schema（库名 `asyncStorage`、版本 `4`、表 `fs4`）。
这是本方案**唯一**越过内核契约去摸内部存储的地方，见「后果」。

### 4. 归档时机有三处，都不在 `pagehide`

| 时机 | 触发 | 说明 |
|---|---|---|
| 静默期自动 | 每 2 秒比对 `list + stat`，连续 2 次无变化才读内容 | 兜「直接关页面 / 刷新」 |
| 退出前强制 | 收到 `runtime:stop`，读完快照并发出，再回 `stopped` | 主路径 |
| 手动导出 | 运行页点导出 | 复用同一份快照 |

静默期为什么要求「连续 2 次无变化」：一次存档可能跨 `.db` 与 `.idx` 两个文件，
中途抓到会得到索引与数据不一致的快照。宁可滞后约 4 秒，也不要归档一个半写状态。

外壳**不**在 `pagehide` 里往内核写任何东西。内核自己已经挂了 `flushAll`，
两边同时写同一批文件只会互相覆盖，而且谁最后生效不可控。

### 5. 隔离键用 JAR 内容指纹

`fingerprint = sha256(JAR 字节)`，已在 `MidletPackage` 里算好。归档按它分 key，
与文件名、展示名无关（改名同包仍是同一份存档，同名不同包不会串）。

★ 指纹**必须是真的摘要**，不允许任何常量退路（2026-11-24 补）：

| 环境 | 做法 |
|---|---|
| 安全上下文，有 `crypto.subtle` | 用原生实现 |
| 没有（子路径部署的 http 页面） | 用 `src/shared/sha256.ts` 的纯 TS 实现，结果逐位一致 |
| 连纯实现都跑不起来 | 抛 `HashUnavailableError` → **拒绝启动 / 拒绝导入** |

`crypto.subtle` 缺失时曾返回固定串 `sha256:unavailable`，注释还写着「退化后仍然
能隔离不同游戏」。这是错的：同一份固定串意味着**所有游戏共享一个存档键**，
装第二个游戏就会覆盖第一个的存档，而且它看起来像一个正常指纹，没人会发现。
`isFingerprint()` 的格式校验也把这类占位串挡在导入之外。

★ 指纹是仓储的**键**，所以 `saves/service` 的每个入口（`restore` / `archive` /
`exportZip` / `applyImport`）各自再查一次格式，不依赖上游是否查过。理由是不对称
的：`archive` 抛错只是「这一次没存上」，而把非法键写进去是「把这款游戏的进度
盖到另一款头上」—— 后者在界面上毫无痕迹。`applyImport` 的 manifest 其实已过
`readManifest`，那一处重复是刻意的。

### 6. ZIP 用 STORE，不压缩

存档通常是几十 KB。用 `CompressionStream` 换来的体积收益不足以抵消实现风险，
所以 ZIP 采用 STORE（不压缩）+ CRC32 校验，零依赖、任何解压工具都能打开。

```
manifest.json            # 版本、指纹、展示名、导出时间、文件清单（path/size/sha256）
saves/RecordStore/<name>.db
saves/RecordStore/<name>.idx
```

导入校验顺序：ZIP 结构 → CRC32 → manifest 版本与字段 → 每个文件的 sha256。
任一步失败就整包拒绝，**不动现有归档**。

★ 导入是**用户自带文件**，所以除了结构正确还要有上界（2026-11-24 补）：

| 项 | 上限 / 规则 |
|---|---|
| 包体 | 12 MiB（`readZip` 解析之前就判，不是遍历之后） |
| 文件数 | 32（含 `manifest.json` 共 33 个 ZIP 条目） |
| 单文件 | 4 MiB |
| 总量 | 8 MiB |
| 路径 | ≤ 128 字符；必须以 `/` 开头；拒绝 `..`、`.`、空段、反斜杠、控制字符、盘符 |
| 条目名 | 拒绝重复条目、目录条目、非 UTF-8；本地头与中央目录的名字必须一致 |
| manifest | 字段逐个查类型；拒绝未知字段；`fingerprint` / 每个 `sha256` 必须是 64 位小写十六进制 |

导出侧用同一套上限：出一个自己都导不回来的包，只会在换设备时才暴露，
那时候用户已经没有别的备份了。

### 7. 不提供「游戏内即时存档」

该能力（savestate）需要内核暴露内存快照，本内核没有。不假装支持。

### 8. 恢复失败 = 启动失败（2026-11-24 补）

原先 `restoreIntoIdb()` 把失败分成 `skipped` / `unavailable` / `error` 几种结果，
而 `boot()` 对它们一律 `console.warn` 后继续装载内核。这个「宽容」是有害的：

```
恢复没成功 → 内核启动 → 游戏在空档或上一款游戏的残留档上玩
           → 退出时把这份错数据当快照 → 覆盖归档
```

于是「读不到旧档」变成了「把旧档删了」。现在的规则是二值的：**要么恢复成功，
要么不启动**，失败原因原样写进 `SAVE_RESTORE_FAILED` 的 message 给用户看
（「存储库被占用」「版本不符」「浏览器不支持 IDB」对应完全不同的处置动作）。
`host.html` 的三态判定见 kernel-contract §14.6。

宿主的 `restore` 参数也在宿主侧再校验一次（路径 / 重复 / 规模），任何一项不合法
都让整次启动失败 —— 不做「丢掉这条继续」，少恢复一个文件会让游戏在缺一块的
存档上跑，退出时再把缺块的快照写回去。

### 9. 运行中导入：停 → 写 → 重启（2026-11-24 补）

原实现允许在游戏运行时导入：校验通过就直接写归档。问题是内核里还是旧存档，
之后任何一个快照（静默期 / 退出）都会把刚写入的档覆盖回去 —— 界面提示「导入成功」，
退出后进度回到导入前。现在的时序由 `importSavePackage()` 固定：

```
needsRestart?（同游戏 && 状态 ∈ starting|running|paused）
  ├─ 是：stop() → 等 archiveChain 清空 → applyImport() → relaunch()
  └─ 否：applyImport()（别的游戏的包只写它自己名下，当前这局不受影响）
```

两点细节：

- `stop()` 只保证宿主**发出**了退出快照，落盘是异步的，所以必须等归档队列清空再写导入；
- 写导入之前挂起归档（`suspendArchive`），挡住 `stop()` 超时后迟到的快照；
  新实例启动时恢复。

界面上这会打断当前这局，所以先弹确认，并给出「先导出当前存档」这个出口。

## 后果

- **越界点只有一处**：宿主页直写 `asyncStorage`。库名/版本/表名硬编码在 `host.html`，
  而 `check:provenance` 锁定了内核产物，所以「内核变了但宿主页没跟上」会在升级时
  暴露而不是线上偶发。内核若将来提供官方存储钩子，替换点也只有 `host.html` 的两处。
- **强关最多丢约 4 秒**（静默期归档的滞后），不再是原来的 5~25 秒且不可知。
- **首次启动多一次读归档**（<100 ms），换来的是「装两个游戏不会互相毁档」。
- **F14 不再是独立功能**：导出就是把归档打成 ZIP，导入就是解包写回归档。
- **F15 的「写失败不静默」有了明确落点**：归档写入与 ZIP 校验的失败都要在 UI 上可见。
- 若内核的定时落盘将来被修好，本方案仍成立：外壳的归档只是更早、更可控的一份。

## 备选与否决

| 方案 | 否决理由 |
|---|---|
| 轮询 vs hook 写点（上一轮讨论的两条路线） | 触发点其实是确定的（启动 / 退出 / 静默），不需要猜写入时机 |
| hook `RecordStoreFile.commitWrite` | 要同时包 `truncateFile`、`RecordStoreUtil.deleteFile`，漏一个就静默丢档；且依赖 native 方法签名 |
| `fs.exportStore` / `importStore` | `importStore` 先 `map.clear()` + `objectStore.clear()`，会把 `/_main.ks` 和内建根目录一起清掉；导出还是 JSON 数字数组，体积膨胀 |
| 父页直接读内核 IDB 当真相 | 读到的是落盘态，比内存态晚最多一个 flush 周期，且与内核的事务抢锁 |
| 每个游戏一个 origin（天然隔离 IDB） | 本地与单页部署都做不到 |

## 如何验证

- 单测：ZIP 往返、损坏包被拒且原档不丢、两个指纹互不覆盖、manifest 缺字段；
  构造包（重复条目 / `..` / 反斜杠 / 控制字符 / 超量 / 超限 / 占位指纹）全部被拒；
  指纹的纯 TS 实现与 Node 的 SHA-256 逐字节一致。
- 指纹门禁：占位串 / 空串 / 无前缀 / 大写十六进制 / 非法长度在 `restore`、`archive`、
  `exportZip`、`applyImport` 四个入口全被拒，且 `archive` 被拒时**别的游戏那份没被
  覆盖**（`tests/unit/saves-archive.test.ts`）。
- 宿主行为：把 `host.html` 的脚本放进 `vm` 里跑，证明「恢复失败 → `SAVE_RESTORE_FAILED`
  → 一个内核脚本都不加载」（`tests/unit/host-restore.test.ts`）。
- 导入时序：`importSavePackage` 在运行中是 `stop → apply → relaunch` 的严格顺序。
- 真内核 e2e：写档 → 退出 → 重新进入 → 读回同一份内容；**运行中导入 → 确认 →
  重启后内核读到的是导入的字节**（不是「提示说成功」）；坏包被拒且原档不动。
- 发布验收：`release.yml` 构建内核后真跑 e2e，并用 `verify-e2e-report.mjs`
  证明「确实跑了」（0 通过 / 有跳过 / flaky 一律失败）。
- 回归：现有 `kernel-smoke` 四场景不受影响（启动 / 输入 / 退出 / 再启动）。
