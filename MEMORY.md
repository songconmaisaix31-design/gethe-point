# Project Memory

## Current State

- `DELIVERY-006` starts from clean commit `4d379df3c1d6c6f185474753e9d2fe12e6a63e29` and applies the reviewed tree delta from `42008dfd6ed9c167553d742d8c14f4ac48a2fe27` as one squash, excluding generated screenshots and `tests/e2e/visual.spec.ts`.
- The source PRD is `C:\Users\DW\Downloads\产品需求文档_都记得_PRD_V1.1.md` (V1.1, 2026-08-28).
- `prototype.html` Style A is the approved visual source; the repository Logo is reusable.
- The integrated MVP uses one persisted local Fixture through the real Next.js API; browser tests run serially because they intentionally share and reset that state.

## Durable Decisions

- Deliver a simple MVP, not the previous over-engineered project.
- Use one Next.js application, strict TypeScript, Node's SQLite API, one domain folder, and one Web folder.
- Selective migration means reviewing and copying only useful fixture data, UI behavior, or small pure functions. Do not merge or cherry-pick old implementation branches wholesale.
- Do not migrate Fleet Kit, package-level contract/data architecture, large table sets, custom gates, historical proof artifacts, or release machinery.
- The default demo is credential-free Fixture mode. Optional LLM and A3 integrations use environment configuration and fail safely when disabled.
- Historical tests are not evidence for this branch; all completion claims come from final clean-HEAD verification here.
- Fixture identifiers, actor mappings, timeout values, and escalation order match `fixtures/household.json` and the frozen API contract.
- The care subject activates the rule and may close an escalated event by acknowledging after deadline equality; only the subject is authorized, and the transaction revalidates the authoritative clock and event state before persistence.
- Repeated triggers reuse the same open care event so App and Robot A3 notification attempts are deduplicated by logical event, recipient, and channel.
- The consent browser test waits for the updated visibility UI before reading the API projection, preventing a desktop-only race without weakening the privacy assertion or changing production behavior.

## Known Limitations

- The Fixture is local and single-household; it is not production authentication or multi-user concurrency evidence.
- Robot A3 remains disabled by default. Provider acceptance, if enabled separately, is not user receipt or acknowledgement.
- Runtime notification channels are limited to `app` and `robot_a3`.

## Secret Handling

- Record environment variable names only. Never record secret values.
