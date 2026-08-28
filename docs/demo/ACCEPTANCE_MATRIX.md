# MVP Acceptance Matrix

| Area | Frozen evidence in QA-001 | Integration acceptance requirement |
| --- | --- | --- |
| Fixture shape | Three roles, three domains, eight confirmed signals, two discussion-only distractors | Final reset endpoint reproduces the same deterministic state |
| Privacy | Fixture role allowlists and black-box projection assertions | Private subject text is absent from primary and partner API/UI before per-item consent |
| Consent | `share_evidence` contract example and `consent-space` browser path | Only the subject action changes visibility and creates shared effects |
| Responsibility | Every task persists all five stage keys; report rejects blame/rank/diagnosis wording | Reload preserves all five fields and the rendered report is neutral |
| Handover | Blocked packet with `last_report`, two actors, expected burden 7 → 2 | Missing info and either single confirmation keep ownership unchanged; second confirmation atomically moves owner and reminders |
| Care activation | Draft rule requires `member_subject` and has a 60-second timeout | Non-subject activation is rejected; unconfirmed rule cannot trigger |
| Care timeout | Exact `advance_demo_clock(60)` case and escalation order | Equality times out; partner precedes primary; acknowledgement closes the event |
| Notifications | App shown, Robot A3 disabled by default, duplicate status frozen | Logs use safe statuses; provider acceptance is never rendered as receipt or acknowledgement |
| Reset | Black-box reset assertion | Reset restores draft rule, blocked handover, empty care events, and empty notification logs |
| Responsive | Desktop 1440×900, tablet 820×1180, mobile 390×844 overflow smoke | Final integrated UI has no horizontal overflow, clipping, overlap, or obscured primary action |
| Accessibility | Keyboard path, accessible names, subject 20px text, 44px targets, reduced motion | Run the installed Playwright checks; axe is not claimed because `@axe-core/playwright` is not installed |
| Truth | `truth-label` and notification-log assertions | UI visibly distinguishes Fixture/local evidence from production auth, live delivery, and real-device smoke |

## Required Stable Test IDs

`role-switch`, `consent-space`, `responsibility-report`, `handover-status`, `handover-add-info`, `handover-confirm`, `burden-count`, `care-activate`, `care-trigger`, `care-advance`, `care-ack`, `notification-log`, `truth-label`, and `subject-chat`.

## Evidence Limit

This QA branch can validate the frozen Fixture, public contracts, TypeScript, lint, unit tests, and Playwright test discovery. Full browser, accessibility, and build results become valid only on the final integration HEAD containing both Domain and Web implementations.
