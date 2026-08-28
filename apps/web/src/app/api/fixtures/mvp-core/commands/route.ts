import { NextResponse, type NextRequest } from "next/server";

import { MVP_CORE_FIXTURE_SESSION_COOKIE } from "../../../../../auth/mvp-core-fixture-session";
import { executeMvpCoreCommand } from "../../../../../integration/mvp-core/runtime";
import { resolveMvpCoreFixtureSession } from "../../../../../integration/mvp-core/session";
import { getMvpCoreDatabase } from "../../../../../server/mvp-core-database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const unavailable = (): NextResponse =>
  NextResponse.json(
    { error: "local_fixture_unavailable" },
    { headers: { "Cache-Control": "no-store" }, status: 503 },
  );

export async function POST(request: NextRequest): Promise<NextResponse> {
  let requestBody: unknown;
  try {
    requestBody = (await request.json()) as unknown;
  } catch {
    requestBody = undefined;
  }

  try {
    const session = resolveMvpCoreFixtureSession(
      request.cookies.get(MVP_CORE_FIXTURE_SESSION_COOKIE)?.value,
    );
    const result = await executeMvpCoreCommand(
      getMvpCoreDatabase(),
      session,
      requestBody,
    );
    return NextResponse.json(result.body, {
      headers: { "Cache-Control": "no-store" },
      status: result.status,
    });
  } catch {
    return unavailable();
  }
}
