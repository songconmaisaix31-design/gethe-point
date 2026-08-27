import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AuditEntrySchema,
  CareEventSchema,
  CareRuleSchema,
  DeleteEvidenceRequestSchema,
  DeleteEvidenceResultSchema,
  DeleteSpaceRequestSchema,
  DeleteSpaceResultSchema,
  DomainSchema,
  EntityIdSchema,
  EvidenceSchema,
  ExportBundleSchema,
  ExportMyDataRequestSchema,
  ExportMyDataResultSchema,
  GetAuditTrailRequestSchema,
  GetAuditTrailResultSchema,
  HandoverSchema,
  MemberActorSchema,
  MemberSchema,
  PrivateMessageSchema,
  RawEvidenceViewSchema,
  RequestIdSchema,
  RevokeAnalysisConsentRequestSchema,
  RevokeAnalysisConsentResultSchema,
  SharedSignalSchema,
  TaskSchema,
  TimestampSchema,
  type CareRule,
  type DeleteEvidenceResult,
  type DeleteSpaceRequest,
  type DeleteSpaceResult,
  type EntityId,
  type ExportBundle,
  type ExportMyDataResult,
  type GetAuditTrailRequest,
  type GetAuditTrailResult,
  type IdempotencyKey,
  type Member,
  type MemberActor,
  type RequestId,
  type RevokeAnalysisConsentResult,
  type Timestamp,
} from "../../../packages/contracts/src/index";
import {
  AuthorizeFutureAnalysisRequestSchema,
  AuthorizeFutureAnalysisResultSchema,
  ReadRawEvidenceRequestSchema,
  ReadRawEvidenceResultSchema,
  ReadSharedConclusionRequestSchema,
  ReadSharedConclusionResultSchema,
  type AuthorizeFutureAnalysisResult,
  type PrivacyError,
  type PrivacyErrorCode,
  type PrivacyResult,
  type ReadRawEvidenceResult,
  type ReadSharedConclusionResult,
} from "./api";
import { actorMatchesActiveMember, canReadVisibility } from "./authorization";
import type {
  PrivacyIdempotencyRecord,
  PrivacyOperationName,
  PrivacyReadPort,
  PrivacyReplayPayload,
  PrivacyServiceDependencies,
  PrivacyTransaction,
  StoredEvidenceRecord,
} from "./ports";

const SAFE_ERROR_MESSAGES: Readonly<Record<PrivacyErrorCode, string>> = {
  invalid_request: "The privacy request is invalid.",
  unauthenticated: "A valid authenticated member actor is required.",
  forbidden: "The actor is not allowed to perform this privacy operation.",
  not_found: "The requested record was not found.",
  conflict: "The privacy operation conflicts with the current state.",
  stale_version: "The record version has changed.",
  consent_invalid: "Current consent does not authorize future analysis.",
  idempotency_conflict: "The idempotency key belongs to a different request.",
  deletion_confirmation_required: "Exact deletion confirmation is required.",
  export_not_authorized: "The requested export is not authorized.",
  internal_failure: "The privacy operation failed.",
};

interface PolicyFailure extends Error {
  readonly name: "PrivacyPolicyFailure";
  readonly code: PrivacyErrorCode;
}

const policyFailure = (code: PrivacyErrorCode): PolicyFailure =>
  Object.assign(new Error(SAFE_ERROR_MESSAGES[code]), {
    name: "PrivacyPolicyFailure" as const,
    code,
  });

const fail = (code: PrivacyErrorCode): never => {
  throw policyFailure(code);
};

const isPolicyFailure = (error: unknown): error is PolicyFailure =>
  error instanceof Error && error.name === "PrivacyPolicyFailure";

const parseBoundary = <Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> => {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return fail("invalid_request");
  }

  return parsed.data;
};

const requestIdFrom = (input: unknown): RequestId => {
  if (typeof input === "object" && input !== null && "requestId" in input) {
    const parsed = RequestIdSchema.safeParse(input.requestId);

    if (parsed.success) {
      return parsed.data;
    }
  }

  return randomUUID();
};

const parseActor = (input: unknown): MemberActor => {
  const parsed = MemberActorSchema.safeParse(input);

  if (!parsed.success) {
    return fail("unauthenticated");
  }

  return parsed.data;
};

