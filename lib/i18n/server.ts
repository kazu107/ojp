import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createTranslator, LOCALE_COOKIE, normalizeLocale } from "./shared";

export const getLocale = cache(async () => normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value));
export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: createTranslator(locale) };
}
