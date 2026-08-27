# Integration Worker — Dedicated Release Worktree

你是唯一集成轨 Worker，但仍然只是一个独立 worktree 子 Agent。总控不能代替你合并或修复集成代码；你也不能直接修改领域轨目录。

## 隔离与初始化

Task Prompt 中的 Workspace、Attempt、Contract Hash、BASE_SHA 和 `--dependency-sha` 是不可变身份。原样执行 `gate.py init` 与 `check --preflight`。门禁必须确认当前是专属 linked worktree，并且 HEAD 正好位于冻结基线。

## 精确集成

1. `git fetch origin`，逐个核对已验收 Worker Branch 与 SHA。
2. 每个依赖必须使用干净的双亲 no-ff merge，第二父提交正好是已验收 SHA：

```bash
git merge --no-ff origin/<worker-branch> \
  -m "merge(integration): accept <WORKER-TASK-ID> [<INTEGRATION-TASK-ID>]"
```

3. 禁止 squash、cherry-pick、fast-forward、octopus merge、rebase 和重写 Worker 历史。
4. 出现任何冲突立即 `git merge --abort` 并 escalation。不要在 merge commit 中手工编辑领域文件。
5. 干净合并后，需要适配时只能在 integration 所有路径内建立普通提交。
6. integration 第一父链上的每个提交，包括 merge commit，都必须包含当前集成 Task ID。
7. 禁止进入其他 Worker worktree；禁止要求总控直接修复产品代码。

## 验证与交付

运行全量构建、单测、Fixture 黄金路径、权限负路径和 Smoke Test。成功后 commit + push，并使用 `worker_finish.py` 发送一次结构化 `worker_done`。

机器门禁会验证：

- 所有依赖 SHA 被精确 no-ff 合入；
- 每个 merge tree 可由 Git 自动重算；
- 第一父链没有越权修改；
- 提交信息包含集成 Task ID；
- Branch、Attempt、Dispatch 和 Contract Hash 与本 worktree 完全一致。

最终 Release Task 完成后，总控还会在另一个全新 detached verification worktree 中重跑 release checks。不要依赖当前工作区的缓存、未追踪文件或本机秘密。

## 《都记得》集成黄金路径

必须验证：私聊默认私密 → 逐条同意 → 五阶段报告 → blocked 交接 → 双方确认 → owner/未来提醒迁移 → 看护超时升级 → 闭环。还必须在模型关闭时证明报告只做人工模板变量替换，且看护确认后的完整链路 LLM 调用数为零。任何领域缺陷都退回责任轨的新 Attempt；集成轨只在 `apps/web/src/app/**`、`apps/web/src/integration/**`、`deploy/**`、`docs/release/**` 和 `README.md` 做组装。
