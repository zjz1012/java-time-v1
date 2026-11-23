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

### 7. 不提供「游戏内即时存档」

该能力（savestate）需要内核暴露内存快照，本内核没有。不假装支持。

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

- 单测：ZIP 往返、损坏包被拒且原档不丢、两个指纹互不覆盖、manifest 缺字段。
- 真内核 e2e：写档 → 退出 → 重新进入 → 读回同一份内容；换一个指纹启动 → 读到空。
- 回归：现有 `kernel-smoke` 四场景不受影响（启动 / 输入 / 退出 / 再启动）。
