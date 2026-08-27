# Decision 0003: Hackathon Core MVP Scope

- Status: Approved by product owner
- Date: 2026-08-28
- Delivery mode: Credential-free local Fixture demo

## Context

The original Fleet plan preserves a production-oriented target, but its exhaustive Unicode, timestamp, concurrency, deletion, care, visual, and release gates have produced more repair work than product progress. The immediate goal is a hackathon MVP that proves the product's differentiating responsibility-transfer loop with real application code and persisted data.

The existing Run `run_a6e82cb7623f`, its immutable failed Attempts, the approved overall plan, and the unapproved deep repair drafts remain the post-MVP Kit target. They are not rewritten or presented as completed.

## Decision

Create a separate Fleet Run from accepted HAND-001 base `59e4bcb98be9d21432a92d02e7d01962bc4451cb`, then apply the already-proven four-line workspace-lock correction in one isolated foundation task before product work. Keep the low-cost Kit controls that prevent parallel-work corruption:

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
4. A handover remains `blocked` while the previous examination result is missing; owner and reminder remain unchanged.
5. The primary carer visibly supplies the missing result, moving the handover to `awaiting_confirmations` without transferring ownership.
6. After both parties confirm, the owner and future reminder move together and both role views reflect the change after reload.

## MVP blockers

- At least one responsibility domain traverses the real UI, public command/query handlers, and PostgreSQL.
- Private Fixture content is self-only before explicit same-speaker sharing; discard, wrong actor, wrong space, or missing consent produces zero shared writes.
- The five responsibility-stage fields are persisted facts, and report copy is deterministic and neutral.
- Missing information and one-sided confirmation cannot transfer ownership or reminders.
- A visible `补齐上次检查结果` action must move `blocked` to `awaiting_confirmations` before either confirmation can complete the handover.
- Accepted handover transfers ownership and future reminders atomically.
- The subject mobile flow and primary/partner desktop flow have visible primary actions with no blocking overlap or clipping.
- Every screen and artifact says `Fixture`, `Local Demo`, and `Not Production Acceptance` truthfully.
- No external model, credential, production identity, public deployment, or production-security claim is required.

## Visual source and adaptation

The fixed visual source is repository code at `origin/main@df9b5b3787715c9582aafcc3a936fa6afe3918c4`:

- `prototype.html` blob `7be8089e87f10e4622c98753c577b0f7ef9ff55c`;
- `style-options.html` blob `0d6a3c99357b3bd0e668bacc4782a3d366ce76c7`.

Use finalized Style A `纸页`: warm paper background, white surfaces, ink green primary, brown accent, restrained borders and shadows, near-square corners, and serif display headings. Treat the HTML/CSS/JS as a code reference, not an asset to copy into production and not a reason to add remote fonts or runtime dependencies.

Adapt the layout rather than reproducing its wide, shallow control rows. Core responsibility, consent, report, and handover containers need meaningful vertical depth, 16-20px vertical padding, clear title/body/action zones, and bounded content widths. At 1440x900, use a compact scenario rail with three phone-proportioned role surfaces; at 390x844, show one role surface with the older subject's larger type and touch targets. Do not stretch core cards into flat full-width strips.

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
