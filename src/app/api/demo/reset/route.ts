import { NextResponse } from "next/server";

import { readSessionRole, safeErrorResponse } from "@/app/api/demo/http";
import { getDemoService } from "@/server/runtime";

export const runtime = "nodejs";

export function POST(request: Request): NextResponse {
  try {
    const role = readSessionRole(request);
    return NextResponse.json(getDemoService().reset({ role }));
  } catch (error) {
    return safeErrorResponse(error);
  }
}
