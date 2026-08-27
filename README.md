# 《都记得》Orca Worktree-Enforced Fleet Kit

这是《都记得（We Remember）》黑客松 MVP 的可执行多 Agent 开发控制面。它把全部计划任务强制委派给独立 linked Git Worktree 中的子 Agent，并用远端 SHA、目录门禁、精确集成和 detached Worktree 复验收口。

## 核心承诺

```text
主 Agent：只启动，不实现
总控子 Agent：只维护结构化控制面，不写业务代码
每个 Task Attempt：唯一 Worktree + Branch + Worker 会话 + Contract Hash
失败重试：释放旧 Dispatch，创建全新 Worktree
最终完成：所有任务 SHA 被 Release 包含，并在新 Worktree 重跑发布检查
```

系统不会把失败伪装成完成。外部模型或依赖可能失败，但在尝试耗尽、任务缺失、远端 SHA 漂移、目录越权、集成不完整或发布复验失败时，Run 会保持未完成。

PRD 5.1 的见证、责任域、交接、边界四个产品 Agent 是领域与契约边界，不是四个长期 Worktree。开发层始终是一 Task Attempt 一 Worktree；看护升级和报告渲染是无 LLM 的确定性服务。

## 项目入口

- 产品需求：[`docs/product/PRD.md`](docs/product/PRD.md)
- 开发规划：[`.agents/plans/DEVELOPMENT_PLAN.md`](.agents/plans/DEVELOPMENT_PLAN.md)
- 可执行 7 Wave / 19 Task DAG（当前启动禁用）：[`.agents/plans/current.json`](.agents/plans/current.json)
- MVP 工程冻结：[`.agents/decisions/0001-mvp-engineering-freeze.md`](.agents/decisions/0001-mvp-engineering-freeze.md)
- Worktree 与完成语义：[`.agents/decisions/0002-worktree-isolation-completion.md`](.agents/decisions/0002-worktree-isolation-completion.md)
- 目录所有权与执行策略：[`.agents/fleet.json`](.agents/fleet.json)
- 运行手册：[`docs/operations/WORKTREE_EXECUTION.md`](docs/operations/WORKTREE_EXECUTION.md)
- 自动化验证范围：[`TEST_REPORT.md`](TEST_REPORT.md)

## 强制执行拓扑

```text
用户 / 主 Agent（薄启动器）
        │
        ▼
fleet-control-* linked worktree
唯一总控子 Agent（control-only、structured-only）
        │
        ├─ DATA-001 Attempt 1  → 独立 Worktree
        ├─ FOUND-001 Attempt 1 → 独立 Worktree
        ├─ FOUND-002 Attempt 1 → 独立 Worktree
        ├─ CONV-001 Attempt 1  → 独立 Worktree
        ├─ ...
        ├─ 失败任务 Attempt 2 → 全新 Worktree
        └─ INT-002 Release     → 独立集成 Worktree
                                      │
                                      ▼
                           Detached Verification Worktree
```

每个 Workspace 使用唯一名称：

```text
trk-<track>-<task>--<run-token>-a<attempt>
```

计划、配置和脚本会拒绝 Worktree 复用、在总控运行任务、缺少最终 completion task，或 completion task 未传递依赖全部任务。

## 目录结构

```text
.agents/
  fleet.json                         # 轨道所有权与强制执行策略
  plans/current.json                 # 《都记得》机器 DAG
  plans/DEVELOPMENT_PLAN.md          # 人类可读开发规划
  prompts/coordinator.md             # control-only 总控 Prompt
  prompts/worker.md                  # one-task-one-worktree Worker Prompt
  prompts/integrator.md              # 唯一集成 Worker Prompt
  decisions/0001-*.md                # 产品工程语义
  decisions/0002-*.md                # Worktree 与完成语义
  runs/                               # Run 状态、摘要、证据与 Manifest
scripts/
  start_fleet.py                     # 主 Agent 的薄启动入口
  fleet.py                           # Run/Task/Dispatch/重试/验收/收口
  gate.py                            # Worktree 身份和目录门禁
  worker_finish.py                   # 结构化完成证明
  common.py                          # Git、计划与范围验证
  tests/                             # 自动化测试
.githooks/pre-commit                 # 提交前门禁
.github/workflows/agent-gate.yml     # CI 门禁
AGENTS.md                            # Agent 宪法
PRINCIPLES.md                        # 核心原则
TEST_REPORT.md                       # 已验证能力与环境限制
docs/operations/WORKTREE_EXECUTION.md
```

