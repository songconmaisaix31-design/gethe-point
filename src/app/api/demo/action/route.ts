import { NextResponse } from "next/server";

import { readSessionRole, safeErrorResponse } from "@/app/api/demo/http";
import { DemoActionSchema } from "@/contracts";
import { domainError } from "@/domain/errors";
import { getDemoService } from "@/server/runtime";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const role = readSessionRole(request);
    const body: unknown = await request.json().catch(() => undefined);
    const action = DemoActionSchema.safeParse(body);
    if (!action.success) {
      throw domainError("invalid_request", "The demo action is invalid.");
    }
    const projection = await getDemoService().execute({ role }, action.data);
    return NextResponse.json(projection);
  } catch (error) {
    return safeErrorResponse(error);
  }
}
