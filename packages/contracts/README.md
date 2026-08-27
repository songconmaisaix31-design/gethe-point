# @we-remember/contracts

This package is the only public contract boundary for the We Remember MVP. Import from `@we-remember/contracts`; deep imports are intentionally unsupported.

It exports strict Zod schemas, inferred TypeScript types, operation registries, complete state-transition tables, authorization/deletion policies, AI/clock/idempotency ports, generated JSON Schema documents, fixed UI facts, and fictional validated examples.

It contains no repository, handler, route, scheduler, provider adapter, network call, credential, rendered UI, or real household data.

```ts
import {
  COMMAND_CONTRACTS,
  TaskSchema,
  contractJsonSchemas,
  type Clock,
  type Task,
} from "@we-remember/contracts";
```

All untrusted values must be parsed with the exported schema before use. A successful parse proves shape only; handlers must still enforce the exported authorization, current-state, visibility, version, and idempotency policies.
