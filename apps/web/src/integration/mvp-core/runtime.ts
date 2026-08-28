import type { Database } from "../../../../../packages/db/src/index";
import {
  MvpCoreCommandRequestSchema,
  MvpCoreCommandResponseSchema,
  isMvpCoreFixtureSession,
  type MvpCoreCommand,
  type MvpCoreCommandRequest,
  type MvpCoreCommandResponse,
  type MvpCoreErrorCode,
  type MvpCoreFixtureSession,
} from "../../../../../packages/testkit/src/integration-seam";
import {
  createPrivateSharingService,
  isPrivateSharingError,
} from "../../../../../modules/boundary/src/index";
import {
  createConversationService,
  isConversationError,
} from "../../../../../modules/conversation/src/index";
import { isHandoverError } from "../../../../../modules/handover/src/index";
import { isResponsibilityError } from "../../../../../modules/responsibility/src/index";
import { MVP_CORE_FIXTURE } from "../../../../../fixtures/mvp-core";
import type {
  MvpCoreMemberActor,
  MvpCoreResponsibilityReport,
} from "./contract-projections";
import {
  confirmCanonicalHandoverFrom,
  confirmCanonicalHandoverTo,
  supplyCanonicalHandoverInformation,
} from "./handover";
import {
  ensureMvpCoreDatabase,
  initialMvpCoreSnapshot,
  readMvpCoreSnapshot,
  readMvpCoreSnapshotIfPresent,
  resetMvpCoreDatabase,
} from "./persistence";
import { generateCanonicalResponsibilityReport } from "./responsibility";
import {
  createDatabaseConversationStatePort,
  createDatabasePrivateSharingStatePort,
} from "./sharing";

export interface MvpCoreRuntimeResponse {
  readonly body: MvpCoreCommandResponse;
  readonly status: number;
}

class MvpCoreRuntimeFailure extends Error {
  readonly code: MvpCoreErrorCode;
  readonly status: number;

  constructor(code: MvpCoreErrorCode, status: number) {
    super("The Local Fixture command failed safely.");
    this.name = "MvpCoreRuntimeFailure";
    this.code = code;
    this.status = status;
  }
}

const fail = (code: MvpCoreErrorCode, status: number): never => {
  throw new MvpCoreRuntimeFailure(code, status);
};

const actorFor = (session: MvpCoreFixtureSession): MvpCoreMemberActor => ({
    authentication: "fixture_demo",
    kind: "member",
    memberId: session.actorId,
    role: session.role,
    spaceId: session.spaceId,
  });

const requireRole = (
  actor: MvpCoreMemberActor,
  roles: readonly MvpCoreMemberActor["role"][],
): void => {
  if (!roles.includes(actor.role)) {
    fail("forbidden", 403);
  }
};

const COMMAND_ROLES = Object.freeze({
  confirm_handover_from: ["primary"],
  confirm_handover_to: ["partner"],
  generate_report: ["primary", "partner"],
  publish_consented_signal: ["subject"],
  read_private_message: ["subject"],
  record_no_consent: ["subject"],
  record_share_consent: ["subject"],
  share_private_message: ["subject"],
  supply_handover_info: ["primary"],
} as const satisfies Readonly<
  Record<MvpCoreCommand, readonly MvpCoreMemberActor["role"][]>
>);

export const authorizeMvpCoreCommand = (
  actor: MvpCoreMemberActor,
  request: MvpCoreCommandRequest,
): void => {
  const { command } = request;
  if (
    command === "read_private_message" ||
    command === "share_private_message"
  ) {
    if (
      actor.role !== "subject" ||
      request.targetId !== MVP_CORE_FIXTURE.privateConversation.message.id
    ) {
      fail("not_found", 404);
    }
    if (command === "share_private_message") {
      fail("raw_private_share_denied", 403);
    }
    return;
  }

  const allowedRoles: readonly MvpCoreMemberActor["role"][] =
    COMMAND_ROLES[command];
  if (!allowedRoles.includes(actor.role)) {
    fail("forbidden", 403);
  }
};

