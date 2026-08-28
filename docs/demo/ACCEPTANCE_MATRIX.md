# MVP Acceptance Matrix

| Area | Frozen evidence in QA-001 | Integration acceptance requirement |
| --- | --- | --- |
| Timetable seed | Real API projection renders six items across seven day sections | Reset restores the canonical six items across three owners and three categories |
| Timetable filters | Member and category filters are exercised independently and in combination | Filtering changes only the rendered projection and can be reset without mutating state |
| Timetable create | Structured UI form creates an item through the action API | The created item retains owner, category, domain, and planned status after reload |
| Timetable complete | Non-owner UI is disabled and direct API mutation returns `403 forbidden` | Only the owner can complete the item and the completed state survives reload |
| Member Agents | Three targets × schedule, responsibilities, care, and help use the real Agent API | Every answer remains read-only and reports `fixture_intent_router` when StepFun is cleared |
| Agent privacy | Partner queries target every member while private text and hidden self-only IDs are asserted absent | Selecting another member never expands the caller's role-safe projection |
| Fixture shape | Three roles, three domains, eight confirmed signals, two discussion-only distractors | Final reset endpoint reproduces the same deterministic state |
| Privacy | Fixture role allowlists and black-box projection assertions | Private subject text is absent from primary and partner API/UI before per-item consent |
| Consent | `share_evidence` contract example and `consent-space` browser path | Only the subject action changes visibility and creates shared effects |
| Responsibility | Every task persists all five stage keys; report rejects blame/rank/diagnosis wording | Reload preserves all five fields and the rendered report is neutral |
| Handover | Blocked packet with `last_report`, two actors, expected burden 7 → 2 | Missing info and either single confirmation keep ownership unchanged; second confirmation atomically moves owner and reminders |
| Care activation | Draft rule requires `member_subject` and has a 60-second timeout | Non-subject activation is rejected; unconfirmed rule cannot trigger |
| Care timeout | Exact `advance_demo_clock(60)` case and escalation order | Equality times out; partner precedes primary; acknowledgement closes the event |
| Notifications | App shown, Robot A3 disabled by default, duplicate status frozen | Logs use safe statuses; provider acceptance is never rendered as receipt or acknowledgement |
| Reset | Black-box reset assertion | Reset restores draft rule, blocked handover, empty care events, and empty notification logs |
| Responsive | `/` and `/demo` cover desktop 1440×900, mobile 390×844, and narrow 320px overflow; `/demo` retains tablet 820×1180 | Final integrated UI has no horizontal overflow, clipping, overlap, or obscured primary action |
| Accessibility | Both routes cover keyboard paths and accessible names; `/demo` retains subject 20px text, 44px targets, and reduced motion | Run the installed Playwright checks; axe is not claimed because `@axe-core/playwright` is not installed |
| Truth | `truth-label` and notification-log assertions | UI visibly distinguishes Fixture/local evidence from production auth, live delivery, and real-device smoke |

## Required Stable Test IDs

Timetable: `family-home`, `role-switch`, `timetable-filter-all`, `timetable-grid`, `timetable-day-*`, `timetable-item-*`, `complete-item-*`, `member-agent-*`, `agent-message`, `agent-send`, `agent-response`, `add-item-form`, and `open-demo`.

Demo regression: `role-switch`, `consent-space`, `responsibility-report`, `handover-status`, `handover-add-info`, `handover-confirm`, `burden-count`, `care-activate`, `care-trigger`, `care-advance`, `care-ack`, `notification-log`, `truth-label`, and `subject-chat`.

## Evidence Limit

These checks use the local single-household Fixture through the real Next.js API. They do not claim production authentication, multi-user concurrency, live delivery, Robot A3 receipt, or live StepFun acceptance; Agent acceptance deliberately clears StepFun configuration and verifies the deterministic Fixture router.
