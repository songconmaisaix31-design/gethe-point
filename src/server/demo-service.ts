import { randomUUID } from "node:crypto";

import type {
  AgentIntent,
  AgentQueryRequest,
  AgentQueryResponse,
  CareEventProjection,
  CareRuleProjection,
  DemoAction,
  EvidenceProjection,
  HandoverProjection,
  MemberProjection,
  NotificationAdapter,
  NotificationAdapterRequest,
  NotificationLogProjection,
  ResponsibilityDomainProjection,
  ResponsibilityTaskProjection,
  Role,
  RoleSafeProjection,
  SignalProjection,
  TimetableCategory,
  TimetableItemProjection,
  TimetableStatus,
  TimetableVisibility,
  Visibility,
} from "@/contracts";
// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { VisibilitySchema } from "../contracts.ts";
// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { assertDomain } from "../domain/errors.ts";
// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { buildNeutralReport } from "../domain/report.ts";
// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { canView } from "../domain/visibility.ts";
import type { DemoDatabase } from "./database.ts";
// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { resetDemoDatabase } from "./database.ts";
// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { appNotificationAdapter, createA3NotificationAdapter } from "./notifications.ts";
import type {
  AgentProviderRequest,
  AgentTextProvider,
} from "./agent-provider.ts";
// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { validateProviderText } from "./agent-provider.ts";
import type { FixtureSession } from "./types.ts";

const DEDUPE_WINDOW_MS = 5 * 60 * 1_000;
const FIXTURE_WEEK_START_MS = Date.parse("2026-08-24T00:00:00+08:00");
const FIXTURE_WEEK_END_MS = Date.parse("2026-08-31T00:00:00+08:00");
const MAX_PROVIDER_TIMETABLE_ITEMS = 8;

interface MemberRow {
  readonly id: string;
  readonly display_name: string;
  readonly role: Role;
  readonly capacity: "available" | "limited";
}

interface EvidenceRow {
  readonly id: string;
  readonly speaker_id: string;
  readonly occurred_at: string;
  readonly text: string;
  readonly visibility_json: string;
  readonly deleted: number;
}

interface SignalRow {
  readonly id: string;
  readonly evidence_id: string;
  readonly summary: string;
  readonly status: SignalProjection["status"];
}

interface DomainRow {
  readonly id: string;
  readonly name: string;
  readonly owner_id: string | null;
  readonly status: ResponsibilityDomainProjection["status"];
  readonly next_action: string | null;
  readonly visibility_json: string;
}

interface TaskRow {
  readonly id: string;
  readonly domain_id: string;
  readonly title: string;
  readonly status: ResponsibilityTaskProjection["status"];
  readonly future_reminder_owner_id: string | null;
  readonly discovered_by: string | null;
  readonly deadline_kept_by: string | null;
  readonly scheduled_by: string | null;
  readonly executed_by: string | null;
  readonly followed_up_by: string | null;
}

interface HandoverRow {
  readonly id: string;
  readonly domain_id: string;
  readonly from_member_id: string;
  readonly to_member_id: string;
  readonly has_last_report: number;
  readonly from_confirmed: number;
  readonly to_confirmed: number;
  readonly state: HandoverProjection["state"];
  readonly version: number;
}

interface CareRuleRow {
  readonly id: string;
  readonly subject_id: string;
  readonly state: CareRuleProjection["state"];
  readonly schedule_label: string;
  readonly acknowledgement_timeout_seconds: number;
  readonly escalation_member_ids_json: string;
  readonly version: number;
}

interface CareEventRow {
  readonly id: string;
  readonly care_rule_id: string;
  readonly state: CareEventProjection["state"];
  readonly reminded_at: string;
  readonly acknowledged_at: string | null;
  readonly closed_at: string | null;
}

interface NotificationRow {
  readonly id: number;
  readonly logical_event_id: string;
  readonly recipient_id: string;
  readonly channel: NotificationLogProjection["channel"];
  readonly priority: NotificationLogProjection["priority"];
  readonly template_id: string;
  readonly status: NotificationLogProjection["status"];
  readonly safe_code: NotificationLogProjection["safeCode"];
  readonly occurred_at: string;
}

interface TimetableRow {
  readonly id: string;
  readonly title: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly category: TimetableCategory;
  readonly owner_id: string;
  readonly domain_id: string | null;
  readonly status: TimetableStatus;
  readonly visibility: TimetableVisibility;
}

interface PendingNotification extends NotificationAdapterRequest {
  readonly text: string;
}

function rows<T>(value: readonly unknown[]): readonly T[] {
  return value as readonly T[];
}

function row<T>(value: unknown): T | undefined {
  return value as T | undefined;
}

function parseVisibility(value: string): Visibility {
  return VisibilitySchema.parse(JSON.parse(value) as unknown);
}

