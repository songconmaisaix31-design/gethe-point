# ADR-0002：每个 Task Attempt 独立 Worktree 与严格完成证明

- 状态：Accepted
- 日期：2026-08-27
- 适用范围：全部 Orca Fleet Run
- 关联配置：`.agents/fleet.json`、`.agents/plans/current.json`

## 1. 背景

本项目采用多 Agent 并行开发。若多个任务复用同一个工作区、同一个会话或同一条可变分支，会出现四类风险：

1. 文件改动互相污染，目录所有权无法机器验证；
2. 失败重试继承脏状态，无法区分新旧实现证据；
3. 总控 Agent 吸收大量源码与 Worker 对话，上下文逐步失真；
4. “所有任务显示完成”不等于最终发布分支真正包含全部成果并通过全量检查。

因此，本 Epoch 不接受“一个轨道长期复用一个 Worktree”，也不接受主 Agent 或总控 Agent 代写任何计划任务。

## 2. 决策

### D1. 主 Agent 是薄启动器

用户所在的主 Agent / 主工作区只执行 `scripts/start_fleet.py`，不得承载产品实现、修复、测试、集成或发布任务。启动脚本创建一个 `fleet-control-*` 的 linked worktree，并在其中运行唯一总控子 Agent。

### D2. 总控也是独立子 Agent，且只做控制面

总控只可写 `.agents/plans/**`、`.agents/runs/**`、`.agents/decisions/**`、`.agents/handoffs/**`。即使某个 Worker 只差一行代码，总控也不得代修，必须派发新的 Task Attempt。

### D3. 每个 Task Attempt 使用唯一 linked worktree

每次派发都强制：

```text
worktree_mode = new-top-level
workspace      = trk-<track>-<task>--<run>-a<attempt>
reuse_worker   = false
```

同一逻辑任务失败后，旧 Dispatch 被释放；下一次重试使用递增 Attempt、全新 Branch、全新 linked worktree 和新的 Contract Hash。旧 Worktree 不得复用。

### D4. Task 身份不可变且必须四方匹配

一个 Worker Attempt 的身份由以下字段共同确定：

- Run ID
- Logical Task ID
- Attempt
- Dispatch ID
- Workspace / Branch
- BASE_SHA
- Contract Hash

`gate.py init` 将这些字段绑定到当前 linked worktree。`worker_finish.py`、`fleet.py accept` 与远端 Git 证据必须完全一致，任一不匹配即拒绝验收。

### D5. 总控只保留结构化上下文

总控只读取：

- `state.json`
- `CONTEXT_BRIEF.md`
- 结构化 `worker_done` / `question` / `escalation`
- Decision / Handoff
- 机器门禁和完成证明

禁止把完整 Worker 对话、长日志或大段源码复制进总控上下文。Worker 完成摘要限制为短结构化字段，并附 Proof Hash。

### D6. 所有计划工作都必须委派

计划内的 foundation、业务实现、测试、修复、Fixture、集成和 release 均属于 Task，全部通过独立 Worktree 子 Agent 执行。计划校验禁止：

- `control` 轨任务；
- `run_in_coordinator`；
- Task 覆盖 `worktree_mode`；
- 缺少最终 integration completion task；
- completion task 未传递依赖全部任务。

### D7. “完成”采用 fail-closed 语义

系统不承诺任何外部模型永远成功，但保证不会把失败伪装成完成：

- 默认最多 3 个隔离 Attempt；
- 尝试耗尽后任务进入 `exhausted`，Run 保持未完成；
- 不允许跳过失败任务或使用 `--allow-incomplete` 生成发布证明；
- 只有 strict finalize 成功后，才能声明 Run 完成。

### D8. Strict finalize 在全新 Worktree 复验发布

最终 completion task 必须是最后 Wave 的 integration Task。`fleet.py finalize` 必须：

1. 确认所有任务均已验收；
2. 重新 fetch 最终远端分支并校验 SHA 未漂移；
3. 证明每个任务的已验收 SHA 都是 Release SHA 的祖先；
4. 重算最终 no-ff integration merge tree；
5. 在全新的 detached verification worktree 中重跑 release checks；
6. 生成带 Hash 的 `FINAL_COMPLETION_PROOF.json` 和 `RELEASE_MANIFEST.json`。

在以上步骤全部成功之前，任何 Agent 不得向用户声称“开发完成”。

## 3. 后果

### 正向后果

- 每次任务和每次重试均有独立、可审计的文件系统与 Git 身份；
- 主 Agent 与总控 Agent 不吸收实现细节，长期运行时上下文更稳定；
- 失败可追溯到具体 Attempt，不会污染后续重试；
- 最终发布是否包含全部成果由 Git 祖先关系和 detached Worktree 检查证明。

### 成本

- Worktree 和 Dispatch 数量增加；
- 共享契约变更必须通过新 Epoch / Handoff，不能临时跨轨修补；
- 尝试耗尽时会诚实停止，而不是继续输出未经证明的“完成”。

这些成本是可接受的，因为本项目优先保证可审计、零冲突面和可靠完成声明。
