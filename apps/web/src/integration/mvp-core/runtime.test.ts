import { describe, expect, it } from "vitest";

import type { Database } from "../../../../../packages/db/src/index";
import { issueMvpCoreFixtureSession } from "../../../../../packages/testkit/src/integration-seam";
import { executeMvpCoreCommand } from "./runtime";
import { readMvpCoreSnapshot } from "./persistence";

const databaseThatMustNotBeUsed = (): Database =>
  new Proxy(
    {},
    {
      get: () => {
        throw new Error("The database adapter was called before authorization.");
      },
    },
  ) as Database;

const emptyReadOnlyDatabase = (): Database => {
  const transaction = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  };
  return {
    transaction: (work: (tx: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as unknown as Database;
};

const sessionFor = (role: "primary" | "partner" | "subject") => {
  const session = issueMvpCoreFixtureSession({
    role,
    scenarioId: "mvp-core",
  });
  if (session === undefined) {
    throw new Error("The accepted QA session seam rejected a canonical role.");
  }
  return session;
};

describe("MVP core pre-persistence authorization", () => {
  it("rejects a body-shaped session without calling the database", async () => {
    const response = await executeMvpCoreCommand(
      databaseThatMustNotBeUsed(),
      {
        actorId: "00000000-0000-4000-8000-000000000004",
        role: "subject",
        scenarioId: "mvp-core",
        spaceId: "00000000-0000-4000-8000-000000000001",
      },
      { command: "record_share_consent" },
    );

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: "invalid_session", ok: false });
  });

  it("rejects authority and content fields before database setup", async () => {
    const response = await executeMvpCoreCommand(
      emptyReadOnlyDatabase(),
      sessionFor("subject"),
      {
        actor: "subject",
        command: "record_share_consent",
        content: "tampered",
        role: "subject",
        scenario: "mvp-core",
        space: "00000000-0000-4000-8000-000000000001",
      },
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "invalid_request", ok: false });
  });

  it("rejects a wrong-role command before database setup", async () => {
    const response = await executeMvpCoreCommand(
      emptyReadOnlyDatabase(),
      sessionFor("partner"),
      { command: "record_share_consent" },
    );

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "forbidden", ok: false });
  });

  it("hides a guessed private-message probe before database setup", async () => {
    const response = await executeMvpCoreCommand(
      emptyReadOnlyDatabase(),
      sessionFor("partner"),
      {
        command: "read_private_message",
        targetId: "00000000-0000-4000-8000-000000000011",
      },
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "not_found", ok: false });
  });

  it("rejects a subject probe for an unknown target before database setup", async () => {
    const response = await executeMvpCoreCommand(
      emptyReadOnlyDatabase(),
      sessionFor("subject"),
      {
        command: "read_private_message",
        targetId: "00000000-0000-4000-8000-0000000000f1",
      },
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "not_found", ok: false });
  });

  it("denies canonical raw sharing before database setup", async () => {
    const response = await executeMvpCoreCommand(
      emptyReadOnlyDatabase(),
      sessionFor("subject"),
      {
        command: "share_private_message",
        targetId: "00000000-0000-4000-8000-000000000011",
      },
    );

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: "raw_private_share_denied",
      ok: false,
    });
  });
});

describe("MVP core snapshot transaction", () => {
  it("requests repeatable-read isolation", async () => {
    const sentinel = new Error("stop after observing transaction options");
    let observedIsolation: string | undefined;
    const database = {
      transaction: (
        _work: unknown,
        options: Readonly<{ isolationLevel?: string }> | undefined,
      ) => {
        observedIsolation = options?.isolationLevel;
        return Promise.reject(sentinel);
      },
    } as unknown as Database;

    await expect(readMvpCoreSnapshot(database)).rejects.toBe(sentinel);
    expect(observedIsolation).toBe("repeatable read");
  });
});
