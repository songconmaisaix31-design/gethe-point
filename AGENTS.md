# Repository Agent Constitution

本仓库采用 Orca CLI 管理的“目录所有权 + 每 Task Attempt 独立 Worktree”多 Agent 开发模式。

## 角色拓扑

```text
主 Agent / 主工作区：薄启动器，不实现
  └─ fleet-control-*：唯一总控子 Agent，只编排
       └─ trk-<track>-<task>--<run>-a<attempt>：独立 Worker 子 Agent
            └─ final integration Worker
                 └─ detached verification worktree
```

主 Agent 不吸收实现上下文；总控不写业务代码；每次任务尝试都有独立 linked worktree、分支、会话和不可变身份。

PRD 5.1 的见证、责任域、交接、边界四个产品 Agent 是领域与结构化契约边界，不对应四个长期 Worktree。实现与重试始终按每个 Task Attempt 新建 Worktree；看护升级和报告渲染是确定性服务，不得扩展成额外 Agent。

## 最高优先级规则

1. **所有计划任务必须委派。** foundation、业务实现、测试、Fixture、修复、集成和发布都必须由独立 Worktree 子 Agent 执行；主 Agent和总控不得代写。
2. **一次 Task Attempt 一个 Worktree。** 禁止跨任务、跨 Attempt、跨会话复用可变工作区。失败重试必须递增 Attempt，并创建新 Branch、新 linked worktree 和新 Contract Hash。
3. **功能定义验收，目录定义写权限。** 只修改当前任务明确列出的 `write_paths`；读取其他目录不代表拥有写权限。
4. **身份不可变。** 当前 Run、Task、Attempt、Dispatch、Workspace、Branch、BASE_SHA 和 Contract Hash 必须全程一致。
5. 禁止 `git switch`、`git checkout`、`git rebase`、`git reset --hard`、`git push --force`；只有 integration Worker 可按专用 Prompt 对已验收 SHA 执行干净 `git merge --no-ff`。
6. 需要跨轨修改时发送 Handoff、question 或 escalation，不直接修改对方文件，也不要求总控代改。
7. 禁止修改公共契约、根依赖、锁文件、部署配置和 CI，除非当前任务明确拥有这些路径。
8. 禁止全仓库格式化；只格式化当前允许目录。
9. 每个可验证增量立即 `commit + push`。已推送历史不得改写。
10. 完成必须同时满足：范围门禁、检查、干净工作区、上游一致、结构化 `worker_done`、总控远端验收。Run 只有 strict finalize 成功后才算完成。

## Worker 标准循环

```text
读取冻结契约与 Task Prompt
→ gate.py init 绑定 Worktree 身份
→ gate.py check --preflight
→ 只在允许目录实现
→ 运行轨道检查
→ 范围门禁
→ commit
→ push
→ worker_finish.py 发送结构化证明
→ 停止修改
```

## 总控上下文规则

总控只保留：

- `state.json`
- `CONTEXT_BRIEF.md`
- 结构化 `worker_done` / `question` / `escalation`
- Decision / Handoff
- 远端 SHA、机器门禁和完成证明

禁止把完整 Worker 对话、长日志、大段源码或临时推理复制进总控上下文。需要独立审查时，创建新的审查 Task/Worktree。

## 阻塞与失败

不要猜测或越权修复。说明任务、Attempt、Dispatch、阻塞原因、责任轨道、建议变化和验收重点。失败 Attempt 归档后，使用 `fleet.py retry` 创建新的隔离 Attempt。默认最多 3 次；尝试耗尽时必须保持失败，不得标成完成。

## 《都记得》项目级强制约束

开始任何任务前，必须读取：

- `docs/product/PRD.md`
- `.agents/plans/DEVELOPMENT_PLAN.md`
- `.agents/decisions/0001-mvp-engineering-freeze.md`
- `.agents/decisions/0002-worktree-isolation-completion.md`
- 当前 Task Prompt 与冻结契约

以下规则高于局部实现便利：

1. `agent_dm` 默认仅本人可见；未经逐条同意不得进入家庭共享库。
2. `Task` 的五阶段归属必须写入数据库一等字段，报告不得现场自由生成。
3. `missingInfo` 非空或双方确认不全时，交接必须 blocked，所有权不得变化。
4. accepted 后 owner、未来提醒和审计必须原子迁移；失败完整回滚。
5. CareRule 未经人确认不得激活；看护升级状态机不得调用 LLM。
6. Evidence 删除后关联结论必须失效并退出报告，不能留下无证据结论。
7. 报告只描述工作分布，不评分、不排名、不判断成员好坏或关系质量。
8. 每个模块只通过 `public.ts` 或包级导出协作，禁止跨模块深层 import。
9. 共享契约、根依赖、锁文件或 migration 需要变化时必须 Handoff 给 foundation，并建立新 Epoch。
10. Demo 结果必须有离线 Fixture 兜底；不得把现场模型成功当作唯一验收路径。
