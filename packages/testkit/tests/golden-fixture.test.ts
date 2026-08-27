import { describe, expect, it } from "vitest";

import fixtureManifest from "../../../fixtures/golden-household.json";
import {
  ConsentDecisionSchema,
  DomainSchema,
  EntityIdSchema,
  EvidenceSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  TaskSchema,
} from "../../contracts/src/index";
import {
  DEFAULT_FIXTURE_INSTANT,
  DEFAULT_ID_NAMESPACE,
  createFixedClock,
  createGoldenFixture,
  createStableIdFactory,
  timestampAt,
} from "../src/index";

describe("golden fictional fixture", () => {
  it("matches the reviewed fixture manifest and contains no real-data category", () => {
    const fixture = createGoldenFixture();

    expect(fixture.metadata).toMatchObject({
      fixtureId: fixtureManifest.fixtureId,
      fixtureVersion: fixtureManifest.fixtureVersion,
      source: fixtureManifest.source,
      fictional: fixtureManifest.fictional,
      fixedInstant: fixtureManifest.fixedInstant,
      idNamespace: fixtureManifest.idNamespace,
      labels: fixtureManifest.labels,
      evidenceLevels: fixtureManifest.evidenceLevels,
      prohibitedRealDataCategories: [],
    });
    expect(Object.values(fixture.members).map((member) => member.displayName)).toEqual([
      "家人甲",
      "家人乙",
      "长辈甲",
    ]);

    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(/\b(?:password|api[_-]?key|access[_-]?token|private[_-]?key)\b/i);
    expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  });

  it("uses stable namespaced UUIDs and an injectable clock", () => {
    const firstIds = createStableIdFactory(DEFAULT_ID_NAMESPACE);
    const secondIds = createStableIdFactory(DEFAULT_ID_NAMESPACE);
    const otherIds = createStableIdFactory("another-fictional-fixture");

    expect(firstIds.forKey("domain:review")).toBe(
      secondIds.forKey("domain:review"),
    );
    expect(firstIds.forKey("domain:review")).not.toBe(
      firstIds.forKey("domain:meals"),
    );
    expect(firstIds.forKey("domain:review")).not.toBe(
      otherIds.forKey("domain:review"),
    );
    expect(EntityIdSchema.safeParse(firstIds.forKey("domain:review")).success).toBe(
      true,
    );

    const clock = createFixedClock(DEFAULT_FIXTURE_INSTANT);
    expect(clock.now()).not.toBe(clock.now());
    expect(clock.now().toISOString()).toBe(DEFAULT_FIXTURE_INSTANT);
    expect(timestampAt(clock, 60)).toBe("2026-08-27T00:01:00.000Z");

    const shifted = createGoldenFixture({
      clock: createFixedClock("2026-09-01T00:00:00.000Z"),
    });
    const baseline = createGoldenFixture();
    expect(shifted.space.id).toBe(baseline.space.id);
    expect(shifted.space.createdAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("is deterministic across independent builds", () => {
    expect(createGoldenFixture()).toEqual(createGoldenFixture());
  });

  it("contains three domains, eight consented signals, two discussions, and one discard", () => {
    const fixture = createGoldenFixture();
    const activeShares = fixture.consents.filter(
      (consent) => consent.recordState === "active",
    );
    const discarded = fixture.consents.filter(
      (consent) => consent.recordState === "discarded",
    );

    expect(fixture.domains).toHaveLength(
      fixtureManifest.expectedCounts.responsibilityDomains,
    );
    expect(fixture.sharedSignals).toHaveLength(
      fixtureManifest.expectedCounts.consentedSignals,
    );
    expect(activeShares).toHaveLength(
      fixtureManifest.expectedCounts.consentedSignals,
    );
    expect(fixture.discussionOnlyMessages).toHaveLength(
      fixtureManifest.expectedCounts.discussionOnlyMessages,
    );
    expect(discarded).toHaveLength(
      fixtureManifest.expectedCounts.discardedConsents,
    );
    expect(fixture.deniedConsent).toMatchObject({
      recordState: "discarded",
      outcome: "discard",
      visibility: null,
    });
  });

  it("validates every built entity against the frozen contracts", () => {
    const fixture = createGoldenFixture();

    for (const evidence of fixture.evidence) {
      expect(EvidenceSchema.safeParse(evidence).success).toBe(true);
    }
    for (const draft of fixture.signalDrafts) {
      expect(SignalDraftSchema.safeParse(draft).success).toBe(true);
    }
    for (const consent of fixture.consents) {
      expect(ConsentDecisionSchema.safeParse(consent).success).toBe(true);
    }
    for (const signal of fixture.sharedSignals) {
      expect(SharedSignalSchema.safeParse(signal).success).toBe(true);
    }
    for (const domain of fixture.domains) {
      expect(DomainSchema.safeParse(domain).success).toBe(true);
    }
    for (const task of fixture.tasks) {
      expect(TaskSchema.safeParse(task).success).toBe(true);
      expect(task).toHaveProperty("discoveredBy");
      expect(task).toHaveProperty("deadlineKeptBy");
      expect(task).toHaveProperty("scheduledBy");
      expect(task).toHaveProperty("executedBy");
      expect(task).toHaveProperty("followedUpBy");
    }
  });

  it("never copies raw private text into a shared signal", () => {
    const fixture = createGoldenFixture();

    for (const signal of fixture.sharedSignals) {
      const evidenceId = signal.provenance[0]?.evidenceId;
      const sourceMessage = fixture.messages.find(
        (message) => message.evidenceId === evidenceId,
      );
      expect(sourceMessage).toBeDefined();
      expect(signal.redactedExcerpt).not.toBe(sourceMessage?.content);
      expect(signal.conclusion).not.toBe(sourceMessage?.content);
    }

    const deniedDraftId = fixture.deniedConsent.signalDraftId;
    expect(
      fixture.sharedSignals.some(
        (signal) => signal.consentDecisionId === fixture.deniedConsent.id,
      ),
    ).toBe(false);
    expect(fixture.signalDrafts.some((draft) => draft.id === deniedDraftId)).toBe(
      true,
    );
  });
});
