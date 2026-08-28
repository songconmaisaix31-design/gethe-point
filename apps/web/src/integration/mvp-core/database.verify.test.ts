import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  consentDecisions,
  evidence,
  idempotencyRecords,
  members,
  signalDraftEvidence,
  signals,
  tasks,
} from "../../../../../packages/db/src/index";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "../../../../../packages/db/tests/disposable/postgres-harness";
import { MVP_CORE_FIXTURE } from "../../../../../fixtures/mvp-core";
import { issueMvpCoreFixtureSession } from "../../../../../packages/testkit/src/integration-seam";
import {
  FIXTURE_RESPONSIBILITY_OPERATION,
  resetMvpCoreDatabase,
} from "./persistence";
import { executeMvpCoreCommand } from "./runtime";

const verifyDatabase = process.env["MVP_CORE_INTEGRATION_VERIFY"] === "1";
const describeDatabase = verifyDatabase ? describe : describe.skip;

const sessionFor = (role: "primary" | "partner" | "subject") => {
  const session = issueMvpCoreFixtureSession({
    role,
    scenarioId: MVP_CORE_FIXTURE.scenarioId,
  });
  if (session === undefined) {
    throw new Error("The accepted QA session seam rejected a canonical role.");
  }
  return session;
};

const subjectSession = sessionFor("subject");
const primarySession = sessionFor("primary");
const partnerSession = sessionFor("partner");

