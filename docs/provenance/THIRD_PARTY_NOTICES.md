# 第三方组件声明

本文件随应用一起分发（关于页需可访问）。完整登记信息见 [`SOURCES.md`](SOURCES.md)。

---

## GNU General Public License v2.0

本应用包含 PluotSorbet（Mozilla J2ME 运行时）及其衍生编译产物：

- `j2me.js`
- `native.js`
- `main-all.js`
- `classes.data`

该组件以 **GNU General Public License version 2** 授权，**非** "or later"。
许可原文见 [`license-texts/GPL-2.0.txt`](license-texts/GPL-2.0.txt)。

### 对应源码的获取方式

本应用对 PluotSorbet 的修改与完整构建方法均以源码形式提供：

1. 上游源码：`https://github.com/mozilla/pluotsorbet`，commit `46ee3e78a4fd9c3f09026cc5cbdcf76e94b7a398`
2. 本地修改：由本仓库 `scripts/fixup-upstream.py` 施加，逐条原因见 `SOURCES.md` §1.1.1
3. 构建流程：`scripts/build-kernel.sh`
4. 上述文件随仓库一并提供，或可通过应用内「关于」页给出的地址获取

GPL-2.0 允许再分发与修改，但不提供任何担保。

---

## Boehm-Demers-Weiser 垃圾回收器（Emscripten 移植）

- 项目：Boehm.js
- 地址：`https://github.com/marco-c/Boehm.js`，commit `712978aea8b6a30bee949d78275aafb0e8cbc887`
- 许可：Boehm GC 宽松许可（允许商业使用、修改、再分发，需保留版权声明）

## Relooper

- 作者：Alon Zakai
- 地址：`https://github.com/kripken/Relooper`
- 许可：MIT

## encoding.js

- 作者：Joshua Bell
- 许可：Apache License 2.0
- 用途：TextEncoder / TextDecoder polyfill，随 PluotSorbet 源码分发

---

## MIT / Apache-2.0 组件

界面与构建工具链使用以下组件，均为宽松许可，要求保留版权与许可声明：

| 组件 | 版本 | 许可 |
|---|---|---|
| React / React DOM | 19.3.1 | MIT |
| Vite | 8.3.8 | MIT |
| Vitest | 5.1.1 | MIT |
| Playwright Test | 1.65.1 | Apache-2.0 |

构建期依赖（TypeScript、ESLint 等）不进入分发包，其许可信息见 `package-lock.json`。

---

## 不含的内容

本应用**不包含**任何游戏、ROM、BIOS、字体或商业素材。用户导入的 `.jar` 文件仅在本机浏览器内运行，不会上传到任何服务器。

本应用当前**不包含** freej2me、kemulator、Mascot Capsule 实现或任何厂商扩展类。