const mappedFailure = (error: unknown): MvpCoreRuntimeFailure => {
  if (error instanceof MvpCoreRuntimeFailure) {
    return error;
  }
  if (isConversationError(error)) {
    if (error.code === "not_found") {
      return new MvpCoreRuntimeFailure("not_found", 404);
    }
    if (error.code === "forbidden") {
      return new MvpCoreRuntimeFailure("forbidden", 403);
    }
    if (error.code === "invalid_request") {
      return new MvpCoreRuntimeFailure("invalid_request", 400);
    }
  }
  if (isPrivateSharingError(error)) {
    if (error.code === "not_found") {
      return new MvpCoreRuntimeFailure("not_found", 404);
    }
    if (error.code === "forbidden") {
      return new MvpCoreRuntimeFailure("forbidden", 403);
    }
    if (error.code === "consent_required") {
      return new MvpCoreRuntimeFailure("consent_required", 409);
    }
    if (error.code === "invalid_request") {
      return new MvpCoreRuntimeFailure("invalid_request", 400);
    }
    if (
      error.code === "consent_invalid" ||
      error.code === "visibility_denied"
    ) {
      return new MvpCoreRuntimeFailure("consent_required", 409);
    }
    return new MvpCoreRuntimeFailure("transition_denied", 409);
  }
  if (isResponsibilityError(error)) {
    if (error.code === "forbidden") {
      return new MvpCoreRuntimeFailure("forbidden", 403);
    }
    if (error.code === "not_found" || error.code === "consent_invalid") {
      return new MvpCoreRuntimeFailure("consent_required", 409);
    }
    if (error.code === "invalid_request") {
      return new MvpCoreRuntimeFailure("invalid_request", 400);
    }
    return new MvpCoreRuntimeFailure("transition_denied", 409);
  }
  if (isHandoverError(error)) {
    if (error.code === "handover_blocked") {
      return new MvpCoreRuntimeFailure("handover_blocked", 409);
    }
    if (error.code === "forbidden") {
      return new MvpCoreRuntimeFailure("forbidden", 403);
    }
    if (error.code === "not_found") {
      return new MvpCoreRuntimeFailure("not_found", 404);
    }
    if (error.code === "invalid_request") {
      return new MvpCoreRuntimeFailure("invalid_request", 400);
    }
    return new MvpCoreRuntimeFailure("transition_denied", 409);
  }
  return new MvpCoreRuntimeFailure("transition_denied", 500);
};

interface CommandResult {
  readonly privateMessage?: Readonly<{ id: string; content: string }>;
  readonly report?: MvpCoreResponsibilityReport;
}

const executeKnownCommand = async (
  database: Database,
  actor: MvpCoreMemberActor,
  request: MvpCoreCommandRequest,
): Promise<CommandResult> => {
  const conversation = createConversationService({
    state: createDatabaseConversationStatePort(database),
  });
  const sharing = createPrivateSharingService({
    state: createDatabasePrivateSharingStatePort(database),
  });

  switch (request.command) {
    case "read_private_message": {
      if (actor.role !== "subject") {
        fail("not_found", 404);
      }
      const result = await conversation.getPrivateMessage(actor, {
        privateMessageId: request.targetId,
        requestId: MVP_CORE_FIXTURE.ids.request,
      });
      return {
        privateMessage: {
          content: result.message.content,
          id: result.message.id,
        },
      };
    }
    case "share_private_message": {
      if (actor.role !== "subject") {
        fail("not_found", 404);
      }
      await conversation.getPrivateMessage(actor, {
        privateMessageId: request.targetId,
        requestId: MVP_CORE_FIXTURE.ids.request,
      });
      return fail("raw_private_share_denied", 403);
    }
    case "record_share_consent": {
      requireRole(actor, ["subject"]);
      await sharing.decideConsent(actor, {
        decidedAt:
          MVP_CORE_FIXTURE.privateConversation.consentDecision.decidedAt,
        decision: "share",
        expiresAt: null,
        requestId: MVP_CORE_FIXTURE.ids.request,
        signalDraftId:
          MVP_CORE_FIXTURE.privateConversation.derivedDraft.id,
        visibility:
          MVP_CORE_FIXTURE.privateConversation.consentDecision.visibility,
      });
      return {};
    }
    case "record_no_consent": {
      requireRole(actor, ["subject"]);
      await sharing.decideConsent(actor, {
        decidedAt:
          MVP_CORE_FIXTURE.privateConversation.consentDecision.decidedAt,
        decision: "discard",
        expiresAt: null,
        requestId: MVP_CORE_FIXTURE.ids.request,
        signalDraftId:
          MVP_CORE_FIXTURE.privateConversation.derivedDraft.id,
        visibility: null,
      });
      return {};
    }
    case "publish_consented_signal": {
      requireRole(actor, ["subject"]);
      await sharing.confirmSignal(actor, {
        consentDecisionId:
          MVP_CORE_FIXTURE.privateConversation.consentDecision.id,
        expectedDraftVersion:
          MVP_CORE_FIXTURE.privateConversation.derivedDraft.version,
        idempotencyKey: "mvp-core-confirm-signal-v1",
        requestId: MVP_CORE_FIXTURE.ids.request,
        signalDraftId:
          MVP_CORE_FIXTURE.privateConversation.derivedDraft.id,
      });
      return {};
    }
    case "generate_report": {
      requireRole(actor, ["primary", "partner"]);
      return {
        report: await generateCanonicalResponsibilityReport(database, actor),
      };
    }
    case "supply_handover_info": {
      requireRole(actor, ["primary"]);
      await supplyCanonicalHandoverInformation(database, actor);
      return {};
    }
    case "confirm_handover_from": {
      requireRole(actor, ["primary"]);
      await confirmCanonicalHandoverFrom(database, actor);
      return {};
    }
    case "confirm_handover_to": {
      requireRole(actor, ["partner"]);
      await confirmCanonicalHandoverTo(database, actor);
      return {};
    }
  }
};