describeDatabase("MVP core durable PostgreSQL integration", () => {
  let postgres: DisposablePostgres;

  beforeAll(async () => {
    postgres = await startDisposablePostgres();
  }, 60_000);

  afterAll(async () => {
    await postgres.stop();
  }, 60_000);

  beforeEach(async () => {
    await resetMvpCoreDatabase(postgres.database);
  });

  const command = (
    session: typeof subjectSession,
    request: unknown,
  ) => executeMvpCoreCommand(postgres.database, session, request);

  const recordShareConsent = () =>
    command(subjectSession, { command: "record_share_consent" });

  const publish = () =>
    command(subjectSession, { command: "publish_consented_signal" });

  const expectNoSharedWrites = async () => {
    const signalRows = await postgres.database
      .select()
      .from(signals)
      .where(eq(signals.spaceId, MVP_CORE_FIXTURE.space.id));
    const responsibilityReceipts = await postgres.database
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.spaceId, MVP_CORE_FIXTURE.space.id),
          eq(
            idempotencyRecords.operation,
            FIXTURE_RESPONSIBILITY_OPERATION,
          ),
        ),
      );
    expect(signalRows).toHaveLength(0);
    expect(responsibilityReceipts).toHaveLength(0);
  };

  it("publishes one signal and one completed responsibility receipt", async () => {
    expect((await recordShareConsent()).body.ok).toBe(true);
    const response = await publish();
    expect(response.body.ok).toBe(true);
    expect(response.body.state.sharedRows).toBe(1);

    const receipts = await postgres.database
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.spaceId, MVP_CORE_FIXTURE.space.id),
          eq(
            idempotencyRecords.operation,
            FIXTURE_RESPONSIBILITY_OPERATION,
          ),
        ),
      );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.state).toBe("completed");
  });

  it("keeps the progressed snapshot on valid-session rejection without writes", async () => {
    await recordShareConsent();
    const published = await publish();
    expect(published.body.ok).toBe(true);
    const progressedState = published.body.state;
    const rowsBefore = await postgres.database
      .select({ id: idempotencyRecords.id })
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.spaceId, MVP_CORE_FIXTURE.space.id));

    const malformed = await command(subjectSession, {
      command: "record_share_consent",
      content: "tampered",
      role: "subject",
    });
    const wrongRole = await command(partnerSession, {
      command: "record_share_consent",
    });
    const privateProbe = await command(partnerSession, {
      command: "read_private_message",
      targetId: MVP_CORE_FIXTURE.privateConversation.message.id,
    });
    const wrongSubjectTarget = await command(subjectSession, {
      command: "read_private_message",
      targetId: "00000000-0000-4000-8000-0000000000f1",
    });
    const rawShare = await command(subjectSession, {
      command: "share_private_message",
      targetId: MVP_CORE_FIXTURE.privateConversation.message.id,
    });

    expect(malformed.body).toMatchObject({
      code: "invalid_request",
      ok: false,
      state: progressedState,
    });
    expect(wrongRole.body).toMatchObject({
      code: "forbidden",
      ok: false,
      state: progressedState,
    });
    expect(privateProbe.body).toMatchObject({
      code: "not_found",
      ok: false,
      state: progressedState,
    });
    expect(wrongSubjectTarget.body).toMatchObject({
      code: "not_found",
      ok: false,
      state: progressedState,
    });
    expect(rawShare.body).toMatchObject({
      code: "raw_private_share_denied",
      ok: false,
      state: progressedState,
    });
    const rowsAfter = await postgres.database
      .select({ id: idempotencyRecords.id })
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.spaceId, MVP_CORE_FIXTURE.space.id));
    expect(rowsAfter).toEqual(rowsBefore);
  });

  it("fails closed for expired, revoked, narrowed, and inactive consent authority", async () => {
    const consent = MVP_CORE_FIXTURE.privateConversation.consentDecision;
    const visibility = consent.visibility;
    await postgres.database.insert(consentDecisions).values({
      createdAt: consent.createdAt,
      decidedAt: consent.decidedAt,
      expiresAt: consent.decidedAt,
      id: consent.id,
      outcome: "share",
      recordState: "expired",
      revokedAt: null,
      signalDraftId: consent.signalDraftId,
      spaceId: consent.spaceId,
      speakerId: consent.speakerId,
      updatedAt: consent.updatedAt,
      version: consent.version,
      visibilityKind: visibility.kind,
      visibilityMemberIds: [...visibility.memberIds],
      visibilitySubjectId: visibility.subjectId,
    });
    expect((await publish()).body.ok).toBe(false);
    await expectNoSharedWrites();

    await resetMvpCoreDatabase(postgres.database);
    await postgres.database.insert(consentDecisions).values({
      createdAt: consent.createdAt,
      decidedAt: consent.decidedAt,
      expiresAt: null,
      id: consent.id,
      outcome: "share",
      recordState: "revoked",
      revokedAt: consent.decidedAt,
      signalDraftId: consent.signalDraftId,
      spaceId: consent.spaceId,
      speakerId: consent.speakerId,
      updatedAt: consent.updatedAt,
      version: consent.version,
      visibilityKind: visibility.kind,
      visibilityMemberIds: [...visibility.memberIds],
      visibilitySubjectId: visibility.subjectId,
    });
    expect((await publish()).body.ok).toBe(false);
    await expectNoSharedWrites();

    await resetMvpCoreDatabase(postgres.database);
    await postgres.database.insert(consentDecisions).values({
      createdAt: consent.createdAt,
      decidedAt: consent.decidedAt,
      expiresAt: null,
      id: consent.id,
      outcome: "share",
      recordState: "active",
      revokedAt: null,
      signalDraftId: consent.signalDraftId,
      spaceId: consent.spaceId,
      speakerId: consent.speakerId,
      updatedAt: consent.updatedAt,
      version: consent.version,
      visibilityKind: "members",
      visibilityMemberIds: [MVP_CORE_FIXTURE.actors.subject.memberId],
      visibilitySubjectId: null,
    });
    expect((await publish()).body.ok).toBe(false);
    await expectNoSharedWrites();

    await resetMvpCoreDatabase(postgres.database);
    await recordShareConsent();
    await postgres.database
      .update(members)
      .set({ status: "inactive" })
      .where(eq(members.id, MVP_CORE_FIXTURE.actors.subject.memberId));
    expect((await publish()).body.ok).toBe(false);
    await expectNoSharedWrites();
  });

  it("rejects a wrong evidence link and rolls back publication", async () => {
    await recordShareConsent();
    const [canonicalEvidence] = await postgres.database
      .select()
      .from(evidence)
      .where(
        eq(
          evidence.id,
          MVP_CORE_FIXTURE.privateConversation.derivedDraft.evidenceIds[0],
        ),
      )
      .limit(1);
    if (canonicalEvidence === undefined) {
      throw new Error("The canonical Fixture evidence row is unavailable.");
    }
    const wrongEvidenceId = "00000000-0000-4000-8000-0000000000f2";
    await postgres.database.insert(evidence).values({
      ...canonicalEvidence,
      id: wrongEvidenceId,
    });
    await postgres.database
      .delete(signalDraftEvidence)
      .where(
        and(
          eq(signalDraftEvidence.spaceId, MVP_CORE_FIXTURE.space.id),
          eq(
            signalDraftEvidence.signalDraftId,
            MVP_CORE_FIXTURE.privateConversation.derivedDraft.id,
          ),
        ),
      );
    await postgres.database.insert(signalDraftEvidence).values({
      evidenceId: wrongEvidenceId,
      signalDraftId: MVP_CORE_FIXTURE.privateConversation.derivedDraft.id,
      spaceId: MVP_CORE_FIXTURE.space.id,
    });

    expect((await publish()).body.ok).toBe(false);
    await expectNoSharedWrites();
  });

  it("detects a responsibility receipt hash conflict on signal replay", async () => {
    await recordShareConsent();
    expect((await publish()).body.ok).toBe(true);
    await postgres.database
      .update(idempotencyRecords)
      .set({ requestHash: "0".repeat(64) })
      .where(
        and(
          eq(idempotencyRecords.spaceId, MVP_CORE_FIXTURE.space.id),
          eq(
            idempotencyRecords.operation,
            FIXTURE_RESPONSIBILITY_OPERATION,
          ),
        ),
      );

    const replay = await publish();
    expect(replay.body.ok).toBe(false);
    expect(replay.body.state.sharedRows).toBe(1);
  });

  it("replays publication after accepted handover without undoing ownership", async () => {
    await recordShareConsent();
    expect((await publish()).body.ok).toBe(true);
    await command(primarySession, { command: "supply_handover_info" });
    await command(primarySession, { command: "confirm_handover_from" });
    const accepted = await command(partnerSession, {
      command: "confirm_handover_to",
    });
    expect(accepted.body.state.handover.status).toBe("accepted");

    const replay = await publish();
    expect(replay.body.ok).toBe(true);
    expect(replay.body.state).toMatchObject({
      domainOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
      reminderOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
      sharedRows: 1,
    });
    const signalRows = await postgres.database
      .select({ id: signals.id })
      .from(signals)
      .where(eq(signals.spaceId, MVP_CORE_FIXTURE.space.id));
    const responsibilityReceipts = await postgres.database
      .select({ id: idempotencyRecords.id })
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.spaceId, MVP_CORE_FIXTURE.space.id),
          eq(
            idempotencyRecords.operation,
            FIXTURE_RESPONSIBILITY_OPERATION,
          ),
        ),
      );
    expect(signalRows).toHaveLength(1);
    expect(responsibilityReceipts).toHaveLength(1);
  });

  it("regenerates a report from current rows after handover", async () => {
    await recordShareConsent();
    await publish();
    const first = await command(primarySession, { command: "generate_report" });
    expect(first.body.ok).toBe(true);

    await command(primarySession, { command: "supply_handover_info" });
    await command(primarySession, { command: "confirm_handover_from" });
    await command(partnerSession, { command: "confirm_handover_to" });
    await postgres.database
      .update(tasks)
      .set({ executedBy: MVP_CORE_FIXTURE.actors.primary.memberId })
      .where(
        and(
          eq(tasks.spaceId, MVP_CORE_FIXTURE.space.id),
          eq(tasks.id, MVP_CORE_FIXTURE.responsibility.task.id),
        ),
      );

    const current = await command(primarySession, { command: "generate_report" });
    expect(current.body.ok).toBe(true);
    if (!current.body.ok || current.body.result.report === undefined) {
      throw new Error("The current persisted report was not returned.");
    }
    const execution = current.body.result.report.rows.find(
      ({ stage }) => stage === "executedBy",
    );
    expect(execution?.counts).toEqual([
      { count: 1, memberId: MVP_CORE_FIXTURE.actors.primary.memberId },
    ]);
    expect(current.body.state.domainOwnerId).toBe(
      MVP_CORE_FIXTURE.actors.partner.memberId,
    );
    expect(current.body.state.reminderOwnerId).toBe(
      MVP_CORE_FIXTURE.actors.partner.memberId,
    );
  });
});
