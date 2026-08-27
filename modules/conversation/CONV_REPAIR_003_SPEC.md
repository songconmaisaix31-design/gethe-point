# CONV-REPAIR-003 Technical Specification

Status: implementation contract for the conversation track
Base: `217d9a3b421e8eef628483f349346eea981a435c`

## Product outcome

A member can keep an `agent_dm` message private, optionally obtain a non-consequential signal draft, and explicitly share one bounded signal. No private message or raw evidence becomes family-visible without current, same-speaker, per-signal consent.

## Scope and non-goals

- `modules/boundary` owns disclosure comparison and recursive provider-output inspection.
- `modules/ai-witness` owns deterministic high-risk routing, bounded provider fields, human-authored rendering, timeout/retry handling, and content-free execution metadata.
- `modules/conversation` owns authorization, private reads/writes, consent, confirmation, and persistence ports.
- This track does not add routes, provider SDKs, database schema, root dependencies, tasks, reports, or automatic shared signals.

## Trust-boundary sequence

1. Parse the actor and request with the frozen contract schemas.
2. Load and validate the active space, active actor, `agent_dm` conversation, self-visible source message, available same-speaker evidence, and enabled analysis consent.
3. Classify the protected input with deterministic high-risk rules. High-risk input never invokes the provider and can only create a private, non-consequential `high_risk` draft.
4. For ordinary input, send only a bounded redacted input and a strict JSON schema to the provider. Inspect every string key and string value in the raw provider result before schema validation.
5. Render only through human-authored templates, then inspect every rendered field and the complete draft against the protected private values.
6. After provider completion, lock and revalidate the entire analysis context before persisting a draft. Stale, revoked, inactive, deleted, missing, or cross-space state writes nothing.
7. `ConfirmSignal` starts a transaction before calling `Clock.now()`. The transaction locks actor, space, draft, consent, evidence, and visibility subjects; the service validates them, builds and disclosure-checks the complete shared signal, rereads the locked state, and performs a conditional persistence using the exact observed versions.

## Unicode disclosure algorithm

`unicodeDefaultFullCaseFold` uses the complete Unicode 17.0.0 `C` plus `F` mappings from `CaseFolding.txt`; `S` and Turkic `T` mappings are excluded. The vendored table has 1,585 entries and is generated from:

- Source: `https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt`
- SHA-256: `ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183`

Input is NFKC-normalized, full-folded by Unicode code point, and NFKC-normalized again. Comparison does not delete whitespace, punctuation, or symbols. A candidate is rejected when its folded value equals, contains, is contained by, or is at most one Unicode-code-point edit from a protected folded value.

This deliberately preserves multi-code-point mappings such as `U+00DF -> ss` and `U+1E9E -> ss`, maps final sigma to ordinary sigma, and handles canonical and compatibility equivalents. Locale casing and uppercase/lowercase closure are not used.

## Persistence port guarantees

Adapters implementing `ConversationStore` must provide real transaction isolation for `transaction`, row-lock all records returned by a `lock*Context` method, and make every conditional `persist*` operation return `stale` rather than write when any expected version, state, visibility, or membership fact changed. Missing and unauthorized records remain indistinguishable to callers.

Raw evidence records exposed to this module include private content only inside the authorized transaction/read context. Implementations must never log those records or include them in ordinary errors.

## Completion criteria

- Unauthorized, inactive, cross-space, missing, mismatched, deleted, or revoked analysis input produces zero provider calls and zero writes.
- Self-harm, domestic-violence, and acute-medical fixtures produce zero provider calls, tasks, and shared signals.
- Invalid output, synchronous/asynchronous failures, timeout, and two invalid attempts return `needs_human_review` with no consequential mutation.
- Provider strings, nested keys/values, rendered drafts, and final shared signals pass recursive disclosure inspection.
- Sharp-S variants, final sigma, canonical/compatibility forms, fullwidth forms, case, whitespace, punctuation, symbols, containment, and one-code-point edits fail closed.
- Private-message and raw-evidence reads are self-only even when another member guesses an identifier.
- Consent remains active, unexpired, unrevoked, same-speaker, visibility-valid, and version-current through conditional transaction persistence.
- Tests, typecheck, lint, the forbidden-ancestor check, scope gate, clean push, and `worker_finish.py --verify-only` all pass.
