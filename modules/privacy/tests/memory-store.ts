/* eslint-disable @typescript-eslint/require-await -- The async port mirrors production persistence while this test adapter is synchronous. */

import type {
  AuditEntry,
  CareEvent,
  CareRule,
  Domain,
  EntityId,
  Handover,
  Member,
  PrivateMessage,
  SharedSignal,
  Space,
  Task,
} from "../../../packages/contracts/src/index";
import type {
  PrivacyIdempotencyRecord,
  PrivacyOperationName,
  PrivacyReadPort,
  PrivacyStore,
  PrivacyTransaction,
  StoredEvidenceRecord,
} from "../src/index";

export interface MemoryPrivacyState {
  spaces: Space[];
  members: Member[];
  privateMessages: PrivateMessage[];
  evidence: StoredEvidenceRecord[];
  signals: SharedSignal[];
  domains: Domain[];
  tasks: Task[];
  handovers: Handover[];
  careRules: CareRule[];
  careEvents: CareEvent[];
  auditEntries: AuditEntry[];
  idempotencyRecords: PrivacyIdempotencyRecord[];
}

const clone = <Value>(value: Value): Value => structuredClone(value);

const replaceById = <Record extends { readonly id: EntityId }>(
  records: Record[],
  replacement: Record,
): void => {
  const index = records.findIndex((record) => record.id === replacement.id);

  if (index === -1) {
    throw new Error("The in-memory privacy record does not exist.");
  }

  records[index] = clone(replacement);
};

class MemoryPrivacyPort implements PrivacyTransaction {
  public constructor(private readonly state: MemoryPrivacyState) {}

  public async getSpace(spaceId: EntityId): Promise<Space | null> {
    return clone(
      this.state.spaces.find((space) => space.id === spaceId) ?? null,
    );
  }

  public async getMember(
    spaceId: EntityId,
    memberId: EntityId,
  ): Promise<Member | null> {
    return clone(
      this.state.members.find(
        (member) => member.spaceId === spaceId && member.id === memberId,
      ) ?? null,
    );
  }

  public async getEvidence(
    spaceId: EntityId,
    evidenceId: EntityId,
  ): Promise<StoredEvidenceRecord | null> {
    return clone(
      this.state.evidence.find(
        (record) =>
          record.evidence.spaceId === spaceId &&
          record.evidence.id === evidenceId,
      ) ?? null,
    );
  }

  public async getSignal(
    spaceId: EntityId,
    signalId: EntityId,
  ): Promise<SharedSignal | null> {
    return clone(
      this.state.signals.find(
        (signal) => signal.spaceId === spaceId && signal.id === signalId,
      ) ?? null,
    );
  }

  public async listPrivateMessages(
    spaceId: EntityId,
  ): Promise<readonly PrivateMessage[]> {
    return clone(
      this.state.privateMessages.filter(
        (message) => message.spaceId === spaceId,
      ),
    );
  }

  public async listEvidence(
    spaceId: EntityId,
  ): Promise<readonly StoredEvidenceRecord[]> {
    return clone(
      this.state.evidence.filter(
        (record) => record.evidence.spaceId === spaceId,
      ),
    );
  }

  public async listSignals(
    spaceId: EntityId,
  ): Promise<readonly SharedSignal[]> {
    return clone(
      this.state.signals.filter((signal) => signal.spaceId === spaceId),
    );
  }

  public async listDomains(spaceId: EntityId): Promise<readonly Domain[]> {
    return clone(
      this.state.domains.filter((domain) => domain.spaceId === spaceId),
    );
  }

  public async listTasks(spaceId: EntityId): Promise<readonly Task[]> {
    return clone(this.state.tasks.filter((task) => task.spaceId === spaceId));
  }

  public async listHandovers(
    spaceId: EntityId,
  ): Promise<readonly Handover[]> {
    return clone(
      this.state.handovers.filter(
        (handover) => handover.spaceId === spaceId,
      ),
    );
  }

  public async listCareRules(spaceId: EntityId): Promise<readonly CareRule[]> {
    return clone(
      this.state.careRules.filter((rule) => rule.spaceId === spaceId),
    );
  }

  public async listCareEvents(
    spaceId: EntityId,
  ): Promise<readonly CareEvent[]> {
    return clone(
      this.state.careEvents.filter((event) => event.spaceId === spaceId),
    );
  }

  public async listAuditEntries(
    spaceId: EntityId,
  ): Promise<readonly AuditEntry[]> {
    return clone(
      this.state.auditEntries.filter((entry) => entry.spaceId === spaceId),
    );
  }

  public async getIdempotencyRecord(
    spaceId: EntityId,
    operation: PrivacyOperationName,
    actorMemberId: EntityId,
    idempotencyKey: string,
  ): Promise<PrivacyIdempotencyRecord | null> {
    return clone(
      this.state.idempotencyRecords.find(
        (record) =>
          record.spaceId === spaceId &&
          record.operation === operation &&
          record.actorMemberId === actorMemberId &&
          record.idempotencyKey === idempotencyKey,
      ) ?? null,
    );
  }

