# Orca 独立 Worktree 执行手册

本手册描述运行本包时的强制拓扑、操作命令、失败恢复和最终完成证明。

## 1. 执行拓扑

```text
用户 / 主 Agent（薄启动器）
        │ 只运行 scripts/start_fleet.py
        ▼
fleet-control-* linked worktree
唯一总控子 Agent（只维护控制面）
        │
        ├── Task A Attempt 1 → 独立 linked worktree / Branch / Worker 会话
        ├── Task B Attempt 1 → 独立 linked worktree / Branch / Worker 会话
        ├── Task C Attempt 1 → 独立 linked worktree / Branch / Worker 会话
        ├── Task A Attempt 2 → 全新 linked worktree（仅失败重试时）
        └── Final Integration → 独立 linked worktree
                                     │
                                     ▼
                         Detached Verification Worktree
                         重跑最终发布检查并生成证明
```

主 Agent 不执行计划任务；总控不执行产品任务；Worker 不复用 Worktree；集成者也只是一个独立 Worker。

## 2. 启动前准备

将控制面放入实际项目根目录后，先在隔离分支提交、验证并通过评审。计划默认 `launch_authorized=false` 且基线为 `BLOCKED_UNTIL_KIT_IS_IN_SHARED_BASE`；启动器会拒绝该状态。控制面进入共享远端基线后，必须在单独受审查提交中替换真实基线并显式授权启动。

```bash
git add .
git commit -m "chore: install worktree-enforced Orca fleet"
git push -u origin HEAD
```

若主分支不是 `origin/main`，同时修改：

- `.agents/fleet.json` 的 `base_ref`
- `.agents/plans/current.json` 的 `base_ref`
- `.agents/plans/current.json` 的 `launch_authorized`（评审通过后才可设为 `true`）

`orca.yaml` 默认只运行计划校验。`scripts/install_hooks.py` 会修改所有 worktree 共享的 `core.hooksPath`，只允许人工 opt-in，不得作为默认 setup。

检查环境和计划：

```bash
python scripts/fleet.py doctor --plan .agents/plans/current.json
python scripts/fleet.py validate .agents/plans/current.json
python -B -m unittest discover -s scripts/tests -v
```

## 3. 主 Agent 的唯一启动命令

```bash
python scripts/start_fleet.py \
  --plan .agents/plans/current.json \
  --objective "完成《都记得》MVP，并以严格完成证明收口"
```

该脚本不会在主工作区开发，而是调用 `fleet.py start-coordinator` 创建 `fleet-control-*` linked worktree 和总控子 Agent。

启动前的 fail-closed 检查包括：

- 主工作区必须干净；
- 控制脚本、计划、Prompt、规则与关键产品文档必须存在于公共基线；
- 本地控制面与公共基线不得漂移；
- 当前计划必须是 `child-agents-only`；
- 每个任务必须使用独立 Worktree；
- completion task 必须覆盖全部任务。

## 4. 总控启动 Run

总控子 Agent 自动执行：

```bash
python scripts/fleet.py doctor --plan .agents/plans/current.json
python scripts/fleet.py validate .agents/plans/current.json
python scripts/fleet.py launch .agents/plans/current.json
```

`launch` 只允许在 `fleet-control-*` linked worktree 中执行。它创建 Orca Run，并按 Wave DAG 派发当前可运行任务。

每个 Attempt 的 Workspace 名称固定为：

```text
trk-<track>-<logical-task-lowercase>--<run-token>-a<attempt>
```

例如：

```text
trk-conversation-conv-001--abc123-a1
trk-conversation-conv-001--abc123-a2
```

第二个名称代表同一逻辑任务的全新重试 Worktree，而不是旧工作区复用。

## 5. Worker 的身份绑定

每个 Worker Prompt 都包含一条完整 `gate.py init` 命令，绑定：

- Run ID
- Track
- Logical Task ID
- Attempt
- BASE_SHA
- Workspace Name
- Contract Hash
- Write Paths
- Dependency SHAs（集成任务）

初始化和预检：

```bash
python scripts/gate.py init <Task Prompt 给出的全部参数>
python scripts/gate.py check --preflight
```

门禁拒绝：

- 在主工作区运行；
- 当前目录不是 linked worktree；
- Branch 与 Workspace 不一致；
- BASE_SHA 不一致；
- Attempt / Contract Hash 缺失或变化；
- 写入不属于当前 Task 的目录；
- 普通 Worker 执行 merge、切分支或改写历史。

