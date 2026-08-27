import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  DomainSchema,
  EntityIdSchema,
  IdempotencyKeySchema,
  MemberActorSchema,
  MemberSchema,
  RecordVersionSchema,
  RequestIdSchema,
  SharedSignalSchema,
  SharedVisibilitySchema,
  ShortTextSchema,
  SignalDraftKindSchema,
  SpaceSchema,
  TaskSchema,
  TimestampSchema,
  type Clock,
  type Domain,
  type LLMProvider,
  type LLMProviderFailure,
  type LLMProviderRequest,
  type Member,
  type MemberActor,
  type SharedVisibility,
  type Task,
} from "../../../packages/contracts/src/index";

import {
  PersistedEvidenceSnapshotSchema,
  VersionGuardEntrySchema,
  type VersionGuardEntry,
} from "../../responsibility/src/model";
import {
  canMemberReadVisibility,
  sharedVisibilitiesMatch,
} from "../../responsibility/src/visibility";

const MAX_PROVIDER_INPUT_BYTES = 8_000;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;
const STRUCTURED_IDENTIFIER_PATTERN =
  /\b(?:space|member|task|signal|evidence|domain)(?:_|\s|-)?id\b|\braw(?:_|\s|-)?(?:ref|content)\b/iu;

const uniqueVersionReferences = (
  references: readonly Readonly<{ id: string }>[],
): boolean => new Set(references.map(({ id }) => id)).size === references.length;

const BoundedVersionReferencesSchema = (maximum: number) =>
  z
    .array(VersionGuardEntrySchema)
    .min(1)
    .max(maximum)
    .refine(uniqueVersionReferences, "References must be unique.");

export const DomainSuggestionRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  spaceId: EntityIdSchema,
  expectedSpaceVersion: RecordVersionSchema,
  expectedActorVersion: RecordVersionSchema,
  tasks: BoundedVersionReferencesSchema(20),
  signals: BoundedVersionReferencesSchema(20),
  evidence: BoundedVersionReferencesSchema(50),
  promptVersion: z.string().trim().min(1).max(80),
  timeoutMs: z.number().int().min(100).max(10_000),
});
export type DomainSuggestionRequest = z.infer<
  typeof DomainSuggestionRequestSchema
>;

export const DomainSuggestionOutputSchema = z.strictObject({
  name: ShortTextSchema,
  nextAction: ShortTextSchema.nullable(),
});
export type DomainSuggestionOutput = z.infer<
  typeof DomainSuggestionOutputSchema
>;

export const DOMAIN_SUGGESTION_OUTPUT_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["name", "nextAction"],
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 160,
    },
    nextAction: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 160 },
        { type: "null" },
      ],
    },
  },
} as const);

const DomainSuggestionSignalRecordSchema = z.strictObject({
  signal: SharedSignalSchema,
  sourceKind: SignalDraftKindSchema,
});
type DomainSuggestionSignalRecord = z.infer<
  typeof DomainSuggestionSignalRecordSchema
>;

export const DomainSuggestionContextSchema = z.strictObject({
  space: SpaceSchema,
  actorMember: MemberSchema,
  members: z.array(MemberSchema).min(1).max(3),
  tasks: z.array(TaskSchema).min(1).max(20),
  signals: z.array(DomainSuggestionSignalRecordSchema).min(1).max(20),
  evidence: z.array(PersistedEvidenceSnapshotSchema).min(1).max(50),
});
export type DomainSuggestionContext = z.infer<
  typeof DomainSuggestionContextSchema
>;

export const DomainSuggestionGuardSchema = z.strictObject({
  space: VersionGuardEntrySchema,
  actorMember: VersionGuardEntrySchema,
  members: z.array(VersionGuardEntrySchema).min(1).max(3),
  tasks: z.array(VersionGuardEntrySchema).min(1).max(20),
  signals: z.array(VersionGuardEntrySchema).min(1).max(20),
  evidence: z.array(VersionGuardEntrySchema).min(1).max(50),
});
export type DomainSuggestionGuard = z.infer<
  typeof DomainSuggestionGuardSchema
>;

const DomainSuggestionMetadataSchema = z.strictObject({
  requestId: RequestIdSchema,
  purpose: z.literal("domain_draft"),
  promptVersion: z.string().trim().min(1).max(80),
  attempts: z.union([z.literal(1), z.literal(2)]),
  providerOutcome: z.enum([
    "validated",
    "invalid_output",
    "timeout",
    "unavailable",
  ]),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  contentLogged: z.literal(false),
});
export type DomainSuggestionMetadata = z.infer<
  typeof DomainSuggestionMetadataSchema
