# 《都记得》96 小时开发规划

| 项目 | 内容 |
|---|---|
| 产品 | 都记得（We Remember） |
| 版本 | 黑客松 MVP / V1.0 |
| 计划日期 | 2026-08-26 |
| 计划状态 | Active / Launch Authorized |
| 产品依据 | `docs/product/PRD.md` |
| 工程决策 | `.agents/decisions/0001-mvp-engineering-freeze.md`、`.agents/decisions/0002-worktree-isolation-completion.md` |
| 机器计划 | `.agents/plans/current.json` |
| 开发方式 | 主 Agent 薄启动 + control-only 总控子 Agent + 每 Task Attempt 独立 linked Worktree + 严格完成证明 |

---

## 0. 强制执行模型

本计划中的全部 19 个任务都必须由独立 Worktree 子 Agent 执行，包括 database foundation、工程地基、测试、失败修复、两次集成和最终 release。主 Agent 只运行 `scripts/start_fleet.py`；总控本身也位于 `fleet-control-*` linked worktree，且只能维护结构化控制面。

PRD 5.1 的见证、责任域、交接、边界四个 Agent 是产品领域与结构化契约边界，不是四个长期 Git Worktree。执行层仍然坚持每个 Task Attempt 一个全新 Worktree；看护升级与报告渲染是确定性服务，不增加产品 Agent。

控制面提交 `c2d8751` 已发布到共享远端分支 `origin/songconmaisaix31-design/we-remember-fleet-kit`，用户在审阅交付摘要后于 2026-08-27 明确授权开始执行。当前计划因此为 `active`、`launch_authorized=true`，首个且唯一可派发的产品任务仍是 `DATA-001`；受保护的 `main` 不作为本次执行写入目标。

每次任务尝试使用唯一身份：

```text
Run + Task + Attempt + Dispatch + Workspace/Branch + BASE_SHA + Contract Hash
```

失败重试不得复用旧 Worktree，默认最多 3 个隔离 Attempt。所有任务完成后仍必须通过 strict finalize：证明全部任务 SHA 被 Release SHA 包含，并在新的 detached verification worktree 重跑最终检查。在完成证明生成前，不得宣称开发完成。

执行语义以 `.agents/decisions/0002-worktree-isolation-completion.md` 为准。

---

## 1. 开发目标

在 96 小时内交付一条稳定、可解释、可测试的纵向链路：

在任何应用、API 或 UI 实现前，`DATA-001` 必须先把完整 migration 应用到一次性 PostgreSQL，并证明 Task 五阶段字段是数据库一等列。随后产品链路才开始：

```text
奶奶私聊 Agent：“腿又疼了”
→ 系统识别潜在家庭事务，但默认只在奶奶侧
→ 奶奶逐条选择“告诉家里人”
→ 信号进入“近期健康照护”责任域
→ 五阶段责任报告显示协调工作集中
→ 发起整块责任交接
→ 因缺少检查报告进入 blocked，所有权不转移
→ 补齐信息并由双方确认
→ Domain.ownerId 与未来提醒原子迁移给爸爸
→ 妈妈首页对应“只有你在记得”条目消失
→ 看护提醒先发给奶奶本人
→ 未回应后按确定性状态机升级
→ 爸爸处理并闭环
```

成功不以“聊天有多聪明”为标准，而以以下三件事是否真实发生为标准：

1. 未经本人同意的私聊内容无法进入家庭共享库；
2. 信息不全或确认不全时，责任绝不落到地上；
3. 交接完成后，旧主人不再承担该责任域的未来提醒。

---

## 2. 真相源与优先级

发生冲突时按以下顺序处理：

1. **产品意图**：`docs/product/PRD.md`
2. **MVP 工程语义**：`.agents/decisions/0001-mvp-engineering-freeze.md`
3. **机器契约**：`packages/contracts/**`、`packages/db/**`、`supabase/**`
4. **执行 DAG**：`.agents/plans/current.json`
5. **领域实现**：各轨道目录中的代码与测试
6. **UI 展示**：不得反向定义数据库或权限语义

