"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "./i18n-provider";

export interface StudyValue { bookmarked: boolean; review: boolean; notes: string; reviewAt: string | null }
export function ProblemStudy({ problemId, initial }: { problemId: string; initial: StudyValue | null }) {
  const { t } = useI18n();
  const router=useRouter();
  const [value, setValue] = useState<StudyValue>(initial ?? { bookmarked: false, review: false, notes: "", reviewAt: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(reviewed = false) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/problems/${problemId}/study`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, reviewed }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to save.");
      setValue(body.study); router.refresh(); setMessage(reviewed ? "Review completed." : "Private notes saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save."); }
    finally { setBusy(false); }
  }
  return <section className="panel stack">
    <h2 className="panel-title">{t("My Study Notes")}</h2>
    <p className="text-soft">{t("Bookmarks and notes are private to your account.")}</p>
    <label><input type="checkbox" checked={value.bookmarked} onChange={event => setValue({ ...value, bookmarked: event.target.checked })} /> {t("Bookmark")}</label>
    <label><input type="checkbox" checked={value.review} onChange={event => setValue({ ...value, review: event.target.checked })} /> {t("Review Later")}</label>
    <label className="field"><span className="field-label">{t("Review Date")}</span><input className="input" type="date" value={value.reviewAt ? new Date(Date.parse(value.reviewAt) + 9 * 3600_000).toISOString().slice(0, 10) : ""} onChange={event => setValue({ ...value, reviewAt: event.target.value ? `${event.target.value}T00:00:00+09:00` : null })} /></label>
    <label className="field"><span className="field-label">{t("Private Notes")}</span><textarea className="textarea" maxLength={10000} value={value.notes} onChange={event => setValue({ ...value, notes: event.target.value })} /></label>
    <div className="button-row"><button className="button" type="button" disabled={busy} onClick={() => void save()}>{t("Save Notes")}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => void save(true)}>{t("Mark Reviewed")}</button></div>
    {message ? <p aria-live="polite">{t(message)}</p> : null}
  </section>;
}
