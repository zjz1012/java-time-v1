# 贡献指南

## 提交前必须通过

```bash
npm run typecheck
npm run lint
npm run test
```

主分支每次提交都应能通过 CI。不要用 `--no-verify` 跳过钩子；钩子失败先修因。

## 提交信息

Conventional Commits，作用域用真实模块名：

```
feat(runtime): add capability-gated pause
fix(saves): reject zip entries escaping root
docs(provenance): record boehm submodule commit
test(input): cover multi-touch cancel
```

## 代码来源纪律（重要）

本项目的核心约束是**来源可核验**，因此：

1. **不复制、改名、改写、翻译任何来源存疑的代码**。包括旧版工程与任何第三方站点产物。
2. 引入第三方代码前，必须在 `docs/provenance/SOURCES.md` 登记：仓库地址、**精确 commit**、许可、使用方式、本地修改范围。未登记不得合并。
3. 新增依赖要锁定版本，并在 `docs/provenance/THIRD_PARTY_NOTICES.md` 补一行。
4. 不确定来源的实现，先停下来记为阻塞项，不要「先写一版再说」。

## 测试要求

- 新模块至少覆盖成功路径与一条失败路径。
- 涉及状态机的代码（运行时、输入、存档）必须覆盖非法迁移。
- 修 bug 先写复现测试。

## 不要做的事

- 不要倒填提交时间或拆分已完成代码伪造开发过程。
- 不要提交 `node_modules/`、构建产物、真实用户存档、任何游戏 JAR。
- 不要把内核源码或产物混进产品 bundle —— 二者的许可义务不同，必须物理分离。
