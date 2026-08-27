# We Remember MVP Implementation Roadmap

Status: Planning draft; not launchable
Planning date: 2026-08-27
Control worktree: `fleet-control-mvp-planning-v2`
Reviewed PRD: `产品需求文档_都记得_PRD.md` at Git blob `761a2431b674824d40fea06b22058c7afd65260a`
Requested archive: `orca-directory-fleet-kit.zip` at SHA-256 `FAC74080BF7517527743BE7ED3CB0EA9CB8A71039EF83B0E952BF8000B42678E`

## Outcome

The shortest reliable path is two planning epochs, not one speculative full-build plan.

1. **Foundation Epoch:** freeze product acceptance, then architecture/API/Schema/security contracts.
2. **Implementation Epoch:** generate exact build tasks only from the accepted foundation SHA and its machine-readable `implementation-contract.json`.

This separation matters because the repository currently has no implementation stack, lockfile, test runner, or application directories. Pretending those choices are already known would create parallel workers with fake checks and unstable interfaces, increasing rework and privacy risk.

## Current launch status

**Blocked. Do not run `start-coordinator`, `launch`, or any Worker.**

The fleet control plane exists at local commit `4e65eba793ff1c63c695ff842e30fd0a9b3fcf07`, while `origin/main` remains `70ca3dce63e137902274c14c101e69e47a84f1cb` and does not contain the kit. The foundation plan deliberately uses the unresolved ref `BLOCKED_UNTIL_KIT_IS_IN_SHARED_BASE` so an accidental launch fails before creating Orca state.

In this requested kit version, `plan_status` and `launch_authorized` are review metadata; the scripts do not currently evaluate them. The unresolved base ref is therefore the actual machine-enforced block. It must not be replaced until launch authorization is checked in code before any Orca Run state is created.

An alternate remote control plane exists at `origin/songconmaisaix31-design/we-remember-fleet-kit`, but it was built from a different archive. Its recorded Run exhausted three attempts before any Worker, Dispatch, branch, or product change was created. That branch and Run are historical evidence, not a base or authorization for this requested-package planning lineage.

Launch becomes eligible only after:

- the kit is available from a reviewed remote base ref;
- one control-plane lineage is selected by exact archive checksum and remote SHA, and the failed alternate Run is explicitly excluded or reconciled;
- Fleet launch rejects draft or unauthorized plans before creating Run state, with a targeted regression test;
- product acceptance is reviewed;
- `mvp-foundation-v1.json` changes from draft to approved;
- its blocked base refs are replaced by the exact fetched remote ref;
- plan validation and doctor pass again.

## Foundation Epoch

Source of truth: [mvp-foundation-v1.json](mvp-foundation-v1.json)

| Wave | Task | Track | Output | Why it must precede implementation |
| --- | --- | --- | --- | --- |
| Product freeze | `PROD-001` | `product` | Reviewed PRD, acceptance manifest, demo fixture contract, UI facts | Prevents building a generic chat app and freezes what the demo must prove |
| Architecture freeze | `ARCH-001` | `architecture` | Tech Spec, API Contract, schemas, state machines, threat model, implementation contract | Gives every later Worker one shared contract, real paths, and executable checks |

The accepted `ARCH-001` SHA must contain the accepted `PROD-001` SHA in its history. That SHA becomes the only valid input for implementation planning.

## PRD decisions that PROD-001 must close

| Decision | Current conflict | Required product outcome |
| --- | --- | --- |
| P0 scope cuts | Family group and data-control rights are P0, while the risk section permits cutting some of them; the rephrase helper appears in both MVP and P1 | One authoritative P0 matrix with explicit cut authority and demo impact |
| Consent grants | The core flow requires per-item explicit consent, while the risk section suggests persistent category grants | One default-deny grant model with revocation, scope, expiry, and audit behavior |
| Handover states | The flow uses proposed, blocked, and active while the data model lists draft, pending states, accepted, declined, and expired | One user-visible vocabulary mapped to one persisted state machine |
| Evidence visibility | Raw evidence is described as self-only, while shared conclusions expose an original-quote entry point | One ACL rule for who can retrieve raw content, redacted excerpts, or only a provenance marker |
| Deletion and retention | Handover and audit history are described as immutable, while space deletion promises complete deletion | One retention rule for evidence, derived conclusions, handovers, and audit records |
| Platform and delivery | Target platform, notification channel, deployment level, visual tokens, and screenshot source are not frozen | Exact Web/PWA/native scope, channel behavior, viewports, assets, tokens, and visual QA evidence |
| High-risk content | High-risk messages are blocked from ordinary tasks, but emergency sharing across the consent boundary is unspecified | An explicit no-bypass rule or a narrowly reviewed emergency policy with user-visible behavior |

## Definition of Ready for implementation

Implementation planning must stop unless all items are true:

- P0, P1, non-goals, and scope-cut rules are explicit.
- The approved P0 matrix closes every conflict listed above and matches the reviewed PRD fingerprint.
- The seven-step demo and fictional Fixture contract are frozen.
- Target platform, viewports, UI states, visual source, assets, tokens, and screenshot acceptance are defined.
- Data ownership, consent, visibility, deletion, export, and audit contracts are machine-readable.
- Handover and care state machines include success, blocked, timeout, declined, unresolved, and retry behavior.
- The stack, package manager, repository layout, exact commands, dependency policy, and secret configuration locations are selected.
- Each future track has non-overlapping physical paths and executable checks.
- No secret value or real household/health data is present.

## Provisional implementation topology

This section is a roadmap, not an executable DAG. Task IDs and checks must be regenerated from the accepted implementation contract.

### Epoch 2A — runnable foundation and persisted invariants

