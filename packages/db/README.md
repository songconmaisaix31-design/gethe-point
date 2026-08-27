# `@we-remember/db`

PostgreSQL persistence for the We Remember MVP. The package contains the
Drizzle schema, the first SQL migration, actor-bound repositories, and a
disposable database verifier.

## Public boundary

Create a Drizzle database from an already configured `postgres` client, then
enter repositories through `withActorTransaction`:

```ts
const database = createDatabase(client);

const result = await withActorTransaction(database, authenticatedActor, (repos) =>
  repos.handovers.accept(validatedPersistenceRequest),
);
```

The actor is separate from request data and is validated before PostgreSQL
opens a transaction. Repository failures expose stable content-free codes;
raw database errors and private message/evidence content are not logged.

## Verification

```bash
pnpm run check:data
pnpm run db:verify
```

`db:verify` requires a running Docker engine. It generates a random database
user, database name, password, and container name in memory, starts
`postgres:16-alpine`, applies `migrations/0000_initial.sql`, runs catalog and
constraint proofs, and removes only that exact container in `finally`-style
cleanup.

See [`DATA_SPEC.md`](./DATA_SPEC.md) for the persistence decisions and complete
acceptance mapping.
