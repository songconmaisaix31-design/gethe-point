# ADR-0001：《都记得》MVP 工程冻结决策

- 状态：Accepted for MVP
- 日期：2026-08-26
- 适用范围：`.agents/plans/current.json` 对应的 96 小时开发 Epoch
- 产品依据：`docs/product/PRD.md`

## 1. 决策目的

PRD 已定义产品价值与主链路，但部分表述在工程实现上存在二义性。并行开发开始前必须先冻结，否则不同 Agent 会各自解释状态、隐私和删除语义，最终无法安全集成。

本文件只冻结 MVP 的工程语义，不扩大产品范围。任何变更都必须由总控创建新的 Decision，并在形成新 BASE_SHA 后再派发后续 Worker。

## 2. 已冻结决策

### D1. `Handover.accepted` 是交接记录终态

PRD 流程图出现 `accepted → active`，但数据模型没有 `active` 枚举。MVP 统一为：

- `Handover.status=accepted`：交接记录已经完成；
- `Domain.ownerId=toId`：责任域当前由接手人实际拥有；
- 不新增 `Handover.active`；
- 所有权、未来提醒和审计必须在同一事务内完成。

### D2. MVP 只做逐条共享同意，不做长期自动授权

私聊内容默认 `self`。每条候选家庭事务只能由发言人选择：

- `share_space`
- `share_members`
- `keep_private`

MVP 不实现“以后这类都自动告诉家里人”。健康类信息也不继承历史同意，避免同意范围膨胀。

### D3. AI 只产出草稿；有后果的写入由确定性服务决定

- Witness、Domain、Handover、CareRule 抽取可以调用 LLM；
- 所有 LLM 输出必须过版本化 JSON Schema；
- 校验失败重试一次，二次失败进入 `needs_human_review`；
- 权限、同意、状态迁移、提醒去重、看护升级、删除、导出和审计不得由 LLM 决定；
- 高风险分类命中或分类失败时默认阻断普通任务生成。

### D4. 看护不是第五个 Agent

CareRule 的自然语言抽取可以由见证 Agent 使用模型并产出 `CareRuleDraft`，但 `packages/care` 不依赖任何模型或 AI 包。从人工确认开始，排程、提醒、等待、超时、升级、回应、闭环与 unresolved 全部由确定性状态机处理。依赖边界测试和调用计数必须证明这条路径的 LLM 调用数为零。

### D5. 证据删除采用“失效 + 待复核”，不做全自动历史重算

删除 `Evidence` 后：

1. 关联 `Signal` 标记 `evidence_missing`；
2. 关联 `Task` / `Domain` 标记 `needs_review`；
3. 该结论停止参与责任报告；
4. 不自动撤销已经完成的交接；
5. 删除与失效过程写入 `AuditLog`。

完整重算与历史回滚留到 V2。

### D6. Web MVP 不宣称“全部原始数据端内”

PRD 的长期方向是 L0 原始证据端内 / 本地优先。当前 Web MVP 若未真正实现端内加密存储，则采用以下诚实口径：

- 私聊原文存放在服务器私有数据区，由服务端权限与行级策略限制为本人可见；
- 家庭共享库只保存经同意的结构化结论和最小证据指针；
- 发给模型的内容是脱敏后的最小必要片段；
- 产品文案使用“默认私密、逐条授权、最小发送”，不得声称“全部本地”；
- 端内加密存储作为后续架构演进，不在本 Epoch 内伪装完成。

### D7. Fixture-first，真实 LLM 只替换一个可降级节点

完整黄金路径必须在离线 Fixture 模式可运行。Demo 中可以把“见证识别”切换为真实 LLM，但关键结果必须有 Schema 校验与预置兜底。交接、权限和看护状态机不能依赖模型在线。

### D8. 模块通过公开入口协作

每个业务轨道至少暴露一个 `public.ts` 或包级导出；禁止跨模块深层 import。跨轨需要新字段或接口时，Worker 只能发 Handoff，由 foundation 轨在新 Epoch 中修改共享契约。

### D9. 根依赖与锁文件在当前 Epoch 冻结

只有 foundation 轨可以修改根依赖、工作区配置、锁文件、公共 Schema、数据库 migration 和共享 UI 包。并行 Worker 不得临时安装根依赖；需要新依赖时先寻找现有能力，仍无法完成再向总控升级。

### D10. Demo 角色切换不等于生产鉴权

MVP 可以提供显式 Demo 角色切换器以加快演示，但：

- 真实服务层仍按当前 Member 与 visibility 做权限判断；
- Demo 切换器只在 Demo 配置启用；
- 生产构建默认关闭；
- E2E 必须同时验证 UI 隐藏和直接 API 越权失败。

### D11. 数据库 migration 是第一个产品实现任务

首个产品实现任务必须先把完整核心数据库 migration 应用到一次性 PostgreSQL 实例，并通过系统目录证明 `Task.discoveredBy`、`deadlineKeptBy`、`scheduledBy`、`executedBy`、`followedUpBy` 是真实一等列。应用、API、UI、报告和看护实现只能依赖该已验收 SHA 开始；静态 SQL 文本匹配不构成“已落库”证明。

### D12. 报告只做人工模板变量替换

责任报告由确定性指标、版本化人工模板和白名单变量生成。renderer 只允许字面变量替换；缺少变量、未知变量或未知模板必须阻断。报告渲染路径不得导入或调用 `LLMProvider`，相同输入和模板版本必须产生字节一致的文案。

## 3. 变更规则

任何需要修改本 ADR 的请求，执行顺序为：

```text
Worker 发 question / escalation
→ 总控记录 Decision
→ foundation 轨修改契约或共享地基
→ 验收并 push 新远端 SHA
→ 停止旧 Wave，建立新 Epoch
→ 后续 Worker 从新 BASE_SHA 启动
```

禁止在旧基线上“顺手兼容”两套语义。