const actorReference = (actor: MemberActor) => ({
  kind: "member" as const,
  memberId: actor.memberId,
  spaceId: actor.spaceId,
  role: actor.role,
});

const run = async <Result>(
  requestId: RequestId,
  work: () => Promise<Result>,
): Promise<PrivacyResult<Result>> => {
  try {
    return { ok: true, result: await work() };
  } catch (error) {
    const code = isPolicyFailure(error) ? error.code : "internal_failure";
    const privacyError: PrivacyError = {
      code,
      requestId,
      message: SAFE_ERROR_MESSAGES[code],
      retryable: false,
    };

    return { ok: false, error: privacyError };
  }
};

const requestHash = (request: object): string =>
  createHash("sha256").update(JSON.stringify(request)).digest("hex");

const uniqueSortedIds = (ids: readonly EntityId[]): readonly EntityId[] =>
  [...new Set(ids)].sort((left, right) => left.localeCompare(right));

const sortRecords = <Record extends { readonly id: EntityId }>(
  records: readonly Record[],
): readonly Record[] =>
  [...records].sort((left, right) => left.id.localeCompare(right.id));

const sortEvidenceViews = <
  Record extends { readonly evidence: { readonly id: EntityId } },
>(
  records: readonly Record[],
): readonly Record[] =>
  [...records].sort((left, right) =>
    left.evidence.id.localeCompare(right.evidence.id),
  );

const requireActiveMember = async (
  port: PrivacyReadPort,
  actor: MemberActor,
): Promise<Member> => {
  const member = await port.getMember(actor.spaceId, actor.memberId);

  if (member === null || !actorMatchesActiveMember(actor, member)) {
    return fail("not_found");
  }

  return MemberSchema.parse(member);
};

const getReplay = async (
  transaction: PrivacyTransaction,
  actor: MemberActor,
  operation: PrivacyOperationName,
  idempotencyKey: IdempotencyKey,
  hash: string,
): Promise<PrivacyReplayPayload | null> => {
  const record = await transaction.getIdempotencyRecord(
    actor.spaceId,
    operation,
    actor.memberId,
    idempotencyKey,
  );

  if (record === null) {
    return null;
  }

  if (record.requestHash !== hash) {
    return fail("idempotency_conflict");
  }

  return record.replay;
};

const saveReplay = async (
  transaction: PrivacyTransaction,
  actor: MemberActor,
  operation: PrivacyOperationName,
  idempotencyKey: IdempotencyKey,
  hash: string,
  replay: PrivacyReplayPayload,
): Promise<void> => {
  const record: PrivacyIdempotencyRecord = {
    spaceId: actor.spaceId,
    operation,
    actorMemberId: actor.memberId,
    idempotencyKey,
    requestHash: hash,
    replay,
  };

  await transaction.saveIdempotencyRecord(record);
};

const AuditCursorSchema = z.strictObject({
  version: z.literal(1),
  memberId: EntityIdSchema,
  targetKey: z.string().min(1).max(256),
  offset: z.number().int().nonnegative(),
});

const auditTargetKey = (request: GetAuditTrailRequest): string =>
  request.target === null
    ? "all"
    : `${request.target.type}:${request.target.id}`;

const decodeAuditOffset = (
  cursor: string | null,
  actor: MemberActor,
  targetKey: string,
): number => {
  if (cursor === null) {
    return 0;
  }

  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const parsed = AuditCursorSchema.safeParse(decoded);

    if (
      !parsed.success ||
      parsed.data.memberId !== actor.memberId ||
      parsed.data.targetKey !== targetKey
    ) {
      return fail("invalid_request");
    }

    return parsed.data.offset;
  } catch {
    return fail("invalid_request");
  }
};

const encodeAuditCursor = (
  actor: MemberActor,
  targetKey: string,
  offset: number,
): string =>
  Buffer.from(
    JSON.stringify({ version: 1, memberId: actor.memberId, targetKey, offset }),
    "utf8",
  ).toString("base64url");

const canReadCareRule = (actor: MemberActor, rule: CareRule): boolean =>
  rule.subjectId === actor.memberId ||
  rule.primaryCaregiverId === actor.memberId ||
  rule.escalationChain.some((step) =>
    step.targetMemberIds.includes(actor.memberId),
  );

