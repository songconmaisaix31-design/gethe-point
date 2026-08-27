import { z } from "zod";

import {
  EntityIdSchema,
  RedactedExcerptSchema,
  ShortTextSchema,
  TimestampSchema,
  type EntityId,
} from "../../../packages/contracts/src/index";

const uniqueIds = (minimum: number, maximum: number) =>
  z
    .array(EntityIdSchema)
    .min(minimum)
    .max(maximum)
    .superRefine((ids, context) => {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: "custom",
          message: "Identifiers must be unique.",
        });
      }
    });

export const DomainDraftSourceSchema = z.enum(["fixture", "validated_ai"]);
export type DomainDraftSource = z.infer<typeof DomainDraftSourceSchema>;

export const DomainDraftCandidateSchema = z.strictObject({
  proposedName: ShortTextSchema,
  proposedOwnerId: EntityIdSchema.nullable(),
  taskIds: uniqueIds(1, 50),
  evidenceIds: uniqueIds(1, 50),
  missingInfo: z.array(ShortTextSchema).max(20),
});
export type DomainDraftCandidate = z.infer<
  typeof DomainDraftCandidateSchema
>;

export const DomainDraftSchema = DomainDraftCandidateSchema.extend({
  id: EntityIdSchema,
  spaceId: EntityIdSchema,
  source: DomainDraftSourceSchema,
  promptVersion: z.string().trim().min(1).max(80),
  generatedAt: TimestampSchema,
});
export type DomainDraft = z.infer<typeof DomainDraftSchema>;

export const DomainDraftScopeSchema = z.strictObject({
  spaceId: EntityIdSchema,
  authorizedTaskIds: uniqueIds(1, 50),
  authorizedEvidenceIds: uniqueIds(1, 50),
  activeMemberIds: uniqueIds(1, 3),
});
export type DomainDraftScope = z.infer<typeof DomainDraftScopeSchema>;

export const DomainDraftProviderItemSchema = z.strictObject({
  taskId: EntityIdSchema,
  redactedConclusion: RedactedExcerptSchema,
  evidenceIds: uniqueIds(1, 20),
});

export const DomainDraftProviderInputSchema = z.strictObject({
  spaceId: EntityIdSchema,
  items: z.array(DomainDraftProviderItemSchema).min(1).max(50),
});
export type DomainDraftProviderInput = z.infer<
  typeof DomainDraftProviderInputSchema
>;

export interface DomainDraftProvider {
  proposeDomain(input: DomainDraftProviderInput): Promise<unknown>;
}

export type DomainDraftErrorCode =
  | "invalid_shape"
  | "space_mismatch"
  | "unauthorized_reference"
  | "provider_invalid_output"
  | "provider_unavailable";

export interface DomainDraftError extends Error {
  readonly code: DomainDraftErrorCode;
  readonly name: "DomainDraftError";
}

const SAFE_MESSAGES: Readonly<Record<DomainDraftErrorCode, string>> = {
  invalid_shape: "The domain draft is invalid.",
  provider_invalid_output: "The domain provider returned an invalid draft.",
  provider_unavailable: "The domain provider is unavailable.",
  space_mismatch: "The domain draft belongs to a different space.",
  unauthorized_reference: "The domain draft contains an unauthorized reference.",
};

const domainDraftError = (code: DomainDraftErrorCode): DomainDraftError =>
  Object.assign(new Error(SAFE_MESSAGES[code]), {
    code,
    name: "DomainDraftError" as const,
  });

export const isDomainDraftError = (error: unknown): error is DomainDraftError =>
  error instanceof Error && error.name === "DomainDraftError";

const isSubset = (
  values: readonly EntityId[],
  allowedValues: readonly EntityId[],
): boolean => {
  const allowed = new Set(allowedValues);
  return values.every((value) => allowed.has(value));
};

/**
 * Revalidates persisted or provider-created drafts against the caller's current
 * actor-visible scope. This check must run again immediately before confirmation.
 */
export const validateDomainDraft = (
  draftInput: unknown,
  scopeInput: unknown,
): DomainDraft => {
  const draft = DomainDraftSchema.safeParse(draftInput);
  const scope = DomainDraftScopeSchema.safeParse(scopeInput);

  if (!draft.success || !scope.success) {
    throw domainDraftError("invalid_shape");
  }

  if (draft.data.spaceId !== scope.data.spaceId) {
    throw domainDraftError("space_mismatch");
  }

  const ownerIsAuthorized =
    draft.data.proposedOwnerId === null ||
    scope.data.activeMemberIds.includes(draft.data.proposedOwnerId);

  if (
    !ownerIsAuthorized ||
    !isSubset(draft.data.taskIds, scope.data.authorizedTaskIds) ||
    !isSubset(draft.data.evidenceIds, scope.data.authorizedEvidenceIds)
  ) {
    throw domainDraftError("unauthorized_reference");
  }

  return draft.data;
};

export interface CreateValidatedAIDomainDraftInput {
  readonly provider: DomainDraftProvider;
  readonly providerInput: unknown;
  readonly scope: unknown;
  readonly metadata: Readonly<{
    id: EntityId;
    generatedAt: string;
    promptVersion: string;
  }>;
}

/**
 * Keeps untrusted model output behind a strict schema and labels only parsed
 * output as `validated_ai`. Provider errors are deliberately not surfaced.
 */
export const createValidatedAIDomainDraft = async ({
  metadata,
  provider,
  providerInput,
  scope,
}: CreateValidatedAIDomainDraftInput): Promise<DomainDraft> => {
  const parsedInput = DomainDraftProviderInputSchema.safeParse(providerInput);
  const parsedScope = DomainDraftScopeSchema.safeParse(scope);

  if (!parsedInput.success || !parsedScope.success) {
    throw domainDraftError("invalid_shape");
  }

  let rawCandidate: unknown;

  try {
    rawCandidate = await provider.proposeDomain(parsedInput.data);
  } catch {
    throw domainDraftError("provider_unavailable");
  }

  const candidate = DomainDraftCandidateSchema.safeParse(rawCandidate);

  if (!candidate.success) {
    throw domainDraftError("provider_invalid_output");
  }

  return validateDomainDraft(
    {
      ...candidate.data,
      ...metadata,
      source: "validated_ai",
      spaceId: parsedInput.data.spaceId,
    },
    parsedScope.data,
  );
};