## 1. 前提

- 当前目录是 Git 仓库，具有可访问远端基线，例如 `origin/main`；
- Orca Runtime 正在运行，CLI 已注册，Orchestration 已启用；
- Codex、Claude Code 或指定 CLI Agent 可在 Orca 中运行；
- Python 3 可用；控制脚本无第三方 Python 依赖；
- Git 支持 `git merge-tree --write-tree`。

安装 Orca Skill：

```bash
orca skills install --skill orca-cli --skill orchestration
orca skills get orchestration --full
```

## 2. 安装到实际项目

将本包根目录内容复制到目标仓库根目录。根据项目修改：

- `.agents/fleet.json` 中的 `base_ref`、轨道 allowlist、检查命令和 Agent 默认值；
- `.agents/plans/current.json` 中的任务、依赖、write_paths 与 checks。

模板计划默认应保持 `draft`、`launch_authorized=false`，并使用不可解析的阻断基线。当前《都记得》执行计划已在用户审阅后显式授权，使用共享远端分支 `origin/songconmaisaix31-design/we-remember-fleet-kit`；该授权只适用于这次计划和这个精确控制面，不得复制为其他 Run 的默认值。

示例提交步骤如下；不要绕过受保护分支或直接 force push：

```bash
git add .
git commit -m "chore: install worktree-enforced Orca fleet"
git push -u origin HEAD
```

启动器会拒绝脏工作区、基线缺少控制面，或本地控制面与公共基线不一致。

`orca.yaml` 的默认 setup 只验证计划，不修改 Git 配置。`scripts/install_hooks.py` 会改变所有 worktree 共享的 `core.hooksPath`，因此保持人工 opt-in，不能由 setup 自动执行。

## 3. 启动前检查

```bash
python scripts/fleet.py doctor --plan .agents/plans/current.json
python scripts/fleet.py validate .agents/plans/current.json
python -B -m unittest discover -s scripts/tests -v
```

也可运行：

```bash
make fleet-doctor
make fleet-validate
make fleet-test
```

## 4. 主 Agent 的启动方式

主 Agent 只执行以下命令：

```bash
python scripts/start_fleet.py \
  --plan .agents/plans/current.json \
  --objective "按 current.json 完成《都记得》MVP，并生成严格完成证明"
```

或：

```bash
make fleet-start
```

`start_fleet.py` 创建一个 `fleet-control-*` linked worktree，并把完整控制循环交给总控子 Agent。主 Agent 不需要接收 Worker 源码、日志或对话。

## 5. 总控子 Agent 的职责

总控自动执行：

```bash
python scripts/fleet.py doctor --plan .agents/plans/current.json
python scripts/fleet.py validate .agents/plans/current.json
python scripts/fleet.py launch .agents/plans/current.json
```

它只写：

```text
.agents/plans/**
.agents/runs/**
.agents/decisions/**
.agents/handoffs/**
```

计划中的 foundation、实现、测试、修复、集成和 release 全部通过：

```text
orca orchestration worker-start --worktree new-top-level
```

派发给独立子 Agent。

## 6. Worker 的不可变身份

每个 Attempt 绑定：

```text
Run ID
Logical Task ID
Attempt
Dispatch ID
Workspace / Branch
BASE_SHA
Contract Hash
Write Paths
Dependency SHAs（仅集成任务）
```

Worker 必须先运行 Task Prompt 中的：

```bash
python scripts/gate.py init <完整身份参数>
python scripts/gate.py check --preflight
```

门禁会拒绝主工作区、非 linked worktree、Branch 不匹配、BASE_SHA 漂移、Contract Hash 缺失、目录越权和禁止的 Git 操作。

## 7. Worker 交付

```bash
python scripts/gate.py check --run-checks
git add <owned-paths>
git commit -m "feat(<track>): <summary> [<TASK-ID>]"
git push -u origin HEAD

python scripts/worker_finish.py \
  --logical-task <TASK-ID> \
  --task-id <ORCA_TASK_ID> \
  --dispatch-id <ORCA_DISPATCH_ID> \
  --base <BASE_SHA> \
  --outcome succeeded \
  --summary "完成内容与验证结果" \
  --risks "none 或剩余限制"
```