公共契约一旦由 `FOUND-002` 验收并 push，当前并行 Epoch 内即冻结。需要变更时停止派发，建立新的 foundation 任务和 BASE_SHA。

---

## 3. MVP 范围

### 3.1 必须完成

- 一个家庭空间，三个角色：`primary`、`partner`、`subject`
- 每人一个 Agent 1:1 输入面；家庭群只保留最小提醒与报告能力
- Witness 识别 `SignalDraft`，并保留 `Evidence`
- 私聊到家庭库的逐条同意门：全家、指定成员、保持私密
- 至少三个责任域，八条有效信号，两条讨论干扰句
- `Task` 五阶段一等字段及确定性责任集中度报告
- 一次包含 `blocked` 与双方确认的完整责任交接
- 交接后 `Domain.ownerId` 和未来提醒真实迁移
- 一条人审激活、可加速演示的看护升级链
- 证据溯源、单条删除失效、撤回未来分析授权、个人导出、空间删除
- 三角色首页、被看护人无障碍与一次点击回应
- 完整 AuditLog、LLM 调用版本记录、E2E 与发布证据链

### 3.2 可以 Fixture 化

- 普通闲聊回复
- 责任域智能推荐
- 复杂联系人与历史资料补全
- 真实短信、微信、电话或 Push 通道
- 大多数模型判断结果
- 家庭群完整聊天体验

### 3.3 本次不做

- 真实微信接入、后台读取私人聊天、位置监控、个人日历自动读取
- 真实语音 ASR、截图 OCR、复杂多模态输入
- 情绪诊断、关系评分、贡献排行榜、AI 教育伴侣
- 医疗诊断、用药剂量建议、急救判断
- 多家庭空间、外部照护者、支付、复杂社交
- 全自动长期共享授权
- 证据删除后的完整历史自动回滚

---

## 4. 不可违反的工程不变量

| 编号 | 不变量 | 机器验收方式 |
|---|---|---|
| I-01 | `agent_dm` 默认 `self` | 服务层权限测试；未同意查询返回拒绝 |
| I-02 | 同意前只能有草稿，不能有共享 `Signal` | 数据库与服务测试 |
| I-03 | 五阶段字段直接落库 | Schema 测试与报告快照 |
| I-04 | 报告只统计当前可见、有证据、未失效记录 | SQL/领域测试 |
| I-05 | `missingInfo` 非空时 owner 不变 | Handover 负路径测试 |
| I-06 | 任一确认缺失时 owner 不变 | 双方确认测试 |
| I-07 | accepted 的 owner、未来提醒、AuditLog 原子提交 | 事务故障注入 |
| I-08 | CareRule 未确认不排程 | 状态机测试 |
| I-09 | CareEvent 同一时点唯一且重复 tick 幂等 | 唯一约束 + 并发测试 |
| I-10 | 看护确认后的完整状态机不依赖、不导入、不调用 LLM | 依赖边界 + 调用计数测试 |
| I-11 | Evidence 删除后结论失效并退出报告 | 删除联动测试 |
| I-12 | UI 隐藏不能代替服务端权限 | 直接 API 越权 E2E |
| I-13 | 失败默认阻断，不默认成功 | Schema、超时、权限、状态错误测试 |
| I-14 | 报告不评分、不排名、不指责任何成员 | 文案快照与禁止词测试 |
| I-15 | 报告只使用版本化人工模板和白名单变量替换 | renderer 依赖边界、未知变量拒绝与字节快照 |

---

## 5. 工程假设

这些是本规划的可替换实现假设，不是产品需求本身：

| 层 | 默认方案 | 选择理由 |
|---|---|---|
| 单仓 | pnpm workspace | 锁定共享依赖，便于目录门禁 |
| Web | Next.js + TypeScript | 一仓完成页面、服务适配和部署 |
| 数据库 | PostgreSQL / Supabase | 事务、唯一约束、RLS 与快速部署 |
| 契约 | Zod + JSON Schema | 同时约束 TS、API、Fixture 与 LLM 输出 |
| 单元测试 | Vitest | 与 TS 工程集成简单 |
| E2E | Playwright | 覆盖三角色、权限与 Demo 黄金路径 |
| LLM | 自定义 `LLMProvider`，OpenAI 兼容协议 | 可切换模型并做 Fixture 降级 |
| 调度 | 持久化 Job + 可重复 scheduler tick | 可恢复、可测试、可加速演示 |
| 时间 | 注入 `Clock` | 同一状态机支持真实时间和 DemoClock |

