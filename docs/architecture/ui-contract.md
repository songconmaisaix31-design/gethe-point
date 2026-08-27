# Fixed UI and Accessibility Contract

Status: Frozen by `CONTRACT-001`

This file freezes facts for `EXPR-001`; it does not implement or render UI. The executable source is `packages/contracts/src/ui.ts`.

## Product truth labels

The following copy is exact and must remain visible on every fixture screen and artifact:

- `演示数据 Fixture`
- `用于演示流程，不是账号实况`
- `演示角色切换，不是生产身份认证`

These labels prevent fictional role switching, local fixture data, screenshots, or a public page from being mistaken for a production account or live household state.

## Role surfaces

| Role | Primary home | Product reason |
| --- | --- | --- |
| `primary` | responsibility map and workload-release summary | makes invisible coordination visible and shows what responsibility has actually left the original owner |
| `partner` | owned responsibility domains and pending handovers | makes the complete accepted responsibility boundary clear |
| `subject` | large-text private conversation and one-step care acknowledgement | provides direct independent value without requiring responsibility-model concepts |

The primary and partner homes are not generic chat homepages. Chat is an input surface; responsibility ownership is the product output.

## Frozen state vocabulary

| State | Heading | Detail/action |
| --- | --- | --- |
| loading | `正在加载` | `请稍候，不会自动提交任何操作。` |
| empty | `暂无内容` | `这里还没有可显示的记录。` |
| blocked | `暂时无法继续` | `信息或确认尚未完整，当前状态没有改变。` |
| denied | `无法查看` | `你没有权限查看此内容。` |
| error | `操作未完成` | `当前状态没有改变，请稍后重试。` |
| retry | `重试` | action label only; retry must be idempotent |
| success | `已完成` | operation-specific confirmed outcome |
| needs human review | `需要人工确认` | `AI 未能生成可靠结果，未执行后续操作。` |
| evidence missing | `证据已缺失` | `相关结论需要重新确认，暂不计入报告。` |
| unresolved care | `仍未解决` | `升级流程已留痕，请由家人现场确认。` |

Blocked and error copy must name that state did not change. Success copy appears only after the deterministic operation succeeds.

## Design tokens

The palette is warm, low-saturation, non-competitive, and non-game-like. Components consume semantic CSS variables generated from `UI_TOKENS`; they do not copy raw values ad hoc.

| Token group | Frozen facts |
| --- | --- |
| color | warm canvas/surface, dark neutral body text, brown primary action, blue focus ring, distinct text-plus-background pairs for info/success/blocked/error |
| typography | system Chinese sans-serif stack; 16px default body; subject body 20px; subject heading 26px; line height at least 1.5 |
| spacing | 4/8/12/16/24/32/48px scale |
| radius | 8/12/16px; pills reserved for status, not primary information |
| target | default minimum 44x44px; subject primary minimum 60x60px |
| motion | 120ms/200ms only; all non-essential animation disabled under reduced motion |
| focus | 3px visible outline with 2px offset; never color alone |
| elevation | one restrained surface shadow; no hard or playful game-like shadow |

The subject body foreground/background token pair must meet at least 7:1 contrast. All other interactive text and controls must meet WCAG 2.2 AA; status meaning also requires text or an icon with an accessible name.

## Viewports

| ID | Size | Required behavior |
| --- | --- | --- |
| `mobile` | 390x844 | no horizontal scroll; fixed/primary actions remain visible without obscuring content; system text scaling does not clip |
| `desktop` | 1440x900 | readable line lengths; primary action and blocked reason remain in the same task context; no stretched full-width text |

Both viewports must show complete Chinese strings without truncation, overlap, hidden focus, or obscured primary actions.

## Required screen contracts

Every listed surface must render loading, empty, blocked, denied, error, retry, and success where the operation supports it. A surface may not reinterpret blocked as empty or error as success.

| Screen ID | Roles | Fixed fixture fact |
| --- | --- | --- |
| `role-home` | all | role-specific home plus visible fixture/auth truth boundary |
| `private-conversation` | all | only the active fictional member's private messages |
| `signal-consent` | all | `告诉家里人`, `先别说`, and `只告诉指定成员`; no preselected sharing |
| `family-activity` | primary, partner | consented structured conclusions only; no raw private message |
| `responsibility-report` | primary, partner | exact five-stage counts and neutral narrative; no rank, score, blame, or red member |
| `handover` | primary, partner | missing information visually prominent; independent confirmations; ownership unchanged while blocked |
| `care-inbox` | all | subject acknowledgement first; escalation outcome visible; no diagnosis or dosage advice |
| `evidence-and-privacy` | all | provenance, evidence delete, future-analysis revoke, personal export, and space delete according to authority |

## Older-subject constraints

- Body text is at least 20px and headings at least 26px.
- The primary acknowledgement target is at least 60x60px.
- A care acknowledgement is one click or one voice action; it does not require typing.
- A screen contains at most three primary interactive elements and no nested navigation.
- Focus order follows visual order and focus remains visible.
- Body contrast is at least 7:1 and information never relies only on color.
- `prefers-reduced-motion: reduce` removes non-essential transitions.
- The product safety copy states that it is not a medical device, does not diagnose, and does not replace emergency services.

## Screenshot manifest

The contract freezes scenario names and visual assertions. `EXPR-001` owns rendered files and baselines.

| Scenario ID | Viewports | Required visible facts |
| --- | --- | --- |
| `primary-home-before-handover` | mobile, desktop | fixture labels; seven remembered items; neutral language |
| `handover-blocked-missing-result` | mobile, desktop | missing result emphasized; both confirmation state; owner unchanged |
| `handover-accepted-workload-release` | mobile, desktop | new owner; old reminder absent; accepted terminal state |
| `partner-pending-handover` | mobile, desktop | complete domain boundary; recipient confirmation action |
| `subject-private-consent` | mobile, desktop | large text; three consent choices; no preselected sharing |
| `subject-care-acknowledgement` | mobile, desktop | 60px one-step action; safety copy; no nested navigation |
| `care-escalated-and-handled` | mobile, desktop | escalation trail and visible handled/closed state |
| `evidence-deleted-needs-review` | mobile, desktop | evidence missing vocabulary; report exclusion; accepted handover preserved |
| `denied-private-evidence` | mobile, desktop | non-enumerating denial with no private content |
| `provider-fallback-human-review` | mobile, desktop | needs-human-review copy; no implied mutation |

## Visual acceptance

Automated screenshots are necessary but not sufficient. The UI track must also verify keyboard operation, focus visibility, text scaling, contrast, target size, reduced motion, screen-reader names, and the subject's one-step path. A later human usability receipt is required before claiming that an older adult can use the flow independently.
