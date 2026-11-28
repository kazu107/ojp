import Link from "next/link";
import { notFound } from "next/navigation";
import { DeliveryAgentTokens } from "@/components/delivery-agent-controls";
import { getI18n } from "@/lib/i18n/server";
import { deliveryAgentEnabled, listAgentAccessTokens, listAgentDrafts } from "@/lib/delivery-agent-store";
import { getOptionalCurrentUser } from "@/lib/store";

export const dynamic = "force-dynamic";
export default async function DeliveryAgentSettings() {
  if (!deliveryAgentEnabled()) notFound();
  const user = await getOptionalCurrentUser();
  if (!user || user.status !== "active") notFound();
  const { t, locale } = await getI18n();
  const [tokens, drafts] = await Promise.all([listAgentAccessTokens(user.id), listAgentDrafts(user.id)]);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });
  return <div className="page stack">
    <section className="page-head">
      <h1 className="page-title">{t("Coding agent connection")}</h1>
      <Link href="/me" className="button button-secondary">{t("Profile")}</Link>
    </section>
    <section className="panel stack">
      <h2 className="panel-title">{t("Local MCP")}</h2>
      <p>{t("Run the local connector in your OJP checkout. Pass the token as an environment variable, not as a command argument.")}</p>
      <pre><code>{"npm ci\nnode scripts/ojp-agent.mjs mcp"}</code></pre>
      <p><code>OJP_AGENT_TOKEN</code>{" / "}<code>OJP_AGENT_URL</code></p>
    </section>
    <DeliveryAgentTokens tokens={tokens.map(token => ({ id: token.id, label: token.label, scopes: token.scopes,
      expiresLabel: fmt.format(token.expiresAt) + " JST",
      state: token.revokedAt ? "revoked" : token.expiresAt <= new Date() ? "expired" : "active" }))} />
    {drafts.length ? <section className="panel stack">
      <h2 className="panel-title">{t("Pending registration drafts")}</h2>
      <ul>{drafts.map(draft => <li key={draft.id}>
        <Link href={`/games/delivery/drafts/${draft.id}`}>{draft.name}</Link>{" \u00b7 "}{fmt.format(draft.expiresAt) + " JST"}
      </li>)}</ul>
    </section> : null}
  </div>;
}
