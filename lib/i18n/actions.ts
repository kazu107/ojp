"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "./shared";

export async function saveLocale(locale: Locale) {
  if (locale !== "ja" && locale !== "en") throw new Error("Invalid locale.");
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/", maxAge: 365 * 24 * 60 * 60, sameSite: "lax",
    secure: process.env.NODE_ENV === "production", httpOnly: true,
  });
}