`worker_finish.py` 发送短结构化 JSON，包含远端 SHA、Attempt、Workspace、Contract Hash、检查结果、Worktree 身份和 Proof Hash。它拒绝脏工作区、未推送分支、重复完成、越界改动和身份漂移。

## 8. 总控验收与上下文卫生

总控使用 `worker_done` 中的原值执行严格验收：

```bash
python scripts/fleet.py accept \
  --state .agents/runs/<RUN>/state.json \
  --task <TASK-ID> \
  --dispatch-id <DISPATCH-ID> \
  --attempt <ATTEMPT> \
  --workspace-name <WORKSPACE-NAME> \
  --contract-hash <CONTRACT-HASH> \
  --branch <BRANCH> \
  --sha <FULL-40-CHAR-REMOTE-SHA> \
  --outcome succeeded \
  --summary "结构化完成摘要" \
  --advance
```

每轮只保留压缩状态：

```bash
python scripts/fleet.py brief \
  --state .agents/runs/<RUN>/state.json
```

`CONTEXT_BRIEF.md` 不含 Task Spec 全文、Worker 对话、长日志或源码，因此总控上下文不会随并行开发无限膨胀。

## 9. 失败重试

失败或停滞任务不得在旧 Worktree 继续修补。总控执行：

```bash
python scripts/fleet.py retry \
  --state .agents/runs/<RUN>/state.json \
  --task <TASK-ID> \
  --reason "根因、修正要求和下一次验收重点"
```

仍活跃但确认停滞时使用 `--force`。每次重试递增 Attempt，并创建新的 Task、Dispatch、Branch、Worktree、Worker 会话和 Contract Hash。默认最多 3 次，耗尽后明确标记 `exhausted`。

## 10. 唯一集成者

integration Task 同样运行在独立 Worktree。它只能合并已验收的精确 SHA，并必须使用干净双亲 `--no-ff` merge。禁止 squash、cherry-pick、fast-forward、octopus、rebase 和手工修改 merge tree 中的领域文件。

冲突必须 abort，并退回责任轨创建新的 Attempt；总控和集成者不得跨轨代修。

## 11. 严格完成

所有 Task 显示 completed 后仍不能直接宣布完成。总控必须执行：

```bash
python scripts/fleet.py finalize \
  --state .agents/runs/<RUN>/state.json
```

finalize 会：

1. 拒绝任何未完成、失败或耗尽任务；
2. 重新 fetch 最终 Release Branch，确认远端 SHA 未漂移；
3. 证明每个任务 SHA 都是 Release SHA 的祖先；
4. 重算最终 integration merge tree；
5. 在全新的 detached verification worktree 中重跑最终 checks；
6. 生成：

```text
.agents/runs/<RUN>/evidence/FINAL_COMPLETION_PROOF.json
.agents/runs/<RUN>/RELEASE_MANIFEST.json
```

只有 finalize 成功并写入 Proof Hash 后，Run 状态才变为 `completed`。

## 12. 常用命令

```bash
# 校验配置和计划
python scripts/fleet.py validate .agents/plans/current.json

# 主 Agent 启动总控子 Agent
python scripts/start_fleet.py --plan .agents/plans/current.json

# 查看 Run 状态
python scripts/fleet.py status --state .agents/runs/<RUN>/state.json

# 生成总控压缩上下文
python scripts/fleet.py brief --state .agents/runs/<RUN>/state.json

# 等待结构化消息
python scripts/fleet.py inbox --state .agents/runs/<RUN>/state.json --wait

# 重试失败任务（全新 Worktree）
python scripts/fleet.py retry --state .agents/runs/<RUN>/state.json --task <TASK-ID> --reason "..."

# 严格发布证明
python scripts/fleet.py finalize --state .agents/runs/<RUN>/state.json
```

## 13. 《都记得》当前任务图

当前 `current.json` 包含 7 个 Wave、19 个任务：

```text
database-foundation（DATA-001：先实际执行 migration）
→ bootstrap
→ contract-freeze
→ parallel-core（7 个领域任务并行）
→ alpha-integration
→ risk-hardening（7 个加固任务并行）
→ release-integration
```

最终 completion task 为 `INT-002`。计划校验要求它传递依赖其余全部任务，finalize 再用 Git 祖先关系证明 Release SHA 实际包含所有成果。

完整运行细节见 [`docs/operations/WORKTREE_EXECUTION.md`](docs/operations/WORKTREE_EXECUTION.md)。