>;

export const DomainSuggestionDraftSchema = z.strictObject({
  id: EntityIdSchema,
  spaceId: EntityIdSchema,
  requestedByMemberId: EntityIdSchema,
  name: ShortTextSchema,
  nextAction: ShortTextSchema.nullable(),
  visibility: SharedVisibilitySchema,
  evidenceIds: z.array(EntityIdSchema).min(1).max(50),
  guard: DomainSuggestionGuardSchema,
  promptVersion: z.string().trim().min(1).max(80),
  createdAt: TimestampSchema,
  source: z.literal("validated_ai"),
  status: z.literal("awaiting_human_confirmation"),
  metadata: DomainSuggestionMetadataSchema,
});
export type DomainSuggestionDraft = z.infer<
  typeof DomainSuggestionDraftSchema
>;

export const DomainSuggestionReviewSchema = z.strictObject({
  status: z.literal("needs_human_review"),
  reason: z.enum([
    "provider_invalid_output",
    "provider_timeout",
    "provider_unavailable",
    "authorization_changed",
    "evidence_changed",
    "version_changed",
  ]),
  attempts: z.union([z.literal(1), z.literal(2)]),
  consequentialMutationAllowed: z.literal(false),
  metadata: DomainSuggestionMetadataSchema,
});
export type DomainSuggestionReview = z.infer<
  typeof DomainSuggestionReviewSchema
>;

export const ConfirmDomainSuggestionRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  suggestion: DomainSuggestionDraftSchema,
  confirmedByHuman: z.literal(true),
});
export type ConfirmDomainSuggestionRequest = z.infer<
  typeof ConfirmDomainSuggestionRequestSchema
>;

const RevalidationResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("current") }),
  z.strictObject({
    status: z.enum([
      "authorization_changed",
      "evidence_changed",
      "version_changed",
    ]),
  }),
]);
type RevalidationResult = z.infer<typeof RevalidationResultSchema>;

const PersistDomainResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.enum(["persisted", "replayed"]),
    domain: DomainSchema,
  }),
  z.strictObject({
    status: z.enum([
      "authorization_changed",
      "evidence_changed",
      "version_changed",
      "idempotency_conflict",
      "conflict",
    ]),
  }),
]);

const ProviderResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    completion: z.strictObject({
      output: z.unknown(),
      latencyMs: z.number().int().nonnegative(),
      usage: z.strictObject({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      }),
    }),
  }),
  z.strictObject({
    status: z.literal("failed"),
    failure: z.strictObject({
      code: z.enum([
        "provider_timeout",
        "provider_invalid_output",
        "provider_unavailable",
      ]),
      retryable: z.boolean(),
    }),
  }),
]);

export type DomainSuggestionFailureCode =
  | "invalid_request"
  | "unauthenticated"
  | "not_found"
  | "stale_version"
  | "evidence_missing"
  | "ineligible_fact"
  | "visibility_mismatch"
  | "idempotency_conflict"
  | "conflict"
  | "internal_failure";

