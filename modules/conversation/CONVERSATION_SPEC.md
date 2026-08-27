# MVP-CONV-001 Private Sharing Specification

Status: Implementation scope for `MVP-CONV-001`

## Outcome

Provide a credential-free Fixture flow that starts with no private messages or
shared signals. One active member can create a self-only `agent_dm` message,
derive the canonical bounded signal draft through a public witness port, and
share only that structured draft after an explicit same-speaker consent choice.

## Scope

- Public conversation ports for private-message creation and self-only reads.
- A deterministic Fixture witness for the canonical fictional message.
- Consent recording and idempotent shared-signal confirmation.
- A fresh in-memory Fixture boundary with safe outcome logs and test controls.

The module does not add routes, UI, database migrations, dependencies,
credentials, provider adapters, or network calls.

## Public port sequence

```text
conversation.createPrivateMessage
-> witness.createSignalDraft
-> sharing.decideConsent
-> sharing.confirmSignal
```

`conversation.getPrivateMessage` and
`conversation.getPrivateConversation` return raw content only to the message
speaker. `sharing.getVisibleSharedSignals` returns only structured shared rows
whose visibility predicate includes the caller.

## Acceptance rules

1. A fresh boundary contains zero messages, drafts, consents, and shared
   signals.
2. Message creation requires an active actor who is the sole participant of the
   same-space `agent_dm`; the stored message and evidence are self-only.
3. The witness accepts only the frozen `signal_draft` purpose and
   `signal-draft-v1` prompt version. The caller cannot add provider options,
   prompts, schemas, or logging instructions.
4. Only the canonical fictional Fixture message produces the frozen bounded
   draft. Unsupported free-form content fails with `needs_human_review` and
   creates no draft.
5. Consent belongs to exactly one draft and its speaker. Discard, missing or
   expired consent, inactive actors, wrong actors, wrong spaces, and unsupported
   visibility fail closed without a shared write.
6. The final write rechecks the active actor, actor space, draft speaker,
   evidence ownership and availability, consent ownership and state, exact
   visibility, and expected draft version.
7. One consent creates at most one shared signal. An exact idempotent retry
   returns the original signal; a key reused for a different request fails.
8. Shared rows contain redacted text plus evidence provenance only. They never
   contain private message content or evidence `rawRef` values.
9. Errors are fixed safe messages. Logs accept only operation, request ID,
   actor ID, resource ID, and outcome fields.

## Risks and controls

| Risk | Control | User impact |
| --- | --- | --- |
| Guessed private identifier | Self-only checks at every raw read and draft-source lookup | Another family role cannot learn whether the message exists |
| Consent confused across actors or spaces | Speaker and space are bound to draft, consent, evidence, and final write | A choice cannot authorize someone else's content |
| Stale or duplicate confirmation | Expected version, scoped request hash, and one-signal-per-consent guard | Retries cannot create duplicate family-visible records |
| Raw content copied into shared state | Shared-signal construction reads only the validated draft and provenance projection | Family views never receive the private message |
| Prompt or provider injection | Fixed Fixture prompt metadata and strict request schemas | Callers cannot expand AI behavior or trigger a provider call |
| Sensitive diagnostics | Typed metadata-only log port and constant errors | Logs and failures do not disclose private text |

## Verification

- Unit tests cover the canonical flow, zero-before-consent behavior, discard,
  missing consent, inactive actor, wrong actor, wrong space, invalid visibility,
  guessed-ID reads, unsupported free-form content, idempotent confirmation, and
  raw-content absence from shared rows, logs, and errors.
- Required commands: `pnpm install --frozen-lockfile --ignore-scripts` and
  `pnpm run check:conversation`.
- Scope and final-state verification use `scripts/gate.py` and
  `scripts/worker_finish.py --verify-only`.
