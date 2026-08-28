# We Remember Timetable Agents MVP

- Status: Approved for implementation
- Source: `C:\Users\DW\Downloads\产品需求文档_都记得_PRD_V1.1.md`
- Product direction: family timetable first, with one role-safe Agent per family member

## Product Outcome

Make the family timetable the home of the application. A household member should be able to see what the family needs to do this week, open a specific family member's Agent, ask about that person's role-safe information, and take a small number of explicit actions without navigating a complex system.

The accepted V1.1 demonstration remains available at `/demo`. The new home at `/` does not remove consent, responsibility, handover, care, or notification behavior already delivered.

## Core Experience

1. Open `/` and see a seven-day timetable backed by the local SQLite Fixture.
2. Filter timetable items by family member and inspect their category, owner, time, status, and related responsibility domain.
3. Open 林秀、陈建国 or 周素兰 as a member Agent.
4. Ask about schedule, responsibilities, or care information and receive a response derived from the current role-safe projection.
5. Add a timetable item through explicit fields; the item persists after reload.
6. Complete an item only when the current role owns it; unauthorized attempts return a safe refusal.
7. Open `/demo` to run the existing consent, report, handover, care, and notification flow.

## P0 Scope

- Seven-day family timetable with member, category, status, and domain context.
- One `timetable_items` persistence table and Fixture seed data.
- Three member Agent entry points using the current viewer's role-safe projection.
- Bounded read-only intents: schedule, responsibilities, care, and help.
- Explicit structured creation of timetable items.
- Owner-only completion of timetable items.
- Responsive desktop and mobile layouts with keyboard and screen-reader support.
- Regression protection for the accepted `/demo` flow.
- Honest labeling of the credential-free deterministic Fixture intent router.

## Deliberate Constraints

- No calendar library, Agent framework, vector database, ORM, background scheduler, or global state library.
- No transcript persistence, natural-language date parsing, recurrence, drag-and-drop, or speculative automation.
- No LLM keys or external credentials are required for the MVP.
- No production authentication, multi-household tenancy, or enterprise administration claims.
- Free text is read-only. Every mutation uses explicit validated fields and authorization checks.

## Acceptance Criteria

- `/` is visibly and functionally timetable-first.
- The Fixture exposes at least six timetable items across all three members and at least three categories.
- Each Agent can answer supported queries from current persisted, role-safe data.
- A valid created item survives reload and a Fixture reset restores the canonical seed.
- Only an item's owner can complete it.
- Selecting another member's Agent never expands the current viewer's visibility or exposes raw private evidence.
- `/demo` remains usable and its existing core browser tests pass.
- Unit, type, lint, build, desktop/mobile E2E, and accessibility checks pass from the final clean HEAD.
