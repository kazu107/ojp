"use client";

import { useI18n } from "@/components/i18n-provider";
import type { TranslationValues } from "@/lib/i18n/shared";

// Also works in module-level loading fallbacks without a component-local hook.
export function UiText({ text, values }: { text: string; values?: TranslationValues }) {
  const { t } = useI18n();
  return t(text, values);
}
