import type {
  CorrectTaskAttributionRequest,
  EntityId,
  GetResponsibilityReportRequest,
  MemberActor,
  RequestHash,
} from "../../../packages/contracts/src/index";

import type {
  AttributionCorrectionCommand,
  CreateResponsibilityRequest,
  ResponsibilityCreationCommand,
  ResponsibilityDraftInput,
} from "./model";

export interface LoadResponsibilitySourceInput {
  readonly actorId: EntityId;
  readonly spaceId: EntityId;
  readonly sourceSignalId: EntityId;
}

/** Read-only source graph loader. Its result is validated before any mutation. */
export interface ResponsibilitySourcePort {
  load(input: LoadResponsibilitySourceInput): Promise<unknown>;
}

/** A draft is data only; it has no authority to write a domain or task. */
export interface ResponsibilityDraftPort {
  draft(input: ResponsibilityDraftInput): Promise<unknown>;
}

/**
 * Creates the source linkage, domain, and task atomically. Implementations must
 * return `replayed` for the same source signal and never create a second pair.
 */
export interface ResponsibilityPersistencePort {
  create(command: ResponsibilityCreationCommand): Promise<unknown>;
}

export interface LoadResponsibilityReportInput {
  readonly actor: MemberActor;
  readonly request: GetResponsibilityReportRequest;
}

/** Report loading is read-only and must return one consistent snapshot. */
export interface ResponsibilityReportPort {
  load(input: LoadResponsibilityReportInput): Promise<unknown>;
}

export interface ResolveAttributionCorrectionInput {
  readonly actor: MemberActor;
  readonly request: CorrectTaskAttributionRequest;
  readonly requestHash: RequestHash;
}

export interface LoadAttributionCorrectionInput {
  readonly actorId: EntityId;
  readonly spaceId: EntityId;
  readonly taskId: EntityId;
}

/**
 * Resolves replay before mutable reads, then commits task, audit, and replay
 * result atomically while rechecking the supplied version guard.
 */
export interface AttributionCorrectionPort {
  resolve(input: ResolveAttributionCorrectionInput): Promise<unknown>;
  load(input: LoadAttributionCorrectionInput): Promise<unknown>;
  commit(command: AttributionCorrectionCommand): Promise<unknown>;
}

export interface CreateResponsibilityInput {
  readonly actor: unknown;
  readonly request: CreateResponsibilityRequest;
}