不得为了某个领域 Worker 临时改变共享技术栈；需要变化时走 foundation 新 Epoch。

---

## 6. 目录拓扑与唯一写权

```text
apps/web/
  src/app/                         # integration：唯一页面组装
  src/integration/                 # integration：依赖注入与模块适配
  src/components/layout/           # experience
  src/modules/
    space/                          # experience
    home/                           # experience
    conversation/                   # conversation
    responsibility/                 # responsibility
    handover/                       # handover
    care/                           # care
    privacy/                        # privacy

packages/
  config/                           # foundation
  ui/                               # foundation
  contracts/                        # foundation
  db/                               # foundation
  ai-witness/                       # conversation
  boundary/                         # conversation
  responsibility/                   # responsibility
  ai-domain/                        # responsibility
  handover/                         # handover
  ai-handover/                      # handover
  care/                             # care
  privacy/                          # privacy
  testkit/                          # qa

fixtures/                           # qa
tests/e2e/                          # qa
docs/demo/                          # qa
deploy/                             # integration
docs/release/                       # integration
```

### 6.1 轨道责任表

| 轨道 | 完整责任 | 明确禁止 |
|---|---|---|
| `control` | Plan、Run、Decision、Handoff | 业务代码、根配置 |
| `foundation` | 工作区、依赖、公共 Schema、DB、共享 UI | 消费者业务实现 |
| `experience` | Space、角色首页、布局与无障碍 | 对话、交接、数据库契约 |
| `conversation` | 输入面、Witness、Consent、Boundary、未激活 CareRuleDraft | 责任统计、交接迁移、看护状态机 |
| `responsibility` | Domain、Task 五阶段、确定性模板报告 | 私聊权限、交接状态机、模型生成报告文案 |
| `handover` | 交接包、blocked、双确认、原子迁移 | 看护调度、全局契约 |
| `care` | 人审后的 CareRule、Clock、scheduler、升级状态机 | 医疗判断、任何 LLM/AI 包依赖 |
| `privacy` | visibility、删除、撤权、导出、空间删除 | 自行修改其他领域查询实现 |
| `qa` | Fixture、E2E、演示与故障证据 | 直接修业务目录 |
| `integration` | 精确合并、App Router、DI、部署、RC | 深入重写领域内部代码 |
| `automation` | Orca 控制脚本、Hook、CI | 与业务功能混改 |

每个业务模块必须用 `public.ts` 或包导出暴露能力。禁止 `../../other-module/internal-file` 式深层导入。

---

## 7. 公共契约冻结清单

`FOUND-002` 完成前，禁止启动并行业务 Worker。

### 7.1 实体

```text
User
Space
Member
Conversation
ConversationMember
Message
Evidence
ConsentDecision
Signal
Domain
Task
Handover
NotificationJob
NotificationDelivery
CareRule
CareEvent
AuditLog
LlmRun
```

### 7.2 必须冻结的枚举

- `Member.role`
- `Member.capacityState`
- `Conversation.type`
- `Visibility`
- `ConsentDecision.decision`
- `Signal.status`
- `Domain.status`
- `Task.status`
- `Handover.status`
- `CareRule.status`
- `CareEvent.state`
- 统一错误码与 `needs_human_review` / `needs_review` 语义

### 7.3 必须冻结的写入命令

```text
CreatePrivateMessage
CreateSignalDraft
DecideConsent
ConfirmSignal
CorrectTaskAttribution
ProposeHandover
SupplyHandoverInfo
ConfirmHandoverFrom
ConfirmHandoverTo
AcceptHandover
ConfirmCareRule
TickCareScheduler
AcknowledgeCareEvent
HandleCareEvent
DeleteEvidence
RevokeAnalysisConsent
ExportMyData
DeleteSpace
```

