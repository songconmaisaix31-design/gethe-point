import { z } from "zod";

import {
  EntityIdSchema,
  type AcceptHandoverRequest,
  type AwaitingConfirmationsHandover,
  type BlockedHandover,
  type ConfirmHandoverFromResult,
  type ConfirmHandoverToResult,
  type DeclineHandoverResult,
  type EntityId,
  type ExpireHandoverResult,
  type Handover,
  type HandoverServiceActor,
  type IdempotencyKey,
  type ProposeHandoverResult,
  type RecordVersion,
  type RequestHash,
  type SupplyHandoverInfoResult,
  type Timestamp,
} from "../../../packages/contracts/src/index";

export interface HandoverProposalContext {
  readonly domain: Readonly<{
    id: EntityId;
    ownerId: EntityId;
    spaceId: EntityId;
    version: RecordVersion;
  }>;
  readonly recipient: Readonly<{
    id: EntityId;
    spaceId: EntityId;
    status: "active" | "inactive";
  }> | null;
}

export interface HandoverProposalMutationInput {
  readonly actorKey: string;
  readonly domainId: EntityId;
  readonly expectedDomainVersion: RecordVersion;
  readonly idempotencyKey: IdempotencyKey;
  readonly operation: "ProposeHandover";
  readonly requestHash: RequestHash;
  readonly spaceId: EntityId;
  readonly toMemberId: EntityId;
}

export interface HandoverProposalPlan {
  readonly handover: BlockedHandover | AwaitingConfirmationsHandover;
  readonly result: ProposeHandoverResult;
}

export type HandoverStateMutationOperation =
  | "SupplyHandoverInfo"
  | "ConfirmHandoverFrom"
  | "ConfirmHandoverTo"
  | "DeclineHandover"
  | "ExpireHandover";

export interface HandoverStateMutationInput {
  readonly actorKey: string;
  readonly expectedVersion: RecordVersion;
  readonly handoverId: EntityId;
  readonly idempotencyKey: IdempotencyKey;
  readonly operation: HandoverStateMutationOperation;
  readonly requestHash: RequestHash;
  readonly spaceId: EntityId;
}

export type HandoverStateMutationResult =
  | SupplyHandoverInfoResult
  | ConfirmHandoverFromResult
  | ConfirmHandoverToResult
  | DeclineHandoverResult
  | ExpireHandoverResult;

export interface HandoverStateMutationPlan {
  readonly handover: Handover;
  readonly result: HandoverStateMutationResult;
}

/**
 * Persists replay lookup, optimistic locking, the next handover, and its result
 * as one operation. Exact replays must return before invoking either planner.
 */
export interface HandoverStatePort {
  getById(input: Readonly<{
    handoverId: EntityId;
    spaceId: EntityId;
  }>): Promise<Handover | null>;

  propose(
    input: Readonly<HandoverProposalMutationInput>,
    plan: (
      context: HandoverProposalContext | null,
    ) => HandoverProposalPlan,
  ): Promise<ProposeHandoverResult>;

  transition(
    input: Readonly<HandoverStateMutationInput>,
    plan: (current: Handover | null) => HandoverStateMutationPlan,
  ): Promise<HandoverStateMutationResult>;
}

export type AtomicHandoverAcceptanceInput = Readonly<
  AcceptHandoverRequest & {
    acceptedAt: Timestamp;
    requestHash: RequestHash;
  }
>;

export const AtomicHandoverAcceptanceResultSchema = z.strictObject({
  auditEntryId: EntityIdSchema,
  domainId: EntityIdSchema,
  futureTaskDefaultsUpdated: z.literal(true),
  handoverId: EntityIdSchema,
  migratedReminderIds: z.array(EntityIdSchema),
  newOwnerId: EntityIdSchema,
  previousOwnerId: EntityIdSchema,
  status: z.enum(["accepted", "replayed"]),
});

export type AtomicHandoverAcceptanceResult = z.infer<
  typeof AtomicHandoverAcceptanceResultSchema
>;

/**
 * Rechecks readiness and changes the handover, domain owner, future ownership
 * default, active reminders, audit, and idempotency result in one transaction.
 */
export interface AtomicHandoverAcceptancePort {
  accept(
    actor: HandoverServiceActor,
    input: AtomicHandoverAcceptanceInput,
  ): Promise<AtomicHandoverAcceptanceResult>;
}
