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
  /^\/learn$/,
  /^\/ratings$/,
  /^\/learn\/[^/]+$/,
  /^\/learn\/[^/]+\/chapters\/[^/]+$/,
];

const PUBLIC_API_GET_PATTERNS: RegExp[] = [
  /^\/api\/health\/db$/,
  /^\/api\/ratings$/,
  /^\/api\/problems$/,
  /^\/api\/problems\/[^/]+$/,
  /^\/api\/problems\/[^/]+\/samples$/,
  /^\/api\/contests$/,
  /^\/api\/contests\/[^/]+$/,
  /^\/api\/contests\/[^/]+\/scoreboard$/,
  /^\/api\/submissions$/,
  /^\/api\/submissions\/[^/]+$/,
  /^\/api\/learning\/courses$/,
  /^\/api\/learning\/courses\/[^/]+$/,
  /^\/api\/learning\/courses\/[^/]+\/items\/[^/]+$/,
  /^\/api\/learning\/courses\/[^/]+\/progress$/,
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
  return NextResponse.redirect(new URL(`/signin?callbackUrl=${callback}`, request.url), 307);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|learning-runtime/pyodide/).*)"],
};