### 7.4 必须冻结的查询

```text
GetRoleHome
GetPrivateConversation
GetVisibleSharedSignals
GetResponsibilityReport
GetDomainWithEvidence
GetPendingHandovers
GetCareInbox
GetAuditTrail
```

---

## 8. 黄金 Fixture

QA 轨维护唯一 ID；所有轨道只引用，不另造一套演示家庭。

### 8.1 成员

| ID | 角色 | 演示身份 |
|---|---|---|
| `member_primary_mom` | `primary` | 妈妈 |
| `member_partner_dad` | `partner` | 爸爸 |
| `member_subject_grandma` | `subject` | 奶奶 |

### 8.2 责任域

| ID | 名称 | 用途 |
|---|---|---|
| `domain_health_followup` | 奶奶近期健康照护 | 主交接与看护链路 |
| `domain_school_uniform` | 孩子周五校服准备 | 五阶段差异演示 |
| `domain_grocery_restock` | 家庭日用品补货 | 无主责任域演示 |

### 8.3 必备数据

- 至少 8 条有效信号；
- 至少 2 条“只是讨论”的非任务句；
- `domain_health_followup` 初始由妈妈承担协调，爸爸有执行记录；
- 交接缺失项固定为“上次检查报告”；
- 接受后 owner 固定变为爸爸；
- 看护规则固定为一条需要回应的提醒；
- Demo 超时为 60 秒；测试 Clock 可瞬时推进；
- 报告初始“只有你在记得”数量与交接后数量均有快照预期。

Fixture 只能由 QA 轨修改；业务轨发现数据不足时发 Handoff。

---

## 9. Wave DAG 与 96 小时节奏

```text
database-foundation / DATA-001
        ↓
bootstrap / FOUND-001
        ↓
contract-freeze / FOUND-002
        ↓
parallel-core
  ├─ EXPR-001
  ├─ CONV-001
  ├─ RESP-001
  ├─ HAND-001
  ├─ CARE-001
  ├─ PRIV-001
  └─ QA-001
        ↓
alpha-integration / INT-001
        ↓
risk-hardening
  ├─ EXPR-002
  ├─ CONV-002
  ├─ RESP-002
  ├─ HAND-002
  ├─ CARE-002
  ├─ PRIV-002
  └─ QA-002
        ↓
release-integration / INT-002
```

| 时间窗 | Wave | 目标 | 阶段门槛 |
|---|---|---|---|
| H0–H4 | `database-foundation` | 核心 migration、五阶段一等列、DB 约束 | 一次性 PostgreSQL 实际执行与系统目录验收 |
| H4–H10 | `bootstrap` | 单仓、共享脚本、UI Token | `FOUND-001` push 并验收 |
| H10–H18 | `contract-freeze` | Schema、状态与权限契约 | `FOUND-002` 成为唯一并行 BASE_SHA |
| H18–H52 | `parallel-core` | 七条零冲突领域纵向切片 | 所有目录轨通过本轨检查并 push |
| H52–H66 | `alpha-integration` | 合并并打通完整 Golden Path | Fixture Demo 可从头走到尾 |
| H66–H86 | `risk-hardening` | 权限、blocked、幂等、无障碍、E2E | 高风险负路径自动化通过 |
| H86–H96 | `release-integration` | 发布候选、部署、演示与证据 | `INT-002` 通过全量 Gate |

时间窗是管理上限，不是异步承诺。任一阶段越时，按第 15 节立即砍项。

---

## 10. 任务摘要

完整 Spec、Acceptance 与 checks 以 `.agents/plans/current.json` 为准。

