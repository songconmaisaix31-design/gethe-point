# Project Memory

## Current State

- Development starts from clean `origin/main` commit `e69da999a1e9851fa7b69613e63e88b92e35bec8` on isolated branch `songconmaisaix31-design/mvp-v1-1-lite`.
- The source PRD is `C:\Users\DW\Downloads\产品需求文档_都记得_PRD_V1.1.md` (V1.1, 2026-08-28).
- `prototype.html` Style A is the approved visual source; the repository Logo is reusable.

## Durable Decisions

- Deliver a simple MVP, not the previous over-engineered project.
- Use one Next.js application, strict TypeScript, Node's SQLite API, one domain folder, and one Web folder.
- Selective migration means reviewing and copying only useful fixture data, UI behavior, or small pure functions. Do not merge or cherry-pick old implementation branches wholesale.
- Do not migrate Fleet Kit, package-level contract/data architecture, large table sets, custom gates, historical proof artifacts, or release machinery.
- The default demo is credential-free Fixture mode. Optional LLM and A3 integrations use environment configuration and fail safely when disabled.
- Historical tests are not evidence for this branch; all completion claims come from final clean-HEAD verification here.

## Secret Handling

- Record environment variable names only. Never record secret values.

