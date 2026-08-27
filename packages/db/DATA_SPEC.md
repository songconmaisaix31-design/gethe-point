# DATA-001 PostgreSQL Persistence Specification

Status: Implementation contract for `DATA-001`
Frozen dependency: `CONTRACT-001` at `4f92e193870c54c39d4d26eda136f0950b6da339`

## Outcome

Provide the first complete PostgreSQL persistence boundary for the MVP. A fresh
database must be migrated without manual setup, application mutations must run
inside an actor-bound transaction, and database constraints must fail closed for
privacy, consent, replay, and terminal-state violations.

## Scope

The package owns:

- Drizzle definitions for spaces, members, conversations, messages, evidence,
  signal drafts, shared signals, consent decisions, domains, tasks, handovers,
  care rules, care events, reminders, audit logs, and idempotency records;
- one SQL migration that creates the same persistence model and its database
  functions/triggers;
- actor-bound transaction and repository helpers;
- a Docker-backed disposable PostgreSQL verifier.

It does not own HTTP authentication, feature orchestration, UI behavior, AI
provider calls, or root dependency configuration.

## Data and constraint decisions

| Boundary | Database rule | User impact |
| --- | --- | --- |
| Space isolation | Composite foreign keys include `space_id`; space deletion cascades all product and audit rows | A guessed cross-space ID cannot create a mixed-family record, and deleting a space leaves no in-space residue |
| Private content | Messages and evidence are self-visible; evidence stores an opaque `raw_ref`, while shared/audit tables expose no raw-content column | Private conversation text cannot leak through shared projections or audit history |
| Shared visibility | Shared tables reject `self`; `members` and `care_related` require bounded member lists, and `care_related` requires a subject | A shared row cannot silently fall back to private or ambiguous visibility |
| Consent | One immutable decision is allowed per draft; a trigger permits shared-signal insertion only from a matching active share decision and identical visibility | Old, discarded, wrong-speaker, or differently scoped consent cannot authorize a shared fact |
| Responsibility | The five task attribution columns are physical nullable UUID columns with same-space member foreign keys | Unknown responsibility remains explicit `NULL`; omission is impossible |
| Handover | Row checks encode state shape; a transition trigger rejects unlisted and terminal outgoing transitions | An incomplete or already terminal handover cannot move ownership |
| Care | Rule/event row checks encode lifecycle shape; the event trigger rejects unlisted and terminal outgoing transitions | Reminder and escalation state cannot disappear or advance through an invented path |
| Replay | Idempotency is unique by space, operation, actor, and key; a different request hash conflicts | Retries cannot create duplicate handovers, reminders, or notifications |
| Audit | Actor shape and a strict safe-change JSON predicate are checked in PostgreSQL | Audit proves who changed which bounded field without becoming a second content store |

Complex packet, schedule, escalation, and missing-information structures remain
`jsonb` because they are bounded contract values read and written atomically.
Relationships that drive authorization, ownership, consent, or lifecycle are
normal columns and foreign keys rather than embedded JSON.

## Repository boundary

`withActorTransaction` validates an actor independently from request data and
is the only public repository constructor. Repositories therefore always have
both a PostgreSQL transaction and a validated actor. They do not accept a logger
or emit message/evidence content.

`acceptHandover` locks the handover and domain, checks versions and both
confirmations, then changes the accepted handover, domain owner and future-task
default, active reminder owners, audit row, and idempotency result in one
transaction. Any error rolls back the complete unit.

## Acceptance criteria

1. `pnpm run check:data` passes strict TypeScript, ESLint, and focused unit tests.
2. `pnpm run db:verify` starts a uniquely named local PostgreSQL container with
   runtime-generated credentials, applies the migration, inspects catalogs,
   exercises representative constraints, and removes only that container.
3. Catalog inspection finds `discovered_by`, `deadline_kept_by`, `scheduled_by`,
   `executed_by`, and `followed_up_by` on `tasks`.
4. Repository verification proves one accepted-handover transaction changes the
   owner/default, active reminders, handover, audit, and idempotency record.
5. Invalid consent, shared visibility, idempotency reuse, and terminal-state
   writes are rejected by PostgreSQL.
6. No credential literal or generated credential is committed or printed.

## Risks and verification

- Docker Desktop must be running locally and able to provide `postgres:16-alpine`.
  The verifier reports only a safe infrastructure error, never its generated
  password or connection URL.
- Drizzle models declarative tables and checks. The migration additionally owns
  deferrable bootstrap integrity and transition/consent triggers, which Drizzle
  does not model as table objects.
- Container cleanup is in `finally`; cleanup targets the exact random name and
  never removes volumes, images, networks, or unrelated containers.