| Task | 轨道 | 核心交付 |
|---|---|---|
| `DATA-001` | foundation | 首个可执行 DB migration、五阶段一等列与真实 PostgreSQL 验证 |
| `FOUND-001` | foundation | pnpm 单仓、Web 骨架、共享脚本、UI Token |
| `FOUND-002` | foundation | 从已落库事实冻结公共契约、权限与状态约束 |
| `EXPR-001` | experience | 家庭空间、三角色首页、无障碍 |
| `CONV-001` | conversation | Agent 输入、Witness、逐条 Consent、Boundary |
| `RESP-001` | responsibility | Domain、五阶段、责任集中度报告 |
| `HAND-001` | handover | 交接包、blocked、双确认、原子迁移 |
| `CARE-001` | care | 人审 CareRule、Clock、确定性升级链 |
| `PRIV-001` | privacy | visibility、删除失效、撤权、导出、删空间 |
| `QA-001` | qa | 黄金 Fixture、契约校验、E2E 骨架 |
| `INT-001` | integration | Alpha 精确合并与完整 Golden Path |
| `*-002` | 各领域 | 基于 Alpha 的高风险加固 |
| `INT-002` | integration | Release Candidate 与全量证据 |

---

## 11. 跨轨 Handoff 规则

Worker 不得跨目录“顺手修”。请求格式：

```markdown
# Handoff: <来源 Task> → <责任轨道>

- Dispatch ID:
- 当前 BASE_SHA:
- 阻塞程度: blocking / non-blocking
- 发现位置:
- 期望行为:
- 实际行为:
- 所需变更的目录或契约:
- 最小复现:
- 建议验收:
- 是否需要新 Epoch: yes / no / unknown
```

总控只做以下决策：

- 退回原责任轨修复；
- 创建同一 BASE 上的新任务；
- 由 foundation 修改共享契约并创建新 Epoch；
- 记录为已知限制并进入 Release Notes。

总控不得替 Worker 修改业务代码，integration 不得在 merge conflict 中手工修领域文件。

---

## 12. 提交与远端验收纪律

### 12.1 Worker 循环

```text
Preflight
→ 读取 PRD、ADR、当前 Task
→ gate.py init
→ 只改 write_paths
→ 运行本轨检查
→ 小步 commit（含 Task ID）
→ push
→ worker_finish.py
→ 停止修改
```

提交示例：

```text
feat(consent): enforce private-to-shared decision gate [CONV-001]
test(handover): rollback owner transfer on notification failure [HAND-002]
fix(care): deduplicate concurrent scheduler ticks [CARE-002]
```

### 12.2 完成定义

“本地能跑”不等于完成。只有同时满足以下条件才算完成：

- 改动全部位于 `write_paths`；
- 本轨 checks 通过；
- 每个提交含逻辑 Task ID；
- 工作区干净；
- 分支已设置 upstream；
- 本地 HEAD 等于远端 HEAD；
- `worker_done` 只发送一次；
- 总控通过 `fleet.py accept` 验证远端 SHA。

禁止 amend、rebase、force push、squash Worker 历史。

---

## 13. 测试矩阵

| 层 | 重点 | 责任轨 |
|---|---|---|
| Contract | Schema、枚举、错误码、Fixture 兼容 | foundation |
| Domain Unit | 五阶段、blocked、状态迁移、删除失效 | 各领域 |
| Permission | self/space/care_related/members 矩阵 | conversation + privacy |
| Transaction | owner、提醒、审计原子性 | handover |
| Scheduler | 唯一事件、重复 tick、重启恢复 | care |
| UI Module | 三角色、状态卡、一次点击回应 | experience + 各领域 |
| E2E Golden | 完整四分钟纵向链路 | qa |
| E2E Negative | 越权、单方确认、模型失败、重复通知 | qa + 对应领域 |
| Build/Smoke | 生产构建、部署、环境开关 | integration |

### 13.1 最低 E2E 黄金路径

```text
切换奶奶
→ 发送“腿又疼了”
→ 验证默认私密
→ 点击“告诉家里人”
→ 切换妈妈
→ 查看责任报告
→ 发起交接
→ 验证缺报告时 blocked 且 owner 不变
→ 补齐信息并由妈妈确认
→ 切换爸爸确认接收
→ 验证 owner 改变且妈妈提醒消失
→ 触发看护提醒
→ 推进 DemoClock
→ 验证 L1/L2 升级
→ 爸爸处理
→ 验证 CareEvent closed
```

