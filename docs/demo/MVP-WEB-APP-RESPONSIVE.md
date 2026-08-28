# MVP Responsive Web App Acceptance

Status: coordinator handoff captured from `WEB-UI-001`

## Outcome

Replace the three-phone demonstration stage with a real responsive Web App that renders only the server-selected Fixture role. Style A remains the visual language: a warm paper canvas, restrained green and brown, document-like typography, fine borders, and quiet card depth. Phone bezels, simulated device chrome, and simultaneous multi-role panels are not part of the product surface.

This matters because each household member needs a usable role-specific workspace, not a presentation mockup. The responsive shell must preserve the product's responsibility, consent, and handover truth while making the current role's work legible at ordinary desktop, tablet, and mobile sizes.

## Acceptance criteria

### Shared product shell

- Render exactly one `RoleSurface`, selected from the allowlisted `role` session query.
- Keep the existing typed HTTP client, command names, request serialization, reload behavior, server snapshot revision, and error truth handling unchanged.
- Preserve every existing `data-testid` value on the same fact or action when its owning role is selected.
- Keep all Fixture truth labels visible, including `演示数据 Fixture`, `用于演示流程，不是账号实况`, and `演示角色切换，不是生产身份认证`.
- Provide compact role links for `primary`, `partner`, and `subject`. These links are explicitly demo navigation and never represent production authentication.
- Do not load remote assets, add dependencies, or alter APIs, authentication, persistence, contracts, fixtures, or tests.

### Role homes

- `primary`: responsibility/report/handover workspace. The report and handover cards remain the central content, including blocked reasons, confirmations, current owner, and reminder owner.
- `partner`: owned responsibility and pending handover workspace. The accepted state must still show handover status, current owner, and reminder owner so the transferred boundary remains visible after acceptance.
- `subject`: private consent conversation. The private message, consent state, and all currently available consent/publish actions remain on one clear page.
- Chinese product copy remains Chinese. Technical state labels and wire facts remain exact where they are part of the existing contract.

### Desktop: 1440x900

- Use a persistent application sidebar for brand, role navigation, current server truth, scenario progress, and Fixture reset.
- Use a broad main workspace with a role-specific page header and a responsive business-card grid.
- Do not render phone frames, device status bars, device captions, or a multi-device stage.
- Keep readable line lengths and keep the blocked reason, state facts, and related actions in the same task context.

### Tablet: 1024x768

- Reflow the application into a narrower sidebar and adaptive card grid without clipped content or horizontal scrolling.
- Allow primary cards to collapse from two columns to one where required by content width.
- Keep navigation, truth labels, current stage, status facts, and actions reachable.

### Mobile: 390x844

- Render a full-width, single-column current-role page with no device frame and no horizontal scrolling.
- Replace the persistent desktop sidebar with compact role navigation and current Fixture status at the top of the page.
- Keep truth labels visible without ellipsis or truncated Chinese text.
- Keep primary actions reachable without covering content and preserve visible keyboard focus.

### Card geometry and accessibility

- Every core card keeps four ordered zones: title, content, state, and actions.
- Core card zones use 16-20px vertical padding and remain vertically substantial; information must not be compressed into a dashboard thumbnail.
- Default interactive targets remain at least 44x44px.
- The subject surface uses at least 20px body text, at least 26px headings, and at least 60px primary targets.
- Status is always expressed in text, not color alone. Focus uses a visible 3px outline with offset.
- Respect `prefers-reduced-motion: reduce` and do not require animation for meaning.

## Constraints and risks

- Existing baseline tests still encode three simultaneously visible phone-proportioned surfaces. They conflict with this specification and are outside this track's write scope; the QA or integration owner must update those assertions.
- Browser validation must distinguish current UI behavior from obsolete phone-shell assertions. Type, lint, build, focused experience tests, and viewport checks remain required evidence.
- No client-side role impersonation state is introduced. Navigation changes only the allowlisted query value and the server-rendered route selects the displayed Fixture role.

## Implementation tasks

1. Replace simultaneous role rendering with one selected `RoleSurface` and a responsive app shell.
2. Convert `ScenarioRail` into application navigation and scenario/status content that collapses cleanly on tablet and mobile.
3. Restructure role headers and card grids without changing action wiring or server facts.
4. Ensure the partner's handover facts remain visible before and after acceptance.
5. Replace phone-stage CSS with Style A responsive Web App CSS.
6. Verify focused tests, typecheck, scoped lint, build, and representative 1440x900, 1024x768, and 390x844 rendering.

## Completion evidence

- Changed-path audit contains only the approved UI implementation files.
- `git diff --check` passes.
- Focused experience tests are run and any stale assertion conflict is identified precisely.
- Typecheck, scoped lint, and production build pass.
- Runtime viewport checks confirm one selected role, no phone shell, no horizontal overflow, no clipped primary action, and visible role/status navigation at all three required sizes.
