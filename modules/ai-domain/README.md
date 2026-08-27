# Deterministic Fixture Domain Draft

`modules/ai-domain` supplies the MVP responsibility draft port. It recognizes
the frozen fictional contract signal and returns the frozen domain and task as
strictly validated structured data.

This adapter does not call an LLM, read raw evidence, or persist anything. Any
non-Fixture, incomplete, or unsupported input returns `needs_human_review` with
`consequentialMutationAllowed: false`; the responsibility service therefore
does not issue a create command.

Later provider-backed adapters may implement the same public port, but a model
result must remain a draft and require a separately authorized confirmation
before persistence.