---

## 14. Demo 可靠性设计

### 14.1 必须提供的开关

- `DEMO_MODE=true`
- 一键重置 Fixture
- 一键切换三角色
- 一键生成“本周”报告
- `DemoClock` 推进 60 秒看护超时
- Witness `fixture / live` 双模式
- 网络或模型失败后显示“待人工确认”，不断链

### 14.2 现场依赖优先级

```text
确定性本地状态与 Fixture
> 数据库事务与状态机
> 可替换的 LLM 调用
> 外部通知渠道
```

关键情绪画面必须在离线 Fixture 下可重现：

1. 同意门；
2. blocked；
3. 妈妈首页条目消失；
4. 看护升级闭环；
5. “只有你在记得”数量下降。

---

## 15. 砍项与降级顺序

当实际进度落后时，不讨论“再努力一下”，按顺序执行：

### 第一层：立即砍掉

- 真实语音 ASR
- 截图识别
- “换个说法”
- 静默时段
- 看护人临时不在
- `capacityState` 智能权重
- 外部照护者
- 完整家庭群聊天

### 第二层：降级为 Fixture 或 Demo 控件

- 真实邀请码加入 → 三个预置成员
- 真实多账号登录 → Demo 角色切换器
- 通用 Domain 聚合 → 固定黄金家庭 + 可验证模型草稿
- 真实消息推送 → 站内 NotificationDelivery
- 通用闲聊 → 模板或最小 LLM

### 永远不能砍

- Task 五阶段字段
- 私聊默认私密与逐条同意
- 服务端 visibility 权限
- blocked 与双方确认
- owner/未来提醒真实迁移
- CareEvent 确定性状态机与幂等
- Evidence 溯源和删除失效
- AuditLog
- 三角色差异首页

---

## 16. 启动命令

控制面必须先存在于经过审阅的共享远端 ref。当前执行使用 `origin/songconmaisaix31-design/we-remember-fleet-kit`；任何后续 Run 若改用其他基线，必须重新审查 `.agents/fleet.json` 与 `current.json`，不得在本地孤立分支解除门禁。

```bash
python scripts/fleet.py doctor --plan .agents/plans/current.json
python scripts/fleet.py validate .agents/plans/current.json

python scripts/fleet.py start-coordinator \
  --objective "按 current.json 完成《都记得》96 小时 MVP，并保留完整审查证据链"
```

在总控会话中：

```bash
python scripts/fleet.py validate .agents/plans/current.json
python scripts/fleet.py launch .agents/plans/current.json
```

监督：

```bash
python scripts/fleet.py inbox \
  --state .agents/runs/<RUN>/state.json \
  --wait
```

全部完成：

```bash
python scripts/fleet.py finalize \
  --state .agents/runs/<RUN>/state.json
```

最终必须保存：Run ID、Task/Dispatch ID、每轨分支、远端 SHA、检查结果、Release Candidate SHA、已知限制和 Demo Runbook。

---

## 17. 开发启动前最终检查

- [x] PRD 与 ADR 已提交到共同基线
- [x] `DATA-001` 是首个产品实现任务，且所有后续 Wave 传递依赖它
- [x] `.agents/fleet.json` 项目名、远端基线和轨道路径已核对
- [x] `launch_authorized=true` 只出现在经过评审的共享基线
- [x] `current.json` 验证通过
- [x] 所有目录 allowlist 零重叠
- [x] Orca Runtime 与 orchestration skill 可用
- [x] `origin/main` 可 fetch，控制面分支 push 已验证
- [ ] 需要外部服务密钥时，只允许从本地 Secret 管理注入；`DATA-001` 不需要密钥
- [x] `FOUND-002` 未完成前不派发领域 Worker
- [x] 所有 Agent 知道“远端 SHA 才算完成”
- [ ] Demo Fixture 的唯一 ID 已由 QA 轨冻结
- [ ] 最终路演不依赖现场 LLM 一次成功
