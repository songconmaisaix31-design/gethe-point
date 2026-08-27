import type { ZodType } from "zod";

import {
  ConfirmSignalRequestSchema,
  ConfirmSignalResultSchema,
  DecideConsentRequestSchema,
  DecideConsentResultSchema,
  GetVisibleSharedSignalsRequestSchema,
  GetVisibleSharedSignalsResultSchema,
  MemberActorSchema,
  SharedSignalSchema,
  type ConfirmSignalRequest,
  type ConfirmSignalResult,
  type DecideConsentRequest,
  type DecideConsentResult,
  type EntityId,
  type GetVisibleSharedSignalsRequest,
  type GetVisibleSharedSignalsResult,
  type MemberActor,
  type RequestId,
  type SharedSignal,
} from "../../../packages/contracts/src/index";
import {
  createPrivateSharingError,
  isPrivateSharingError,
  type PrivateSharingErrorCode,
} from "./errors";

export interface PrivateSharingStatePort {
  confirmSignal(
    actor: MemberActor,
    request: ConfirmSignalRequest,
  ): SharedSignal | Promise<SharedSignal>;

  decideConsent(
    actor: MemberActor,
    request: DecideConsentRequest,
  ):
    | DecideConsentResult["decision"]
    | Promise<DecideConsentResult["decision"]>;

  listVisibleSharedSignals(
    actor: MemberActor,
    request: GetVisibleSharedSignalsRequest,
  ):
    | readonly SharedSignal[]
    | null
    | Promise<readonly SharedSignal[] | null>;
}

export interface SafeSharingLogEntry {
  readonly operation:
    | "DecideConsent"
    | "ConfirmSignal"
    | "GetVisibleSharedSignals";
  readonly outcome: "decision_recorded" | "confirmed" | "ready";
  readonly requestId: RequestId;
  readonly actorId: EntityId;
  readonly resourceId: EntityId;
}

export interface SharingLogger {
  write(entry: SafeSharingLogEntry): void;
}

export interface PrivateSharingServiceDependencies {
  readonly logger?: SharingLogger;
  readonly state: PrivateSharingStatePort;
}

export interface PrivateSharingService {
  confirmSignal(
    actor: unknown,
    request: unknown,
  ): Promise<ConfirmSignalResult>;

  decideConsent(
    actor: unknown,
    request: unknown,
  ): Promise<DecideConsentResult>;

  getVisibleSharedSignals(
    actor: unknown,
    request: unknown,
  ): Promise<GetVisibleSharedSignalsResult>;
}

const parseInput = <Output>(
  schema: ZodType<Output>,
  input: unknown,
  code: PrivateSharingErrorCode,
): Output => {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw createPrivateSharingError(code);
  }

  return parsed.data;
};

const parseActor = (input: unknown): MemberActor =>
  parseInput(MemberActorSchema, input, "unauthenticated");

const executeSafely = async <Result>(
  work: () => Promise<Result>,
): Promise<Result> => {
  try {
    return await work();
  } catch (error) {
    if (isPrivateSharingError(error)) {
      throw error;
    }

    throw createPrivateSharingError("internal_failure");
  }
};

export const createPrivateSharingService = (
  dependencies: PrivateSharingServiceDependencies,
): PrivateSharingService => {
  const decideConsent: PrivateSharingService["decideConsent"] = (
    actorInput,
    requestInput,
  ) =>
    executeSafely(async () => {
      const actor = parseActor(actorInput);
      const request = parseInput(
        DecideConsentRequestSchema,
        requestInput,
        "invalid_request",
      );
      const decision = await dependencies.state.decideConsent(actor, request);
      const result = parseInput(
        DecideConsentResultSchema,
        { decision, status: "decision_recorded" },
        "internal_failure",
      );

      dependencies.logger?.write({
        actorId: actor.memberId,
        operation: "DecideConsent",
        outcome: "decision_recorded",
        requestId: request.requestId,
        resourceId: result.decision.id,
      });

      return result;
    });

  const confirmSignal: PrivateSharingService["confirmSignal"] = (
    actorInput,
    requestInput,
  ) =>
    executeSafely(async () => {
      const actor = parseActor(actorInput);
      const request = parseInput(
        ConfirmSignalRequestSchema,
        requestInput,
        "invalid_request",
      );
      const signal = await dependencies.state.confirmSignal(actor, request);
      const result = parseInput(
        ConfirmSignalResultSchema,
        { signal, status: "confirmed" },
        "internal_failure",
      );

      dependencies.logger?.write({
        actorId: actor.memberId,
        operation: "ConfirmSignal",
        outcome: "confirmed",
        requestId: request.requestId,
        resourceId: result.signal.id,
      });

      return result;
    });

  const getVisibleSharedSignals: PrivateSharingService["getVisibleSharedSignals"] = (
    actorInput,
    requestInput,
  ) =>
    executeSafely(async () => {
      const actor = parseActor(actorInput);
      const request = parseInput(
        GetVisibleSharedSignalsRequestSchema,
        requestInput,
        "invalid_request",
      );
      const signalsInput = await dependencies.state.listVisibleSharedSignals(
        actor,
        request,
      );

      if (signalsInput === null) {
        throw createPrivateSharingError("not_found");
      }

      const signals = signalsInput.map((signal) =>
        parseInput(SharedSignalSchema, signal, "internal_failure"),
      );
      const cursorIndex =
        request.page.cursor === null
          ? -1
          : signals.findIndex(({ id }) => id === request.page.cursor);

      if (request.page.cursor !== null && cursorIndex < 0) {
        throw createPrivateSharingError("not_found");
      }

      const startIndex = cursorIndex + 1;
      const pageSignals = signals.slice(
        startIndex,
        startIndex + request.page.limit,
      );
      const hasMore = startIndex + pageSignals.length < signals.length;
      const result = parseInput(
        GetVisibleSharedSignalsResultSchema,
        {
          page: {
            hasMore,
            nextCursor: hasMore ? (pageSignals.at(-1)?.id ?? null) : null,
          },
          signals: pageSignals,
          status: "ready",
        },
        "internal_failure",
      );

      dependencies.logger?.write({
        actorId: actor.memberId,
        operation: "GetVisibleSharedSignals",
        outcome: "ready",
        requestId: request.requestId,
        resourceId: request.spaceId,
      });

      return result;
    });

  return Object.freeze({
    confirmSignal,
    decideConsent,
    getVisibleSharedSignals,
  });
};
