import { randomUUID } from "node:crypto";

import type { ZodType } from "zod";

import {
  AcceptHandoverRequestSchema,
  AcceptHandoverResultSchema,
  AcceptedHandoverSchema,
  AwaitingConfirmationsHandoverSchema,
  BlockedHandoverSchema,
  ConfirmHandoverFromRequestSchema,
  ConfirmHandoverFromResultSchema,
  ConfirmHandoverToRequestSchema,
  ConfirmHandoverToResultSchema,
  DeclineHandoverRequestSchema,
  DeclineHandoverResultSchema,
  EntityIdSchema,
  ExpireHandoverRequestSchema,
  ExpireHandoverResultSchema,
  HandoverSchema,
  HandoverExpiryActorSchema,
  HandoverServiceActorSchema,
  MemberActorSchema,
  ProposedHandoverSchema,
  ProposeHandoverRequestSchema,
  ProposeHandoverResultSchema,
  SupplyHandoverInfoRequestSchema,
  SupplyHandoverInfoResultSchema,
  TimestampSchema,
  getHandoverTransitionRule,
  type AcceptHandoverResult,
  type Clock,
  type ConfirmHandoverFromResult,
  type ConfirmHandoverToResult,
  type DeclineHandoverResult,
  type EntityId,
  type ExpireHandoverResult,
  type Handover,
  type HandoverServiceActor,
  type HandoverTransitionTrigger,
  type MemberActor,
  type ProposeHandoverResult,
  type SupplyHandoverInfoResult,
  type Timestamp,
} from "../../../packages/contracts/src/index";
import {
  createHandoverError,
  isHandoverError,
  type HandoverErrorCode,
} from "./errors";
import { hashHandoverRequest } from "./hash";
import {
  AtomicHandoverAcceptanceResultSchema,
  type AtomicHandoverAcceptancePort,
  type HandoverProposalPlan,
  type HandoverStateMutationInput,
  type HandoverStateMutationOperation,
  type HandoverStateMutationPlan,
  type HandoverStatePort,
} from "./ports";

export interface HandoverServiceDependencies {
  readonly acceptance: AtomicHandoverAcceptancePort;
  readonly clock: Clock;
  readonly idGenerator?: () => EntityId;
  readonly state: HandoverStatePort;
}

export interface HandoverService {
  accept(actor: unknown, request: unknown): Promise<AcceptHandoverResult>;
  confirmFrom(
    actor: unknown,
    request: unknown,
  ): Promise<ConfirmHandoverFromResult>;
  confirmTo(
    actor: unknown,
    request: unknown,
  ): Promise<ConfirmHandoverToResult>;
  decline(actor: unknown, request: unknown): Promise<DeclineHandoverResult>;
  expire(actor: unknown, request: unknown): Promise<ExpireHandoverResult>;
  propose(actor: unknown, request: unknown): Promise<ProposeHandoverResult>;
  supplyInformation(
    actor: unknown,
    request: unknown,
  ): Promise<SupplyHandoverInfoResult>;
}

const parseInput = <Output>(
  schema: ZodType<Output>,
  input: unknown,
  errorCode: HandoverErrorCode,
): Output => {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw createHandoverError(errorCode);
  }

  return parsed.data;
};

const parseMemberActor = (input: unknown): MemberActor =>
  parseInput(MemberActorSchema, input, "unauthenticated");

const parseServiceActor = (input: unknown): HandoverServiceActor =>
  parseInput(HandoverServiceActorSchema, input, "unauthenticated");

const executeSafely = async <Result>(
  work: () => Promise<Result>,
): Promise<Result> => {
  try {
    return await work();
  } catch (error) {
    if (isHandoverError(error)) {
      throw error;
    }

    throw createHandoverError("internal_failure");
  }
};

const actorKey = (actor: MemberActor | HandoverServiceActor): string =>
  actor.kind === "member"
    ? `member:${actor.memberId}`
    : `system:${actor.service}`;

const timestampNow = (clock: Clock): Timestamp =>
  parseInput(TimestampSchema, clock.now().toISOString(), "internal_failure");

const createEntityId = (idGenerator: () => EntityId): EntityId =>
  parseInput(EntityIdSchema, idGenerator(), "internal_failure");

