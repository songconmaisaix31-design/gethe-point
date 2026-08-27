import { createHash, randomUUID } from "node:crypto";

import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  isRepositoryError,
  withActorTransaction,
} from "../../src/repositories";
import {
  startDisposablePostgres,
  type DisposablePostgres,
} from "./postgres-harness";

interface FixtureIds {
  readonly conversationId: string;
  readonly domainId: string;
  readonly evidenceId: string;
  readonly handoverId: string;
  readonly messageId: string;
  readonly newOwnerId: string;
  readonly oldOwnerId: string;
  readonly reminderId: string;
  readonly signalDraftId: string;
  readonly spaceId: string;
  readonly taskId: string;
}

const now = "2026-08-27T08:00:00.000Z";
const later = "2026-08-28T08:00:00.000Z";

const buildIds = (): FixtureIds => ({
  conversationId: randomUUID(),
  domainId: randomUUID(),
  evidenceId: randomUUID(),
  handoverId: randomUUID(),
  messageId: randomUUID(),
  newOwnerId: randomUUID(),
  oldOwnerId: randomUUID(),
  reminderId: randomUUID(),
  signalDraftId: randomUUID(),
  spaceId: randomUUID(),
  taskId: randomUUID(),
});

const seed = async (client: Sql, ids: FixtureIds): Promise<void> => {
  await client.begin(async (transaction) => {
    await transaction`
      insert into spaces (id, name, created_by, status, created_at, updated_at, version)
      values (${ids.spaceId}, ${"Fixture family"}, ${ids.oldOwnerId}, ${"active"}, ${now}, ${now}, 0)
    `;
    await transaction`
      insert into members (
        id, space_id, role, display_name, status, joined_at,
        analysis_consent, created_at, updated_at, version
      ) values
        (${ids.oldOwnerId}, ${ids.spaceId}, ${"primary"}, ${"Current owner"}, ${"active"}, ${now}, ${"enabled"}, ${now}, ${now}, 0),
        (${ids.newOwnerId}, ${ids.spaceId}, ${"partner"}, ${"New owner"}, ${"active"}, ${now}, ${"enabled"}, ${now}, ${now}, 0)
    `;
    await transaction`
      insert into conversations (id, space_id, type, created_at, updated_at, version)
      values (${ids.conversationId}, ${ids.spaceId}, ${"agent_dm"}, ${now}, ${now}, 0)
    `;
    await transaction`
      insert into conversation_members (space_id, conversation_id, member_id)
      values
        (${ids.spaceId}, ${ids.conversationId}, ${ids.oldOwnerId}),
        (${ids.spaceId}, ${ids.conversationId}, ${ids.newOwnerId})
    `;
    await transaction`
      insert into messages (
        id, space_id, conversation_id, author_id, client_message_id,
        content, occurred_at, visible_to_member_id, created_at, updated_at, version
      ) values (
        ${ids.messageId}, ${ids.spaceId}, ${ids.conversationId}, ${ids.oldOwnerId},
        ${randomUUID()}, ${"Private fixture content"}, ${now}, ${ids.oldOwnerId},
        ${now}, ${now}, 0
      )
    `;
    await transaction`
      insert into evidence (
        id, space_id, source_type, speaker_id, source_message_id, occurred_at,
        raw_ref, visible_to_member_id, state, created_at, updated_at, version
      ) values (
        ${ids.evidenceId}, ${ids.spaceId}, ${"agent_dm"}, ${ids.oldOwnerId},
        ${ids.messageId}, ${now}, ${"fixture://private-evidence"}, ${ids.oldOwnerId},
        ${"available"}, ${now}, ${now}, 0
      )
    `;
    await transaction`
      insert into domains (
        id, space_id, name, owner_id, future_task_owner_id, status, next_action,
        visibility_kind, visibility_member_ids, visibility_subject_id,
        created_at, updated_at, version
      ) values (
        ${ids.domainId}, ${ids.spaceId}, ${"Medication"}, ${ids.oldOwnerId},
        ${ids.oldOwnerId}, ${"active"}, ${"Prepare next refill"}, ${"space"},
        ${transaction.array([])}::uuid[], ${null}, ${now}, ${now}, 0
      )
    `;
    await transaction`
      insert into signal_drafts (
        id, space_id, speaker_id, source_message_id, kind, redacted_excerpt,
        proposed_conclusion, candidate_domain_id, confidence, missing_info,
        prompt_version, source, created_at, updated_at, version
      ) values (
        ${ids.signalDraftId}, ${ids.spaceId}, ${ids.oldOwnerId}, ${ids.messageId},
        ${"potential_task"}, ${"A refill needs attention"}, ${"Prepare the refill"},
        ${ids.domainId}, ${0.9}, ${JSON.stringify([])}::jsonb, ${"fixture-v1"},
        ${"fixture"}, ${now}, ${now}, 0
      )
    `;
    await transaction`
      insert into signal_draft_evidence (space_id, signal_draft_id, evidence_id)
      values (${ids.spaceId}, ${ids.signalDraftId}, ${ids.evidenceId})
    `;
    await transaction`
      insert into domain_evidence (space_id, domain_id, evidence_id)
      values (${ids.spaceId}, ${ids.domainId}, ${ids.evidenceId})
    `;
    await transaction`
      insert into tasks (
        id, space_id, domain_id, title, due_at, status, review_state,
        visibility_kind, visibility_member_ids, visibility_subject_id,
        discovered_by, deadline_kept_by, scheduled_by, executed_by, followed_up_by,
        created_at, updated_at, version
      ) values (
        ${ids.taskId}, ${ids.spaceId}, ${ids.domainId}, ${"Prepare refill"}, ${later},
        ${"open"}, ${"current"}, ${"space"}, ${transaction.array([])}::uuid[],
        ${null}, ${ids.oldOwnerId}, ${ids.oldOwnerId}, ${ids.oldOwnerId},
        ${ids.oldOwnerId}, ${ids.oldOwnerId}, ${now}, ${now}, 0
      )
    `;
    await transaction`
      insert into task_evidence (space_id, task_id, evidence_id)
      values (${ids.spaceId}, ${ids.taskId}, ${ids.evidenceId})
    `;
    await transaction`
      insert into reminders (
        id, space_id, domain_id, task_id, owner_member_id, due_at, status,
        idempotency_key, created_at, updated_at, version
      ) values (
        ${ids.reminderId}, ${ids.spaceId}, ${ids.domainId}, ${ids.taskId},
        ${ids.oldOwnerId}, ${later}, ${"active"}, ${"fixture-reminder-0001"},
        ${now}, ${now}, 0
      )
    `;
    await transaction`
      insert into handovers (
        id, space_id, domain_id, from_member_id, to_member_id, packet,
        missing_info, status, expires_at, from_confirmed_at, to_confirmed_at,
        accepted_at, terminal_at, declined_by, decline_reason,
        created_at, updated_at, version
      ) values (
        ${ids.handoverId}, ${ids.spaceId}, ${ids.domainId}, ${ids.oldOwnerId},
        ${ids.newOwnerId}, ${JSON.stringify({
          constraints: [],
          contacts: [],
          evidenceIds: [ids.evidenceId],
          history: [],
          knownInformation: [],
          nextAction: "Prepare next refill",
          scope: "Medication responsibility",
        })}::jsonb, ${JSON.stringify([])}::jsonb, ${"awaiting_confirmations"}, ${later},
        ${now}, ${now}, ${null}, ${null}, ${null}, ${null}, ${now}, ${now}, 0
      )
    `;
  });
};

