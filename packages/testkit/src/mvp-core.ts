import {
  ResponsibilityReportSchema,
  type MemberRole,
  type ResponsibilityReport,
} from "../../contracts/src/index";

import { MVP_CORE_FIXTURE, MVP_CORE_SCENARIO_ID } from "../../../fixtures/mvp-core";
import {
  MvpCoreCommandRequestSchema,
  type MvpCoreCommand,
  type MvpCoreCommandResponse,
  type MvpCoreErrorCode,
  type MvpCoreSnapshot,
} from "./integration-seam";

type ConsentState = MvpCoreSnapshot["consent"];
type HandoverStatus = MvpCoreSnapshot["handover"]["status"];

interface MvpCoreState {
  readonly scenarioId: typeof MVP_CORE_SCENARIO_ID;
  readonly revision: number;
  readonly writeCount: number;
  readonly sharedWriteCount: number;
  readonly consent: ConsentState;
  readonly sharedSignalIds: readonly string[];
  readonly reportGenerated: boolean;
  readonly domainOwnerId: string;
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
  execute(input: unknown): MvpCoreCommandResponse;
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
  domainOwnerId: MVP_CORE_FIXTURE.responsibility.domain.ownerId,
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
  domainOwnerId: state.domainOwnerId,
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

const succeeded = (
  command: MvpCoreCommand,
  state: MvpCoreState,
  result: Readonly<{
    privateMessage?: Readonly<{ id: string; content: string }>;
    report?: ResponsibilityReport;
  }> = {},
): MvpCoreCommandResponse => ({
  ok: true,
  command,
  state: toSnapshot(state),
  result,
});

const withWrite = (
  state: MvpCoreState,
  update: Partial<Omit<MvpCoreState, "scenarioId" | "revision" | "writeCount">>,
): MvpCoreState => ({
  ...state,
  ...update,
  revision: state.revision + 1,
  writeCount: state.writeCount + 1,
});

const roleCanViewSharedData = (role: MemberRole): boolean =>
  role === "primary" || role === "partner";

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
    result?: Readonly<{
      privateMessage?: Readonly<{ id: string; content: string }>;
      report?: ResponsibilityReport;
    }>,
  ): MvpCoreCommandResponse => {
    persistence.save(next);
    return succeeded(command, next, result);
  };

  const execute = (input: unknown): MvpCoreCommandResponse => {
    const current = load();
    const parsed = MvpCoreCommandRequestSchema.safeParse(input);

    if (!parsed.success) {
      return rejected(null, "invalid_request", current);
    }

    const { command, role, scenarioId, targetId } = parsed.data;
    if (scenarioId !== MVP_CORE_SCENARIO_ID) {
      return rejected(command, "unknown_scenario", current);
    }

    switch (command) {
      case "read_private_message": {
        if (
          role !== "subject" ||
          targetId !== MVP_CORE_FIXTURE.privateConversation.message.id
        ) {
          return rejected(command, "not_found", current);
        }

        return succeeded(command, current, {
          privateMessage: {
            id: MVP_CORE_FIXTURE.privateConversation.message.id,
            content: MVP_CORE_FIXTURE.privateConversation.message.content,
          },
        });
      }
      case "share_private_message": {
        if (
          role !== "subject" ||
          targetId !== MVP_CORE_FIXTURE.privateConversation.message.id
        ) {
          return rejected(command, "not_found", current);
        }

        return rejected(command, "raw_private_share_denied", current);
      }
      case "record_share_consent": {
        if (role !== "subject") {
          return rejected(command, "forbidden", current);
        }
        if (current.consent === "shared") {
          return succeeded(command, current);
        }
        if (current.consent === "discarded") {
          return rejected(command, "transition_denied", current);
        }

        return saveSuccess(command, withWrite(current, { consent: "shared" }));
      }
      case "record_no_consent": {
        if (role !== "subject") {
          return rejected(command, "forbidden", current);
        }
        if (current.consent === "discarded") {
          return succeeded(command, current);
        }
        if (current.consent === "shared") {
          return rejected(command, "transition_denied", current);
        }

        return saveSuccess(command, withWrite(current, { consent: "discarded" }));
      }
      case "publish_consented_signal": {
        if (role !== "subject") {
          return rejected(command, "forbidden", current);
        }
        if (current.consent !== "shared") {
          return rejected(command, "consent_required", current);
        }
        if (current.sharedSignalIds.length === 1) {
          return succeeded(command, current);
        }

        return saveSuccess(
          command,
          withWrite(current, {
            sharedSignalIds: [MVP_CORE_FIXTURE.privateConversation.consentedSignal.id],
            sharedWriteCount: current.sharedWriteCount + 1,
          }),
        );
      }
      case "generate_report": {
        if (!roleCanViewSharedData(role)) {
          return rejected(command, "forbidden", current);
        }
        if (current.sharedSignalIds.length === 0) {
          return rejected(command, "consent_required", current);
        }
        if (current.reportGenerated) {
          return succeeded(command, current, {
            report: canonicalReport,
          });
        }

        return saveSuccess(
          command,
          withWrite(current, { reportGenerated: true }),
          { report: canonicalReport },
        );
      }
      case "supply_handover_info": {
        if (role !== "primary") {
          return rejected(command, "forbidden", current);
        }
        if (current.handover.status === "accepted") {
          return rejected(command, "transition_denied", current);
        }
        if (current.handover.status === "awaiting_confirmations") {
          return succeeded(command, current);
        }

        return saveSuccess(
          command,
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
        if (role !== "primary") {
          return rejected(command, "forbidden", current);
        }
        if (current.handover.status === "blocked") {
          return rejected(command, "handover_blocked", current);
        }
        if (current.handover.status === "accepted" || current.handover.fromConfirmed) {
          return succeeded(command, current);
        }

        const bothConfirmed = current.handover.toConfirmed;
        const next = withWrite(current, {
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
        });
        return saveSuccess(command, next);
      }
      case "confirm_handover_to": {
        if (role !== "partner") {
          return rejected(command, "forbidden", current);
        }
        if (current.handover.status === "blocked") {
          return rejected(command, "handover_blocked", current);
        }
        if (current.handover.status === "accepted" || current.handover.toConfirmed) {
          return succeeded(command, current);
        }

        const bothConfirmed = current.handover.fromConfirmed;
        const next = withWrite(current, {
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
        });
        return saveSuccess(command, next);
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