The accepted implementation contract must start with a serial foundation baseline before parallel feature work. It selects the final physical paths and owner; this roadmap intentionally does not invent them.

| Provisional task | Intended responsibility | Required gate |
| --- | --- | --- |
| `FOUND-001` | Minimal runnable application, package manager, local database/test harness, strict TypeScript, and exact shared commands | Install, typecheck, unit-test, and local-run checks execute from a clean checkout |
| `DATA-001` | Complete first migration for Space, Member, Conversation, Message, Evidence, Signal, Domain, Task, Handover, CareRule, CareEvent, Reminder, and AuditLog | Five-stage Task ownership fields and consequential-state constraints are executable before UI or Agent code |

### Epoch 2B — deterministic core and static experience

| Provisional task | Track | Intended responsibility | Required gate |
| --- | --- | --- | --- |
| `DOMAIN-001` | `domain` | Space/member consent, five-stage Task ownership, responsibility domains, handover, deletion, audit | Contract/unit tests for every consequential transition |
| `CARE-001` | `care` | Human-confirmed care rules and deterministic escalation with controllable time | Timeout/escalation/unresolved tests with no LLM in execution |
| `AI-001` | `ai` | Witness, domain, handover, and boundary drafts behind validated schemas | Invalid JSON, timeout, retry, redaction, and human-fallback tests |
| `WEB-001` | `web` | Fixed-data, pixel-faithful role experiences before real integration | Desktop/mobile screenshot QA, overflow, overlap, accessibility, reduced motion |
| `QA-001` | `qa` | Fictional golden Fixtures and contract acceptance | Three domains, eight valid signals, two non-task discussions, no personal data |

Static UI must pass screenshot QA before `WEB-002` connects real data. Core and UI tasks start only from the accepted `DATA-001` SHA. This protects persisted invariants and the product's central experience from being buried under integration debugging.

After acceptance, a sole `INT-001` integration task merges the exact remote SHAs with clean `--no-ff` commits and produces a new implementation baseline.

### Epoch 3 — connected application and final evidence

| Provisional task | Track | Intended responsibility | Required gate |
| --- | --- | --- | --- |
| `API-001` | `api` | Authenticated application boundary over accepted domain, care, and AI contracts | Input, authorization, error, privacy, deletion, and audit tests |
| `WEB-002` | `web` | Connect accepted UI to real application interfaces | Static fidelity preserved; loading, empty, blocked, error, and retry states pass |
| `QA-002` | `qa` | End-to-end consent, handover, care, deletion, safety, and demo flow | Representative success and failure paths with responsibility attribution |
| `INT-002` | `integration` | Exact-SHA assembly, full checks, release manifest, local/public evidence split | Clean history, complete checks, reproducible four-minute demo |

## P0 ownership map

| P0 outcome | Primary implementation owner | Contract consumers |
| --- | --- | --- |
| Five-stage responsibility fields | `domain` | `api`, `web`, `qa` |
| Family space, roles, authorization | `domain` | `api`, `web` |
| Agent DM and family group | `ai` for interpretation; `api` for transport | `web`, `qa` |
| Signal and Evidence creation | `ai` drafts; `domain` accepts/rejects | `api`, `qa` |
| Consent gate and visibility | `domain` | `api`, `web`, `qa` |
| Responsibility report | `domain` computes; `web` presents | `qa` |
| Blocked two-party handover | `domain` | `api`, `web`, `qa` |
| Care activation and escalation | `care` | `api`, `web`, `qa` |
| Evidence trace/delete and space delete | `domain` | `api`, `web`, `qa` |
| Three role-specific home experiences | `web` | `qa` |

No table row grants cross-track write access. Shared behavior changes begin in contracts and are consumed through accepted interfaces.

## Quality and safety gates

- **Scope:** one track, one worktree, one branch, exact `write_paths`.
- **Contracts:** consumers start only from the accepted contract SHA.
- **Privacy:** deny by default; validate all untrusted input; redact model context; never log private evidence or secret values.
- **Consequential state:** deterministic transitions only, with idempotency and audit evidence.
- **AI:** schema validation, bounded retry, explicit timeout, human fallback, prompt version, cost/latency receipt.
- **UI:** fixed-data fidelity first, then real integration; desktop/mobile screenshots; no truncation, overlap, obscured actions, color-only meaning, or inaccessible tap targets.
- **Accessibility:** subject text at least 20px, titles at least 26px, 7:1 body contrast, 60x60px targets, reduced motion, one-step acknowledgement.
- **Failure:** blocked, partial, failed, unresolved, and unavailable remain distinct from success.
- **Evidence:** Local, Fixture, Public Runtime, Deployment, and Official Acceptance are labeled separately.

## 96-hour control points

| Timebox | Required outcome | Stop/cut rule |
| --- | --- | --- |
| 0–8h | Product acceptance and demo Fixture frozen | Do not design architecture against unresolved P0 behavior |
| 8–20h | Architecture, schemas, exact stack/checks frozen | Do not dispatch implementation with placeholder commands |
| 20–56h | Runnable foundation, complete first migration, core tracks, and static UI accepted | Cut P1 first; record any P0 cut as a product decision |
| 56–76h | First integration baseline and connected app | Stop cross-track patching; return failures to owning track |
| 76–88h | E2E, privacy, safety, accessibility, demo timing | No new feature scope |
| 88–96h | Release candidate, evidence, rehearsal buffer | Freeze candidate; fixes require explicit severity and owner |

## Evidence required for completion

A future implementation run is complete only when the Release Manifest links the objective, plan, tasks, dispatches, branches, remote SHAs, checks, acceptance decisions, integration merges, and release candidate. Local success does not prove deployment, and deployment does not prove official submission or acceptance.
