"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";

type TokenView = { id: string; label: string; scopes: string[]; expiresLabel: string; state: "active" | "expired" | "revoked" };

async function post(path: string, body: object) {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Agent integration request failed");
  return data;
}

export function DeliveryAgentTokens({ tokens }: { tokens: TokenView[] }) {
  const { t } = useI18n(), router = useRouter();
  const [label, setLabel] = useState("");
  const [allowDrafts, setAllowDrafts] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await post("/api/agent-access/tokens", { label, allowDrafts });
      setSecret(result.secret);
      setLabel("");
      router.refresh();
    } catch (e) { setError(t(e instanceof Error ? e.message : "Agent integration request failed")); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await post("/api/agent-access/tokens/" + id + "/revoke", {});
      setSecret("");
      setNotice(t("Agent token revoked"));
      router.refresh();
    } catch (e) { setError(t(e instanceof Error ? e.message : "Agent integration request failed")); }
    finally { setBusy(false); }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setNotice(t("Agent token copied"));
    } catch { setError(t("Copy the token from the field")); }
  }
  return <section className="panel stack">
    <h2 className="panel-title">{t("Agent tokens")}</h2>
    <form className="stack" onSubmit={create}>
      <label className="field">{t("Token label")}
        <input value={label} onChange={event => setLabel(event.target.value)} maxLength={40} required autoComplete="off" />
      </label>
      <label><input type="checkbox" checked={allowDrafts} onChange={event => setAllowDrafts(event.target.checked)} />
        {" "}{t("Allow preparing registration drafts")}
      </label>
      <div className="button-row">
        <button className="button button-primary" type="submit" disabled={busy || !label.trim()}>{t("Create agent token")}</button>
      </div>
    </form>
    {secret ? <div className="stack">
      <p>{t("This token is shown only once. Keep it out of source code and chat messages.")}</p>
      <label className="field">{t("New agent token")}<input readOnly value={secret} autoComplete="off" spellCheck={false} /></label>
      <div className="button-row">
        <button className="button button-secondary" type="button" onClick={() => void copy()}>{t("Copy agent token")}</button>
      </div>
    </div> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {tokens.length ? <div className="table-wrap"><table className="table">
      <thead><tr><th>{t("Token label")}</th><th>{t("Permissions")}</th><th>{t("Token expiration")}</th><th>{t("Status")}</th><th>{t("Actions")}</th></tr></thead>
      <tbody>{tokens.map(token => <tr key={token.id}>
        <td>{token.label}</td>
        <td>{token.scopes.includes("delivery:prepare") ? t("Trial and registration drafts") : t("Trial only")}</td>
        <td>{token.expiresLabel}</td>
        <td>{token.state === "revoked" ? t("Revoked") : token.state === "expired" ? t("Expired") : t("Active")}</td>
        <td>{token.state === "active" ? <button className="button button-secondary" type="button" disabled={busy}
          onClick={() => void revoke(token.id)}>{t("Revoke token")}</button> : null}</td>
      </tr>)}</tbody>
    </table></div> : null}
  </section>;
}

export function ApproveDeliveryAgentDraft({ id, sourceDigest }: { id: string; sourceDigest: string }) {
  const { t } = useI18n(), router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function approve() {
    setBusy(true);
    setError("");
    try {
      await post("/api/agent-access/delivery/drafts/" + id + "/confirm", { sourceDigest });
      router.refresh();
    } catch (e) { setError(t(e instanceof Error ? e.message : "Agent integration request failed")); }
    finally { setBusy(false); }
  }
  return <div className="stack">
    <div className="button-row"><button className="button button-primary" type="button" disabled={busy}
      onClick={() => void approve()}>{t("Approve and register bot")}</button></div>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
