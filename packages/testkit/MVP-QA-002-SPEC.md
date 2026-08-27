# MVP-QA-002 Core Fixture Correction

Status: implementation specification for the QA track

## Outcome

Provide one deterministic fictional graph and a dependency-free test harness for
the six `@mvp-core` browser contracts without depending on unfinished application
routes. Browser execution remains an `MVP-INT-001` responsibility; this track
must prove unit behavior and Playwright discovery.

## Security boundary

- Command request bodies contain only a command discriminator. The two explicit
  private-message probe commands also require `targetId`.
- Scenario, role, actor, space, subject, content, and private text are never
  accepted from a command body.
- A server-issued Fixture session supplies the allowlisted scenario, role,
  actor, and space independently from the request body.
- Every command branch uses a strict command-specific schema. `targetId` is an
  unknown key for every non-probe command.
- Invalid or forged sessions, body tampering, unauthorized private-message
  probes, and guessed private identifiers fail before persistence. Failure
  responses contain snapshots and safe codes only, never raw private text.

## Canonical graph and state

`fixtures/mvp-core.ts` is the sole QA source for the three fictional roles, one
private message, one consented signal, all five responsibility owners, one
blocked handover, both independent confirmations, and one future reminder. The
harness persists consent, shared/report rows, all five owners, handover state,
domain ownership, and reminder ownership. The second valid confirmation commits
the accepted handover, domain owner, and reminder owner in one persistence save.

## Style A acceptance

The QA expectation is defined directly and does not import the older contract
palette:

| Semantic variable | Value |
| --- | --- |
| `--style-a-background` | `#F4F1EA` |
| `--style-a-surface` | `#FFFFFF` |
| `--style-a-text` | `#1F1C17` |
| `--style-a-primary` | `#33513F` |
| `--style-a-accent` | `#8A5A3B` |
| `--style-a-warning` | `#9C4E22` |

The scenario rail is at most 330px wide. Consent, report,
responsibility, and handover cards use 16-20px vertical padding and expose
vertically ordered title, content/evidence, state, and action zones. The visible
`SupplyHandoverInfo` action copy is exactly `补齐上次检查结果`.

## Browser inventory

The one no-mock Playwright file contains exactly six discoverable tests:

1. Full consent, report, two-confirmation handover, owner/reminder transfer, and reload.
2. No-consent zero shared writes.
3. Blocked and one-sided handover immutability.
4. Partner private-message probe denial and command-body tampering.
5. Strict command-specific request parsing with zero writes.
6. Desktop Style A computed colors, rail geometry, card padding, and vertical zones.

The file must not disable tests, intercept routes, or inject document HTML.

## Verification

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check:qa-core
pnpm exec playwright test --list --grep @mvp-core
python scripts/gate.py check --run-checks
```
