import type {
  Actor,
  AuditEntry,
  CareEvent,
  CareRule,
  RequestHash,
} from "../../../packages/contracts/src/index";
import {
  throwCareOperationError,
  type CareRepository,
  type CareTransaction,
  type IdempotentExecutionInput,
} from "../src/repository";

interface StoredIdempotencyResult {
  readonly requestHash: RequestHash;
  readonly result: unknown;
}

interface MemoryState {
  readonly activeMemberIds: Set<string>;
  readonly auditEntries: Map<string, AuditEntry>;
  readonly availableEvidenceIds: Set<string>;
  readonly careEvents: Map<string, CareEvent>;
  readonly careRules: Map<string, CareRule>;
  readonly idempotencyResults: Map<string, StoredIdempotencyResult>;
}

export interface MemoryCareSeed {
  readonly activeMemberIds: readonly string[];
  readonly availableEvidenceIds: readonly string[];
  readonly careEvents?: readonly CareEvent[];
  readonly careRules: readonly CareRule[];
}

export interface MemoryCareSnapshot {
  readonly auditEntries: readonly AuditEntry[];
  readonly careEvents: readonly CareEvent[];
  readonly careRules: readonly CareRule[];
  readonly idempotencyRecordCount: number;
}

const clone = <Value>(value: Value): Value => structuredClone(value);

const cloneState = (state: MemoryState): MemoryState => ({
  activeMemberIds: new Set(state.activeMemberIds),
  auditEntries: new Map(
    [...state.auditEntries].map(([key, value]) => [key, clone(value)]),
  ),
  availableEvidenceIds: new Set(state.availableEvidenceIds),
  careEvents: new Map(
    [...state.careEvents].map(([key, value]) => [key, clone(value)]),
  ),
  careRules: new Map(
    [...state.careRules].map(([key, value]) => [key, clone(value)]),
  ),
  idempotencyResults: new Map(
    [...state.idempotencyResults].map(([key, value]) => [key, clone(value)]),
  ),
});

const actorKey = (actor: Actor): string =>
  actor.kind === "member"
    ? `member:${actor.memberId}`
    : `system:${actor.service}`;

const idempotencyScopeKey = <Result>(
  input: IdempotentExecutionInput<Result>,
): string =>
  [
    input.actor.spaceId,
    input.operation,
    actorKey(input.actor),
    input.idempotencyKey,
  ].join(":");

const createTransaction = (
  state: MemoryState,
  actor: Actor,
): CareTransaction => ({
  appendAuditEntry: (auditEntry) => {
    if (state.auditEntries.has(auditEntry.id)) {
      return throwCareOperationError("conflict");
    }
    state.auditEntries.set(auditEntry.id, clone(auditEntry));
    return Promise.resolve();
  },
  areMembersActive: (memberIds) =>
    Promise.resolve(
      [...new Set(memberIds)].every((memberId) =>
        state.activeMemberIds.has(memberId),
      ),
    ),
  getCareEventForUpdate: (careEventId) => {
    const event = state.careEvents.get(careEventId);
    return Promise.resolve(
      event?.spaceId === actor.spaceId ? clone(event) : null,
    );
  },
  getCareRuleForUpdate: (careRuleId) => {
    const rule = state.careRules.get(careRuleId);
    return Promise.resolve(
      rule?.spaceId === actor.spaceId ? clone(rule) : null,
    );
  },
  insertCareEvent: (careEvent) => {
    const existing = [...state.careEvents.values()].find(
      (candidate) =>
        candidate.spaceId === careEvent.spaceId &&
        candidate.careRuleId === careEvent.careRuleId &&
        candidate.occurrenceKey === careEvent.occurrenceKey,
    );
    if (existing !== undefined) {
      return Promise.resolve("existing" as const);
    }
    if (state.careEvents.has(careEvent.id)) {
      return throwCareOperationError("conflict");
    }
    state.careEvents.set(careEvent.id, clone(careEvent));
    return Promise.resolve("created" as const);
  },
  isEvidenceAvailable: (evidenceId) =>
    Promise.resolve(state.availableEvidenceIds.has(evidenceId)),
  listCareEventsForUpdate: () =>
    Promise.resolve(
      [...state.careEvents.values()]
        .filter((event) => event.spaceId === actor.spaceId)
        .map((event) => clone(event)),
    ),
  listCareRulesForUpdate: () =>
    Promise.resolve(
      [...state.careRules.values()]
        .filter((rule) => rule.spaceId === actor.spaceId)
        .map((rule) => clone(rule)),
    ),
  saveCareEvent: (careEvent, expectedVersion) => {
    const existing = state.careEvents.get(careEvent.id);
    if (
      existing?.spaceId !== actor.spaceId ||
      existing.version !== expectedVersion
    ) {
      return throwCareOperationError("stale_version");
    }
    state.careEvents.set(careEvent.id, clone(careEvent));
    return Promise.resolve();
  },
  saveCareRule: (careRule, expectedVersion) => {
    const existing = state.careRules.get(careRule.id);
    if (
      existing?.spaceId !== actor.spaceId ||
      existing.version !== expectedVersion
    ) {
      return throwCareOperationError("stale_version");
    }
    state.careRules.set(careRule.id, clone(careRule));
    return Promise.resolve();
  },
});

export const createMemoryCareRepository = (
  seed: MemoryCareSeed,
): Readonly<{
  repository: CareRepository;
  snapshot: () => MemoryCareSnapshot;
}> => {
  let state: MemoryState = {
    activeMemberIds: new Set(seed.activeMemberIds),
    auditEntries: new Map(),
    availableEvidenceIds: new Set(seed.availableEvidenceIds),
    careEvents: new Map(
      (seed.careEvents ?? []).map((event) => [event.id, clone(event)]),
    ),
    careRules: new Map(
      seed.careRules.map((rule) => [rule.id, clone(rule)]),
    ),
    idempotencyResults: new Map(),
  };

  const repository: CareRepository = {
    executeIdempotent: async <Result>(
      input: IdempotentExecutionInput<Result>,
    ) => {
      const scopeKey = idempotencyScopeKey(input);
      const existing = state.idempotencyResults.get(scopeKey);
      if (existing !== undefined) {
        if (existing.requestHash !== input.requestHash) {
          return throwCareOperationError("idempotency_conflict");
        }
        return {
          replayed: true,
          result: input.parseResult(clone(existing.result)),
        };
      }

      const working = cloneState(state);
      const result = await input.work(
        createTransaction(working, input.actor),
      );
      working.idempotencyResults.set(scopeKey, {
        requestHash: input.requestHash,
        result: clone(result),
      });
      state = working;
      return { replayed: false, result };
    },
  };

  return {
    repository,
    snapshot: () => ({
      auditEntries: [...state.auditEntries.values()].map((entry) => clone(entry)),
      careEvents: [...state.careEvents.values()].map((event) => clone(event)),
      careRules: [...state.careRules.values()].map((rule) => clone(rule)),
      idempotencyRecordCount: state.idempotencyResults.size,
    }),
  };
};