export interface DomainSuggestionFailure {
  readonly code: DomainSuggestionFailureCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type DomainSuggestionResult<Result> =
  | Readonly<{ ok: true; result: Result }>
  | Readonly<{ ok: false; error: DomainSuggestionFailure }>;

const SAFE_MESSAGES: Readonly<Record<DomainSuggestionFailureCode, string>> = {
  invalid_request: "The domain suggestion request is invalid.",
  unauthenticated: "A valid member actor is required.",
  not_found: "The requested domain suggestion context is unavailable.",
  stale_version: "The domain suggestion context has changed.",
  evidence_missing: "Current authorized evidence is required.",
  ineligible_fact: "Only current responsibility facts may be suggested.",
  visibility_mismatch: "The selected facts do not share one safe visibility scope.",
  idempotency_conflict: "The idempotency key belongs to a different request.",
  conflict: "The domain suggestion conflicts with current state.",
  internal_failure: "The domain suggestion operation failed.",
};

const fail = <Result>(
  code: DomainSuggestionFailureCode,
): DomainSuggestionResult<Result> => ({
  ok: false,
  error: {
    code,
    message: SAFE_MESSAGES[code],
    retryable: code === "internal_failure",
  },
});

export interface LoadDomainSuggestionContextInput {
  readonly actor: MemberActor;
  readonly spaceId: string;
  readonly taskIds: readonly string[];
  readonly signalIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface RevalidateDomainSuggestionInput {
  readonly actor: MemberActor;
  readonly guard: DomainSuggestionGuard;
}

export interface PersistConfirmedDomainInput {
  readonly actor: MemberActor;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly guard: DomainSuggestionGuard;
  readonly domain: Domain;
  readonly confirmedByMemberId: string;
}

/**
 * Revalidation and persistence implementations must compare the complete guard
 * inside the same transaction as the domain insert.
 */
export interface DomainSuggestionRepository {
  loadDomainSuggestionContext(
    input: LoadDomainSuggestionContextInput,
  ): Promise<unknown>;
  revalidateDomainSuggestionContext(
    input: RevalidateDomainSuggestionInput,
  ): Promise<unknown>;
  persistConfirmedDomain(input: PersistConfirmedDomainInput): Promise<unknown>;
}

export interface DomainSuggestionServiceDependencies {
  readonly repository: DomainSuggestionRepository;
  readonly provider: LLMProvider;
  readonly clock: Clock;
  readonly createId?: () => string;
}

type ExpectedDomainContext = Readonly<{
  space: VersionGuardEntry;
  actorMember: VersionGuardEntry;
  members?: readonly VersionGuardEntry[];
  tasks: readonly VersionGuardEntry[];
  signals: readonly VersionGuardEntry[];
  evidence: readonly VersionGuardEntry[];
}>;

type ValidatedDomainContext = Readonly<{
  context: DomainSuggestionContext;
  visibility: SharedVisibility;
  guard: DomainSuggestionGuard;
}>;

const sameIds = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
};

const referencesMatch = (
  references: readonly VersionGuardEntry[],
  records: readonly Readonly<{ id: string; version: number }>[],
): boolean => {
  if (
    !uniqueVersionReferences(references) ||
    !uniqueVersionReferences(records) ||
    references.length !== records.length
  ) {
    return false;
  }

  const versions = new Map(records.map(({ id, version }) => [id, version]));
  return references.every(({ id, version }) => versions.get(id) === version);
};

const sortedVersionEntries = (
  records: readonly Readonly<{ id: string; version: number }>[],
): readonly VersionGuardEntry[] =>
  records
    .map(({ id, version }) => ({ id, version }))
    .sort((left, right) => left.id.localeCompare(right.id));

const allInSpace = (
  spaceId: string,
  records: readonly Readonly<{ spaceId: string }>[],
): boolean => records.every((record) => record.spaceId === spaceId);

const currentMemberIds = (members: readonly Member[]): ReadonlySet<string> =>
  new Set(
    members
      .filter(({ status }) => status === "active")
      .map(({ id }) => id),
  );

const taskAttributionMemberIds = (task: Task): readonly (string | null)[] => [
  task.discoveredBy,
  task.deadlineKeptBy,
  task.scheduledBy,
  task.executedBy,
  task.followedUpBy,
];

const safeRedactedExcerpt = (excerpt: string): boolean =>
  !UUID_PATTERN.test(excerpt) && !STRUCTURED_IDENTIFIER_PATTERN.test(excerpt);

const providerInput = (
  signals: readonly DomainSuggestionSignalRecord[],
): string =>
  JSON.stringify({
    facts: signals.map(({ signal }, index) => ({
      fact: index + 1,
      text: signal.redactedExcerpt,
    })),
  });

const evidenceUnion = (
  tasks: readonly Task[],
  signals: readonly DomainSuggestionSignalRecord[],
): readonly string[] => [
  ...new Set([
    ...tasks.flatMap(({ evidenceIds }) => evidenceIds),
    ...signals.flatMap(({ signal }) =>
      signal.provenance.map(({ evidenceId }) => evidenceId),
    ),
  ]),
];

const signalSupportsTask = (
  task: Task,
  record: DomainSuggestionSignalRecord,
): boolean => {
  const signalEvidenceIds = new Set(
    record.signal.provenance.map(({ evidenceId }) => evidenceId),
  );
  return task.evidenceIds.some((id) => signalEvidenceIds.has(id));
};

const validateContext = (
  rawContext: unknown,
  actor: MemberActor,
  expected: ExpectedDomainContext,
):
  | Readonly<{ ok: true; value: ValidatedDomainContext }>
  | Readonly<{ ok: false; code: DomainSuggestionFailureCode }> => {
  const parsed = DomainSuggestionContextSchema.safeParse(rawContext);
  if (!parsed.success) {
    return { ok: false, code: "internal_failure" };
  }

  const context = parsed.data;
  const scopedRecords = [
    context.actorMember,
    ...context.members,
    ...context.tasks,
    ...context.signals.map(({ signal }) => signal),
    ...context.evidence,
  ];
  if (
    context.space.id !== actor.spaceId ||
    context.space.status !== "active" ||
    context.actorMember.id !== actor.memberId ||
    context.actorMember.role !== actor.role ||
    context.actorMember.status !== "active" ||
    context.actorMember.analysisConsent !== "enabled" ||
    !allInSpace(actor.spaceId, scopedRecords) ||
    !context.members.some(({ id }) => id === actor.memberId) ||
    !uniqueVersionReferences(context.members) ||
    !uniqueVersionReferences(context.tasks) ||
    !uniqueVersionReferences(context.signals.map(({ signal }) => signal)) ||
    !uniqueVersionReferences(context.evidence)
  ) {
    return { ok: false, code: "not_found" };
  }

  if (
    context.space.version !== expected.space.version ||
    context.actorMember.version !== expected.actorMember.version ||
    !referencesMatch(expected.tasks, context.tasks) ||
    !referencesMatch(
      expected.signals,
      context.signals.map(({ signal }) => signal),
    ) ||
    !referencesMatch(expected.evidence, context.evidence) ||
    (expected.members !== undefined &&
      !referencesMatch(expected.members, context.members))
  ) {
    return { ok: false, code: "stale_version" };
  }

  const memberIds = currentMemberIds(context.members);
  if (
    context.tasks.some(
      (task) =>
        task.status === "cancelled" ||
        task.reviewState !== "current" ||
        !canMemberReadVisibility(actor, task.visibility) ||
        taskAttributionMemberIds(task).some(
          (memberId) => memberId !== null && !memberIds.has(memberId),
        ),
    ) ||
    context.signals.some(
      ({ signal, sourceKind }) =>
        sourceKind !== "potential_task" ||
        signal.purpose !== "responsibility" ||
        !canMemberReadVisibility(actor, signal.visibility),
    )
  ) {
    return { ok: false, code: "ineligible_fact" };
  }

  const evidenceById = new Map(
    context.evidence.map((evidence) => [evidence.id, evidence]),
  );
  if (
    context.evidence.some(
      ({ speakerId, state }) => state !== "available" || !memberIds.has(speakerId),
    ) ||
    context.tasks.some(({ evidenceIds }) =>
      evidenceIds.some((id) => evidenceById.get(id)?.state !== "available"),
    ) ||
    context.signals.some(({ signal }) =>
      signal.evidenceState !== "available" ||
      signal.provenance.some(
        ({ evidenceId, state }) =>
          state !== "available" || evidenceById.get(evidenceId)?.state !== "available",
      ),
    )
  ) {
    return { ok: false, code: "evidence_missing" };
  }

  if (
    !sameIds(
      expected.evidence.map(({ id }) => id),
      evidenceUnion(context.tasks, context.signals),
    ) ||
    context.tasks.some(
      (task) => !context.signals.some((signal) => signalSupportsTask(task, signal)),
    )
  ) {
    return { ok: false, code: "not_found" };
  }

  const visibility = context.signals[0]?.signal.visibility;
  if (
    visibility === undefined ||
    context.tasks.some(
      ({ visibility: taskVisibility }) =>
        !sharedVisibilitiesMatch(visibility, taskVisibility),
    ) ||
    context.signals.some(
      ({ signal }) => !sharedVisibilitiesMatch(visibility, signal.visibility),
    )
  ) {
    return { ok: false, code: "visibility_mismatch" };
  }

  if (
    context.signals.some(({ signal }) => !safeRedactedExcerpt(signal.redactedExcerpt))
  ) {
    return { ok: false, code: "ineligible_fact" };
  }

  const redactedInput = providerInput(context.signals);
  if (new TextEncoder().encode(redactedInput).byteLength > MAX_PROVIDER_INPUT_BYTES) {
    return { ok: false, code: "invalid_request" };
  }

  return {
    ok: true,
    value: {
      context,
      visibility,
      guard: DomainSuggestionGuardSchema.parse({
        space: { id: context.space.id, version: context.space.version },
        actorMember: {
          id: context.actorMember.id,
          version: context.actorMember.version,
        },
        members: sortedVersionEntries(context.members),
        tasks: sortedVersionEntries(context.tasks),
        signals: sortedVersionEntries(
          context.signals.map(({ signal }) => signal),
        ),
        evidence: sortedVersionEntries(context.evidence),
      }),
    },
  };
};

type ProviderAttempt =
  | Readonly<{
      status: "validated";
      output: DomainSuggestionOutput;
      latencyMs: number;
      inputTokens: number;
      outputTokens: number;
    }>
  | Readonly<{
      status: "failed";
      reason: LLMProviderFailure["code"];
      latencyMs: number;
      inputTokens: number;
      outputTokens: number;
    }>;

const callProviderWithTimeout = async (
  provider: LLMProvider,
  request: LLMProviderRequest,
): Promise<unknown> => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<unknown>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve({
        status: "failed",
        failure: { code: "provider_timeout", retryable: true },
      });
    }, request.timeoutMs);
  });
  const providerResult = provider
    .complete(request, controller.signal)
    .catch((): unknown => ({
      status: "failed",
      failure: { code: "provider_unavailable", retryable: true },
    }));

  try {
    return await Promise.race([providerResult, timeoutResult]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
};

const runProviderAttempt = async (
  provider: LLMProvider,
  request: LLMProviderRequest,
): Promise<ProviderAttempt> => {
  const parsed = ProviderResultSchema.safeParse(
    await callProviderWithTimeout(provider, request),
  );
  if (!parsed.success) {
    return {
      status: "failed",
      reason: "provider_invalid_output",
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  if (parsed.data.status === "failed") {
    return {
      status: "failed",
      reason: parsed.data.failure.code,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const output = DomainSuggestionOutputSchema.safeParse(
    parsed.data.completion.output,
  );
  if (!output.success) {
    return {
      status: "failed",
      reason: "provider_invalid_output",
      latencyMs: parsed.data.completion.latencyMs,
      inputTokens: parsed.data.completion.usage.inputTokens,
      outputTokens: parsed.data.completion.usage.outputTokens,
    };
  }

  return {
    status: "validated",
    output: output.data,
    latencyMs: parsed.data.completion.latencyMs,
    inputTokens: parsed.data.completion.usage.inputTokens,
    outputTokens: parsed.data.completion.usage.outputTokens,
  };
};

const providerOutcome = (
  reason: LLMProviderFailure["code"],
): DomainSuggestionMetadata["providerOutcome"] => {
  switch (reason) {
    case "provider_invalid_output":
      return "invalid_output";
    case "provider_timeout":
      return "timeout";
    case "provider_unavailable":
      return "unavailable";
  }
};

const reviewReason = (
  reason: LLMProviderFailure["code"],
): DomainSuggestionReview["reason"] => reason;

const contextReviewReason = (
  status: Exclude<RevalidationResult["status"], "current">,
): DomainSuggestionReview["reason"] => status;

const createMetadata = (
  request: Pick<DomainSuggestionRequest, "requestId" | "promptVersion">,
  attempts: 1 | 2,
  outcome: DomainSuggestionMetadata["providerOutcome"],
  totals: Readonly<{
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
  }>,
): DomainSuggestionMetadata =>
  DomainSuggestionMetadataSchema.parse({
    requestId: request.requestId,
    purpose: "domain_draft",
    promptVersion: request.promptVersion,
    attempts,
    providerOutcome: outcome,
    latencyMs: totals.latencyMs,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    contentLogged: false,
  });

const expectedFromRequest = (
  actor: MemberActor,
  request: DomainSuggestionRequest,
): ExpectedDomainContext => ({
  space: { id: request.spaceId, version: request.expectedSpaceVersion },
  actorMember: { id: actor.memberId, version: request.expectedActorVersion },
  tasks: request.tasks,
  signals: request.signals,
  evidence: request.evidence,
});

const expectedFromDraft = (
  draft: DomainSuggestionDraft,
): ExpectedDomainContext => ({
  ...draft.guard,
});

const loadInput = (
  actor: MemberActor,
  expected: ExpectedDomainContext,
): LoadDomainSuggestionContextInput => ({
  actor,
  spaceId: expected.space.id,
  taskIds: expected.tasks.map(({ id }) => id),
  signalIds: expected.signals.map(({ id }) => id),
  evidenceIds: expected.evidence.map(({ id }) => id),
});

const revalidate = async (
  repository: DomainSuggestionRepository,
  actor: MemberActor,
  guard: DomainSuggestionGuard,
): Promise<RevalidationResult | undefined> => {
  try {
    const result = RevalidationResultSchema.safeParse(
      await repository.revalidateDomainSuggestionContext({ actor, guard }),
    );
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
};

const loadAndValidate = async (
  repository: DomainSuggestionRepository,
  actor: MemberActor,
  expected: ExpectedDomainContext,
): Promise<
  | Readonly<{ ok: true; value: ValidatedDomainContext }>
  | Readonly<{ ok: false; code: DomainSuggestionFailureCode }>
> => {
  let rawContext: unknown;
  try {
    rawContext = await repository.loadDomainSuggestionContext(
      loadInput(actor, expected),
    );
  } catch {
    return { ok: false, code: "internal_failure" };
  }
  return validateContext(rawContext, actor, expected);
};

const mutationFailure = (
  status:
    | "authorization_changed"
    | "evidence_changed"
    | "version_changed"
    | "idempotency_conflict"
    | "conflict",
): DomainSuggestionFailureCode => {
  switch (status) {
    case "authorization_changed":
      return "not_found";
    case "evidence_changed":
      return "evidence_missing";
    case "version_changed":
      return "stale_version";
    case "conflict":
    case "idempotency_conflict":
      return status;
  }
};

const persistedDomainMatches = (
  domain: Domain,
  suggestion: DomainSuggestionDraft,
): boolean =>
  domain.id === suggestion.id &&
  domain.spaceId === suggestion.spaceId &&
  domain.name === suggestion.name &&
  domain.nextAction === suggestion.nextAction &&
  domain.ownerId === null &&
  domain.status === "active" &&
  domain.version === 0 &&
  sameIds(domain.evidenceIds, suggestion.evidenceIds) &&
  sharedVisibilitiesMatch(domain.visibility, suggestion.visibility);

/**
 * Creates a two-stage AI boundary: drafting never persists, while confirmation
 * requires a current version guard and an explicit human command.
 */
export const createDomainSuggestionService = (
  dependencies: DomainSuggestionServiceDependencies,
) => {
  const createId = dependencies.createId ?? randomUUID;

  const draftDomainSuggestion = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<
    DomainSuggestionResult<DomainSuggestionDraft | DomainSuggestionReview>
  > => {
    const actorResult = MemberActorSchema.safeParse(actorInput);
    if (!actorResult.success) {
      return fail("unauthenticated");
    }

    const requestResult = DomainSuggestionRequestSchema.safeParse(requestInput);
    if (!requestResult.success) {
      return fail("invalid_request");
    }

    const actor = actorResult.data;
    const request = requestResult.data;
    if (actor.spaceId !== request.spaceId) {
      return fail("not_found");
    }

    const contextResult = await loadAndValidate(
      dependencies.repository,
      actor,
      expectedFromRequest(actor, request),
    );
    if (!contextResult.ok) {
      return fail(contextResult.code);
    }

    const redactedInput = providerInput(contextResult.value.context.signals);
    const totals = { latencyMs: 0, inputTokens: 0, outputTokens: 0 };
    let validatedOutput: DomainSuggestionOutput | undefined;
    let lastFailure: LLMProviderFailure["code"] = "provider_unavailable";
    let attempts: 1 | 2 = 1;

    for (const attempt of [1, 2] as const) {
      attempts = attempt;
      const providerRequest: LLMProviderRequest = {
        requestId: request.requestId,
        purpose: "domain_draft",
        promptVersion: request.promptVersion,
        redactedInput,
        outputSchema: DOMAIN_SUGGESTION_OUTPUT_JSON_SCHEMA,
        timeoutMs: request.timeoutMs,
        attempt,
      };
      const result = await runProviderAttempt(
        dependencies.provider,
        providerRequest,
      );
      totals.latencyMs += result.latencyMs;
      totals.inputTokens += result.inputTokens;
      totals.outputTokens += result.outputTokens;
      if (result.status === "validated") {
        validatedOutput = result.output;
        break;
      }
      lastFailure = result.reason;
    }

    if (validatedOutput === undefined) {
      return {
        ok: true,
        result: DomainSuggestionReviewSchema.parse({
          status: "needs_human_review",
          reason: reviewReason(lastFailure),
          attempts,
          consequentialMutationAllowed: false,
          metadata: createMetadata(
            request,
            attempts,
            providerOutcome(lastFailure),
            totals,
          ),
        }),
      };
    }

    const current = await revalidate(
      dependencies.repository,
      actor,
      contextResult.value.guard,
    );
    if (current === undefined) {
      return fail("internal_failure");
    }

    const metadata = createMetadata(
      request,
      attempts,
      "validated",
      totals,
    );
    if (current.status !== "current") {
      return {
        ok: true,
        result: DomainSuggestionReviewSchema.parse({
          status: "needs_human_review",
          reason: contextReviewReason(current.status),
          attempts,
          consequentialMutationAllowed: false,
          metadata,
        }),
      };
    }

    const id = createId();
    if (!EntityIdSchema.safeParse(id).success) {
      return fail("internal_failure");
    }

    let createdAt: string;
    try {
      createdAt = dependencies.clock.now().toISOString();
    } catch {
      return fail("internal_failure");
    }

    return {
      ok: true,
      result: DomainSuggestionDraftSchema.parse({
        id,
        spaceId: actor.spaceId,
        requestedByMemberId: actor.memberId,
        name: validatedOutput.name,
        nextAction: validatedOutput.nextAction,
        visibility: contextResult.value.visibility,
        evidenceIds: contextResult.value.guard.evidence.map(({ id: evidenceId }) =>
          evidenceId,
        ),
        guard: contextResult.value.guard,
        promptVersion: request.promptVersion,
        createdAt,
        source: "validated_ai",
        status: "awaiting_human_confirmation",
        metadata,
      }),
    };
  };

  const confirmDomainSuggestion = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<DomainSuggestionResult<Domain>> => {
    const actorResult = MemberActorSchema.safeParse(actorInput);
    if (!actorResult.success) {
      return fail("unauthenticated");
    }

    const requestResult = ConfirmDomainSuggestionRequestSchema.safeParse(requestInput);
    if (!requestResult.success) {
      return fail("invalid_request");
    }

    const actor = actorResult.data;
    const request = requestResult.data;
    if (
      actor.spaceId !== request.suggestion.spaceId ||
      actor.memberId !== request.suggestion.requestedByMemberId
    ) {
      return fail("not_found");
    }

    const contextResult = await loadAndValidate(
      dependencies.repository,
      actor,
      expectedFromDraft(request.suggestion),
    );
    if (!contextResult.ok) {
      return fail(contextResult.code);
    }

    const current = await revalidate(
      dependencies.repository,
      actor,
      request.suggestion.guard,
    );
    if (current === undefined) {
      return fail("internal_failure");
    }
    if (current.status !== "current") {
      return fail(mutationFailure(current.status));
    }

    const domain = DomainSchema.parse({
      id: request.suggestion.id,
      spaceId: request.suggestion.spaceId,
      createdAt: request.suggestion.createdAt,
      updatedAt: request.suggestion.createdAt,
      version: 0,
      name: request.suggestion.name,
      ownerId: null,
      status: "active",
      nextAction: request.suggestion.nextAction,
      visibility: request.suggestion.visibility,
      evidenceIds: request.suggestion.evidenceIds,
    });

    let rawPersistResult: unknown;
    try {
      rawPersistResult = await dependencies.repository.persistConfirmedDomain({
        actor,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        guard: request.suggestion.guard,
        domain,
        confirmedByMemberId: actor.memberId,
      });
    } catch {
      return fail("internal_failure");
    }

    const persistResult = PersistDomainResultSchema.safeParse(rawPersistResult);
    if (!persistResult.success) {
      return fail("internal_failure");
    }
    if (
      persistResult.data.status !== "persisted" &&
      persistResult.data.status !== "replayed"
    ) {
      return fail(mutationFailure(persistResult.data.status));
    }
    if (!persistedDomainMatches(persistResult.data.domain, request.suggestion)) {
      return fail("internal_failure");
    }

    return { ok: true, result: persistResult.data.domain };
  };

  return Object.freeze({
    draftDomainSuggestion,
    confirmDomainSuggestion,
  });
};
