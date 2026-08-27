import { describe, expect, it } from "vitest";

import {
  createLocalFixtureClient,
} from "../src/features/experience/client";
import type { ExperienceClientError } from "../src/features/experience/client";
import type {
  CanonicalScenarioActionId,
  ExperienceClient,
  ExperienceSnapshot,
} from "../src/features/experience/model";

const perform = async (
  client: ExperienceClient,
  snapshot: ExperienceSnapshot,
  actionId: CanonicalScenarioActionId,
): Promise<ExperienceSnapshot> =>
  client.perform({ actionId, expectedRevision: snapshot.revision });

describe("local Fixture experience client", () => {
  it("loads the consent screen without preselecting a share choice", async () => {
    const client = createLocalFixtureClient({ delayMs: 0 });

    const snapshot = await client.load();

    expect(snapshot.stage).toBe("consent");
    expect(snapshot.mobileRole).toBe("subject");
    expect(snapshot.consentOutcome).toBeNull();
    expect(snapshot.actions.map(({ id }) => id)).toEqual([
      "share_with_space",
      "share_with_primary",
      "keep_private",
    ]);
  });

  it("replays the canonical success path through independent confirmations", async () => {
    const client = createLocalFixtureClient({ delayMs: 0 });
    let snapshot = await client.load();

    snapshot = await perform(client, snapshot, "share_with_space");
    expect(snapshot.stage).toBe("report");
    expect(snapshot.report?.rows).toHaveLength(5);

    snapshot = await perform(client, snapshot, "propose_handover");
    expect(snapshot.handover?.state).toBe("blocked");
    expect(snapshot.handover?.ownerLabel).toContain("家人甲");

    snapshot = await perform(client, snapshot, "supply_last_check_result");
    expect(snapshot.handover?.state).toBe("awaiting_confirmations");
    expect(snapshot.handover?.confirmations.every(({ state }) => state === "waiting")).toBe(
      true,
    );

    snapshot = await perform(client, snapshot, "confirm_handover_source");
    expect(snapshot.handover?.confirmations.map(({ state }) => state)).toEqual([
      "confirmed",
      "waiting",
    ]);
    expect(snapshot.handover?.ownerLabel).toContain("未转移");

    snapshot = await perform(client, snapshot, "confirm_handover_recipient");
    expect(snapshot.stage).toBe("accepted");
    expect(snapshot.handover?.confirmations.map(({ state }) => state)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    expect(snapshot.handover?.ownerLabel).toBe("当前负责人：家人乙");
    expect(snapshot.handover?.reminderLabel).toContain("家人甲不再收到");
    expect(snapshot.report?.primaryRememberedItems).toBe(2);
  });

  it("surfaces one recoverable integration error without advancing state", async () => {
    const client = createLocalFixtureClient({
      delayMs: 0,
      failOnceOn: "supply_last_check_result",
    });
    let snapshot = await client.load();
    snapshot = await perform(client, snapshot, "share_with_space");
    snapshot = await perform(client, snapshot, "propose_handover");

    const request = {
      actionId: "supply_last_check_result",
      expectedRevision: snapshot.revision,
    } as const;

    await expect(client.perform(request)).rejects.toMatchObject({
      code: "fixture_connection_interrupted",
      recoverable: true,
    } satisfies Partial<ExperienceClientError>);

    const unchanged = await client.load();
    expect(unchanged.stage).toBe("blocked");
    expect(unchanged.revision).toBe(snapshot.revision);

    const retried = await client.perform(request);
    expect(retried.stage).toBe("awaiting_confirmations");
  });
});
