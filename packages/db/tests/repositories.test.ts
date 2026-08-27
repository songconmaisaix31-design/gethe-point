import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { Database } from "../src/client";
import {
  isRepositoryError,
  validateRepositoryActor,
  withActorTransaction,
} from "../src/repositories";

describe("actor-bound repositories", () => {
  it("accepts a strict explicit system actor", () => {
    const spaceId = randomUUID();

    expect(
      validateRepositoryActor({
        authentication: "internal_service",
        kind: "system",
        service: "handover_service",
        spaceId,
      }),
    ).toEqual({
      authentication: "internal_service",
      kind: "system",
      service: "handover_service",
      spaceId,
    });
  });

  it("rejects missing or request-supplied actor fields before opening a transaction", async () => {
    const transaction = vi.fn();
    const database = { transaction } as unknown as Database;

    const failure = withActorTransaction(
      database,
      { kind: "system", service: "handover_service" },
      () => Promise.resolve(undefined),
    );

    await expect(failure).rejects.toSatisfy(
      (error: unknown) => isRepositoryError(error) && error.code === "invalid_actor",
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects unknown actor keys instead of widening authority", () => {
    expect(() =>
      validateRepositoryActor({
        authentication: "internal_service",
        kind: "system",
        service: "handover_service",
        spaceId: randomUUID(),
        trusted: true,
      }),
    ).toThrow("A valid explicit actor is required.");
  });
});
