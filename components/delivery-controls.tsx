"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CodeEditor } from "@/components/code-editor";
import { useI18n } from "@/components/i18n-provider";
import { DELIVERY_PYTHON_TEMPLATE } from "@/lib/delivery-templates";
import { SUBMISSION_LANGUAGES, type SubmissionLanguage } from "@/lib/languages";
import { languageLabel } from "@/lib/presentation";

export function DeliveryRefresh({ pending, watch = false }: { pending: boolean; watch?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending && !watch) return;
    const refresh = () => { if (!document.hidden) router.refresh(); };
    const timer = setInterval(refresh, pending ? 2000 : 8000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pending, router, watch]);
  return null;
}

function useDeliveryAction() {
  const router = useRouter(), { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const send = async (action: string, data: object = {}) => {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/games/delivery", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...data }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(typeof result.error === "string" ? t(result.error) : t("Unable to process delivery request"));
        return;
      }
      setNotice(action === "trial" ? t("Delivery trial queued") :
        action === "register" ? t("Delivery bot registered") :
        action === "withdraw" ? t("Delivery registration withdrawn") : t("Delivery evaluation queued"));
      router.refresh();
    } catch {
      setError(t("Unable to process delivery request"));
    } finally {
      setPending(false);
    }
  };
  return { send, notice, error, pending };
}

export function DeliveryBotEditor({ bot, trialPending }: {
  bot: { name: string; language: SubmissionLanguage; sourceCode: string } | null; trialPending: boolean;
}) {
  const { t } = useI18n();
  const { send, pending, notice, error } = useDeliveryAction();
  const [language, setLanguage] = useState<SubmissionLanguage>(bot?.language ?? "python");
  const [drafts, setDrafts] = useState<Partial<Record<SubmissionLanguage, string>>>({
    python: DELIVERY_PYTHON_TEMPLATE, pypy: DELIVERY_PYTHON_TEMPLATE,
    ...(bot ? { [bot.language]: bot.sourceCode } : {}),
  });
  const [name, setName] = useState(bot?.name ?? "");
  const sourceCode = drafts[language] ?? "";
  return <div className="stack">
    <label className="field">{t("Language")}
      <select value={language} onChange={e => setLanguage(e.target.value as SubmissionLanguage)}>
        {SUBMISSION_LANGUAGES.map(lang => <option key={lang} value={lang}>{languageLabel(lang)}</option>)}
      </select>
    </label>
    <CodeEditor language={language} value={sourceCode} minHeight={260}
      ariaLabel={t("Bot source code")} onChange={code => setDrafts(previous => ({ ...previous, [language]: code }))} />
    <label className="field">{t("Bot name")}
      <input value={name} onChange={e => setName(e.target.value)} maxLength={40} autoComplete="off" />
    </label>
    <div className="button-row">
      <button className="button button-secondary" type="button" disabled={pending || trialPending || !sourceCode.trim()}
        onClick={() => void send("trial", { language, sourceCode })}>{t("Try against the standard bot")}</button>
      <button className="button button-primary" type="button" disabled={pending || !sourceCode.trim() || !name.trim()}
        onClick={() => void send("register", { language, sourceCode, name })}>
        {bot ? t("Replace registered bot") : t("Register for evaluation")}
      </button>
      {bot ? <button className="button button-secondary" type="button" disabled={pending}
        onClick={() => void send("withdraw")}>{t("Withdraw bot")}</button> : null}
    </div>
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

export function DeliveryAdmin({ evaluationId, failed, busy }: { evaluationId?: string; failed: boolean; busy: boolean }) {
  const { t } = useI18n();
  const { send, pending, notice, error } = useDeliveryAction();
  return <div className="stack">
    <div className="button-row">
      {failed ? <button className="button button-secondary" type="button" disabled={pending}
        onClick={() => void send("retry", { id: evaluationId })}>{t("Retry failed delivery matches")}</button> :
        <button className="button button-secondary" type="button" disabled={pending || busy}
          onClick={() => void send("start")}>{t("Start manual evaluation")}</button>}
    </div>
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
