import { NextResponse } from "next/server";
import { auth } from "@/auth";

const PUBLIC_PAGE_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/signin$/,
  /^\/problems$/,
  /^\/problems\/[^/]+$/,
  /^\/contests$/,
  /^\/contests\/[^/]+$/,
  /^\/submissions$/,
  /^\/submissions\/[^/]+$/,
];

const PUBLIC_API_GET_PATTERNS: RegExp[] = [
  /^\/api\/health\/db$/,
  /^\/api\/problems$/,
  /^\/api\/problems\/[^/]+$/,
  /^\/api\/contests$/,
  /^\/api\/contests\/[^/]+$/,
  /^\/api\/contests\/[^/]+\/scoreboard$/,
  /^\/api\/submissions$/,
  /^\/api\/submissions\/[^/]+$/,
];

function matchesAny(pathname: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(pathname));
}

export default auth((request) => {
  const { pathname, search } = request.nextUrl;
  const isPublicPath = pathname.startsWith("/api/auth") || matchesAny(pathname, PUBLIC_PAGE_PATTERNS);
  const isPublicApiGet =
    request.method === "GET" && matchesAny(pathname, PUBLIC_API_GET_PATTERNS);

  if (isPublicPath || isPublicApiGet || request.auth) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  const callback = encodeURIComponent(`${pathname}${search}`);
  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: `/signin?callbackUrl=${callback}`,
    },
  });
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