const parseCurrent = (
  current: Handover | null,
  spaceId: EntityId,
): Handover => {
  if (current === null) {
    throw createHandoverError("not_found");
  }

  const parsed = parseInput(HandoverSchema, current, "internal_failure");

  if (parsed.spaceId !== spaceId) {
    throw createHandoverError("not_found");
  }

  return parsed;
};

const isTerminal = (handover: Handover): boolean =>
  handover.status === "accepted" ||
  handover.status === "declined" ||
  handover.status === "expired";

const requireVersion = (actual: number, expected: number): void => {
  if (actual !== expected) {
    throw createHandoverError("stale_version");
  }
};

const requireInvolvedMember = (
  actor: MemberActor,
  handover: Handover,
): void => {
  if (
    actor.memberId !== handover.fromMemberId &&
    actor.memberId !== handover.toMemberId
  ) {
    throw createHandoverError("forbidden");
  }
};

const requireNonTerminal = (handover: Handover): void => {
  if (isTerminal(handover)) {
    throw createHandoverError("terminal_state");
  }
};

const requireTransition = (
  handover: Handover,
  to: Handover["status"],
  trigger: HandoverTransitionTrigger,
): void => {
  const rule = getHandoverTransitionRule(handover.status, to);

  if (rule.decision !== "allowed" || rule.trigger !== trigger) {
    throw createHandoverError("transition_denied");
  }
};

const unique = <Value>(values: readonly Value[]): Value[] => [
  ...new Set(values),
];

const mutationInput = (
  operation: HandoverStateMutationOperation,
  actor: MemberActor,
  request: Readonly<{
    expectedVersion: number;
    handoverId: EntityId;
    idempotencyKey: string;
  }>,
  requestHash: string,
): HandoverStateMutationInput => ({
  actorKey: actorKey(actor),
  expectedVersion: request.expectedVersion,
  handoverId: request.handoverId,
  idempotencyKey: request.idempotencyKey,
  operation,
  requestHash,
  spaceId: actor.spaceId,
});

const parseMutationResult = <Result>(
  schema: ZodType<Result>,
  result: unknown,
): Result => parseInput(schema, result, "internal_failure");

