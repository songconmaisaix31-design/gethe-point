import {
  ResponsibilityReportSchema,
  type MemberRole,
  type ResponsibilityReport,
} from "../../contracts/src/index";

import {
  MVP_CORE_FIXTURE,
  MVP_CORE_SCENARIO_ID,
} from "../../../fixtures/mvp-core";
import {
  isMvpCoreFixtureSession,
  MvpCoreCommandRequestSchema,
  type MvpCoreCommand,
  type MvpCoreCommandResponse,
  type MvpCoreErrorCode,
  type MvpCoreFixtureSession,
  type MvpCoreSnapshot,
} from "./integration-seam";

type ConsentState = MvpCoreSnapshot["consent"];
type HandoverStatus = MvpCoreSnapshot["handover"]["status"];
type ResponsibilityOwners = MvpCoreSnapshot["responsibilityOwners"];

interface MvpCoreState {
  readonly scenarioId: typeof MVP_CORE_SCENARIO_ID;
  readonly revision: number;
  readonly writeCount: number;
  readonly sharedWriteCount: number;
  readonly consent: ConsentState;
  readonly sharedSignalIds: readonly string[];
  readonly reportGenerated: boolean;
  readonly responsibilityOwners: ResponsibilityOwners;
  readonly domainOwnerId: string;
  readonly futureReminderCount: 1;
  readonly reminderOwnerId: string;
  readonly handover: Readonly<{
    status: HandoverStatus;
    fromConfirmed: boolean;
    toConfirmed: boolean;
  }>;
}

export interface MvpCorePersistence {
  load(): MvpCoreState | undefined;
  save(state: MvpCoreState): void;
}

export interface MvpCoreHarness {
  execute(session: unknown, input: unknown): MvpCoreCommandResponse;
  snapshot(): MvpCoreSnapshot;
  reload(): MvpCoreHarness;
  reset(): MvpCoreSnapshot;
}

const cloneState = (state: MvpCoreState): MvpCoreState => structuredClone(state);
const canonicalReport = ResponsibilityReportSchema.parse(
  MVP_CORE_FIXTURE.responsibility.report,
);

const initialState = (): MvpCoreState => ({
  scenarioId: MVP_CORE_SCENARIO_ID,
  revision: 0,
  writeCount: 0,
  sharedWriteCount: 0,
  consent: "pending",
  sharedSignalIds: [],
  reportGenerated: false,
  responsibilityOwners: structuredClone(MVP_CORE_FIXTURE.responsibility.stageOwners),
  domainOwnerId: MVP_CORE_FIXTURE.responsibility.domain.ownerId,
  futureReminderCount: 1,
  reminderOwnerId: MVP_CORE_FIXTURE.reminder.initialOwnerId,
  handover: {
    status: MVP_CORE_FIXTURE.handover.blocked.status,
    fromConfirmed: false,
    toConfirmed: false,
  },
});

const toSnapshot = (state: MvpCoreState): MvpCoreSnapshot => ({
  scenarioId: state.scenarioId,
  revision: state.revision,
  writeCount: state.writeCount,
  sharedWriteCount: state.sharedWriteCount,
  consent: state.consent,
  sharedRows: state.sharedSignalIds.length,
  reportRows: state.reportGenerated ? MVP_CORE_FIXTURE.responsibility.report.rows.length : 0,
  responsibilityOwners: state.responsibilityOwners,
  domainOwnerId: state.domainOwnerId,
  futureReminderCount: state.futureReminderCount,
  reminderOwnerId: state.reminderOwnerId,
  handover: state.handover,
});

const rejected = (
  command: MvpCoreCommand | null,
  code: MvpCoreErrorCode,
  state: MvpCoreState,
): MvpCoreCommandResponse => ({
  ok: false,
  command,
  code,
  state: toSnapshot(state),
});

interface SuccessResult {
  readonly privateMessage?: Readonly<{ id: string; content: string }>;
  readonly report?: ResponsibilityReport;
}

const succeeded = (
  command: MvpCoreCommand,
  state: MvpCoreState,
  result: SuccessResult = {},
): MvpCoreCommandResponse => ({
  ok: true,
  command,
  state: toSnapshot(state),
  result,
});

const withWrite = (
  state: MvpCoreState,
  update: Partial<
    Omit<MvpCoreState, "scenarioId" | "revision" | "writeCount">
  >,
): MvpCoreState => ({
  ...state,
  ...update,
  revision: state.revision + 1,
  writeCount: state.writeCount + 1,
});

const roleCanViewSharedData = (role: MemberRole): boolean =>
  role === "primary" || role === "partner";

const sessionMatchesCanonicalIdentity = (
  session: MvpCoreFixtureSession,
): boolean => {
  const canonicalActor = MVP_CORE_FIXTURE.actors[session.role];
  return (
    session.actorId === canonicalActor.memberId &&
    session.spaceId === canonicalActor.spaceId
  );
};

export const createMemoryMvpCorePersistence = (): MvpCorePersistence => {
  let stored: MvpCoreState | undefined;

  return {
    load: () => (stored === undefined ? undefined : cloneState(stored)),
    save: (state) => {
      stored = cloneState(state);
    },
  };
};

