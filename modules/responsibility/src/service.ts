import { randomUUID } from "node:crypto";

import {
  GetResponsibilityReportRequestSchema,
  MemberActorSchema,
  type GetResponsibilityReportRequest,
  type GetResponsibilityReportResult,
  type MemberActor,
} from "../../../packages/contracts/src/index";
import {
  correctTaskAttribution,
  type AttributionCorrectionRepository,
} from "./correction";
import {
  confirmDomainGrouping,
  type DomainGroupingRepository,
} from "./domain-grouping";
import { responsibilityError } from "./errors";
import { buildResponsibilityReport } from "./report";

export interface ResponsibilityRepository
  extends AttributionCorrectionRepository,
    DomainGroupingRepository {
  loadResponsibilityReportDataset(input: Readonly<{
    actor: MemberActor;
    request: GetResponsibilityReportRequest;
  }>): Promise<unknown>;
}

export interface ResponsibilityServiceDependencies {
  readonly repository: ResponsibilityRepository;
  readonly now?: () => unknown;
  readonly createId?: () => unknown;
}

export interface ResponsibilityService {
  correctTaskAttribution(
    actor: unknown,
    request: unknown,
  ): ReturnType<typeof correctTaskAttribution>;
  confirmDomainGrouping(
    actor: unknown,
    request: unknown,
  ): ReturnType<typeof confirmDomainGrouping>;
  getResponsibilityReport(
    actor: unknown,
    request: unknown,
  ): Promise<GetResponsibilityReportResult>;
}

/**
 * Exposes one integration boundary while keeping time and identifiers injectable
 * for deterministic tests and replay-safe adapters.
 */
export const createResponsibilityService = ({
  createId = randomUUID,
  now = () => new Date().toISOString(),
  repository,
}: ResponsibilityServiceDependencies): ResponsibilityService => ({
  correctTaskAttribution: (actor, request) =>
    correctTaskAttribution({ actor, request, repository, now, createId }),
  confirmDomainGrouping: (actor, request) =>
    confirmDomainGrouping({ actor, request, repository }),
  getResponsibilityReport: async (actorInput, requestInput) => {
    const actor = MemberActorSchema.safeParse(actorInput);
    const request = GetResponsibilityReportRequestSchema.safeParse(requestInput);

    if (!actor.success || !request.success) {
      throw responsibilityError("invalid_request");
    }

    if (actor.data.spaceId !== request.data.spaceId) {
      throw responsibilityError("forbidden");
    }

    const dataset = await repository.loadResponsibilityReportDataset({
      actor: actor.data,
      request: request.data,
    });

    if (dataset === null) {
      throw responsibilityError("not_found");
    }

    return buildResponsibilityReport({
      actor: actor.data,
      request: request.data,
      dataset,
      generatedAt: now(),
    }).result;
  },
});