function parseStringArray(value: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);
  assertDomain(
    Array.isArray(parsed) && parsed.every((item) => typeof item === "string"),
    "internal_failure",
    "Stored escalation configuration is invalid.",
  );
  return parsed;
}

function routeAgentIntent(
  message: string,
  intentHint?: AgentIntent,
): AgentIntent {
  if (intentHint !== undefined) {
    return intentHint;
  }

  const keywordGroups: Readonly<Record<Exclude<AgentIntent, "help">, readonly string[]>> = {
    schedule: ["日程", "安排", "时间", "什么时候", "待办"],
    responsibilities: ["责任", "负责", "分工", "任务"],
    care: ["照护", "用药", "健康", "提醒"],
  };
  const matches = (Object.entries(keywordGroups) as readonly [
    Exclude<AgentIntent, "help">,
    readonly string[],
  ][]).filter(([, keywords]) => keywords.some((keyword) => message.includes(keyword)));
  return matches.length === 1 ? matches[0][0] : "help";
}

export interface DemoService {
  reset(session: FixtureSession): RoleSafeProjection;
  execute(session: FixtureSession, action: DemoAction): Promise<RoleSafeProjection>;
  getState(session: FixtureSession): RoleSafeProjection;
  queryAgent(
    session: FixtureSession,
    request: AgentQueryRequest,
  ): Promise<AgentQueryResponse>;
}

