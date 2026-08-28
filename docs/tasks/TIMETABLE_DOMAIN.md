# TIMETABLE-DOMAIN-001

## Goal

Implement the timetable persistence, projection, validated actions, role authorization, deterministic member Agent endpoint, Fixture seed, and focused domain/API tests.

## Ownership

- `src/contracts.ts`
- `src/domain/**`
- `src/server/**`
- `src/app/api/**`
- `fixtures/household.json`
- Colocated server/domain tests required by this change

Do not edit page components, global styles, Playwright tests, or delivery documents.

## Acceptance

- Contract matches `API_CONTRACT.md`.
- At least six seeded items cover three members and three categories.
- Create persists, reset restores, and only owner completes.
- Agent queries are read-only, bounded, current, and role-safe.
- Unit, typecheck, lint, and build pass for the owned implementation.