const buildExportBundle = async (
  port: PrivacyReadPort,
  actor: MemberActor,
  member: Member,
  generatedAt: Timestamp,
): Promise<ExportBundle> => {
  const privateMessages = (await port.listPrivateMessages(actor.spaceId))
    .filter(
      (message) =>
        message.spaceId === actor.spaceId &&
        message.authorId === actor.memberId &&
        message.visibility.memberId === actor.memberId,
    )
    .map((message) => PrivateMessageSchema.parse(message));

  const evidence = (await port.listEvidence(actor.spaceId))
    .filter(
      (record) =>
        record.evidence.spaceId === actor.spaceId &&
        record.evidence.speakerId === actor.memberId &&
        record.evidence.visibility.memberId === actor.memberId &&
        record.evidence.state === "available" &&
        record.rawContent !== null,
    )
    .map((record) =>
      RawEvidenceViewSchema.parse({
        evidence: record.evidence,
        rawContent: record.rawContent,
      }),
    );

  const signals = (await port.listSignals(actor.spaceId))
    .filter(
      (signal) =>
        signal.spaceId === actor.spaceId &&
        canReadVisibility(actor, signal.visibility),
    )
    .map((signal) => SharedSignalSchema.parse(signal));

  const domains = (await port.listDomains(actor.spaceId))
    .filter(
      (domain) =>
        domain.spaceId === actor.spaceId &&
        canReadVisibility(actor, domain.visibility),
    )
    .map((domain) => DomainSchema.parse(domain));
  const visibleDomainIds = new Set(domains.map((domain) => domain.id));

  const tasks = (await port.listTasks(actor.spaceId))
    .filter(
      (task) =>
        task.spaceId === actor.spaceId &&
        canReadVisibility(actor, task.visibility),
    )
    .map((task) => TaskSchema.parse(task));

  const handovers = (await port.listHandovers(actor.spaceId))
    .filter(
      (handover) =>
        handover.spaceId === actor.spaceId &&
        (visibleDomainIds.has(handover.domainId) ||
          handover.fromMemberId === actor.memberId ||
          handover.toMemberId === actor.memberId),
    )
    .map((handover) => HandoverSchema.parse(handover));

  const careRules = (await port.listCareRules(actor.spaceId))
    .filter(
      (rule) =>
        rule.spaceId === actor.spaceId && canReadCareRule(actor, rule),
    )
    .map((rule) => CareRuleSchema.parse(rule));
  const visibleCareRules = new Map(careRules.map((rule) => [rule.id, rule]));

  const careEvents = (await port.listCareEvents(actor.spaceId))
    .filter(
      (event) =>
        event.spaceId === actor.spaceId &&
        (event.subjectId === actor.memberId ||
          visibleCareRules.has(event.careRuleId)),
    )
    .map((event) => CareEventSchema.parse(event));

  return ExportBundleSchema.parse({
    generatedAt,
    member: MemberSchema.parse(member),
    privateMessages: sortRecords(privateMessages),
    evidence: sortEvidenceViews(evidence),
    visibleSignals: sortRecords(signals),
    visibleDomains: sortRecords(domains),
    visibleTasks: sortRecords(tasks),
    visibleHandovers: sortRecords(handovers),
    visibleCareRules: sortRecords(careRules),
    visibleCareEvents: sortRecords(careEvents),
  });
};

const parseDeleteSpaceRequest = (input: unknown): DeleteSpaceRequest => {
  const parsed = DeleteSpaceRequestSchema.safeParse(input);

  if (parsed.success) {
    if (
      typeof input !== "object" ||
      input === null ||
      !("expectedSpaceName" in input) ||
      !("typedSpaceName" in input) ||
      input.expectedSpaceName !== parsed.data.expectedSpaceName ||
      input.typedSpaceName !== parsed.data.typedSpaceName ||
      input.expectedSpaceName !== input.typedSpaceName
    ) {
      return fail("deletion_confirmation_required");
    }

    return parsed.data;
  }

  const confirmationOnly = parsed.error.issues.every(
    (issue) =>
      issue.code === "custom" && issue.path.join(".") === "typedSpaceName",
  );

  return fail(
    confirmationOnly ? "deletion_confirmation_required" : "invalid_request",
  );
};

