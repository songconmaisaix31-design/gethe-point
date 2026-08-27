# MVP core testkit

This package provides a dependency-free, deterministic harness for the
`mvp-core` canonical graph. `pnpm run check:qa-core` validates fixture shape,
privacy boundaries, server-owned scenario parsing, handover guards, atomic owner
and reminder movement, and persistence without requiring unfinished product
routes.

## Integration seam for MVP-INT-001

The browser suite targets the exported `MVP_CORE_SEAM`:

- `GET /fixtures/mvp-core?scenario=mvp-core&role=<role>` renders the fixture UI.
- `POST /api/fixtures/mvp-core/reset` accepts only `{ scenarioId }` and returns
  `204` after resetting isolated acceptance state.
- `GET /api/fixtures/mvp-core/state?scenario=mvp-core` returns
  `MvpCoreSnapshotSchema` and never includes raw private message content.
- `POST /api/fixtures/mvp-core/commands` accepts only
  `MvpCoreCommandRequestSchema` and returns `MvpCoreCommandResponseSchema`.

The command request intentionally has no actor ID, space ID, raw content, health
information, timestamp, or arbitrary scenario payload. The integration handler
must map the selected local-demo role to the canonical server-owned actor and
must use canonical graph values for every mutation. Unknown scenarios return
`404`; non-enumerating private-message denials return `404`; strict-request
failures return `400`; authorization failures return `403`; guarded state
transitions return `409`; successful commands return `200`.

Every rendered fixture surface keeps the three truth badges and the fictional
notice visible. DOM hooks are the exported `MVP_CORE_SEAM.testIds`; they are an
acceptance contract, not a styling API.
