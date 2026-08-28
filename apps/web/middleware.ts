import { NextResponse, type NextRequest } from "next/server";

import {
  issueLocalFixtureSessionId,
  MVP_CORE_FIXTURE_SESSION_COOKIE,
  MVP_CORE_FIXTURE_SESSION_PATH,
} from "./src/auth/mvp-core-fixture-session";

const fixturePage = (pathname: string): boolean =>
  pathname === "/" || pathname === "/fixtures/mvp-core";

export function middleware(request: NextRequest): NextResponse {
  if (!fixturePage(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const selectedRole = request.nextUrl.searchParams.get("role") ?? "primary";
  const sessionId = issueLocalFixtureSessionId(selectedRole);
  const response = NextResponse.next();

  response.headers.set("Cache-Control", "no-store");
  if (sessionId === undefined) {
    response.cookies.delete({
      name: MVP_CORE_FIXTURE_SESSION_COOKIE,
      path: MVP_CORE_FIXTURE_SESSION_PATH,
    });
    return response;
  }

  response.cookies.set(MVP_CORE_FIXTURE_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    maxAge: 60 * 60,
    path: MVP_CORE_FIXTURE_SESSION_PATH,
    sameSite: "strict",
    secure: request.nextUrl.protocol === "https:",
  });
  return response;
}

export const config = {
  matcher: ["/", "/fixtures/mvp-core"],
};