## 6. Worker 完成协议

Worker 必须完成检查、提交、推送，并保持工作区干净：

```bash
python scripts/gate.py check --run-checks
git add <owned-paths>
git commit -m "feat(<track>): <summary> [<TASK-ID>]"
git push -u origin HEAD
```

最后只发送一次结构化完成消息：

```bash
python scripts/worker_finish.py \
  --logical-task <TASK-ID> \
  --task-id <ORCA_TASK_ID> \
  --dispatch-id <ORCA_DISPATCH_ID> \
  --base <BASE_SHA> \
  --outcome succeeded \
  --summary "完成内容和验证结果" \
  --risks "none 或剩余限制"
```

消息包含 Attempt、Workspace、Branch、Contract Hash、远端 SHA、检查结果、Worktree 身份和 Proof Hash。总控无需读取完整对话或源码。

## 7. 总控验收

总控从结构化 `worker_done` 原样取值：

```bash
python scripts/fleet.py accept \
  --state .agents/runs/<RUN>/state.json \
  --task <TASK-ID> \
  --dispatch-id <DISPATCH-ID> \
  --attempt <ATTEMPT> \
  --workspace-name <WORKSPACE-NAME> \
  --contract-hash <CONTRACT-HASH> \
  --branch <BRANCH> \
  --sha <FULL-40-CHAR-SHA> \
  --outcome succeeded \
  --summary "结构化摘要" \
  --advance
```

验收会重新 fetch 远端并验证：

- Dispatch / Attempt / Contract Hash 一致；
- Workspace 与 Branch 完全相同；
- SHA 等于远端 Branch HEAD；
- 变更范围在 Track allowlist 和 Task write_paths 内；
- 提交信息包含 Task ID；
- integration Task 使用精确的干净 no-ff merge tree。

## 8. 失败、停滞与重试

Worker 无法完成时仍发送 `--outcome failed`。总控记录原因后创建新 Attempt：

```bash
python scripts/fleet.py retry \
  --state .agents/runs/<RUN>/state.json \
  --task <TASK-ID> \
  --reason "根因、修正要求、下一次验收重点"
```

对确定已经停滞但仍显示 dispatched 的 Worker，可使用：

```bash
python scripts/fleet.py retry ... --force
```

强制重试会先释放旧 Dispatch，再创建全新的 Task、Branch、Worktree、Worker 会话和 Contract Hash。默认最多 3 次。达到上限后任务为 `exhausted`，Run 保持失败，不会伪装完成。

## 9. 总控上下文卫生

总控每轮只运行：

```bash
python scripts/fleet.py brief \
  --state .agents/runs/<RUN>/state.json
```

生成的 `CONTEXT_BRIEF.md` 只包含：

- Run 目标；
- Task 状态；
- Attempt；
- 活跃 Workspace / Dispatch；
- 已验收 Branch / SHA；
- 下一步动作。

它故意不包含 Task Spec 全文、源码、完整日志或 Worker 对话。需要实现细节时，创建独立审查任务或要求责任 Worker 返回短结构化摘要。

## 10. 严格完成

全部任务显示 completed 后，必须执行：

```bash
python scripts/fleet.py finalize \
  --state .agents/runs/<RUN>/state.json
```

完成条件：

1. 无 planned、starting、dispatched、failed 或 exhausted Task；
2. completion task 是最终 integration Task；
3. Release Branch 远端 SHA 未漂移；
4. 每个验收 Task SHA 都是 Release SHA 的祖先；
5. 最终集成结构符合精确 no-ff 规则；
6. 全量 release checks 在新的 detached Worktree 中再次通过。

成功后生成：

```text
.agents/runs/<RUN>/evidence/FINAL_COMPLETION_PROOF.json
.agents/runs/<RUN>/RELEASE_MANIFEST.json
```

只有这两个文件生成且 Proof Hash 写入 Run 状态后，才允许声明开发完成。

## 11. 能保证什么

本包机器化保证：

- 所有计划任务都被委派给子 Agent；
- 每个 Task Attempt 都有唯一 linked Worktree；
- 主 Agent 与总控不承载业务实现；
- 失败重试不复用旧工作区；
- 未经远端 SHA、范围、契约、集成和最终复验，不能被标记为完成；
- 尝试耗尽时明确失败，不输出虚假的完成结论。

它不能保证外部模型、依赖服务或需求本身永不失败；它保证的是：持续隔离重试、保留证据、失败时诚实停止，以及只有经过严格证明的 Release 才被称为完成。
