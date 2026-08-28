# TIMETABLE-QA-001

## Goal

Add real API browser and accessibility acceptance coverage for the timetable and member Agents without weakening existing assertions.

## Ownership

- `tests/**`
- `docs/demo/**`

Do not edit production source, contracts, Fixture data, or root configuration.

## Acceptance

- Cover timetable rendering and filtering.
- Cover persisted item creation across reload.
- Cover owner-only completion and unauthorized refusal.
- Cover supported Agent queries and a privacy non-leak case.
- Cover `/demo` regression after the route move.
- Cover desktop and mobile primary flows and accessibility for both routes.
