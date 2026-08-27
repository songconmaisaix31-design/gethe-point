export type MemberRole = "primary" | "partner" | "subject";

export const ROLE_ORDER = ["primary", "partner", "subject"] as const satisfies readonly MemberRole[];

export const EXPERIENCE_STAGE_ORDER = [
  "consent",
  "report",
  "blocked",
  "awaiting_confirmations",
  "source_confirmed",
  "accepted",
] as const;

export type ExperienceStage = (typeof EXPERIENCE_STAGE_ORDER)[number] | "consent_recorded";

export type CanonicalScenarioActionId =
  | "share_with_space"
  | "share_with_primary"
  | "keep_private"
  | "propose_handover"
  | "supply_last_check_result"
  | "confirm_handover_source"
  | "confirm_handover_recipient"
  | "restart_fixture";

export interface CanonicalScenarioAction {
  readonly id: CanonicalScenarioActionId;
  readonly label: string;
  readonly role: MemberRole;
  readonly tone: "primary" | "secondary";
}

export interface ResponsibilityStageRow {
  readonly field:
    | "discoveredBy"
    | "deadlineKeptBy"
    | "scheduledBy"
    | "executedBy"
    | "followedUpBy";
  readonly label: string;
  readonly primaryCount: number;
  readonly partnerCount: number;
}

export interface ResponsibilityReport {
  readonly period: string;
  readonly rows: readonly ResponsibilityStageRow[];
  readonly narrative: string;
  readonly evidence: string;
  readonly primaryRememberedItems: number;
  readonly partnerOwnedDomains: number;
}

export interface HandoverConfirmation {
  readonly role: "primary" | "partner";
  readonly partyLabel: string;
  readonly state: "waiting" | "confirmed";
  readonly confirmedAt: string | null;
}

export interface HandoverView {
  readonly id: string;
  readonly domainTitle: string;
  readonly scope: string;
  readonly nextStep: string;
  readonly evidence: string;
  readonly state: "blocked" | "awaiting_confirmations" | "accepted";
  readonly stateLabel: string;
  readonly stateDetail: string;
  readonly missingInformation: readonly string[];
  readonly confirmations: readonly HandoverConfirmation[];
  readonly ownerLabel: string;
  readonly reminderLabel: string;
}

export interface ExperienceSnapshot {
  readonly revision: number;
  readonly stage: ExperienceStage;
  readonly stageTitle: string;
  readonly stageSummary: string;
  readonly mobileRole: MemberRole;
  readonly consentOutcome: "shared" | "limited" | "private" | null;
  readonly report: ResponsibilityReport | null;
  readonly handover: HandoverView | null;
  readonly actions: readonly CanonicalScenarioAction[];
}

export interface ExperienceActionRequest {
  readonly actionId: CanonicalScenarioActionId;
  readonly expectedRevision: number;
}

export interface ExperienceClient {
  load(): Promise<ExperienceSnapshot>;
  perform(request: ExperienceActionRequest): Promise<ExperienceSnapshot>;
}
