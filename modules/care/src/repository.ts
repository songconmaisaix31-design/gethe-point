import type {
  Actor,
  AuditEntry,
  CareEvent,
  CareRule,
  ContractErrorCode,
  IdempotencyKey,
  RequestHash,
  Timestamp,
} from "../../../packages/contracts/src/index";

export type CareOperationName =
  | "ConfirmCareRule"
  | "TickCareScheduler"
  | "AcknowledgeCareEvent"
  | "HandleCareEvent";

export interface CareTransaction {
  getCareRuleForUpdate(careRuleId: string): Promise<CareRule | null>;
  listCareRulesForUpdate(): Promise<readonly CareRule[]>;
  getCareEventForUpdate(careEventId: string): Promise<CareEvent | null>;
  listCareEventsForUpdate(): Promise<readonly CareEvent[]>;
  saveCareRule(careRule: CareRule, expectedVersion: number): Promise<void>;
  insertCareEvent(careEvent: CareEvent): Promise<"created" | "existing">;
  saveCareEvent(careEvent: CareEvent, expectedVersion: number): Promise<void>;
  isEvidenceAvailable(evidenceId: string): Promise<boolean>;
  areMembersActive(memberIds: readonly string[]): Promise<boolean>;
  appendAuditEntry(auditEntry: AuditEntry): Promise<void>;
}

export interface IdempotentExecution<Result> {
  readonly replayed: boolean;
  readonly result: Result;
}

export interface IdempotentExecutionInput<Result> {
  readonly actor: Actor;
  readonly operation: CareOperationName;
  readonly idempotencyKey: IdempotencyKey;
  readonly requestHash: RequestHash;
  readonly claimedAt: Timestamp;
  readonly parseResult: (value: unknown) => Result;
  readonly work: (transaction: CareTransaction) => Promise<Result>;
}

export interface CareRepository {
  executeIdempotent<Result>(
    input: IdempotentExecutionInput<Result>,
  ): Promise<IdempotentExecution<Result>>;
}

export type CareOperationErrorCode = Extract<
  ContractErrorCode,
  | "conflict"
  | "evidence_missing"
  | "forbidden"
  | "idempotency_conflict"
  | "internal_failure"
  | "invalid_request"
  | "not_found"
  | "stale_version"
  | "terminal_state"
  | "transition_denied"
  | "unauthenticated"
>;

export interface CareOperationError extends Error {
  readonly code: CareOperationErrorCode;
  readonly name: "CareOperationError";
}

const SAFE_ERROR_MESSAGES: Readonly<Record<CareOperationErrorCode, string>> = {
  conflict: "The care operation conflicts with current persisted state.",
  evidence_missing: "The care rule evidence is no longer available.",
  forbidden: "The actor is not allowed to perform this care operation.",
  idempotency_conflict:
    "The idempotency key belongs to a different care request.",
  internal_failure: "The care operation failed.",
  invalid_request: "The care request is invalid.",
  not_found: "The requested care record was not found.",
  stale_version: "The care record version has changed.",
  terminal_state: "The care event is already terminal.",
  transition_denied: "The requested care transition is not allowed.",
  unauthenticated: "A valid care actor is required.",
};

export const careOperationError = (
  code: CareOperationErrorCode,
): CareOperationError =>
  Object.assign(new Error(SAFE_ERROR_MESSAGES[code]), {
    code,
    name: "CareOperationError" as const,
  });

export const isCareOperationError = (
  error: unknown,
): error is CareOperationError =>
  error instanceof Error && error.name === "CareOperationError";

export const throwCareOperationError = (
  code: CareOperationErrorCode,
): never => {
  throw careOperationError(code);
};
