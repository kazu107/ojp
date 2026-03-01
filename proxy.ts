import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((request) => {
  const { pathname, search } = request.nextUrl;
  const isPublicPath =
    pathname === "/signin" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health/");

  if (isPublicPath || request.auth) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  const signInUrl = new URL("/signin", request.nextUrl.origin);
  signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