  public async saveMember(member: Member): Promise<void> {
    replaceById(this.state.members, member);
  }

  public async saveEvidence(record: StoredEvidenceRecord): Promise<void> {
    const index = this.state.evidence.findIndex(
      (item) => item.evidence.id === record.evidence.id,
    );

    if (index === -1) {
      throw new Error("The in-memory evidence record does not exist.");
    }

    this.state.evidence[index] = clone(record);
  }

  public async saveSignal(signal: SharedSignal): Promise<void> {
    replaceById(this.state.signals, signal);
  }

  public async saveTask(task: Task): Promise<void> {
    replaceById(this.state.tasks, task);
  }

  public async saveDomain(domain: Domain): Promise<void> {
    replaceById(this.state.domains, domain);
  }

  public async appendAuditEntry(entry: AuditEntry): Promise<void> {
    this.state.auditEntries.push(clone(entry));
  }

  public async saveIdempotencyRecord(
    record: PrivacyIdempotencyRecord,
  ): Promise<void> {
    const duplicate = this.state.idempotencyRecords.some(
      (item) =>
        item.spaceId === record.spaceId &&
        item.operation === record.operation &&
        item.actorMemberId === record.actorMemberId &&
        item.idempotencyKey === record.idempotencyKey,
    );

    if (duplicate) {
      throw new Error("The in-memory idempotency record already exists.");
    }

    this.state.idempotencyRecords.push(clone(record));
  }

  public async deleteSpaceContent(spaceId: EntityId): Promise<void> {
    this.state.spaces = this.state.spaces.filter(
      (space) => space.id !== spaceId,
    );
    this.state.members = this.state.members.filter(
      (member) => member.spaceId !== spaceId,
    );
    this.state.privateMessages = this.state.privateMessages.filter(
      (message) => message.spaceId !== spaceId,
    );
    this.state.evidence = this.state.evidence.filter(
      (record) => record.evidence.spaceId !== spaceId,
    );
    this.state.signals = this.state.signals.filter(
      (signal) => signal.spaceId !== spaceId,
    );
    this.state.domains = this.state.domains.filter(
      (domain) => domain.spaceId !== spaceId,
    );
    this.state.tasks = this.state.tasks.filter(
      (task) => task.spaceId !== spaceId,
    );
    this.state.handovers = this.state.handovers.filter(
      (handover) => handover.spaceId !== spaceId,
    );
    this.state.careRules = this.state.careRules.filter(
      (rule) => rule.spaceId !== spaceId,
    );
    this.state.careEvents = this.state.careEvents.filter(
      (event) => event.spaceId !== spaceId,
    );
    this.state.auditEntries = this.state.auditEntries.filter(
      (entry) => entry.spaceId !== spaceId,
    );
    this.state.idempotencyRecords = this.state.idempotencyRecords.filter(
      (record) => record.spaceId !== spaceId,
    );
  }

  public async hasSpaceContent(spaceId: EntityId): Promise<boolean> {
    return (
      this.state.spaces.some((space) => space.id === spaceId) ||
      this.state.members.some((member) => member.spaceId === spaceId) ||
      this.state.privateMessages.some(
        (message) => message.spaceId === spaceId,
      ) ||
      this.state.evidence.some(
        (record) => record.evidence.spaceId === spaceId,
      ) ||
      this.state.signals.some((signal) => signal.spaceId === spaceId) ||
      this.state.domains.some((domain) => domain.spaceId === spaceId) ||
      this.state.tasks.some((task) => task.spaceId === spaceId) ||
      this.state.handovers.some(
        (handover) => handover.spaceId === spaceId,
      ) ||
      this.state.careRules.some((rule) => rule.spaceId === spaceId) ||
      this.state.careEvents.some((event) => event.spaceId === spaceId) ||
      this.state.auditEntries.some((entry) => entry.spaceId === spaceId) ||
      this.state.idempotencyRecords.some(
        (record) => record.spaceId === spaceId,
      )
    );
  }
}

export class MemoryPrivacyStore implements PrivacyStore {
  private state: MemoryPrivacyState;
  private transactionTail: Promise<void> = Promise.resolve();

  public constructor(initialState: MemoryPrivacyState) {
    this.state = clone(initialState);
  }

  public async read<Result>(
    work: (port: PrivacyReadPort) => Promise<Result>,
  ): Promise<Result> {
    await this.transactionTail;
    return work(new MemoryPrivacyPort(clone(this.state)));
  }

  public async transaction<Result>(
    work: (transaction: PrivacyTransaction) => Promise<Result>,
  ): Promise<Result> {
    let release: (() => void) | undefined;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      const draft = clone(this.state);
      const result = await work(new MemoryPrivacyPort(draft));
      this.state = draft;
      return result;
    } finally {
      release?.();
    }
  }

  public async snapshot(): Promise<MemoryPrivacyState> {
    await this.transactionTail;
    return clone(this.state);
  }
}
