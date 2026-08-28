# STEPFUN-PROVIDER-001

## Goal

Enhance member Agent answer text with optional StepFun Chat Completions while preserving the deterministic, role-safe, read-only core and credential-free fallback.

## Ownership

- `src/contracts.ts`
- `src/server/agent-provider.ts`
- `src/server/demo-service.ts`
- `src/server/runtime.ts`
- `src/app/api/demo/agent/route.ts`
- Focused server/provider tests

Do not edit pages, styles, Playwright tests, Fixture content, dependencies, lockfiles, or delivery documents.

## Requirements

- Use native `fetch` against `https://api.stepfun.com/v1/chat/completions`; add no SDK.
- Read `STEPFUN_API_KEY` only at the server boundary and never log it.
- Allow `STEPFUN_MODEL` override with the low-latency default `step-2-mini`.
- Send only a bounded summary derived from the caller's role-safe projection; never send Evidence text, family messages, notification metadata, or conversation history.
- Keep intent selection, referenced item IDs, suggestions, authorization, and every mutation deterministic and local.
- Bound request and response sizes, apply a short timeout, perform no retry, narrow the unknown response, and fall back on every provider failure.
- Return `engine: "stepfun"` only for a validated provider answer; otherwise return `engine: "fixture_intent_router"`.

## Acceptance

- Provider success rewrites only response text and reports StepFun.
- Missing key, timeout, network failure, HTTP failure, malformed JSON, empty text, and oversized text all return the deterministic response.
- Tests prove the outbound prompt excludes the canonical private Evidence sentence and contains no secret value in errors or logs.
- Existing 25 unit tests, typecheck, lint, and build continue to pass.
