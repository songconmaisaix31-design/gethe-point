import { afterEach, describe, expect, it, vi } from "vitest";

import { FIXTURE_IDS } from "../../../packages/contracts/src/index";
import {
  createHttpExperienceClient,
  createLocalFixtureClient,
} from "../src/features/experience/client";
import { resolveFixtureExperienceClient } from "../src/components/FixtureExperience";
import type {
  CanonicalScenarioActionId,
  ExperienceClient,
  ExperienceSnapshot,
} from "../src/features/experience/model";

type ConsentState = "pending" | "shared" | "discarded";
type HandoverStatus = "blocked" | "awaiting_confirmations" | "accepted";

interface ServerSnapshotOptions {
  readonly revision: number;
  readonly consent?: ConsentState;
  readonly sharedRows?: number;
  readonly reportRows?: number;
  readonly handoverStatus?: HandoverStatus;
  readonly fromConfirmed?: boolean;
  readonly toConfirmed?: boolean;
}

const serverSnapshot = ({
  revision,
  consent = "pending",
  sharedRows = 0,
  reportRows = 0,
  handoverStatus = "blocked",
  fromConfirmed = false,
  toConfirmed = false,
}: ServerSnapshotOptions) => ({
  scenarioId: "mvp-core",
  revision,
  writeCount: revision,
  sharedWriteCount: sharedRows > 0 ? 1 : 0,
  consent,
  sharedRows,
  reportRows,
  responsibilityOwners: {
    discoveredBy: FIXTURE_IDS.subject,
    deadlineKeptBy: FIXTURE_IDS.primary,
    scheduledBy: FIXTURE_IDS.primary,
    executedBy: FIXTURE_IDS.partner,
    followedUpBy: FIXTURE_IDS.primary,
  },
  domainOwnerId: handoverStatus === "accepted" ? FIXTURE_IDS.partner : FIXTURE_IDS.primary,
  futureReminderCount: 1,
  reminderOwnerId:
    handoverStatus === "accepted" ? FIXTURE_IDS.partner : FIXTURE_IDS.primary,
  handover: {
    status: handoverStatus,
    fromConfirmed,
    toConfirmed,
  },
});

const successResponse = (
  command: string,
  state: ReturnType<typeof serverSnapshot>,
): Response =>
  Response.json({
    ok: true,
    command,
    state,
    result: {},
  });

const perform = async (
  client: ExperienceClient,
  snapshot: ExperienceSnapshot,
  actionId: CanonicalScenarioActionId,
): Promise<ExperienceSnapshot> =>
  client.perform({ actionId, expectedRevision: snapshot.revision });

