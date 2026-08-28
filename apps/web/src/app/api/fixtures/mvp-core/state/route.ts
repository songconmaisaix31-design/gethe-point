import { NextResponse, type NextRequest } from "next/server";

import { MVP_CORE_FIXTURE_SESSION_COOKIE } from "../../../../../auth/mvp-core-fixture-session";
import {
  isMvpCoreRuntimeFailure,
  readMvpCoreState,
} from "../../../../../integration/mvp-core/runtime";
import { resolveMvpCoreFixtureSession } from "../../../../../integration/mvp-core/session";
import { getMvpCoreDatabase } from "../../../../../server/mvp-core-database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = resolveMvpCoreFixtureSession(
      request.cookies.get(MVP_CORE_FIXTURE_SESSION_COOKIE)?.value,
    );
    const state = await readMvpCoreState(getMvpCoreDatabase(), session);
    return NextResponse.json(state, {
      headers: { "Cache-Control": "no-store" },
      status: 200,
    });
  } catch (error) {
    if (isMvpCoreRuntimeFailure(error)) {
      return NextResponse.json(
        { error: error.code },
        { headers: { "Cache-Control": "no-store" }, status: error.status },
      );
    }
    return NextResponse.json(
      { error: "local_fixture_unavailable" },
      { headers: { "Cache-Control": "no-store" }, status: 503 },
    );
  }
}
