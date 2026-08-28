# TIMETABLE-INTEGRATION-001

## Goal

Integrate exact reviewed Domain, Web, and QA commits into one clean delivery branch, make only minimal assembly fixes, verify the final product, and launch it locally.

## Ownership

- Exact track merges
- Minimal cross-track wiring required for compilation or acceptance
- `README.md`
- `MEMORY.md`

Return defects to the owning track when they are not simple integration wiring.

## Acceptance

- Changed paths match the approved scope and no generated screenshots are tracked.
- Frozen install, unit, typecheck, lint, build, E2E, and accessibility checks pass.
- Desktop and mobile visual QA shows no critical clipping, overlap, or blocked action.
- Final branch is pushed, clean, and its production server is reachable locally.
