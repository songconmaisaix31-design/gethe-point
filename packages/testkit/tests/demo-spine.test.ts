import { describe, expect, it } from "vitest";

import fixtureManifest from "../../../fixtures/golden-household.json";
import { ALL_OPERATION_CONTRACTS } from "../../contracts/src/index";
import { createDemoSpine, createGoldenFixture } from "../src/index";

describe("seven-step demo spine", () => {
  it("encodes the frozen order as reusable contract scenarios", () => {
    const fixture = createGoldenFixture();
    const spine = createDemoSpine(fixture);
    const knownOperations = new Set(
      ALL_OPERATION_CONTRACTS.map((contract) => contract.name),
    );

    expect(spine).toHaveLength(fixtureManifest.expectedCounts.demoSteps);
    expect(spine.map((step) => step.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(spine.map((step) => step.id)).toEqual([
      "family-context",
      "private-consent-share",
      "responsibility-report",
      "handover-blocked",
      "handover-accepted",
      "care-escalation",
      "primary-home-after",
    ]);
    expect(spine.map((step) => step.expectedOutcome)).toEqual([
      "success",
      "success",
      "success",
      "blocked",
      "success",
      "success",
      "success",
    ]);

    for (const step of spine) {
      expect(step.entityIds.length).toBeGreaterThan(0);
      expect(step.requiredFacts.length).toBeGreaterThan(0);
      for (const operation of step.operationNames) {
        expect(knownOperations.has(operation)).toBe(true);
      }
    }
  });

  it("keeps the blocked handover inert and accepts only after both confirmations", () => {
    const fixture = createGoldenFixture();
    const timeline = [
      fixture.handover.blocked,
      fixture.handover.awaitingConfirmations,
      fixture.handover.fromConfirmed,
      fixture.handover.bothConfirmed,
      fixture.handover.accepted,
    ];

    expect(timeline.map((handover) => handover.status)).toEqual([
      "blocked",
      "awaiting_confirmations",
      "awaiting_confirmations",
      "awaiting_confirmations",
      "accepted",
    ]);
    expect(fixture.handover.blocked).toMatchObject({
      fromConfirmedAt: null,
      toConfirmedAt: null,
      acceptedAt: null,
    });
    expect(fixture.domains[0]?.ownerId).toBe(fixture.members.primary.id);
    expect(fixture.handover.domainAfterAcceptance.ownerId).toBe(
      fixture.members.partner.id,
    );
    expect(fixture.handover.accepted.status).toBe("accepted");
    if (fixture.handover.accepted.status !== "accepted") {
      throw new Error("Expected the golden handover to be accepted.");
    }
    expect(typeof fixture.handover.accepted.fromConfirmedAt).toBe("string");
    expect(typeof fixture.handover.accepted.toConfirmedAt).toBe("string");
    expect(typeof fixture.handover.accepted.acceptedAt).toBe("string");
    expect(fixture.handover.rememberedItemIdsBefore).toHaveLength(7);
    expect(fixture.handover.removedReminderIds).toHaveLength(5);
    expect(fixture.handover.rememberedItemIdsAfter).toHaveLength(2);
  });

  it("encodes acknowledgement and escalation as deterministic care branches", () => {
    const fixture = createGoldenFixture();

    expect(fixture.care.rule).toMatchObject({
      status: "active",
      requireAck: true,
      ackTimeoutSec: 60,
    });
    expect(fixture.care.acknowledged.state).toBe("acknowledged");
    if (fixture.care.acknowledged.state !== "acknowledged") {
      throw new Error("Expected the acknowledgement care branch.");
    }
    expect(typeof fixture.care.acknowledged.acknowledgedAt).toBe("string");
    expect([
      fixture.care.notified.state,
      fixture.care.timedOut.state,
      fixture.care.escalated.state,
      fixture.care.handled.state,
    ]).toEqual(["notified", "timed_out", "escalated", "handled"]);
    expect(fixture.care.escalated.state).toBe("escalated");
    if (fixture.care.escalated.state !== "escalated") {
      throw new Error("Expected the escalated care branch.");
    }
    expect(fixture.care.escalated.escalationLevel).toBe(1);
    expect(typeof fixture.care.escalated.timedOutAt).toBe("string");
  });

  it("invalidates dependent facts without reversing accepted responsibility", () => {
    const fixture = createGoldenFixture();

    expect(fixture.deletion.evidenceBefore.state).toBe("available");
    expect(fixture.deletion.evidenceAfter.state).toBe("deleted");
    expect(fixture.deletion.signalAfter.evidenceState).toBe("evidence_missing");
    expect(fixture.deletion.taskAfter.reviewState).toBe("needs_review");
    expect(fixture.deletion.domainAfter.status).toBe("needs_review");
    expect(
      fixture.responsibilityReports.afterDeletion.excludedNeedsReviewCount,
    ).toBe(1);
    expect(fixture.deletion.result).toMatchObject({
      status: "deleted",
      receipt: {
        excludedFromFutureReports: true,
        acceptedHandoversReversed: false,
        preservedAcceptedHandoverIds: [fixture.handover.accepted.id],
      },
    });
    expect(fixture.handover.accepted.status).toBe("accepted");
  });

  it("keeps report language neutral and deterministic", () => {
    const fixture = createGoldenFixture();
    const report = fixture.responsibilityReports.beforeDeletion;

    expect(report.rows.map((row) => row.stage)).toEqual([
      "discoveredBy",
      "deadlineKeptBy",
      "scheduledBy",
      "executedBy",
      "followedUpBy",
    ]);
    expect(report.source).toBe("deterministic_template");
    expect(report.narrative).not.toMatch(/(?:排名|评分|责怪|诊断|score|rank|blame)/i);
  });
});
