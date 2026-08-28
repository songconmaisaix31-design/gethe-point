# Timetable Agents MVP Delivery Plan

## Objective

Ship a functional family timetable at `/` with three role-safe member Agents while retaining the accepted V1.1 demo at `/demo`.

## Completion Definition

- The persistent seven-day timetable works at desktop and mobile widths.
- Supported Agent queries reflect current role-safe data.
- Structured item creation and owner-only completion work through the real API.
- Privacy boundaries and the existing demo are covered by automated tests.
- Final clean HEAD passes unit, type, lint, build, E2E, accessibility, and visual QA.

## Tracks

1. Domain: contracts, SQLite, validation, authorization, Agent endpoint, Fixture seed, and focused unit tests.
2. Web: timetable-first home, member Agent panel, structured actions, responsive styling, and `/demo` routing.
3. QA: real API browser and accessibility coverage, including privacy and regression cases.
4. Integration: exact reviewed commits, minimal assembly fixes, final verification, and local launch.

## Risks and Controls

- Privacy leak through target selection: compose replies only from the caller projection and assert non-leakage.
- Fake Agent claims: expose the deterministic engine name in API and UI.
- Date complexity: bound the MVP to one Fixture week and explicit ISO inputs.
- Regression of accepted behavior: retain `DemoApp` and run its existing test suite at `/demo`.
- Over-engineering: one table, one endpoint, existing dependencies, no framework additions.