export const createHandoverService = (
  dependencies: HandoverServiceDependencies,
): HandoverService => {
  const idGenerator = dependencies.idGenerator ?? randomUUID;

  const propose: HandoverService["propose"] = (actorInput, requestInput) =>
    executeSafely(async () => {
      const actor = parseMemberActor(actorInput);
      const request = parseInput(
        ProposeHandoverRequestSchema,
        requestInput,
        "invalid_request",
      );
      const requestHash = hashHandoverRequest(request);

      const result = await dependencies.state.propose(
        {
          actorKey: actorKey(actor),
          domainId: request.domainId,
          expectedDomainVersion: request.expectedDomainVersion,
          idempotencyKey: request.idempotencyKey,
          operation: "ProposeHandover",
          requestHash,
          spaceId: actor.spaceId,
          toMemberId: request.toMemberId,
        },
        (context): HandoverProposalPlan => {
          if (context === null) {
            throw createHandoverError("not_found");
          }

          if (
            context.domain.spaceId !== actor.spaceId ||
            context.domain.id !== request.domainId
          ) {
            throw createHandoverError("not_found");
          }

          requireVersion(
            context.domain.version,
            request.expectedDomainVersion,
          );

          if (context.domain.ownerId !== actor.memberId) {
            throw createHandoverError("forbidden");
          }

          if (request.toMemberId === actor.memberId) {
            throw createHandoverError("invalid_request");
          }

          if (context.recipient === null) {
            throw createHandoverError("not_found");
          }

          if (
            context.recipient.id !== request.toMemberId ||
            context.recipient.spaceId !== actor.spaceId ||
            context.recipient.status !== "active"
          ) {
            throw createHandoverError("not_found");
          }

          const now = timestampNow(dependencies.clock);
          const base = {
            acceptedAt: null,
            createdAt: now,
            declineReason: null,
            declinedBy: null,
            domainId: request.domainId,
            expiresAt: request.expiresAt,
            fromConfirmedAt: null,
            fromMemberId: actor.memberId,
            id: createEntityId(idGenerator),
            missingInfo: request.missingInfo,
            packet: request.packet,
            spaceId: actor.spaceId,
            terminalAt: null,
            toConfirmedAt: null,
            toMemberId: request.toMemberId,
            updatedAt: now,
            version: 0,
          };
          const handover =
            request.missingInfo.length > 0
              ? parseInput(
                  BlockedHandoverSchema,
                  { ...base, status: "blocked" },
                  "internal_failure",
                )
              : parseInput(
                  AwaitingConfirmationsHandoverSchema,
                  { ...base, status: "awaiting_confirmations" },
                  "internal_failure",
                );
          const proposed = parseInput(
            ProposedHandoverSchema,
            { ...base, status: "proposed" },
            "internal_failure",
          );

          requireTransition(
            proposed,
            handover.status,
            "EvaluateHandoverCompleteness",
          );

          return {
            handover,
            result: { handover, status: "proposal_recorded" },
          };
        },
      );

      return parseMutationResult(ProposeHandoverResultSchema, result);
    });

  const supplyInformation: HandoverService["supplyInformation"] = (
    actorInput,
    requestInput,
  ) =>
    executeSafely(async () => {
      const actor = parseMemberActor(actorInput);
      const request = parseInput(
        SupplyHandoverInfoRequestSchema,
        requestInput,
        "invalid_request",
      );
      const requestHash = hashHandoverRequest(request);
      const result = await dependencies.state.transition(
        mutationInput(
          "SupplyHandoverInfo",
          actor,
          request,
          requestHash,
        ),
        (current): HandoverStateMutationPlan => {
          const handover = parseCurrent(current, actor.spaceId);
          requireInvolvedMember(actor, handover);
          requireNonTerminal(handover);
          requireVersion(handover.version, request.expectedVersion);

          if (handover.status !== "blocked") {
            throw createHandoverError("transition_denied");
          }

          const resolvedIds = request.resolvedItems.map(
            ({ missingInfoId }) => missingInfoId,
          );

          if (unique(resolvedIds).length !== resolvedIds.length) {
            throw createHandoverError("invalid_request");
          }

          const missingIds = new Set(
            handover.missingInfo.map(({ id }) => id),
          );

          if (resolvedIds.some((id) => !missingIds.has(id))) {
            throw createHandoverError("invalid_request");
          }

          const missingInfo = handover.missingInfo.filter(
            ({ id }) => !resolvedIds.includes(id),
          );
          const knownInformation = [
            ...handover.packet.knownInformation,
            ...request.resolvedItems.map(({ value }) => value),
          ];
          const evidenceIds = unique([
            ...handover.packet.evidenceIds,
            ...request.resolvedItems.flatMap(({ evidenceIds: ids }) => ids),
          ]);

          if (knownInformation.length > 50 || evidenceIds.length > 50) {
            throw createHandoverError("invalid_request");
          }

          const now = timestampNow(dependencies.clock);
          const candidate = {
              ...handover,
              missingInfo,
              packet: {
                ...handover.packet,
                evidenceIds,
                knownInformation,
              },
              status:
                missingInfo.length === 0
                  ? "awaiting_confirmations"
                  : "blocked",
              updatedAt: now,
              version: handover.version + 1,
            };
          const next: Handover =
            missingInfo.length === 0
              ? parseInput(
                  AwaitingConfirmationsHandoverSchema,
                  candidate,
                  "internal_failure",
                )
              : parseInput(
                  BlockedHandoverSchema,
                  candidate,
                  "internal_failure",
                );

          if (next.status === "awaiting_confirmations") {
            requireTransition(
              handover,
              "awaiting_confirmations",
              "SupplyHandoverInfo",
            );
          }

          return {
            handover: next,
            result: { handover: next, status: "information_recorded" },
          };
        },
      );

      return parseMutationResult(SupplyHandoverInfoResultSchema, result);
    });

  const confirm = async (
    side: "from" | "to",
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<ConfirmHandoverFromResult | ConfirmHandoverToResult> => {
    const actor = parseMemberActor(actorInput);
    const schema =
      side === "from"
        ? ConfirmHandoverFromRequestSchema
        : ConfirmHandoverToRequestSchema;
    const request = parseInput(schema, requestInput, "invalid_request");
    const operation =
      side === "from" ? "ConfirmHandoverFrom" : "ConfirmHandoverTo";
    const result = await dependencies.state.transition(
      mutationInput(operation, actor, request, hashHandoverRequest(request)),
      (current): HandoverStateMutationPlan => {
        const handover = parseCurrent(current, actor.spaceId);
        const expectedActorId =
          side === "from" ? handover.fromMemberId : handover.toMemberId;

        if (actor.memberId !== expectedActorId) {
          throw createHandoverError("forbidden");
        }

        requireNonTerminal(handover);
        requireVersion(handover.version, request.expectedVersion);

        if (handover.status === "blocked" || handover.missingInfo.length > 0) {
          throw createHandoverError("handover_blocked");
        }

        if (handover.status !== "awaiting_confirmations") {
          throw createHandoverError("transition_denied");
        }

        if (
          (side === "from" && handover.fromConfirmedAt !== null) ||
          (side === "to" && handover.toConfirmedAt !== null)
        ) {
          throw createHandoverError("transition_denied");
        }

        if (side === "from") {
          const next = parseInput(
            ConfirmHandoverFromResultSchema.shape.handover,
            {
              ...handover,
              fromConfirmedAt: request.confirmedAt,
              updatedAt: request.confirmedAt,
              version: handover.version + 1,
            },
            "internal_failure",
          );

          return {
            handover: next,
            result: { handover: next, status: "confirmation_recorded" },
          };
        }

        const next = parseInput(
          ConfirmHandoverToResultSchema.shape.handover,
          {
            ...handover,
            toConfirmedAt: request.confirmedAt,
            updatedAt: request.confirmedAt,
            version: handover.version + 1,
          },
          "internal_failure",
        );

        return {
          handover: next,
          result: { handover: next, status: "confirmation_recorded" },
        };
      },
    );

    return side === "from"
      ? parseMutationResult(ConfirmHandoverFromResultSchema, result)
      : parseMutationResult(ConfirmHandoverToResultSchema, result);
  };

  const confirmFrom: HandoverService["confirmFrom"] = (
    actorInput,
    requestInput,
  ) =>
    executeSafely(async () => {
      const result = await confirm("from", actorInput, requestInput);
      return parseMutationResult(ConfirmHandoverFromResultSchema, result);
    });

  const confirmTo: HandoverService["confirmTo"] = (
    actorInput,
    requestInput,
  ) =>
    executeSafely(async () => {
      const result = await confirm("to", actorInput, requestInput);
      return parseMutationResult(ConfirmHandoverToResultSchema, result);
    });

  const decline: HandoverService["decline"] = (actorInput, requestInput) =>
    executeSafely(async () => {
      const actor = parseMemberActor(actorInput);
      const request = parseInput(
        DeclineHandoverRequestSchema,
        requestInput,
        "invalid_request",
      );
      const result = await dependencies.state.transition(
        mutationInput(
          "DeclineHandover",
          actor,
          request,
          hashHandoverRequest(request),
        ),
        (current): HandoverStateMutationPlan => {
          const handover = parseCurrent(current, actor.spaceId);
          requireInvolvedMember(actor, handover);
          requireNonTerminal(handover);
          requireVersion(handover.version, request.expectedVersion);

          if (
            handover.status !== "blocked" &&
            handover.status !== "awaiting_confirmations"
          ) {
            throw createHandoverError("transition_denied");
          }

          requireTransition(handover, "declined", "DeclineHandover");
          const next = parseInput(
            DeclineHandoverResultSchema.shape.handover,
            {
              ...handover,
              declineReason: request.reason,
              declinedBy: actor.memberId,
              status: "declined",
              terminalAt: request.declinedAt,
              updatedAt: request.declinedAt,
              version: handover.version + 1,
            },
            "internal_failure",
          );

          return {
            handover: next,
            result: { handover: next, status: "declined" },
          };
        },
      );

      return parseMutationResult(DeclineHandoverResultSchema, result);
    });

  const expire: HandoverService["expire"] = (actorInput, requestInput) =>
    executeSafely(async () => {
      const actor = parseInput(
        HandoverExpiryActorSchema,
        actorInput,
        "unauthenticated",
      );

      const request = parseInput(
        ExpireHandoverRequestSchema,
        requestInput,
        "invalid_request",
      );
      const result = await dependencies.state.transition(
        {
          actorKey: `system:${actor.service}`,
          expectedVersion: request.expectedVersion,
          handoverId: request.handoverId,
          idempotencyKey: request.idempotencyKey,
          operation: "ExpireHandover",
          requestHash: hashHandoverRequest(request),
          spaceId: actor.spaceId,
        },
        (current): HandoverStateMutationPlan => {
          const handover = parseCurrent(current, actor.spaceId);
          requireNonTerminal(handover);
          requireVersion(handover.version, request.expectedVersion);

          if (
            handover.status !== "blocked" &&
            handover.status !== "awaiting_confirmations"
          ) {
            throw createHandoverError("transition_denied");
          }

          if (Date.parse(request.observedAt) < Date.parse(handover.expiresAt)) {
            throw createHandoverError("transition_denied");
          }

          requireTransition(handover, "expired", "ExpireHandover");
          const next = parseInput(
            ExpireHandoverResultSchema.shape.handover,
            {
              ...handover,
              status: "expired",
              terminalAt: request.observedAt,
              updatedAt: request.observedAt,
              version: handover.version + 1,
            },
            "internal_failure",
          );

          return {
            handover: next,
            result: { handover: next, status: "expired" },
          };
        },
      );

      return parseMutationResult(ExpireHandoverResultSchema, result);
    });

  const accept: HandoverService["accept"] = (actorInput, requestInput) =>
    executeSafely(async () => {
      const actor = parseServiceActor(actorInput);
      const request = parseInput(
        AcceptHandoverRequestSchema,
        requestInput,
        "invalid_request",
      );
      const current = parseCurrent(
        await dependencies.state.getById({
          handoverId: request.handoverId,
          spaceId: actor.spaceId,
        }),
        actor.spaceId,
      );

      if (current.status === "declined" || current.status === "expired") {
        throw createHandoverError("terminal_state");
      }

      if (current.status === "blocked" || current.missingInfo.length > 0) {
        throw createHandoverError("handover_blocked");
      }

      if (current.status !== "accepted") {
        if (current.status !== "awaiting_confirmations") {
          throw createHandoverError("transition_denied");
        }

        requireVersion(current.version, request.expectedHandoverVersion);

        if (
          current.fromConfirmedAt === null ||
          current.toConfirmedAt === null
        ) {
          throw createHandoverError("confirmation_required");
        }

        requireTransition(current, "accepted", "AcceptHandover");
      }

      const acceptedAt = timestampNow(dependencies.clock);
      let atomicResultInput: unknown;

      try {
        atomicResultInput = await dependencies.acceptance.accept(actor, {
          ...request,
          acceptedAt,
          requestHash: hashHandoverRequest(request),
        });
      } catch (error) {
        if (
          current.status === "accepted" &&
          isHandoverError(error) &&
          error.code === "transition_denied"
        ) {
          throw createHandoverError("terminal_state");
        }

        throw error;
      }

      const atomicResult = parseInput(
        AtomicHandoverAcceptanceResultSchema,
        atomicResultInput,
        "internal_failure",
      );

      if (
        atomicResult.handoverId !== request.handoverId ||
        atomicResult.domainId !== current.domainId ||
        atomicResult.previousOwnerId !== current.fromMemberId ||
        atomicResult.newOwnerId !== current.toMemberId ||
        (current.status === "accepted" &&
          atomicResult.status !== "replayed")
      ) {
        throw createHandoverError("internal_failure");
      }

      const acceptedHandover =
        current.status === "accepted"
          ? current
          : parseInput(
              AcceptedHandoverSchema,
              {
                ...current,
                acceptedAt,
                status: "accepted",
                terminalAt: acceptedAt,
                updatedAt: acceptedAt,
                version: current.version + 1,
              },
              "internal_failure",
            );

      return parseMutationResult(AcceptHandoverResultSchema, {
        handover: acceptedHandover,
        migration: {
          auditEntryId: atomicResult.auditEntryId,
          domainId: atomicResult.domainId,
          futureTaskDefaultsUpdated: atomicResult.futureTaskDefaultsUpdated,
          migratedReminderIds: atomicResult.migratedReminderIds,
          newOwnerId: atomicResult.newOwnerId,
          previousOwnerId: atomicResult.previousOwnerId,
        },
        status: "accepted",
      });
    });

  return {
    accept,
    confirmFrom,
    confirmTo,
    decline,
    expire,
    propose,
    supplyInformation,
  };
};
