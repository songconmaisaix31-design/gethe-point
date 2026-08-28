import type { DemoAction, Role, RoleSafeProjection, SafeError } from "../contracts";

export class DemoApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "DemoApiError";
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DemoApiError("服务返回了无法读取的响应。", "internal_failure");
  }
}

function isSafeError(value: unknown): value is SafeError {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = value.error;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRoleSafeProjection(value: unknown): value is RoleSafeProjection {
  if (!isRecord(value) || !["primary", "partner", "subject"].includes(String(value.role))) return false;
  if (!isRecord(value.report) || !Array.isArray(value.report.tasks)) return false;

  return [
    value.members,
    value.evidence,
    value.signals,
    value.domains,
    value.handovers,
    value.careRules,
    value.careEvents,
    value.notificationLogs,
  ].every(Array.isArray);
}

async function requestProjection(url: string, init?: RequestInit): Promise<RoleSafeProjection> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const payload: unknown = await readJson(response);

  if (!response.ok) {
    if (isSafeError(payload)) {
      throw new DemoApiError(payload.error.message, payload.error.code);
    }
    throw new DemoApiError("演示服务暂时不可用。", "internal_failure");
  }

  if (!isRoleSafeProjection(payload)) {
    throw new DemoApiError("演示服务返回了不完整的数据。", "internal_failure");
  }

  return payload;
}

export function getDemoState(role: Role): Promise<RoleSafeProjection> {
  return requestProjection(`/api/demo/state?role=${encodeURIComponent(role)}`);
}

export function postDemoAction(role: Role, action: DemoAction): Promise<RoleSafeProjection> {
  return requestProjection(`/api/demo/action?role=${encodeURIComponent(role)}`, {
    method: "POST",
    body: JSON.stringify(action),
  });
}

export async function resetDemo(role: Role): Promise<RoleSafeProjection> {
  return requestProjection(`/api/demo/reset?role=${encodeURIComponent(role)}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
