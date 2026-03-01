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
