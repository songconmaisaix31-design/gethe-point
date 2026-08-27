import type {
  AuditEntry,
  CareEvent,
  CareRule,
  Clock,
  DeleteEvidenceResult,
  Domain,
  EntityId,
  Evidence,
  ExportMyDataResult,
  Handover,
  IdempotencyKey,
  Member,
  PrivateMessage,
  RevokeAnalysisConsentResult,
  SharedSignal,
  Space,
  Task,
  Timestamp,
} from "../../../packages/contracts/src/index";

export interface StoredEvidenceRecord {
  readonly evidence: Evidence;
  readonly rawContent: string | null;
}

export type PrivacyOperationName =
  | "DeleteEvidence"
  | "RevokeAnalysisConsent"
  | "ExportMyData";

export type PrivacyReplayPayload =
  | Readonly<{
      kind: "delete_evidence";
      result: DeleteEvidenceResult;
    }>
  | Readonly<{
      kind: "revoke_analysis_consent";
      result: RevokeAnalysisConsentResult;
    }>
  | Readonly<{
      kind: "export_personal_data";
      exportId: ExportMyDataResult["exportId"];
      auditEntryId: ExportMyDataResult["auditEntryId"];
      generatedAt: Timestamp;
    }>;

export interface PrivacyIdempotencyRecord {
  readonly spaceId: EntityId;
  readonly operation: PrivacyOperationName;
  readonly actorMemberId: EntityId;
  readonly idempotencyKey: IdempotencyKey;
  readonly requestHash: string;
  readonly replay: PrivacyReplayPayload;
}

export interface PrivacyReadPort {
  getSpace(spaceId: EntityId): Promise<Space | null>;
  getMember(spaceId: EntityId, memberId: EntityId): Promise<Member | null>;
  getEvidence(
    spaceId: EntityId,
    evidenceId: EntityId,
  ): Promise<StoredEvidenceRecord | null>;
  getSignal(
    spaceId: EntityId,
    signalId: EntityId,
  ): Promise<SharedSignal | null>;
  listPrivateMessages(spaceId: EntityId): Promise<readonly PrivateMessage[]>;
  listEvidence(spaceId: EntityId): Promise<readonly StoredEvidenceRecord[]>;
  listSignals(spaceId: EntityId): Promise<readonly SharedSignal[]>;
  listDomains(spaceId: EntityId): Promise<readonly Domain[]>;
  listTasks(spaceId: EntityId): Promise<readonly Task[]>;
  listHandovers(spaceId: EntityId): Promise<readonly Handover[]>;
  listCareRules(spaceId: EntityId): Promise<readonly CareRule[]>;
  listCareEvents(spaceId: EntityId): Promise<readonly CareEvent[]>;
  listAuditEntries(spaceId: EntityId): Promise<readonly AuditEntry[]>;
  getIdempotencyRecord(
    spaceId: EntityId,
    operation: PrivacyOperationName,
    actorMemberId: EntityId,
    idempotencyKey: IdempotencyKey,
  ): Promise<PrivacyIdempotencyRecord | null>;
}

export interface PrivacyTransaction extends PrivacyReadPort {
  saveMember(member: Member): Promise<void>;
  saveEvidence(record: StoredEvidenceRecord): Promise<void>;
  saveSignal(signal: SharedSignal): Promise<void>;
  saveTask(task: Task): Promise<void>;
  saveDomain(domain: Domain): Promise<void>;
  appendAuditEntry(entry: AuditEntry): Promise<void>;
  saveIdempotencyRecord(record: PrivacyIdempotencyRecord): Promise<void>;
  deleteSpaceContent(spaceId: EntityId): Promise<void>;
  hasSpaceContent(spaceId: EntityId): Promise<boolean>;
}

export interface PrivacyStore {
  read<Result>(
    work: (port: PrivacyReadPort) => Promise<Result>,
  ): Promise<Result>;
  transaction<Result>(
    work: (transaction: PrivacyTransaction) => Promise<Result>,
  ): Promise<Result>;
}

export interface PrivacyServiceDependencies {
  readonly store: PrivacyStore;
  readonly clock: Clock;
  readonly idFactory: () => EntityId;
}
