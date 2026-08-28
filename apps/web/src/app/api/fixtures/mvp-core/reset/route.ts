import { NextResponse, type NextRequest } from "next/server";

import { MvpCoreResetRequestSchema } from "../../../../../../../../packages/testkit/src/integration-seam";
import { MVP_CORE_FIXTURE_SESSION_COOKIE } from "../../../../../auth/mvp-core-fixture-session";
import {
  isMvpCoreRuntimeFailure,
  resetMvpCoreState,
} from "../../../../../integration/mvp-core/runtime";
import { resolveMvpCoreFixtureSession } from "../../../../../integration/mvp-core/session";
import { getMvpCoreDatabase } from "../../../../../server/mvp-core-database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = resolveMvpCoreFixtureSession(
    request.cookies.get(MVP_CORE_FIXTURE_SESSION_COOKIE)?.value,
  );
  let requestBody: unknown;
  try {
    requestBody = (await request.json()) as unknown;
  } catch {
    requestBody = undefined;
  }

  if (!MvpCoreResetRequestSchema.safeParse(requestBody).success) {
    return NextResponse.json(
      { error: "invalid_request" },
      { headers: { "Cache-Control": "no-store" }, status: 400 },
    );
  }

  try {
    await resetMvpCoreState(getMvpCoreDatabase(), session);
    return new NextResponse(null, {
      headers: { "Cache-Control": "no-store" },
      status: 204,
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
