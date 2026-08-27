import type { Database } from "../../../packages/db/src/index";
import {
  isRepositoryError,
  withActorTransaction,
} from "../../../packages/db/src/index";
import { createHandoverError } from "./errors";
import type { AtomicHandoverAcceptancePort } from "./ports";

const mapRepositoryError = (code: string) => {
  switch (code) {
    case "forbidden":
    case "handover_blocked":
    case "idempotency_conflict":
    case "invalid_request":
    case "not_found":
    case "stale_version":
    case "transition_denied":
      return createHandoverError(code);
    case "idempotency_in_progress":
      return createHandoverError("conflict");
    case "invalid_actor":
      return createHandoverError("unauthenticated");
    case "internal_failure":
    case "invariant_violation":
    default:
      return createHandoverError("internal_failure");
  }
};

/** Uses the single DATA-001 actor-bound transaction; no application write is split. */
export const createDatabaseHandoverAcceptancePort = (
  database: Database,
): AtomicHandoverAcceptancePort => ({
  accept: async (actor, input) => {
    try {
      return await withActorTransaction(database, actor, ({ handovers }) =>
        handovers.accept(input),
      );
    } catch (error) {
      if (isRepositoryError(error)) {
        throw mapRepositoryError(error.code);
      }

      throw createHandoverError("internal_failure");
    }
  },
});
