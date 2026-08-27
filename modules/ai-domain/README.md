# AI domain draft boundary

This module accepts only redacted, structured responsibility facts and returns a validated domain suggestion. A fixture or model response is never a write command: `modules/responsibility` must revalidate the draft against the actor-visible persisted task and evidence scope before a member can confirm it.

The provider boundary intentionally returns `unknown`. Invalid output, unauthorized references, cross-space references, duplicate identifiers, and provider failures are converted to safe typed errors without exposing provider payloads.
