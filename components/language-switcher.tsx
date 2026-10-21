"use client";

import { useI18n } from "./i18n-provider";

export function LanguageSwitcher() {
  const { locale, t, pending, error, changeLocale } = useI18n();
  return <div className="language-switcher">
    <div className="language-options" role="group" aria-label={t("Display language")} aria-busy={pending}>
      <button type="button" lang="ja" aria-pressed={locale === "ja"} disabled={pending}
        onClick={() => changeLocale("ja")}>日本語</button>
      <button type="button" lang="en" aria-pressed={locale === "en"} disabled={pending}
        onClick={() => changeLocale("en")}>English</button>
    </div>
    {error ? <span className="language-error" role="alert">{t(error)}</span> : null}
  </div>;
}
