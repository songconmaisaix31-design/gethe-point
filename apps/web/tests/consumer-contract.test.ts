import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpExperienceClient } from "../src/features/experience/client";
import {
  MVP_CORE_CANONICAL_REPORT,
  MVP_CORE_DISPLAY,
  MVP_CORE_PATHS,
} from "../src/features/experience/fixture-display";
import type { ExperienceActionId, ExperienceClient } from "../src/features/experience/model";
import type {
  MvpCoreReport,
  MvpCoreSnapshot,
  VisibleMvpCoreCommand,
} from "../src/features/experience/wire-contract";

interface SnapshotOptions {
  readonly revision: number;
  readonly consent?: MvpCoreSnapshot["consent"];
  readonly sharedRows?: number;
  readonly reportRows?: number;
  readonly handoverStatus?: MvpCoreSnapshot["handover"]["status"];
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
}: SnapshotOptions): MvpCoreSnapshot => ({
  scenarioId: "mvp-core",
  revision,
  writeCount: revision,
  sharedWriteCount: sharedRows > 0 ? 1 : 0,
  consent,
  sharedRows,
  reportRows,
  responsibilityOwners: {
    discoveredBy: MVP_CORE_DISPLAY.memberIds.subject,
    deadlineKeptBy: MVP_CORE_DISPLAY.memberIds.primary,
    scheduledBy: MVP_CORE_DISPLAY.memberIds.primary,
    executedBy: MVP_CORE_DISPLAY.memberIds.partner,
    followedUpBy: MVP_CORE_DISPLAY.memberIds.primary,
  },
  domainOwnerId:
    handoverStatus === "accepted"
      ? MVP_CORE_DISPLAY.memberIds.partner
      : MVP_CORE_DISPLAY.memberIds.primary,
  futureReminderCount: 1,
  reminderOwnerId:
    handoverStatus === "accepted"
      ? MVP_CORE_DISPLAY.memberIds.partner
      : MVP_CORE_DISPLAY.memberIds.primary,
  handover: {
    status: handoverStatus,
    fromConfirmed,
    toConfirmed,
  },
});

const successResponse = (
  command: VisibleMvpCoreCommand,
  state: MvpCoreSnapshot,
  report?: MvpCoreReport,
): Response =>
  Response.json({
    ok: true,
    command,
    state,
    result: report === undefined ? {} : { report },
  });

const perform = async (
  client: ExperienceClient,
  actionId: ExperienceActionId,
) => client.perform(actionId);

const requestBodies = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>): readonly unknown[] =>
  fetcher.mock.calls.flatMap(([, init]) =>
    typeof init?.body === "string" ? [JSON.parse(init.body) as unknown] : [],
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QA-002 narrow HTTP consumer contract", () => {
  it("keeps consent and publish separate and sends one command-only body per action", async () => {
    const reportFromResult = {
      ...MVP_CORE_CANONICAL_REPORT,
      narrative: "Result payload narrative used by the consumer.",
    } satisfies MvpCoreReport;
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
          serverSnapshot({ revision: 3, consent: "shared", sharedRows: 1, reportRows: 5 }),
          reportFromResult,
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

    await client.load();
    await perform(client, "record_share_consent");
    await perform(client, "publish_consented_signal");
    const reportSnapshot = await perform(client, "generate_report");
    expect(reportSnapshot.report?.narrative).toBe(reportFromResult.narrative);
    await perform(client, "supply_handover_info");
    await perform(client, "confirm_handover_from");
    const accepted = await perform(client, "confirm_handover_to");

    expect(accepted.stage).toBe("accepted");
    expect(requestBodies(fetcher)).toEqual([
      { command: "record_share_consent" },
      { command: "publish_consented_signal" },
      { command: "generate_report" },
      { command: "supply_handover_info" },
      { command: "confirm_handover_from" },
      { command: "confirm_handover_to" },
    ]);
  });

  it("uses only the reset endpoint with an exactly empty object", async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(Response.json(serverSnapshot({ revision: 3, consent: "shared", sharedRows: 1 })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json(serverSnapshot({ revision: 0 })));
    const client = createHttpExperienceClient({ fetch: fetcher });

    await client.load();
    const reset = await client.perform("reset_fixture");

    expect(reset.server.revision).toBe(0);
    expect(fetcher.mock.calls[1]?.[0]).toBe(MVP_CORE_PATHS.reset);
    expect(requestBodies(fetcher)).toEqual([{}]);
  });

  it("adopts a non-2xx response snapshot without claiming rollback", async () => {
    const blocked = serverSnapshot({
      revision: 3,
      consent: "shared",
      sharedRows: 1,
      reportRows: 5,
    });
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(Response.json(blocked))
      .mockResolvedValueOnce(
        Response.json(
          {
            ok: false,
            command: "confirm_handover_from",
            code: "handover_blocked",
            state: blocked,
          },
          { status: 409 },
        ),
      );
    const client = createHttpExperienceClient({ fetch: fetcher });
    await client.load();

    const error = await client.perform("confirm_handover_from").catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: "fixture_request_rejected",
      truthSource: "response",
      snapshot: { server: { revision: 3, handover: { status: "blocked" } } },
    });
    expect((error as Error).message).not.toMatch(/没有提交|状态没有改变|已回滚/);
    expect(requestBodies(fetcher)).toEqual([{ command: "confirm_handover_from" }]);
  });

  it("reconciles an interrupted command with GET and never resends the write", async () => {
    const blocked = serverSnapshot({
      revision: 3,
      consent: "shared",
      sharedRows: 1,
      reportRows: 5,
    });
    const acceptedByServer = serverSnapshot({
      revision: 4,
      consent: "shared",
      sharedRows: 1,
      reportRows: 5,
      handoverStatus: "awaiting_confirmations",
    });
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(Response.json(blocked))
      .mockRejectedValueOnce(new Error("connection lost after send"))
      .mockResolvedValueOnce(Response.json(acceptedByServer));
    const client = createHttpExperienceClient({ fetch: fetcher });
    await client.load();

    const error = await client.perform("supply_handover_info").catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: "fixture_connection_interrupted",
      truthSource: "reload",
      snapshot: {
        stage: "awaiting_confirmations",
        server: { revision: 4 },
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(requestBodies(fetcher)).toEqual([{ command: "supply_handover_info" }]);
  });

  it("reconciles malformed success data and does not trust the malformed snapshot", async () => {
    const blocked = serverSnapshot({
      revision: 3,
      consent: "shared",
      sharedRows: 1,
      reportRows: 5,
    });
    const latest = serverSnapshot({
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
          state: { ...latest, actorId: MVP_CORE_DISPLAY.memberIds.primary },
          result: {},
        }),
      )
      .mockResolvedValueOnce(Response.json(latest));
    const client = createHttpExperienceClient({ fetch: fetcher });
    await client.load();

    const error = await client.perform("supply_handover_info").catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: "malformed_fixture_response",
      truthSource: "reload",
      snapshot: { server: { revision: 4 } },
    });
    expect(requestBodies(fetcher)).toEqual([{ command: "supply_handover_info" }]);
  });
});
