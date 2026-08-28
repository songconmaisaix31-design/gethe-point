# QA and Fixture Task Card

## Goal

Create one realistic fictional household Fixture and executable acceptance for the four-minute Demo path.

## Write Paths

- `fixtures/**`
- `tests/**`
- `docs/demo/**`

## Acceptance

1. Fixture has three domains, at least eight valid signals, two discussion-only distractors, one blocked handover, and one care escalation.
2. Tests verify core state transitions and the role-safe browser path without reading credentials.
3. E2E covers desktop and mobile; accessibility checks cover subject type, target size, labels, keyboard path, and reduced motion.
4. Assertions distinguish Fixture/local/fake-provider proof from production/live-device proof.
5. Only assigned paths change; worktree is clean and pushed.

## Explicitly Do Not

- Fix product code, create provider mocks that bypass public boundaries, deploy, or claim real A3/enterprise delivery.

