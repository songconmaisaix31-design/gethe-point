# @we-remember/contracts

This package is the only public contract boundary for the We Remember MVP. Import from `@we-remember/contracts`; deep imports are intentionally unsupported.

It exports strict Zod schemas, inferred TypeScript types, operation registries, complete state-transition tables, authorization/deletion policies, AI/clock/idempotency ports, generated JSON Schema documents, fixed UI facts, exact timestamp comparison, and fictional validated examples.

It contains no repository, handler, route, scheduler, provider adapter, network call, credential, rendered UI, or real household data.

```ts
import {
  COMMAND_CONTRACTS,
  TaskSchema,
  TimestampSchema,
  compareTimestamps,
  contractJsonSchemas,
  type CareClock,
  type Clock,
  type Task,
} from "@we-remember/contracts";
```

All untrusted values must be parsed with the exported schema before use. A successful parse proves shape only; handlers must still enforce the exported authorization, current-state, visibility, version, and idempotency policies.

`compareTimestamps(left, right)` accepts values already validated by `TimestampSchema` and returns `-1`, `0`, or `1`. It preserves arbitrary fractional precision and offset equivalence without conversion through `Date`.

The existing `Clock.now(): Date` interface remains the general-purpose clock contract. Care command adapters implement `CareClock.now(): Timestamp`, validate their source value with `TimestampSchema` before returning it, and commands retain that returned timestamp verbatim. `AcknowledgeCareEvent` and `HandleCareEvent` sample the care clock once and do not accept caller-controlled transition timestamps.
