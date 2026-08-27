import type {
  MvpCoreReport,
  MvpCoreSnapshot,
  VisibleMvpCoreCommand,
} from "./wire-contract";

export type MemberRole = "primary" | "partner" | "subject";

export const ROLE_ORDER = ["primary", "partner", "subject"] as const satisfies readonly MemberRole[];

export type ExperienceActionId = VisibleMvpCoreCommand | "reset_fixture";

export type ExperienceStage =
  | "consent"
  | "consent_recorded"
  | "private"
  | "report"
  | "blocked"
  | "awaiting_confirmations"
  | "source_confirmed"
  | "recipient_confirmed"
  | "acceptance_pending"
  | "accepted";

export interface ExperienceSnapshot {
  readonly server: MvpCoreSnapshot;
  readonly stage: ExperienceStage;
  readonly stageTitle: string;
  readonly stageSummary: string;
  readonly report: MvpCoreReport | null;
}

export interface ExperienceClient {
  load(): Promise<ExperienceSnapshot>;
  perform(actionId: ExperienceActionId): Promise<ExperienceSnapshot>;
}
