# Care

Deterministic care-rule activation and event scheduling for We Remember.

```ts
import {
  createCareService,
  createPostgresCareRepository,
} from "./src/index";

const care = createCareService({
  clock,
  repository: createPostgresCareRepository(database),
});

const result = await care.TickCareScheduler(actor, request);
```

The service accepts only the frozen public contract shapes. Its dependency
surface is a `Clock` and a `CareRepository`; it has no LLM/provider dependency.
The PostgreSQL repository stores each operation's idempotency claim and result
in the same transaction as rule, event, and audit mutations.

See [CARE_SPEC.md](./CARE_SPEC.md) for lifecycle semantics and acceptance.
