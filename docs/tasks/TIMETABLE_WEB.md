# TIMETABLE-WEB-001

## Goal

Implement the timetable-first family home, three member Agent entry points, explicit timetable actions, responsive behavior, and retain the existing application at `/demo`.

## Ownership

- `src/app/page.tsx`
- `src/app/demo/**`
- `src/app/globals.css`
- `src/components/**`
- `public/**`

Do not edit contracts, server/domain code, Fixture data, Playwright tests, or delivery documents.

## Acceptance

- `/` prioritizes the seven-day timetable and consumes the real API.
- Desktop uses a seven-day overview; mobile uses readable chronological day sections.
- All three Agents support quick queries and bounded free text.
- Structured create and authorized complete actions refresh server state.
- `/demo` preserves the existing flow and stable test identifiers.
- UI is keyboard reachable, screen-reader labeled, and honest about Fixture routing.
