# 多 Agent 开发九条铁律

> **主 Agent 只启动，总控只编排；一任务一 Worktree，远端证据后才完成。**

1. **主 Agent 是薄启动器。** 用户所在的主会话只启动总控子 Agent，不执行产品实现、修复、测试、集成或发布。
2. **总控只编排，不写业务代码。** 总控负责冻结基线、派发、追踪、决策、验收和收口；任何代码变化都交给独立 Worker。
3. **按目录所有权分轨，不按功能分人。** 任何文件在同一开发纪元只有一个合法写入轨道。
4. **每个 Task Attempt 独立。** 一个 Attempt 对应一个 linked Worktree、一个 Branch、一个 Worker 会话和一个 Contract Hash；失败重试不得复用。
5. **先冻结契约和基线，再开始并行。** 并行 Worker 从同一可审查 BASE_SHA 出发；共享契约变化建立新 Epoch。
6. **跨轨需求只走 Handoff、RFC 或 Decision Gate。** Worker 可以读全仓，但只能写自己的允许路径。
7. **小步提交，远端 SHA 才算可验收。** 每个增量 `commit + push`；已推送历史只追加或 revert，禁止重写。
8. **机器门禁高于提示词自律。** linked Worktree、身份契约、目录范围、提交、测试、精确集成和远端 SHA 均由脚本验证。
9. **严格完成而非乐观完成。** 最终发布必须包含所有任务 SHA，并在新的 detached Worktree 重跑检查；失败或尝试耗尽时诚实停止。

## 记忆公式

**一薄主、一总控、六隔离、五门禁、三证明。**

- 一薄主：主 Agent 只负责启动。
- 一总控：唯一控制面子 Agent。
- 六隔离：任务、目录、Worktree、分支、会话、权限上下文。
- 五门禁：身份、范围、契约、质量、发布。
- 三证明：Worker Proof、集成祖先证明、Detached Release Proof。