describe("disposable PostgreSQL migration", { concurrent: false }, () => {
  let disposable: DisposablePostgres;
  const ids = buildIds();

  beforeAll(async () => {
    disposable = await startDisposablePostgres();
    await seed(disposable.client, ids);
  }, 60_000);

  afterAll(async () => {
    await disposable.stop();
  });

  it("applies from empty and exposes all responsibility fields in the system catalog", async () => {
    const columns = await disposable.client<
      { column_name: string; is_nullable: string }[]
    >`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'tasks'
        and column_name in (
          'discovered_by', 'deadline_kept_by', 'scheduled_by',
          'executed_by', 'followed_up_by'
        )
      order by ordinal_position
    `;

    expect(columns).toEqual([
      { column_name: "discovered_by", is_nullable: "YES" },
      { column_name: "deadline_kept_by", is_nullable: "YES" },
      { column_name: "scheduled_by", is_nullable: "YES" },
      { column_name: "executed_by", is_nullable: "YES" },
      { column_name: "followed_up_by", is_nullable: "YES" },
    ]);

    const databaseGuards = await disposable.client<{ name: string }[]>`
      select conname as name
      from pg_constraint
      where conname in (
        'consent_decisions_state_shape',
        'signals_shared_visibility',
        'idempotency_records_scope_key'
      )
      union all
      select tgname as name
      from pg_trigger
      where not tgisinternal
        and tgname in (
          'signals_require_active_matching_consent',
          'handovers_enforce_transition'
        )
    `;

    expect(databaseGuards.map(({ name }) => name).sort()).toEqual([
      "consent_decisions_state_shape",
      "handovers_enforce_transition",
      "signals_require_active_matching_consent",
      "signals_shared_visibility",
    ]);
  });

  it("rejects invalid consent and shared visibility writes", async () => {
    await expect(
      disposable.client`
        insert into consent_decisions (
          id, space_id, signal_draft_id, speaker_id, decided_at, record_state,
          outcome, visibility_kind, visibility_member_ids, visibility_subject_id,
          expires_at, revoked_at, created_at, updated_at, version
        ) values (
          ${randomUUID()}, ${ids.spaceId}, ${ids.signalDraftId}, ${ids.oldOwnerId},
          ${now}, ${"active"}, ${"share"}, ${"self"},
          ${disposable.client.array([ids.oldOwnerId])}::uuid[], ${null},
          ${null}, ${null}, ${now}, ${now}, 0
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });

    const consentDecisionId = randomUUID();
    await disposable.client`
      insert into consent_decisions (
        id, space_id, signal_draft_id, speaker_id, decided_at, record_state,
        outcome, visibility_kind, visibility_member_ids, visibility_subject_id,
        expires_at, revoked_at, created_at, updated_at, version
      ) values (
        ${consentDecisionId}, ${ids.spaceId}, ${ids.signalDraftId}, ${ids.oldOwnerId},
        ${now}, ${"active"}, ${"share"}, ${"space"},
        ${disposable.client.array([])}::uuid[], ${null}, ${null}, ${null},
        ${now}, ${now}, 0
      )
    `;

    await expect(
      disposable.client`
        insert into signals (
          id, space_id, speaker_id, consent_decision_id, redacted_excerpt,
          conclusion, purpose, visibility_kind, visibility_member_ids,
          visibility_subject_id, evidence_state, created_at, updated_at, version
        ) values (
          ${randomUUID()}, ${ids.spaceId}, ${ids.oldOwnerId}, ${consentDecisionId},
          ${"A refill needs attention"}, ${"Prepare the refill"}, ${"responsibility"},
          ${"self"}, ${disposable.client.array([ids.oldOwnerId])}::uuid[], ${null},
          ${"available"}, ${now}, ${now}, 0
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });

    await disposable.client`
      insert into signals (
        id, space_id, speaker_id, consent_decision_id, redacted_excerpt,
        conclusion, purpose, visibility_kind, visibility_member_ids,
        visibility_subject_id, evidence_state, created_at, updated_at, version
      ) values (
        ${randomUUID()}, ${ids.spaceId}, ${ids.oldOwnerId}, ${consentDecisionId},
        ${"A refill needs attention"}, ${"Prepare the refill"}, ${"responsibility"},
        ${"space"}, ${disposable.client.array([])}::uuid[], ${null},
        ${"available"}, ${now}, ${now}, 0
      )
    `;
  });

  it("rejects a stale acceptance atomically, then migrates owner, reminders, and audit together", async () => {
    const actor = {
      authentication: "internal_service",
      kind: "system",
      service: "handover_service",
      spaceId: ids.spaceId,
    } as const;
    const baseRequest = {
      acceptedAt: now,
      expectedDomainVersion: 0,
      expectedHandoverVersion: 0,
      handoverId: ids.handoverId,
      idempotencyKey: `accept-handover:${randomUUID()}`,
      requestHash: createHash("sha256").update("accepted-handover-v1").digest("hex"),
      requestId: randomUUID(),
    };
    const staleRequest = {
      ...baseRequest,
      expectedDomainVersion: 99,
      idempotencyKey: `stale-handover:${randomUUID()}`,
      requestHash: createHash("sha256").update("stale-handover-v1").digest("hex"),
    };

    await expect(
      withActorTransaction(disposable.database, actor, ({ handovers }) =>
        handovers.accept(staleRequest),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isRepositoryError(error) && error.code === "stale_version",
    );

    const [unchanged] = await disposable.client<
      {
        handover_status: string;
        idempotency_count: number;
        owner_id: string;
        reminder_owner_id: string;
      }[]
    >`
      select
        domains.owner_id,
        reminders.owner_member_id as reminder_owner_id,
        handovers.status as handover_status,
        (
          select count(*)::int
          from idempotency_records
          where idempotency_key = ${staleRequest.idempotencyKey}
        ) as idempotency_count
      from domains
      join reminders on reminders.domain_id = domains.id
      join handovers on handovers.domain_id = domains.id
      where domains.id = ${ids.domainId}
    `;

    expect(unchanged).toEqual({
      handover_status: "awaiting_confirmations",
      idempotency_count: 0,
      owner_id: ids.oldOwnerId,
      reminder_owner_id: ids.oldOwnerId,
    });

    const accepted = await withActorTransaction(
      disposable.database,
      actor,
      ({ handovers }) => handovers.accept(baseRequest),
    );

    expect(accepted).toMatchObject({
      domainId: ids.domainId,
      futureTaskDefaultsUpdated: true,
      handoverId: ids.handoverId,
      migratedReminderIds: [ids.reminderId],
      newOwnerId: ids.newOwnerId,
      previousOwnerId: ids.oldOwnerId,
      status: "accepted",
    });

    const [committed] = await disposable.client<
      {
        action: string;
        future_task_owner_id: string;
        handover_status: string;
        idempotency_state: string;
        owner_id: string;
        reminder_owner_id: string;
      }[]
    >`
      select
        domains.owner_id,
        domains.future_task_owner_id,
        reminders.owner_member_id as reminder_owner_id,
        handovers.status as handover_status,
        audit_logs.action,
        idempotency_records.state as idempotency_state
      from domains
      join reminders on reminders.domain_id = domains.id
      join handovers on handovers.domain_id = domains.id
      join audit_logs on audit_logs.id = ${accepted.auditEntryId}
      join idempotency_records
        on idempotency_records.idempotency_key = ${baseRequest.idempotencyKey}
      where domains.id = ${ids.domainId}
    `;

    expect(committed).toEqual({
      action: "handover_accepted",
      future_task_owner_id: ids.newOwnerId,
      handover_status: "accepted",
      idempotency_state: "completed",
      owner_id: ids.newOwnerId,
      reminder_owner_id: ids.newOwnerId,
    });

    const replayed = await withActorTransaction(
      disposable.database,
      actor,
      ({ handovers }) => handovers.accept(baseRequest),
    );
    expect(replayed).toEqual({ ...accepted, status: "replayed" });

    await expect(
      withActorTransaction(disposable.database, actor, ({ handovers }) =>
        handovers.accept({
          ...baseRequest,
          requestHash: createHash("sha256")
            .update("different-request")
            .digest("hex"),
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isRepositoryError(error) && error.code === "idempotency_conflict",
    );
  });

  it("rejects duplicate idempotency scope and terminal handover rewrites", async () => {
    const duplicateKey = "database-idempotency-0001";
    await disposable.client`
      insert into idempotency_records (
        id, space_id, operation, actor_kind, actor_member_id, actor_service,
        actor_key, idempotency_key, request_hash, state, result, claimed_at,
        completed_at
      ) values (
        ${randomUUID()}, ${ids.spaceId}, ${"VerifierProbe"}, ${"system"}, ${null},
        ${"handover_service"}, ${"system:handover_service"}, ${duplicateKey},
        ${"0".repeat(64)}, ${"claimed"}, ${null}, ${now}, ${null}
      )
    `;

    await expect(
      disposable.client`
        insert into idempotency_records (
          id, space_id, operation, actor_kind, actor_member_id, actor_service,
          actor_key, idempotency_key, request_hash, state, result, claimed_at,
          completed_at
        ) values (
          ${randomUUID()}, ${ids.spaceId}, ${"VerifierProbe"}, ${"system"}, ${null},
          ${"handover_service"}, ${"system:handover_service"}, ${duplicateKey},
          ${"1".repeat(64)}, ${"claimed"}, ${null}, ${now}, ${null}
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      disposable.client`
        update handovers
        set status = ${"blocked"},
            accepted_at = ${null},
            terminal_at = ${null},
            from_confirmed_at = ${null},
            to_confirmed_at = ${null},
            missing_info = ${JSON.stringify([
              { id: randomUUID(), label: "Missing", reason: "Missing" },
            ])}::jsonb
        where id = ${ids.handoverId}
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });
});
