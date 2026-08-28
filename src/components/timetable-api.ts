import type { Role } from "../contracts";

export type TimetableCategory = "responsibility" | "care" | "family";
export type TimetableStatus = "planned" | "completed";
export type AgentIntent = "schedule" | "responsibilities" | "care" | "help";

export interface TimetableMember {
  readonly id: string;
  readonly displayName: string;
  readonly role: Role;
}

export interface TimetableDomain {
  readonly id: string;
  readonly name: string;
}

export interface TimetableItem {
  readonly id: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly category: TimetableCategory;
  readonly ownerId: string;
  readonly domainId: string | null;
  readonly status: TimetableStatus;
  readonly visibility: "household" | "self";
  readonly canComplete: boolean;
}

export interface TimetableProjection {
  readonly role: Role;
  readonly now: string;
  readonly members: readonly TimetableMember[];
  readonly domains: readonly TimetableDomain[];
  readonly timetableItems: readonly TimetableItem[];
}

export interface AgentResponse {
  readonly intent: AgentIntent;
  readonly targetMemberId: string;
  readonly text: string;
  readonly referencedItemIds: readonly string[];
  readonly suggestedActions: readonly ("view_timetable" | "add_item" | "open_demo")[];
  readonly engine: "fixture_intent_router";
}

export interface CreateTimetableItem {
  readonly type: "create_timetable_item";
  readonly ownerId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly durationMinutes: number;
  readonly category: TimetableCategory;
  readonly domainId?: string;
}

export interface CompleteTimetableItem {
  readonly type: "complete_timetable_item";
  readonly itemId: string;
}

type TimetableAction = CreateTimetableItem | CompleteTimetableItem;

export class TimetableApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "TimetableApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRole(value: unknown): value is Role {
  return value === "primary" || value === "partner" || value === "subject";
}

function isMember(value: unknown): value is TimetableMember {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    isRole(value.role)
  );
}

function isDomain(value: unknown): value is TimetableDomain {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isTimetableItem(value: unknown): value is TimetableItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.startsAt === "string" &&
    typeof value.endsAt === "string" &&
    ["responsibility", "care", "family"].includes(String(value.category)) &&
    typeof value.ownerId === "string" &&
    (value.domainId === null || typeof value.domainId === "string") &&
    ["planned", "completed"].includes(String(value.status)) &&
    ["household", "self"].includes(String(value.visibility)) &&
    typeof value.canComplete === "boolean"
  );
}

function isProjection(value: unknown): value is TimetableProjection {
  return (
    isRecord(value) &&
    isRole(value.role) &&
    typeof value.now === "string" &&
    Array.isArray(value.members) &&
    value.members.every(isMember) &&
    Array.isArray(value.domains) &&
    value.domains.every(isDomain) &&
    Array.isArray(value.timetableItems) &&
    value.timetableItems.every(isTimetableItem)
  );
}

function isAgentResponse(value: unknown): value is AgentResponse {
  return (
    isRecord(value) &&
    ["schedule", "responsibilities", "care", "help"].includes(String(value.intent)) &&
    typeof value.targetMemberId === "string" &&
    typeof value.text === "string" &&
    Array.isArray(value.referencedItemIds) &&
    value.referencedItemIds.every((item) => typeof item === "string") &&
    Array.isArray(value.suggestedActions) &&
    value.suggestedActions.every((item) =>
      ["view_timetable", "add_item", "open_demo"].includes(String(item)),
    ) &&
    value.engine === "fixture_intent_router"
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TimetableApiError("服务返回了无法读取的响应。", "internal_failure");
  }
}

function errorFrom(payload: unknown, fallback: string): TimetableApiError {
  if (isRecord(payload) && isRecord(payload.error)) {
    const message = payload.error.message;
    const code = payload.error.code;
    if (typeof message === "string" && typeof code === "string") {
      return new TimetableApiError(message, code);
    }
  }
  return new TimetableApiError(fallback, "internal_failure");
}

export async function getTimetableState(role: Role): Promise<TimetableProjection> {
  const response = await fetch(`/api/demo/state?role=${encodeURIComponent(role)}`, {
    cache: "no-store",
  });
  const payload = await readJson(response);
  if (!response.ok) throw errorFrom(payload, "家庭日程暂时无法加载。");
  if (!isProjection(payload)) {
    throw new TimetableApiError("家庭日程数据不完整。", "internal_failure");
  }
  return payload;
}

export async function postTimetableAction(
  role: Role,
  action: TimetableAction,
): Promise<TimetableProjection> {
  const response = await fetch(`/api/demo/action?role=${encodeURIComponent(role)}`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action),
  });
  const payload = await readJson(response);
  if (!response.ok) throw errorFrom(payload, "日程操作没有完成。");
  if (!isProjection(payload)) {
    throw new TimetableApiError("服务没有返回更新后的家庭日程。", "internal_failure");
  }
  return payload;
}

export async function queryMemberAgent(
  role: Role,
  request: { readonly targetMemberId: string; readonly message: string; readonly intentHint?: AgentIntent },
): Promise<AgentResponse> {
  const response = await fetch(`/api/demo/agent?role=${encodeURIComponent(role)}`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await readJson(response);
  if (!response.ok) throw errorFrom(payload, "成员 Agent 暂时无法回答。");
  if (!isAgentResponse(payload)) {
    throw new TimetableApiError("成员 Agent 返回了不完整的回答。", "internal_failure");
  }
  return payload;
}
