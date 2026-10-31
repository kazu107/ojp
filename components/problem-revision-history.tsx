"use client";
import { useEffect, useState } from "react";
import { useI18n } from "./i18n-provider";
import { formatDate } from "@/lib/presentation";

interface Revision { id: string; digest: string; kind: string; createdAt: string; changes: Array<{ field: string; before: string; after: string }> }
export function ProblemRevisionHistory({ problemId }: { problemId: string }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<Revision[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [current, setCurrent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/problems/${problemId}/revisions`, { cache: "no-store", signal: abort.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setRows(body.revisions); setCursor(body.nextCursor); setCurrent(body.currentDigest);
    }).catch(error => { if (!abort.signal.aborted) setError(String(error.message)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [problemId]);
  async function loadMore(){
    if(!cursor)return;setBusy(true);setError("");
    try{const response=await fetch(`/api/problems/${problemId}/revisions?cursor=${encodeURIComponent(cursor)}`,{cache:"no-store"});const body=await response.json();if(!response.ok)throw new Error(body.error);setRows(current=>[...current,...body.revisions]);setCursor(body.nextCursor);}catch(error){setError(error instanceof Error?error.message:"Unable to load revisions.")}finally{setBusy(false)}
  }
  async function restore(id: string) {
    if (!window.confirm(t("Restore this revision? Statement, settings, tags and tests will change. Existing submissions keep their pinned versions."))) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/problems/${problemId}/revisions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revisionId: id }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      window.location.reload();
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to restore revision."); setBusy(false); }
  }
  return <section className="panel stack">
    <h2 className="panel-title">{t("Revision History")}</h2>
    <p className="text-soft">{t("The latest 50 distinct versions are shown. Older recorded versions and pinned ZIPs remain stored.")}</p>
    {loading ? <p>{t("Loading...")}</p> : null}
    {error ? <p className="badge badge-red">{t(error)}</p> : null}
    {!loading && !rows.length ? <p>{t("No recorded revisions yet. History starts with saves after this feature was enabled.")}</p> : null}
    {rows.map(row => <article key={row.id} className="package-case-editor stack">
      <div className="meta-inline"><strong>{row.id.slice(0, 8)}</strong><span>{formatDate(row.createdAt, locale)}</span><span>{t(row.kind)}</span>{row.digest === current ? <span className="badge badge-green">{t("Current Revision")}</span> : null}</div>
      <div className="button-row"><button type="button" className="button button-secondary" aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{t("Show Changes")}</button><button type="button" className="button button-secondary" disabled={busy || row.digest === current} onClick={() => void restore(row.id)}>{t("Restore Revision")}</button></div>
      {expanded === row.id ? row.changes.map(change => <div key={change.field} className="stack"><strong>{t(change.field)}</strong><div className="form-grid"><div><span>{t("Before")}</span><pre className="code-block">{change.before}</pre></div><div><span>{t("After")}</span><pre className="code-block">{change.after}</pre></div></div></div>) : null}
    </article>)}
    {cursor ? <button className="button button-secondary" type="button" disabled={busy} onClick={()=>void loadMore()}>{t("Load More Revisions")}</button> : null}
  </section>;
}