const failureResponse = async (
  database: Database,
  command: MvpCoreCommand | null,
  failure: MvpCoreRuntimeFailure,
): Promise<MvpCoreRuntimeResponse> => ({
  body: MvpCoreCommandResponseSchema.parse({
    code: failure.code,
    command,
    ok: false,
    state: await readMvpCoreSnapshot(database),
  }),
  status: failure.status,
});

const prePersistenceFailureResponse = (
  command: MvpCoreCommand | null,
  failure: MvpCoreRuntimeFailure,
): MvpCoreRuntimeResponse => ({
  body: MvpCoreCommandResponseSchema.parse({
    code: failure.code,
    command,
    ok: false,
    state: initialMvpCoreSnapshot(),
  }),
  status: failure.status,
});

const readOnlyPreauthorizationFailureResponse = async (
  database: Database,
  command: MvpCoreCommand | null,
  failure: MvpCoreRuntimeFailure,
): Promise<MvpCoreRuntimeResponse> => ({
  body: MvpCoreCommandResponseSchema.parse({
    code: failure.code,
    command,
    ok: false,
    state: await readMvpCoreSnapshotIfPresent(database),
  }),
  status: failure.status,
});

export const executeMvpCoreCommand = async (
  database: Database,
  sessionInput: unknown,
  requestInput: unknown,
): Promise<MvpCoreRuntimeResponse> => {
  if (!isMvpCoreFixtureSession(sessionInput)) {
    return prePersistenceFailureResponse(
      null,
      new MvpCoreRuntimeFailure("invalid_session", 401),
    );
  }

  const parsed = MvpCoreCommandRequestSchema.safeParse(requestInput);
  if (!parsed.success) {
    return readOnlyPreauthorizationFailureResponse(
      database,
      null,
      new MvpCoreRuntimeFailure("invalid_request", 400),
    );
  }

  const actor = actorFor(sessionInput);
  try {
    authorizeMvpCoreCommand(actor, parsed.data);
  } catch (error) {
    return readOnlyPreauthorizationFailureResponse(
      database,
      parsed.data.command,
      mappedFailure(error),
    );
  }

  await ensureMvpCoreDatabase(database);

  try {
    const result = await executeKnownCommand(
      database,
      actor,
      parsed.data,
    );
    return {
      body: MvpCoreCommandResponseSchema.parse({
        command: parsed.data.command,
        ok: true,
        result,
        state: await readMvpCoreSnapshot(database),
      }),
      status: 200,
    };
  } catch (error) {
    return failureResponse(
      database,
      parsed.data.command,
      mappedFailure(error),
    );
  }
};

export const readMvpCoreState = async (
  database: Database,
  sessionInput: unknown,
) => {
  if (!isMvpCoreFixtureSession(sessionInput)) {
    throw new MvpCoreRuntimeFailure("invalid_session", 401);
  }
  await ensureMvpCoreDatabase(database);
  return readMvpCoreSnapshot(database);
};

export const resetMvpCoreState = async (
  database: Database,
  sessionInput: unknown,
): Promise<void> => {
  if (!isMvpCoreFixtureSession(sessionInput)) {
    throw new MvpCoreRuntimeFailure("invalid_session", 401);
  }
  await resetMvpCoreDatabase(database);
};

export const isMvpCoreRuntimeFailure = (
  error: unknown,
): error is MvpCoreRuntimeFailure => error instanceof MvpCoreRuntimeFailure;
