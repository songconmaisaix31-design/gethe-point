# Decision 0003: Hackathon Core MVP Scope

- Status: Approved by product owner
- Date: 2026-08-28
- Delivery mode: Credential-free local Fixture demo

## Context

The original Fleet plan preserves a production-oriented target, but its exhaustive Unicode, timestamp, concurrency, deletion, care, visual, and release gates have produced more repair work than product progress. The immediate goal is a hackathon MVP that proves the product's differentiating responsibility-transfer loop with real application code and persisted data.

The existing Run `run_a6e82cb7623f`, its immutable failed Attempts, the approved overall plan, and the unapproved deep repair drafts remain the post-MVP Kit target. They are not rewritten or presented as completed.

## Decision

Create a separate Fleet Run from accepted base `217d9a3b421e8eef628483f349346eea981a435c`. Keep the low-cost Kit controls that prevent parallel-work corruption:

- four product workers at a time;
- one task per isolated worktree and native Dispatch;
- exact base and dependency SHAs;
- non-overlapping write ownership;
- independent acceptance before integration;
- no reuse of failed Attempts.

Reduce the product gate to one 90-120 second core journey:

1. A fictional older subject writes one private Fixture message.
2. No shared record exists until that same subject explicitly chooses to share it.
3. A persisted task exposes all five responsibility-stage owners and produces a neutral report.
4. A handover remains `blocked` while required information or either confirmation is missing.
5. After both parties confirm, the owner and future reminder move together and both role views reflect the change after reload.

## MVP blockers

- At least one responsibility domain traverses the real UI, public command/query handlers, and PostgreSQL.
- Private Fixture content is self-only before explicit same-speaker sharing; discard, wrong actor, wrong space, or missing consent produces zero shared writes.
- The five responsibility-stage fields are persisted facts, and report copy is deterministic and neutral.
- Missing information and one-sided confirmation cannot transfer ownership or reminders.
- Accepted handover transfers ownership and future reminders atomically.
- The subject mobile flow and primary/partner desktop flow have visible primary actions with no blocking overlap or clipping.
- Every screen and artifact says `Fixture`, `Local Demo`, and `Not Production Acceptance` truthfully.
- No external model, credential, production identity, public deployment, or production-security claim is required.

## Preserved post-MVP Kit targets

The following remain documented targets but do not block the hackathon core:

- complete Unicode case-folding and adversarial provider-output coverage;
- arbitrary fractional-second and offset timestamp correctness;
- care scheduling and escalation;
- evidence and space deletion cascades, export, and the complete authorization matrix;
- exhaustive race, failure, retry, migration, and rollback matrices;
- the full three-role, all-state, two-viewport visual and accessibility matrix;
- live model integration, the full seven-step demo, public deployment, and release evidence.

The active `CONTRACT-CORR-004` worker may finish and be recorded as a post-MVP asset, but it is not a dependency of the new core Run and must not trigger downstream advancement in the old Run.

## Evidence boundary

Success means a reproducible local Fixture MVP. It does not prove production authentication, general private-input safety, live model behavior, public deployment, release readiness, or official hackathon acceptance.