export interface PrivacyService {
  readRawEvidence(
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<PrivacyResult<ReadRawEvidenceResult>>;
  readSharedConclusion(
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<PrivacyResult<ReadSharedConclusionResult>>;
  getAuditTrail(
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<PrivacyResult<GetAuditTrailResult>>;
  authorizeFutureAnalysis(
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<PrivacyResult<AuthorizeFutureAnalysisResult>>;
  deleteEvidence(
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<PrivacyResult<DeleteEvidenceResult>>;
  revokeAnalysisConsent(
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<PrivacyResult<RevokeAnalysisConsentResult>>;
  exportMyData(
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<PrivacyResult<ExportMyDataResult>>;
  deleteSpace(
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<PrivacyResult<DeleteSpaceResult>>;
}

export const createPrivacyService = (
  dependencies: PrivacyServiceDependencies,
): PrivacyService => {
  const newEntityId = (): EntityId => {
    const parsed = EntityIdSchema.safeParse(dependencies.idFactory());

    if (!parsed.success) {
      return fail("internal_failure");
    }

    return parsed.data;
  };

  const now = (): Timestamp => {
    const parsed = TimestampSchema.safeParse(
      dependencies.clock.now().toISOString(),
    );

    if (!parsed.success) {
      return fail("internal_failure");
    }

    return parsed.data;
  };

  return {
    readRawEvidence: async (actorInput, requestInput) => {
      const requestId = requestIdFrom(requestInput);

      return run(requestId, async () => {
        const request = parseBoundary(
          ReadRawEvidenceRequestSchema,
          requestInput,
        );
        const actor = parseActor(actorInput);

        return dependencies.store.read(async (port) => {
          await requireActiveMember(port, actor);
          const record = await port.getEvidence(
            actor.spaceId,
            request.evidenceId,
          );

          if (
            record?.evidence.spaceId !== actor.spaceId ||
            record.evidence.speakerId !== actor.memberId ||
            record.evidence.visibility.memberId !== actor.memberId ||
            record.evidence.state !== "available" ||
            record.rawContent === null
          ) {
            return fail("not_found");
          }

          return ReadRawEvidenceResultSchema.parse({
            status: "ready",
            evidence: {
              evidence: record.evidence,
              rawContent: record.rawContent,
            },
          });
        });
      });
    },

    readSharedConclusion: async (actorInput, requestInput) => {
      const requestId = requestIdFrom(requestInput);

      return run(requestId, async () => {
        const request = parseBoundary(
          ReadSharedConclusionRequestSchema,
          requestInput,
        );
        const actor = parseActor(actorInput);

        return dependencies.store.read(async (port) => {
          await requireActiveMember(port, actor);
          const signal = await port.getSignal(actor.spaceId, request.signalId);

          if (
            signal?.spaceId !== actor.spaceId ||
            !canReadVisibility(actor, signal.visibility)
          ) {
            return fail("not_found");
          }

          return ReadSharedConclusionResultSchema.parse({
            status: "ready",
            signal,
          });
        });
      });
    },

    getAuditTrail: async (actorInput, requestInput) => {
      const requestId = requestIdFrom(requestInput);

      return run(requestId, async () => {
        const request = parseBoundary(GetAuditTrailRequestSchema, requestInput);
        const actor = parseActor(actorInput);

        return dependencies.store.read(async (port) => {
          await requireActiveMember(port, actor);

          if (request.spaceId !== actor.spaceId) {
            return fail("not_found");
          }

          const targetKey = auditTargetKey(request);
          const offset = decodeAuditOffset(
            request.page.cursor,
            actor,
            targetKey,
          );
          const entries = (await port.listAuditEntries(actor.spaceId))
            .filter(
              (entry) =>
                entry.spaceId === actor.spaceId &&
                canReadVisibility(actor, entry.visibility) &&
                (request.target === null ||
                  (entry.targetType === request.target.type &&
                    entry.targetId === request.target.id)),
            )
            .map((entry) => AuditEntrySchema.parse(entry))
            .sort(
              (left, right) =>
                Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
                right.id.localeCompare(left.id),
            );

          if (offset > entries.length) {
            return fail("invalid_request");
          }

          const pageEntries = entries.slice(offset, offset + request.page.limit);
          const nextOffset = offset + pageEntries.length;
          const hasMore = nextOffset < entries.length;

          return GetAuditTrailResultSchema.parse({
            status: "ready",
            entries: pageEntries,
            page: {
              nextCursor: hasMore
                ? encodeAuditCursor(actor, targetKey, nextOffset)
                : null,
              hasMore,
            },
          });
        });
      });
    },

    authorizeFutureAnalysis: async (actorInput, requestInput) => {
      const requestId = requestIdFrom(requestInput);

      return run(requestId, async () => {
        const request = parseBoundary(
          AuthorizeFutureAnalysisRequestSchema,
          requestInput,
        );
        const actor = parseActor(actorInput);

        if (new Set(request.evidenceIds).size !== request.evidenceIds.length) {
          return fail("invalid_request");
        }

        return dependencies.store.read(async (port) => {
          const member = await requireActiveMember(port, actor);

          if (member.analysisConsent !== "enabled") {
            return fail("consent_invalid");
          }

          for (const evidenceId of request.evidenceIds) {
            const record = await port.getEvidence(actor.spaceId, evidenceId);

            if (
              record?.evidence.spaceId !== actor.spaceId ||
              record.evidence.speakerId !== actor.memberId ||
              record.evidence.visibility.memberId !== actor.memberId ||
              record.evidence.state !== "available"
            ) {
              return fail("not_found");
            }
          }

          return AuthorizeFutureAnalysisResultSchema.parse({
            status: "authorized",
            memberId: actor.memberId,
            evidenceIds: request.evidenceIds,
            contentReleased: false,
          });
        });
      });
    },

    deleteEvidence: async (actorInput, requestInput) => {
      const requestId = requestIdFrom(requestInput);

      return run(requestId, async () => {
        const request = parseBoundary(
          DeleteEvidenceRequestSchema,
          requestInput,
        );
        const actor = parseActor(actorInput);
        const hash = requestHash(request);

        return dependencies.store.transaction(async (transaction) => {
          await requireActiveMember(transaction, actor);
          const replay = await getReplay(
            transaction,
            actor,
            "DeleteEvidence",
            request.idempotencyKey,
            hash,
          );

          if (replay !== null) {
            if (replay.kind !== "delete_evidence") {
              return fail("internal_failure");
            }

            return DeleteEvidenceResultSchema.parse(replay.result);
          }

          const storedEvidence = await transaction.getEvidence(
            actor.spaceId,
            request.evidenceId,
          );

          if (
            storedEvidence?.evidence.spaceId !== actor.spaceId ||
            storedEvidence.evidence.speakerId !== actor.memberId ||
            storedEvidence.evidence.visibility.memberId !== actor.memberId ||
            storedEvidence.evidence.state !== "available"
          ) {
            return fail("not_found");
          }

          if (storedEvidence.evidence.version !== request.expectedVersion) {
            return fail("stale_version");
          }

          const changedAt = now();
          const signals = (await transaction.listSignals(actor.spaceId)).filter(
            (signal) =>
              signal.provenance.some(
                (item) => item.evidenceId === request.evidenceId,
              ),
          );
          const tasks = (await transaction.listTasks(actor.spaceId)).filter(
            (task) => task.evidenceIds.includes(request.evidenceId),
          );
          const domains = (await transaction.listDomains(actor.spaceId)).filter(
            (domain) => domain.evidenceIds.includes(request.evidenceId),
          );
          const affectedDomainIds = new Set(domains.map((domain) => domain.id));
          const preservedHandovers = (
            await transaction.listHandovers(actor.spaceId)
          ).filter(
            (handover) =>
              handover.status === "accepted" &&
              (handover.packet.evidenceIds.includes(request.evidenceId) ||
                affectedDomainIds.has(handover.domainId)),
          );

          const deletedEvidence: StoredEvidenceRecord = {
            evidence: EvidenceSchema.parse({
              ...storedEvidence.evidence,
              rawRef: "deleted",
              state: "deleted",
              updatedAt: changedAt,
              version: storedEvidence.evidence.version + 1,
            }),
            rawContent: null,
          };
          await transaction.saveEvidence(deletedEvidence);

          for (const signal of signals) {
            await transaction.saveSignal(
              SharedSignalSchema.parse({
                ...signal,
                evidenceState: "evidence_missing",
                provenance: signal.provenance.map((item) =>
                  item.evidenceId === request.evidenceId
                    ? { ...item, state: "deleted" as const }
                    : item,
                ),
                updatedAt: changedAt,
                version: signal.version + 1,
              }),
            );
          }

          for (const task of tasks) {
            if (task.reviewState === "current") {
              await transaction.saveTask(
                TaskSchema.parse({
                  ...task,
                  reviewState: "needs_review",
                  updatedAt: changedAt,
                  version: task.version + 1,
                }),
              );
            }
          }

          for (const domain of domains) {
            if (domain.status !== "needs_review") {
              await transaction.saveDomain(
                DomainSchema.parse({
                  ...domain,
                  status: "needs_review",
                  updatedAt: changedAt,
                  version: domain.version + 1,
                }),
              );
            }
          }

          const auditEntryId = newEntityId();
          const auditEntry = AuditEntrySchema.parse({
            id: auditEntryId,
            spaceId: actor.spaceId,
            actor: actorReference(actor),
            action: "evidence_deleted",
            targetType: "evidence",
            targetId: request.evidenceId,
            beforeVersion: storedEvidence.evidence.version,
            afterVersion: deletedEvidence.evidence.version,
            changes: [
              {
                field: "evidenceState",
                before: { kind: "state", value: "available" },
                after: { kind: "state", value: "deleted" },
              },
            ],
            visibility: { kind: "self", memberId: actor.memberId },
            occurredAt: changedAt,
            retention: "until_space_deleted",
          });
          await transaction.appendAuditEntry(auditEntry);

          const result = DeleteEvidenceResultSchema.parse({
            status: "deleted",
            receipt: {
              evidenceId: request.evidenceId,
              invalidatedSignalIds: uniqueSortedIds(
                signals.map((signal) => signal.id),
              ),
              needsReviewTaskIds: uniqueSortedIds(
                tasks.map((task) => task.id),
              ),
              needsReviewDomainIds: uniqueSortedIds(
                domains.map((domain) => domain.id),
              ),
              preservedAcceptedHandoverIds: uniqueSortedIds(
                preservedHandovers.map((handover) => handover.id),
              ),
              excludedFromFutureReports: true,
              acceptedHandoversReversed: false,
              auditEntryId,
            },
          });
          await saveReplay(
            transaction,
            actor,
            "DeleteEvidence",
            request.idempotencyKey,
            hash,
            { kind: "delete_evidence", result },
          );

          return result;
        });
      });
    },

    revokeAnalysisConsent: async (actorInput, requestInput) => {
      const requestId = requestIdFrom(requestInput);

      return run(requestId, async () => {
        const request = parseBoundary(
          RevokeAnalysisConsentRequestSchema,
          requestInput,
        );
        const actor = parseActor(actorInput);
        const hash = requestHash(request);

        return dependencies.store.transaction(async (transaction) => {
          const member = await requireActiveMember(transaction, actor);
          const replay = await getReplay(
            transaction,
            actor,
            "RevokeAnalysisConsent",
            request.idempotencyKey,
            hash,
          );

          if (replay !== null) {
            if (replay.kind !== "revoke_analysis_consent") {
              return fail("internal_failure");
            }

            return RevokeAnalysisConsentResultSchema.parse(replay.result);
          }

          if (member.version !== request.expectedMemberVersion) {
            return fail("stale_version");
          }

          if (member.analysisConsent === "revoked") {
            return fail("conflict");
          }

          const changedAt = now();
          const auditEntryId = newEntityId();
          const updatedMember = MemberSchema.parse({
            ...member,
            analysisConsent: "revoked",
            updatedAt: changedAt,
            version: member.version + 1,
          });
          const auditEntry = AuditEntrySchema.parse({
            id: auditEntryId,
            spaceId: actor.spaceId,
            actor: actorReference(actor),
            action: "analysis_consent_revoked",
            targetType: "member",
            targetId: actor.memberId,
            beforeVersion: member.version,
            afterVersion: updatedMember.version,
            changes: [
              {
                field: "analysisConsent",
                before: { kind: "state", value: "enabled" },
                after: { kind: "state", value: "revoked" },
              },
            ],
            visibility: { kind: "self", memberId: actor.memberId },
            occurredAt: changedAt,
            retention: "until_space_deleted",
          });
          const result = RevokeAnalysisConsentResultSchema.parse({
            status: "revoked",
            memberId: actor.memberId,
            effectiveAt: request.effectiveAt,
            futureAnalysisEnabled: false,
            priorAuthorizedEventsPreserved: true,
            auditEntryId,
          });

          await transaction.saveMember(updatedMember);
          await transaction.appendAuditEntry(auditEntry);
          await saveReplay(
            transaction,
            actor,
            "RevokeAnalysisConsent",
            request.idempotencyKey,
            hash,
            { kind: "revoke_analysis_consent", result },
          );

          return result;
        });
      });
    },

    exportMyData: async (actorInput, requestInput) => {
      const requestId = requestIdFrom(requestInput);

      return run(requestId, async () => {
        const request = parseBoundary(
          ExportMyDataRequestSchema,
          requestInput,
        );
        const actor = parseActor(actorInput);
        const hash = requestHash(request);

        return dependencies.store.transaction(async (transaction) => {
          const member = await requireActiveMember(transaction, actor);
          const replay = await getReplay(
            transaction,
            actor,
            "ExportMyData",
            request.idempotencyKey,
            hash,
          );

          if (replay !== null && replay.kind !== "export_personal_data") {
            return fail("internal_failure");
          }

          const exportId =
            replay?.kind === "export_personal_data"
              ? replay.exportId
              : newEntityId();
          const auditEntryId =
            replay?.kind === "export_personal_data"
              ? replay.auditEntryId
              : newEntityId();
          const generatedAt =
            replay?.kind === "export_personal_data"
              ? replay.generatedAt
              : now();
          const bundle = await buildExportBundle(
            transaction,
            actor,
            member,
            generatedAt,
          );
          const result = ExportMyDataResultSchema.parse({
            status: "exported",
            exportId,
            bundle,
            auditEntryId,
          });

          if (replay === null) {
            const auditEntry = AuditEntrySchema.parse({
              id: auditEntryId,
              spaceId: actor.spaceId,
              actor: actorReference(actor),
              action: "personal_data_exported",
              targetType: "export",
              targetId: exportId,
              beforeVersion: null,
              afterVersion: null,
              changes: [],
              visibility: { kind: "self", memberId: actor.memberId },
              occurredAt: generatedAt,
              retention: "until_space_deleted",
            });
            await transaction.appendAuditEntry(auditEntry);
            await saveReplay(
              transaction,
              actor,
              "ExportMyData",
              request.idempotencyKey,
              hash,
              {
                kind: "export_personal_data",
                exportId,
                auditEntryId,
                generatedAt,
              },
            );
          }

          return result;
        });
      });
    },

    deleteSpace: async (actorInput, requestInput) => {
      const requestId = requestIdFrom(requestInput);

      return run(requestId, async () => {
        const request = parseDeleteSpaceRequest(requestInput);
        const actor = parseActor(actorInput);

        return dependencies.store.transaction(async (transaction) => {
          await requireActiveMember(transaction, actor);
          const space = await transaction.getSpace(request.spaceId);

          if (
            request.spaceId !== actor.spaceId ||
            space?.spaceId !== actor.spaceId ||
            space.createdBy !== actor.memberId
          ) {
            return fail("not_found");
          }

          if (space.version !== request.expectedVersion) {
            return fail("stale_version");
          }

          if (
            space.status !== "active" ||
            space.name !== request.expectedSpaceName ||
            request.typedSpaceName !== space.name
          ) {
            return fail("deletion_confirmation_required");
          }

          const deletionReceiptId = newEntityId();
          const deletedAt = now();
          await transaction.deleteSpaceContent(actor.spaceId);

          if (await transaction.hasSpaceContent(actor.spaceId)) {
            return fail("internal_failure");
          }

          return DeleteSpaceResultSchema.parse({
            status: "deleted",
            deletionReceiptId,
            deletedAt,
            persistedAfterDeletion: false,
            containsProductContent: false,
          });
        });
      });
    },
  };
};