const requestBodies = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>): readonly unknown[] =>
  fetcher.mock.calls.flatMap(([, init]) => {
    if (typeof init?.body !== "string") {
      return [];
    }
    return [JSON.parse(init.body) as unknown];
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HTTP Fixture experience client", () => {
  it("uses the HTTP client by default and keeps memory behind explicit injection", async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(Response.json(serverSnapshot({ revision: 0 })));
    vi.stubGlobal("fetch", fetcher);

    const productionClient = resolveFixtureExperienceClient();
    await expect(productionClient.load()).resolves.toMatchObject({ stage: "consent" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/fixtures/mvp-core/state",
      expect.objectContaining({ method: "GET" }),
    );

    fetcher.mockClear();
    const injectedClient = createLocalFixtureClient({ delayMs: 0 });
    expect(resolveFixtureExperienceClient(injectedClient)).toBe(injectedClient);
    await injectedClient.load();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reaches the canonical journey with strict command-only bodies", async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(Response.json(serverSnapshot({ revision: 0 })))
      .mockResolvedValueOnce(
        successResponse(
          "record_share_consent",
          serverSnapshot({ revision: 1, consent: "shared" }),
        ),
      )
      .mockResolvedValueOnce(
        successResponse(
          "publish_consented_signal",
          serverSnapshot({ revision: 2, consent: "shared", sharedRows: 1 }),
        ),
      )
      .mockResolvedValueOnce(
        successResponse(
          "generate_report",
          serverSnapshot({
            revision: 3,
            consent: "shared",
            sharedRows: 1,
            reportRows: 5,
          }),
        ),
      )
      .mockResolvedValueOnce(
        successResponse(
          "supply_handover_info",
          serverSnapshot({
            revision: 4,
            consent: "shared",
            sharedRows: 1,
            reportRows: 5,
            handoverStatus: "awaiting_confirmations",
          }),
        ),
      )
      .mockResolvedValueOnce(
        successResponse(
          "confirm_handover_from",
          serverSnapshot({
            revision: 5,
            consent: "shared",
            sharedRows: 1,
            reportRows: 5,
            handoverStatus: "awaiting_confirmations",
            fromConfirmed: true,
          }),
        ),
      )
      .mockResolvedValueOnce(
        successResponse(
          "confirm_handover_to",
          serverSnapshot({
            revision: 6,
            consent: "shared",
            sharedRows: 1,
            reportRows: 5,
            handoverStatus: "accepted",
            fromConfirmed: true,
            toConfirmed: true,
          }),
        ),
      );
    const client = createHttpExperienceClient({ fetch: fetcher });

    let snapshot = await client.load();
    snapshot = await perform(client, snapshot, "share_with_space");
    expect(snapshot.stage).toBe("report");
    snapshot = await perform(client, snapshot, "propose_handover");
    expect(snapshot.stage).toBe("blocked");
    snapshot = await perform(client, snapshot, "supply_last_check_result");
    expect(snapshot.stage).toBe("awaiting_confirmations");
    snapshot = await perform(client, snapshot, "confirm_handover_source");
    expect(snapshot.stage).toBe("source_confirmed");
    snapshot = await perform(client, snapshot, "confirm_handover_recipient");
    expect(snapshot.stage).toBe("accepted");

    expect(requestBodies(fetcher)).toEqual([
      { command: "record_share_consent" },
      { command: "publish_consented_signal" },
      { command: "generate_report" },
      { command: "supply_handover_info" },
      { command: "confirm_handover_from" },
      { command: "confirm_handover_to" },
    ]);
  });

  it("keeps the current snapshot after a recoverable non-2xx response", async () => {
    const blocked = serverSnapshot({
      revision: 3,
      consent: "shared",
      sharedRows: 1,
      reportRows: 5,
    });
    const awaiting = serverSnapshot({
      revision: 4,
      consent: "shared",
      sharedRows: 1,
      reportRows: 5,
      handoverStatus: "awaiting_confirmations",
    });
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(Response.json(blocked))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(successResponse("supply_handover_info", awaiting));
    const client = createHttpExperienceClient({ fetch: fetcher });
    const snapshot = await client.load();
    const request = {
      actionId: "supply_last_check_result",
      expectedRevision: snapshot.revision,
    } as const;

    await expect(client.perform(request)).rejects.toMatchObject({
      code: "fixture_request_rejected",
      recoverable: true,
    });
    await expect(client.perform(request)).resolves.toMatchObject({
      stage: "awaiting_confirmations",
      revision: 4,
    });
  });

  it("keeps the current snapshot and fails terminally on malformed success", async () => {
    const blocked = serverSnapshot({
      revision: 3,
      consent: "shared",
      sharedRows: 1,
      reportRows: 5,
    });
    const awaiting = serverSnapshot({
      revision: 4,
      consent: "shared",
      sharedRows: 1,
      reportRows: 5,
      handoverStatus: "awaiting_confirmations",
    });
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(Response.json(blocked))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          command: "supply_handover_info",
          state: { ...awaiting, actorId: FIXTURE_IDS.primary },
          result: {},
        }),
      )
      .mockResolvedValueOnce(successResponse("supply_handover_info", awaiting));
    const client = createHttpExperienceClient({ fetch: fetcher });
    const snapshot = await client.load();
    const request = {
      actionId: "supply_last_check_result",
      expectedRevision: snapshot.revision,
    } as const;

    await expect(client.perform(request)).rejects.toMatchObject({
      code: "malformed_fixture_response",
      recoverable: false,
    });
    await expect(client.perform(request)).resolves.toMatchObject({
      stage: "awaiting_confirmations",
      revision: 4,
    });
  });

  it("does not convert a 404 or network failure into local success", async () => {
    const blocked = serverSnapshot({
      revision: 3,
      consent: "shared",
      sharedRows: 1,
      reportRows: 5,
    });
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(Response.json(blocked))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(new Error("offline"));
    const client = createHttpExperienceClient({ fetch: fetcher });
    const snapshot = await client.load();
    const request = {
      actionId: "supply_last_check_result",
      expectedRevision: snapshot.revision,
    } as const;

    await expect(client.perform(request)).rejects.toMatchObject({
      code: "fixture_request_rejected",
      recoverable: false,
    });
    await expect(client.perform(request)).rejects.toMatchObject({
      code: "fixture_connection_interrupted",
      recoverable: true,
    });
  });
});
