# MVP core testkit

This package provides a dependency-free, deterministic harness for the
`mvp-core` canonical graph. `pnpm run check:qa-core` validates fixture shape,
private-message isolation, server-issued Fixture sessions, strict
command-specific parsing, handover guards, atomic owner/reminder movement, and
persistence without requiring unfinished product routes.

## Integration seam for MVP-INT-001

- `GET /fixtures/mvp-core?role=<allowlisted-demo-role>` renders the Fixture UI
  and causes the server adapter to issue an isolated Fixture session.
- `POST /api/fixtures/mvp-core/reset` accepts exactly `{}` and returns `204`.
- `GET /api/fixtures/mvp-core/state` returns `MvpCoreSnapshotSchema` and never
  includes raw private-message content.
- `POST /api/fixtures/mvp-core/commands` accepts only
  `MvpCoreCommandRequestSchema` and returns `MvpCoreCommandResponseSchema`.

The page role is an untrusted local-demo selection, not authentication. The
server validates it against the canonical graph, fixes the scenario, actor, and
space, then injects the issued context separately into the command harness.
Command bodies never carry scenario, role, actor, space, subject, content, or
private text. Only `read_private_message` and `share_private_message` accept a
`targetId`; every other command rejects it as an unknown key.

Unknown or forged sessions fail closed; non-enumerating private-message denials
return `404`; strict-request failures return `400`; authorization failures
return `403`; guarded transitions return `409`; successful commands return
`200`. Every rendered Fixture surface keeps all truth labels and the fictional
notice visible. Exported test IDs are an acceptance contract, not a styling API.
