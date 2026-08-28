import { NextResponse } from "next/server";

import { readSessionRole, safeErrorResponse } from "@/app/api/demo/http";
import { AgentQueryRequestSchema } from "@/contracts";
import { domainError } from "@/domain/errors";
import { getDemoService } from "@/server/runtime";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const role = readSessionRole(request);
    const body: unknown = await request.json().catch(() => undefined);
    const query = AgentQueryRequestSchema.safeParse(body);
    if (!query.success) {
      throw domainError("invalid_request", "The Agent query is invalid.");
    }
    return NextResponse.json(
      getDemoService().queryAgent({ role }, query.data),
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