export const createMvpCoreHarness = (
  persistence: MvpCorePersistence = createMemoryMvpCorePersistence(),
): MvpCoreHarness => {
  const load = (): MvpCoreState => persistence.load() ?? initialState();

  const saveSuccess = (
    command: MvpCoreCommand,
    next: MvpCoreState,
    result?: SuccessResult,
  ): MvpCoreCommandResponse => {
    persistence.save(next);
    return succeeded(command, next, result);
  };

  const execute = (sessionInput: unknown, input: unknown): MvpCoreCommandResponse => {
    const current = load();
    if (
      !isMvpCoreFixtureSession(sessionInput) ||
      !sessionMatchesCanonicalIdentity(sessionInput)
    ) {
      return rejected(null, "invalid_session", current);
    }

    const parsed = MvpCoreCommandRequestSchema.safeParse(input);
    if (!parsed.success) {
      return rejected(null, "invalid_request", current);
    }

    const session = sessionInput;
    const request = parsed.data;
    switch (request.command) {
      case "read_private_message": {
        if (
          session.role !== "subject" ||
          request.targetId !== MVP_CORE_FIXTURE.privateConversation.message.id
        ) {
          return rejected(request.command, "not_found", current);
        }

        return succeeded(request.command, current, {
          privateMessage: {
            id: MVP_CORE_FIXTURE.privateConversation.message.id,
            content: MVP_CORE_FIXTURE.privateConversation.message.content,
          },
        });
      }
      case "share_private_message": {
        if (
          session.role !== "subject" ||
          request.targetId !== MVP_CORE_FIXTURE.privateConversation.message.id
        ) {
          return rejected(request.command, "not_found", current);
        }

        return rejected(request.command, "raw_private_share_denied", current);
      }
      case "record_share_consent": {
        if (session.role !== "subject") {
          return rejected(request.command, "forbidden", current);
        }
        if (current.consent === "shared") {
          return succeeded(request.command, current);
        }
        if (current.consent === "discarded") {
          return rejected(request.command, "transition_denied", current);
        }

        return saveSuccess(
          request.command,
          withWrite(current, { consent: "shared" }),
        );
      }
      case "record_no_consent": {
        if (session.role !== "subject") {
          return rejected(request.command, "forbidden", current);
        }
        if (current.consent === "discarded") {
          return succeeded(request.command, current);
        }
        if (current.consent === "shared") {
          return rejected(request.command, "transition_denied", current);
        }

        return saveSuccess(
          request.command,
          withWrite(current, { consent: "discarded" }),
        );
      }
      case "publish_consented_signal": {
        if (session.role !== "subject") {
          return rejected(request.command, "forbidden", current);
        }
        if (current.consent !== "shared") {
          return rejected(request.command, "consent_required", current);
        }
        if (current.sharedSignalIds.length === 1) {
          return succeeded(request.command, current);
        }

        return saveSuccess(
          request.command,
          withWrite(current, {
            sharedSignalIds: [MVP_CORE_FIXTURE.privateConversation.consentedSignal.id],
            sharedWriteCount: current.sharedWriteCount + 1,
          }),
        );
      }
      case "generate_report": {
        if (!roleCanViewSharedData(session.role)) {
          return rejected(request.command, "forbidden", current);
        }
        if (current.sharedSignalIds.length === 0) {
          return rejected(request.command, "consent_required", current);
        }
        if (current.reportGenerated) {
          return succeeded(request.command, current, { report: canonicalReport });
        }

        return saveSuccess(
          request.command,
          withWrite(current, { reportGenerated: true }),
          { report: canonicalReport },
        );
      }
      case "supply_handover_info": {
        if (session.role !== "primary") {
          return rejected(request.command, "forbidden", current);
        }
        if (current.handover.status === "accepted") {
          return rejected(request.command, "transition_denied", current);
        }
        if (current.handover.status === "awaiting_confirmations") {
          return succeeded(request.command, current);
        }

        return saveSuccess(
          request.command,
          withWrite(current, {
            handover: {
              status: "awaiting_confirmations",
              fromConfirmed: false,
              toConfirmed: false,
            },
          }),
        );
      }
      case "confirm_handover_from": {
        if (session.role !== "primary") {
          return rejected(request.command, "forbidden", current);
        }
        if (current.handover.status === "blocked") {
          return rejected(request.command, "handover_blocked", current);
        }
        if (current.handover.status === "accepted" || current.handover.fromConfirmed) {
          return succeeded(request.command, current);
        }

        const bothConfirmed = current.handover.toConfirmed;
        return saveSuccess(
          request.command,
          withWrite(current, {
            domainOwnerId: bothConfirmed
              ? MVP_CORE_FIXTURE.handover.accepted.toMemberId
              : current.domainOwnerId,
            reminderOwnerId: bothConfirmed
              ? MVP_CORE_FIXTURE.reminder.acceptedOwnerId
              : current.reminderOwnerId,
            handover: {
              status: bothConfirmed ? "accepted" : "awaiting_confirmations",
              fromConfirmed: true,
              toConfirmed: current.handover.toConfirmed,
            },
          }),
        );
      }
      case "confirm_handover_to": {
        if (session.role !== "partner") {
          return rejected(request.command, "forbidden", current);
        }
        if (current.handover.status === "blocked") {
          return rejected(request.command, "handover_blocked", current);
        }
        if (current.handover.status === "accepted" || current.handover.toConfirmed) {
          return succeeded(request.command, current);
        }

        const bothConfirmed = current.handover.fromConfirmed;
        return saveSuccess(
          request.command,
          withWrite(current, {
            domainOwnerId: bothConfirmed
              ? MVP_CORE_FIXTURE.handover.accepted.toMemberId
              : current.domainOwnerId,
            reminderOwnerId: bothConfirmed
              ? MVP_CORE_FIXTURE.reminder.acceptedOwnerId
              : current.reminderOwnerId,
            handover: {
              status: bothConfirmed ? "accepted" : "awaiting_confirmations",
              fromConfirmed: current.handover.fromConfirmed,
              toConfirmed: true,
            },
          }),
        );
      }
    }
  };

  return {
    execute,
    snapshot: () => toSnapshot(load()),
    reload: () => createMvpCoreHarness(persistence),
    reset: () => {
      const next = initialState();
      persistence.save(next);
      return toSnapshot(next);
    },
  };
};
