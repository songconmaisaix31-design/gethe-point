# AI Domain Boundary

This module turns an exact set of authorized shared responsibility signals into
a bounded domain suggestion. It sends only redacted excerpts and provider-safe
source types to `LLMProvider`; selected persistent entity identifiers and raw
evidence never cross that boundary.

`draftDomainSuggestion` validates the complete source graph before and after the
provider call. A successful call persists an immutable server-side draft and
returns an opaque receipt with display-only suggestion text.

`confirmDomainSuggestion` accepts only that receipt plus request and idempotency
identities. It reloads the server-held draft, checks its integrity digest,
requires the same current human, revalidates every guarded record, and delegates
one atomic receipt consumption and domain write to `DomainSuggestionRepository`.

The persistence adapter must generate unguessable receipts, keep draft content
server-side, enforce one-time receipt consumption, recheck the supplied guard in
the domain-write transaction, and store exact idempotent replay results.
