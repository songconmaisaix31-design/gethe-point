import { NextResponse } from "next/server";

import { RoleSchema, type Role, type SafeErrorCode } from "@/contracts";
import { isDomainError } from "@/domain/errors";

const ERROR_STATUS: Readonly<Record<SafeErrorCode, number>> = {
  invalid_request: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  disabled: 503,
  timeout: 504,
  provider_unavailable: 502,
  internal_failure: 500,
};

export function readSessionRole(request: Request): Role {
  const searchParams = new URL(request.url).searchParams;
  const keys = [...searchParams.keys()];
  const role = RoleSchema.safeParse(searchParams.get("role"));
  if (!role.success || keys.length !== 1 || keys[0] !== "role") {
    throw Object.assign(new Error("A valid Fixture role is required."), {
      name: "DomainError",
      code: "invalid_request" as const,
    });
  }
  return role.data;
}

export function safeErrorResponse(error: unknown): NextResponse {
  if (isDomainError(error)) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: ERROR_STATUS[error.code] },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "internal_failure",
        message: "The demo action could not be completed.",
      },
    },
    { status: 500 },
  );
}
