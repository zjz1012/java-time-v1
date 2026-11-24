# 自研 MIDlet 源码

六款随包分发的自研游戏：贪吃蛇、打砖块、记忆翻牌、2048、推箱子、坠落方块。
它们的编译产物是 `public/games/*.data`，随应用一起分发。

**这些源码必须和产物一起存在。** 整个项目按 GPL-2.0-or-later 分发，而
`public/games/*.data` 里有六款是本项目的编译产物 —— 只有产物没有源码，
「对应源码」就无从取得，那六款也就不能合法分发。

## 内容

| 文件 | 说明 |
|---|---|
| `src/*.java` | 六个 MIDlet，各自单文件，无第三方依赖、无外部美术资源 |
| `games.json` | 构建清单：id ↔ 主类 ↔ `MIDlet-Name`，以及 vendor 与 MIDP profile |

源码里的类名就是产物里的条目名：`SnakeMidlet.java` → `SnakeMidlet.class`，
绘图逻辑在同文件的 `SnakeCanvas` 里（`build-midlets.mjs` 一次性编译整个文件）。

## 构建与校验

```bash
node scripts/build-midlets.mjs --structural   # 结构校验，不需要 JDK（CI 跑这条）
node scripts/build-midlets.mjs               # 重编译 + 与产物逐条目比字节
node scripts/build-midlets.mjs --install     # 把重编译结果写回 public/games/
```

也挂在 npm 上：`npm run check:midlets` / `npm run verify:midlets` / `npm run build:midlets`。

### 前置

| 工具 | 说明 |
|---|---|
| `javac` / `jar` | JDK 8+。已提交的产物是用 **JDK 27 + `--release 8`** 编的 |
| `public/kernel/java/classes.data` | J2ME（MIDP/CLDC）类库，内核构建产物，不入库 |

类库不在仓库里，所以第一次跑要先构建内核：

```bash
bash scripts/fetch-upstream.sh
bash scripts/build-kernel.sh
```

没有 JDK 或类库时，`build-midlets.mjs` 会打一行 `[skip]` 退出 0 ——
**只有重编译比对被跳过，结构校验一定跑**。

### 为什么默认不写回产物

`.data` 的内容指纹就是这款游戏的存档隔离键（见 `docs/decisions/0005-saves.md`）。
换产物 = 换指纹 = 这六款的旧存档全部读不回来，同时 `src/library/catalog.ts` 里
登记的指纹也全部失效。所以默认只校验；真要换产物得显式 `--install`，并且要
自己接住「catalog 重新生成 + 旧存档失效」这两件事。

## 自研的边界

外部来的东西在源码文件头里都写了，也在 `docs/provenance/SOURCES.md` §5.2 登记：

- **推箱子的关卡**用 David W. Skinner 的 Microban 集（可自由分发、需署名），
  只取关卡的文本布局，解析 / 绘制 / 撤销全是自研。
- **2048** 只沿用规则（不受著作权保护），Java 实现从零写，未移植原版 JS、未用其配色。
- **坠落方块**刻意避开 Tetris 的商标与「整体观感」：换名、10×16 板面、自配色扁平块型。