export function createDemoService(
  database: DemoDatabase,
  adapters: readonly NotificationAdapter[] = [
      appNotificationAdapter,
      createA3NotificationAdapter(),
  ],
  agentProvider?: AgentTextProvider,
): DemoService {
  const adaptersByChannel = new Map(
    adapters.map((adapter) => [adapter.channel, adapter]),
  );

  function reset(session: FixtureSession): RoleSafeProjection {
    assertDomain(
      session.role === "primary",
      "forbidden",
      "Only the primary Fixture role can reset the demo.",
    );
    resetDemoDatabase(database);
    return getState(session);
  }

  async function execute(
    session: FixtureSession,
    action: DemoAction,
  ): Promise<RoleSafeProjection> {
    const actorId = memberIdForRole(session.role);
    let pending: readonly PendingNotification[] = [];

    switch (action.type) {
      case "share_evidence":
        shareEvidence(actorId, action.evidenceId, action.visibility);
        break;
      case "add_handover_info":
        addHandoverInfo(actorId, action.handoverId);
        break;
      case "confirm_handover":
        confirmHandover(
          actorId,
          action.actorId,
          action.handoverId,
          action.expectedVersion,
        );
        break;
      case "activate_care_rule":
        activateCareRule(
          actorId,
          action.actorId,
          action.careRuleId,
          action.expectedVersion,
        );
        break;
      case "trigger_care_reminder":
        pending = triggerCareReminder(actorId, action.careRuleId);
        break;
      case "advance_demo_clock":
        pending = advanceClock(actorId, action.seconds);
        break;
      case "acknowledge_care":
        acknowledgeCare(actorId, action.actorId, action.careEventId);
        break;
      case "handle_escalation":
        handleEscalation(actorId, action.actorId, action.careEventId);
        break;
      case "delete_evidence":
        deleteEvidence(actorId, action.actorId, action.evidenceId);
        break;
      case "create_timetable_item":
        createTimetableItem(actorId, session.role, action);
        break;
      case "complete_timetable_item":
        completeTimetableItem(actorId, action.itemId);
        break;
    }

    for (const notification of pending) {
      await deliver(notification);
    }

    return getState(session);
  }

  function getState(session: FixtureSession): RoleSafeProjection {
    const viewerId = memberIdForRole(session.role);
    const now = currentTime();
    const members = rows<MemberRow>(
      database.prepare("SELECT * FROM members ORDER BY rowid").all(),
    ).map<MemberProjection>((member) => ({
      id: member.id,
      displayName: member.display_name,
      role: member.role,
      capacity: member.capacity,
    }));

    const visibleEvidenceRows = rows<EvidenceRow>(
      database.prepare("SELECT * FROM evidence ORDER BY occurred_at").all(),
    ).filter((evidence) =>
      canView(parseVisibility(evidence.visibility_json), viewerId, evidence.speaker_id),
    );
    const visibleEvidenceIds = new Set(
      visibleEvidenceRows.map((evidence) => evidence.id),
    );
    const evidence = visibleEvidenceRows.map<EvidenceProjection>((item) => ({
      id: item.id,
      speakerId: item.speaker_id,
      occurredAt: item.occurred_at,
      text: item.deleted === 1 ? "[deleted]" : item.text,
      visibility: parseVisibility(item.visibility_json),
      deleted: item.deleted === 1,
    }));
    const signals = rows<SignalRow>(
      database.prepare("SELECT * FROM signals ORDER BY rowid").all(),
    )
      .filter((item) => visibleEvidenceIds.has(item.evidence_id))
      .map<SignalProjection>((item) => ({
        id: item.id,
        evidenceId: item.evidence_id,
        summary: item.summary,
        status: item.status,
      }));

    const domains = rows<DomainRow>(
      database.prepare("SELECT * FROM domains ORDER BY rowid").all(),
    )
      .filter((item) =>
        canView(parseVisibility(item.visibility_json), viewerId, item.owner_id ?? ""),
      )
      .map<ResponsibilityDomainProjection>((item) => ({
        id: item.id,
        name: item.name,
        ownerId: item.owner_id,
        status: item.status,
        nextAction: item.next_action,
        visibility: parseVisibility(item.visibility_json),
      }));
    const visibleDomainIds = new Set(domains.map((domain) => domain.id));
    const tasks = rows<TaskRow>(
      database.prepare("SELECT * FROM tasks ORDER BY rowid").all(),
    )
      .filter((item) => visibleDomainIds.has(item.domain_id))
      .map<ResponsibilityTaskProjection>((item) => ({
        id: item.id,
        domainId: item.domain_id,
        title: item.title,
        status: item.status,
        futureReminderOwnerId: item.future_reminder_owner_id,
        discoveredBy: item.discovered_by,
        deadlineKeptBy: item.deadline_kept_by,
        scheduledBy: item.scheduled_by,
        executedBy: item.executed_by,
        followedUpBy: item.followed_up_by,
      }));

    const handovers = rows<HandoverRow>(
      database.prepare("SELECT * FROM handovers ORDER BY rowid").all(),
    )
      .filter((item) => visibleDomainIds.has(item.domain_id))
      .map((item) => handoverProjection(item));
    const careRules = rows<CareRuleRow>(
      database.prepare("SELECT * FROM care_rules ORDER BY rowid").all(),
    ).map<CareRuleProjection>((item) => ({
      id: item.id,
      subjectId: item.subject_id,
      state: item.state,
      scheduleLabel: item.schedule_label,
      acknowledgementTimeoutSeconds: item.acknowledgement_timeout_seconds,
      escalationMemberIds: parseStringArray(item.escalation_member_ids_json),
      version: item.version,
    }));
    const careEvents = rows<CareEventRow>(
      database.prepare("SELECT * FROM care_events ORDER BY rowid").all(),
    ).map<CareEventProjection>((item) => ({
      id: item.id,
      careRuleId: item.care_rule_id,
      state: item.state,
      remindedAt: item.reminded_at,
      acknowledgedAt: item.acknowledged_at,
      closedAt: item.closed_at,
    }));
    const notificationLogs = rows<NotificationRow>(
      database
        .prepare(
          "SELECT * FROM notification_logs ORDER BY id",
        )
        .all(),
    ).map<NotificationLogProjection>((item) => ({
      id: `notification_${item.id}`,
      logicalEventId: item.logical_event_id,
      recipientId: item.recipient_id,
      channel: item.channel,
      priority: item.priority,
      templateId: item.template_id,
      status: item.status,
      safeCode: item.safe_code,
      occurredAt: item.occurred_at,
    }));
    const timetableItems = rows<TimetableRow>(
      database.prepare("SELECT * FROM timetable_items ORDER BY starts_at, id").all(),
    )
      .filter(
        (item) => item.visibility === "household" || item.owner_id === viewerId,
      )
      .map<TimetableItemProjection>((item) => ({
        id: item.id,
        title: item.title,
        startsAt: item.starts_at,
        endsAt: item.ends_at,
        category: item.category,
        ownerId: item.owner_id,
        domainId: item.domain_id,
        status: item.status,
        visibility: item.visibility,
        canComplete: item.status === "planned" && item.owner_id === viewerId,
      }));

    return {
      role: session.role,
      now,
      members,
      evidence,
      signals,
      domains,
      report: buildNeutralReport(tasks, "Fixture week"),
      handovers,
      careRules,
      careEvents,
      notificationLogs,
      timetableItems,
    };
  }

  async function queryAgent(
    session: FixtureSession,
    request: AgentQueryRequest,
  ): Promise<AgentQueryResponse> {
    const state = getState(session);
    const target = state.members.find(
      (member) => member.id === request.targetMemberId,
    );
    assertDomain(target, "not_found", "The target member is unavailable.");

    const intent = routeAgentIntent(request.message, request.intentHint);
    const targetItems = state.timetableItems.filter(
      (item) => item.ownerId === target.id,
    );
    const matchingItems = targetItems.filter((item) => {
      if (intent === "care") {
        return item.category === "care";
      }
      if (intent === "responsibilities") {
        return item.category === "responsibility";
      }
      return intent === "schedule";
    });

    let text: string;
    let suggestedActions: AgentQueryResponse["suggestedActions"];
    if (intent === "schedule") {
      text = matchingItems.length === 0
        ? `当前可见日程中没有${target.displayName}的安排。`
        : `${target.displayName}当前有 ${matchingItems.length} 项可见日程：${matchingItems.map((item) => item.title).join("、")}。`;
      suggestedActions = ["view_timetable", "add_item"];
    } else if (intent === "responsibilities") {
      const ownedDomains = state.domains.filter(
        (domain) => domain.ownerId === target.id,
      );
      text = ownedDomains.length === 0 && matchingItems.length === 0
        ? `当前可见投影中没有${target.displayName}负责的事项。`
        : `${target.displayName}当前负责 ${ownedDomains.length} 个可见领域，并有 ${matchingItems.length} 项可见责任日程。`;
      suggestedActions = ["view_timetable", "open_demo"];
    } else if (intent === "care") {
      const careRuleCount = state.careRules.filter(
        (rule) => rule.subjectId === target.id,
      ).length;
      text = `${target.displayName}当前有 ${matchingItems.length} 项可见照护日程和 ${careRuleCount} 条照护规则。如需操作，请使用明确的结构化动作。`;
      suggestedActions = ["view_timetable", "open_demo"];
    } else {
      text = `我可以查询${target.displayName}的可见日程、责任和照护信息。自由文本不会修改任何数据。`;
      suggestedActions = ["view_timetable", "add_item", "open_demo"];
    }

    const deterministicResponse: AgentQueryResponse = {
      intent,
      targetMemberId: target.id,
      text,
      referencedItemIds: matchingItems.map((item) => item.id),
      suggestedActions,
      engine: "fixture_intent_router",
    };

    if (!agentProvider) {
      return deterministicResponse;
    }

    const providerRequest: AgentProviderRequest = {
      question: request.message,
      targetDisplayName: target.displayName,
      intent,
      deterministicAnswer: text,
      visibleTimetable: targetItems
        .slice(0, MAX_PROVIDER_TIMETABLE_ITEMS)
        .map((item) => ({
          title: item.title,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          category: item.category,
          status: item.status,
        })),
      visibleResponsibilityCount: state.domains.filter(
        (domain) => domain.ownerId === target.id,
      ).length,
      visibleCareRuleCount: state.careRules.filter(
        (rule) => rule.subjectId === target.id,
      ).length,
    };

    try {
      const providerText = validateProviderText(
        await agentProvider.rewrite(providerRequest),
      );
      return providerText
        ? { ...deterministicResponse, text: providerText, engine: "stepfun" }
        : deterministicResponse;
    } catch {
      return deterministicResponse;
    }
  }

  function memberIdForRole(role: Role): string {
    const member = row<{ readonly id: string }>(
      database.prepare("SELECT id FROM members WHERE role = ?").get(role),
    );
    assertDomain(member, "internal_failure", "Fixture member is unavailable.");
    return member.id;
  }

  function currentTime(): string {
    const state = row<{ readonly now: string }>(
      database.prepare("SELECT now FROM demo_state WHERE singleton = 1").get(),
    );
    assertDomain(state, "internal_failure", "Fixture clock is unavailable.");
    return state.now;
  }

  function transaction<T>(operation: () => T): T {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  function createTimetableItem(
    actorId: string,
    role: Role,
    action: Extract<DemoAction, { readonly type: "create_timetable_item" }>,
  ): void {
    transaction(() => {
      const owner = row<{ readonly id: string }>(
        database.prepare("SELECT id FROM members WHERE id = ?").get(action.ownerId),
      );
      assertDomain(owner, "invalid_request", "The timetable owner is invalid.");
      if (action.domainId !== undefined) {
        const domain = row<{ readonly id: string }>(
          database.prepare("SELECT id FROM domains WHERE id = ?").get(action.domainId),
        );
        assertDomain(domain, "invalid_request", "The timetable domain is invalid.");
      }

      const ownsItem = action.ownerId === actorId;
      const canCreateForHousehold =
        (role === "primary" || role === "partner") &&
        (action.category === "family" || action.category === "care");
      assertDomain(
        ownsItem || canCreateForHousehold,
        "forbidden",
        "This Fixture role cannot create the timetable item.",
      );

      const title = action.title.trim();
      assertDomain(
        title.length >= 1 && title.length <= 80,
        "invalid_request",
        "The timetable title is invalid.",
      );
      const startsAtMs = Date.parse(action.startsAt);
      const endsAtMs = startsAtMs + action.durationMinutes * 60_000;
      assertDomain(
        startsAtMs >= FIXTURE_WEEK_START_MS && endsAtMs <= FIXTURE_WEEK_END_MS,
        "invalid_request",
        "The timetable item must stay within the Fixture week.",
      );
      const visibility: TimetableVisibility =
        action.category === "responsibility" ? "self" : "household";
      const itemId = `timetable_${randomUUID().replaceAll("-", "")}`;
      const now = currentTime();
      database
        .prepare(
          `INSERT INTO timetable_items(
            id, title, starts_at, ends_at, category, owner_id, domain_id,
            status, visibility, created_by, created_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, NULL)`,
        )
        .run(
          itemId,
          title,
          action.startsAt,
          new Date(endsAtMs).toISOString(),
          action.category,
          action.ownerId,
          action.domainId ?? null,
          visibility,
          actorId,
          now,
        );
      auditAt(actorId, "create_timetable_item", itemId, now, {
        ownerId: action.ownerId,
        category: action.category,
      });
    });
  }

  function completeTimetableItem(actorId: string, itemId: string): void {
    transaction(() => {
      const item = row<TimetableRow>(
        database.prepare("SELECT * FROM timetable_items WHERE id = ?").get(itemId),
      );
      assertDomain(item, "not_found", "The timetable item is unavailable.");
      assertDomain(
        item.owner_id === actorId,
        "forbidden",
        "Only the timetable owner can complete this item.",
      );
      assertDomain(
        item.status === "planned",
        "conflict",
        "The timetable item is already completed.",
      );
      const now = currentTime();
      database
        .prepare(
          "UPDATE timetable_items SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'planned'",
        )
        .run(now, itemId);
      auditAt(actorId, "complete_timetable_item", itemId, now, {});
    });
  }

  function shareEvidence(
    actorId: string,
    evidenceId: string,
    visibility: Visibility,
  ): void {
    transaction(() => {
      const evidence = row<EvidenceRow>(
        database.prepare("SELECT * FROM evidence WHERE id = ?").get(evidenceId),
      );
      assertDomain(evidence, "not_found", "Evidence is unavailable.");
      assertDomain(
        evidence.speaker_id === actorId && evidence.deleted === 0,
        "forbidden",
        "Only the speaker can share this evidence.",
      );

      if (typeof visibility === "object") {
        const count = row<{ readonly count: number }>(
          database
            .prepare(
              `SELECT COUNT(*) AS count FROM members WHERE id IN (${visibility.members.map(() => "?").join(",")})`,
            )
            .get(...visibility.members),
        );
        assertDomain(
          count?.count === visibility.members.length,
          "invalid_request",
          "Visibility includes an unknown member.",
        );
      }

      database
        .prepare("UPDATE evidence SET visibility_json = ? WHERE id = ?")
        .run(JSON.stringify(visibility), evidenceId);
      if (visibility !== "self" && evidenceId === "evidence_subject_private") {
        database
          .prepare(
            `INSERT OR IGNORE INTO signals(id, evidence_id, summary, status)
             VALUES ('signal_private_pain', ?, '当事人提到腿部不适，等待家庭确认下一步', 'observed')`,
          )
          .run(evidenceId);
      }
      audit(actorId, "share_evidence", evidenceId, {
        shared: visibility !== "self",
      });
    });
  }

  function addHandoverInfo(actorId: string, handoverId: string): void {
    transaction(() => {
      const handover = getHandover(handoverId);
      assertDomain(
        actorId === handover.from_member_id || actorId === handover.to_member_id,
        "forbidden",
        "Only handover participants can add information.",
      );
      assertDomain(
        handover.state !== "accepted",
        "conflict",
        "The handover is already accepted.",
      );
      if (handover.has_last_report === 0) {
        database
          .prepare(
            `UPDATE handovers
             SET has_last_report = 1, state = 'awaiting_confirmations', version = version + 1
             WHERE id = ?`,
          )
          .run(handoverId);
        audit(actorId, "add_handover_info", handoverId, {
          item: "last_report",
        });
      }
    });
  }

  function confirmHandover(
    sessionActorId: string,
    actionActorId: string,
    handoverId: string,
    expectedVersion: number,
  ): void {
    assertDomain(
      sessionActorId === actionActorId,
      "forbidden",
      "The action actor does not match the Fixture session.",
    );
    transaction(() => {
      const handover = getHandover(handoverId);
      assertDomain(
        handover.has_last_report === 1,
        "conflict",
        "Required handover information is missing.",
      );
      assertDomain(
        handover.state === "awaiting_confirmations",
        "conflict",
        "The handover cannot be confirmed in its current state.",
      );
      assertDomain(
        handover.version === expectedVersion,
        "conflict",
        "The handover version changed.",
      );

      const isFrom = actionActorId === handover.from_member_id;
      const isTo = actionActorId === handover.to_member_id;
      assertDomain(isFrom || isTo, "forbidden", "Actor is not a handover participant.");
      assertDomain(
        (isFrom && handover.from_confirmed === 0) ||
          (isTo && handover.to_confirmed === 0),
        "conflict",
        "This participant already confirmed the handover.",
      );

      database
        .prepare(
          `UPDATE handovers
           SET from_confirmed = CASE WHEN ? = 1 THEN 1 ELSE from_confirmed END,
               to_confirmed = CASE WHEN ? = 1 THEN 1 ELSE to_confirmed END,
               version = version + 1
           WHERE id = ? AND version = ?`,
        )
        .run(isFrom ? 1 : 0, isTo ? 1 : 0, handoverId, expectedVersion);

      const fresh = getHandover(handoverId);
      assertDomain(
        fresh.version === expectedVersion + 1,
        "conflict",
        "The handover version changed during confirmation.",
      );
      const now = currentTime();
      if (fresh.from_confirmed === 1 && fresh.to_confirmed === 1) {
        database
          .prepare("UPDATE domains SET owner_id = ? WHERE id = ?")
          .run(fresh.to_member_id, fresh.domain_id);
        database
          .prepare(
            `UPDATE tasks SET future_reminder_owner_id = ?
             WHERE domain_id = ? AND status = 'open'`,
          )
          .run(fresh.to_member_id, fresh.domain_id);
        database
          .prepare("UPDATE handovers SET state = 'accepted' WHERE id = ? AND version = ?")
          .run(handoverId, fresh.version);
      }
      auditAt(actionActorId, "confirm_handover", handoverId, now, {
        accepted: fresh.from_confirmed === 1 && fresh.to_confirmed === 1,
      });
    });
  }

  function activateCareRule(
    sessionActorId: string,
    actionActorId: string,
    careRuleId: string,
    expectedVersion: number,
  ): void {
    transaction(() => {
      const current = getCareRule(careRuleId);
      assertDomain(
        sessionActorId === actionActorId && actionActorId === current.subject_id,
        "forbidden",
        "Only the care subject can activate this rule.",
      );
      assertDomain(current.state === "draft", "conflict", "The care rule is already active.");
      assertDomain(current.version === expectedVersion, "conflict", "The care rule version changed.");
      const now = currentTime();
      const fresh = getCareRule(careRuleId);
      assertDomain(actionActorId === fresh.subject_id, "forbidden", "Only the care subject can activate this rule.");
      assertDomain(fresh.state === "draft", "conflict", "The care rule is already active.");
      assertDomain(fresh.version === expectedVersion, "conflict", "The care rule version changed.");
      database
        .prepare(
          `UPDATE care_rules SET state = 'active', version = version + 1
           WHERE id = ? AND version = ? AND state = 'draft'`,
        )
        .run(careRuleId, expectedVersion);
      auditAt(actionActorId, "activate_care_rule", careRuleId, now, {
        humanConfirmed: true,
      });
    });
  }

  function triggerCareReminder(
    actorId: string,
    careRuleId: string,
  ): readonly PendingNotification[] {
    return transaction(() => {
      const rule = getCareRule(careRuleId);
      assertDomain(actorId === rule.subject_id, "forbidden", "Only the care subject can trigger this reminder.");
      assertDomain(rule.state === "active", "conflict", "The care rule is not active.");
      const now = currentTime();
      const openEvent = row<{ readonly id: string }>(
        database
          .prepare(
            `SELECT id FROM care_events
             WHERE care_rule_id = ? AND state IN ('reminded', 'escalated')
             ORDER BY rowid DESC LIMIT 1`,
          )
          .get(careRuleId),
      );
      const count = row<{ readonly count: number }>(
        database.prepare("SELECT COUNT(*) AS count FROM care_events").get(),
      );
      const eventId = openEvent?.id ?? `care_event_${(count?.count ?? 0) + 1}`;
      if (!openEvent) {
        database
          .prepare(
            `INSERT INTO care_events(id, care_rule_id, state, reminded_at)
             VALUES (?, ?, 'reminded', ?)`,
          )
          .run(eventId, careRuleId, now);
      }
      auditAt(actorId, "trigger_care_reminder", eventId, now, {});
      return [
        notification(eventId, rule.subject_id, "app", "high", "care_reminder", "该做已确认的照护事项了。"),
        notification(eventId, rule.subject_id, "robot_a3", "high", "care_reminder", "该做已确认的照护事项了。"),
      ];
    });
  }

  function advanceClock(
    actorId: string,
    seconds: number,
  ): readonly PendingNotification[] {
    return transaction(() => {
      const next = new Date(Date.parse(currentTime()) + seconds * 1_000).toISOString();
      database.prepare("UPDATE demo_state SET now = ? WHERE singleton = 1").run(next);

      const pending: PendingNotification[] = [];
      const events = rows<CareEventRow & { readonly subject_id: string; readonly acknowledgement_timeout_seconds: number; readonly escalation_member_ids_json: string }>(
        database
          .prepare(
            `SELECT care_events.*, care_rules.subject_id, care_rules.acknowledgement_timeout_seconds,
                    care_rules.escalation_member_ids_json
             FROM care_events JOIN care_rules ON care_rules.id = care_events.care_rule_id
             WHERE care_events.state = 'reminded'
             ORDER BY care_events.rowid`,
          )
          .all(),
      );
      assertDomain(
        events.length > 0 && events.every((event) => event.subject_id === actorId),
        "forbidden",
        "Only the care subject can advance this Fixture reminder.",
      );
      for (const event of events) {
        const deadline =
          Date.parse(event.reminded_at) + event.acknowledgement_timeout_seconds * 1_000;
        if (Date.parse(next) >= deadline) {
          database
            .prepare("UPDATE care_events SET state = 'escalated' WHERE id = ?")
            .run(event.id);
          const escalationIds = parseStringArray(event.escalation_member_ids_json);
          for (const recipientId of escalationIds) {
            pending.push(
              notification(
                `${event.id}_escalation`,
                recipientId,
                "app",
                "urgent",
                "care_escalation",
                "照护提醒尚未确认，请按顺序协助处理。",
              ),
            );
          }
        }
      }
      auditAt(actorId, "advance_demo_clock", "demo_clock", next, { seconds });
      return pending;
    });
  }

  function acknowledgeCare(
    sessionActorId: string,
    actionActorId: string,
    careEventId: string,
  ): void {
    assertDomain(sessionActorId === actionActorId, "forbidden", "The action actor does not match the Fixture session.");
    transaction(() => {
      const now = currentTime();
      const event = getCareEventWithRule(careEventId);
      assertDomain(actionActorId === event.subject_id, "forbidden", "Only the care subject can acknowledge this reminder.");
      assertDomain(
        event.state === "reminded" || event.state === "escalated",
        "conflict",
        "The care event cannot be acknowledged.",
      );
      const deadline = Date.parse(event.reminded_at) + event.acknowledgement_timeout_seconds * 1_000;
      if (event.state === "reminded") {
        assertDomain(Date.parse(now) < deadline, "conflict", "The acknowledgement deadline has passed.");
      }
      const result = database
        .prepare(
          `UPDATE care_events
           SET state = 'closed', acknowledged_at = ?, closed_at = ?
           WHERE id = ? AND state = ?`,
        )
        .run(now, now, careEventId, event.state);
      assertDomain(result.changes === 1, "conflict", "The care event state changed.");
      auditAt(actionActorId, "acknowledge_care", careEventId, now, {});
    });
  }

  function handleEscalation(
    sessionActorId: string,
    actionActorId: string,
    careEventId: string,
  ): void {
    assertDomain(sessionActorId === actionActorId, "forbidden", "The action actor does not match the Fixture session.");
    transaction(() => {
      const event = getCareEventWithRule(careEventId);
      const escalationIds = parseStringArray(event.escalation_member_ids_json);
      assertDomain(escalationIds.includes(actionActorId), "forbidden", "Actor is not in the escalation chain.");
      assertDomain(event.state === "escalated", "conflict", "The care event is not escalated.");
      const now = currentTime();
      database
        .prepare("UPDATE care_events SET state = 'closed', closed_at = ? WHERE id = ?")
        .run(now, careEventId);
      auditAt(actionActorId, "handle_escalation", careEventId, now, {});
    });
  }

  function deleteEvidence(
    sessionActorId: string,
    actionActorId: string,
    evidenceId: string,
  ): void {
    assertDomain(sessionActorId === actionActorId, "forbidden", "The action actor does not match the Fixture session.");
    transaction(() => {
      const evidence = row<EvidenceRow>(
        database.prepare("SELECT * FROM evidence WHERE id = ?").get(evidenceId),
      );
      assertDomain(evidence, "not_found", "Evidence is unavailable.");
      assertDomain(evidence.speaker_id === actionActorId, "forbidden", "Only the speaker can delete this evidence.");
      assertDomain(evidence.deleted === 0, "conflict", "Evidence is already deleted.");
      const now = currentTime();
      database.prepare("UPDATE evidence SET deleted = 1, text = '' WHERE id = ?").run(evidenceId);
      database.prepare("UPDATE signals SET status = 'needs_review' WHERE evidence_id = ?").run(evidenceId);
      database.prepare("UPDATE tasks SET status = 'needs_review' WHERE evidence_id = ?").run(evidenceId);
      database
        .prepare(
          `UPDATE domains SET status = 'needs_review'
           WHERE id IN (SELECT domain_id FROM tasks WHERE evidence_id = ?)`,
        )
        .run(evidenceId);
      auditAt(actionActorId, "delete_evidence", evidenceId, now, {
        dependentConclusions: "needs_review",
      });
    });
  }

  function getHandover(id: string): HandoverRow {
    const handover = row<HandoverRow>(
      database.prepare("SELECT * FROM handovers WHERE id = ?").get(id),
    );
    assertDomain(handover, "not_found", "Handover is unavailable.");
    return handover;
  }

  function getCareRule(id: string): CareRuleRow {
    const rule = row<CareRuleRow>(
      database.prepare("SELECT * FROM care_rules WHERE id = ?").get(id),
    );
    assertDomain(rule, "not_found", "Care rule is unavailable.");
    return rule;
  }

  function getCareEventWithRule(id: string): CareEventRow & {
    readonly subject_id: string;
    readonly acknowledgement_timeout_seconds: number;
    readonly escalation_member_ids_json: string;
  } {
    const event = row<CareEventRow & {
      readonly subject_id: string;
      readonly acknowledgement_timeout_seconds: number;
      readonly escalation_member_ids_json: string;
    }>(
      database
        .prepare(
          `SELECT care_events.*, care_rules.subject_id,
                  care_rules.acknowledgement_timeout_seconds,
                  care_rules.escalation_member_ids_json
           FROM care_events JOIN care_rules ON care_rules.id = care_events.care_rule_id
           WHERE care_events.id = ?`,
        )
        .get(id),
    );
    assertDomain(event, "not_found", "Care event is unavailable.");
    return event;
  }

  function handoverProjection(item: HandoverRow): HandoverProjection {
    const confirmedBy = [
      ...(item.from_confirmed === 1 ? [item.from_member_id] : []),
      ...(item.to_confirmed === 1 ? [item.to_member_id] : []),
    ];
    return {
      id: item.id,
      domainId: item.domain_id,
      fromMemberId: item.from_member_id,
      toMemberId: item.to_member_id,
      state: item.state,
      missingItems: item.has_last_report === 1 ? [] : ["last_report"],
      confirmedBy,
      version: item.version,
    };
  }

  function notification(
    logicalEventId: string,
    recipientId: string,
    channel: NotificationAdapterRequest["channel"],
    priority: NotificationAdapterRequest["priority"],
    templateId: string,
    text: string,
  ): PendingNotification {
    return { logicalEventId, recipientId, channel, priority, templateId, text };
  }

  async function deliver(request: PendingNotification): Promise<void> {
    const now = currentTime();
    const cutoff = new Date(Date.parse(now) - DEDUPE_WINDOW_MS).toISOString();
    const reservationId = transaction(() => {
      const duplicate = row<{ readonly id: number }>(
        database
          .prepare(
            `SELECT id FROM notification_logs
             WHERE logical_event_id = ? AND recipient_id = ? AND channel = ?
               AND occurred_at >= ? AND status != 'deduplicated'
             ORDER BY id DESC LIMIT 1`,
          )
          .get(request.logicalEventId, request.recipientId, request.channel, cutoff),
      );
      if (duplicate) {
        insertNotificationLog(request, "deduplicated", null, now);
        return null;
      }
      return insertNotificationLog(request, "queued", null, now);
    });

    if (reservationId === null) {
      return;
    }

    const adapter = adaptersByChannel.get(request.channel);
    if (!adapter) {
      updateNotificationLog(reservationId, "failed", "internal_failure");
      return;
    }
    try {
      const result = await adapter.send(request);
      updateNotificationLog(reservationId, result.status, result.safeCode);
    } catch {
      updateNotificationLog(reservationId, "failed", "internal_failure");
    }
  }

  function insertNotificationLog(
    request: PendingNotification,
    status: NotificationLogProjection["status"],
    safeCode: NotificationLogProjection["safeCode"],
    occurredAt: string,
  ): number {
    const result = database
      .prepare(
        `INSERT INTO notification_logs(
          logical_event_id, recipient_id, channel, priority, template_id,
          status, safe_code, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.logicalEventId,
        request.recipientId,
        request.channel,
        request.priority,
        request.templateId,
        status,
        safeCode,
        occurredAt,
      );
    return Number(result.lastInsertRowid);
  }

  function updateNotificationLog(
    id: number,
    status: NotificationLogProjection["status"],
    safeCode: NotificationLogProjection["safeCode"],
  ): void {
    database
      .prepare("UPDATE notification_logs SET status = ?, safe_code = ? WHERE id = ?")
      .run(status, safeCode, id);
  }

  function audit(
    actorId: string,
    action: string,
    targetId: string,
    metadata: Readonly<Record<string, string | number | boolean>>,
  ): void {
    auditAt(actorId, action, targetId, currentTime(), metadata);
  }

  function auditAt(
    actorId: string,
    action: string,
    targetId: string,
    occurredAt: string,
    metadata: Readonly<Record<string, string | number | boolean>>,
  ): void {
    database
      .prepare(
        `INSERT INTO audit_logs(actor_id, action, target_id, occurred_at, safe_metadata_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(actorId, action, targetId, occurredAt, JSON.stringify(metadata));
  }

  return { reset, execute, getState, queryAgent };
}
