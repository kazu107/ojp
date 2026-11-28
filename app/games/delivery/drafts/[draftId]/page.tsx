import Link from "next/link";
import { notFound } from "next/navigation";
import { ApproveDeliveryAgentDraft } from "@/components/delivery-agent-controls";
import { agentCodeChange } from "@/lib/delivery-agent-diff";
import { agentUuid, deliveryAgentEnabled, getAgentDraftForReview } from "@/lib/delivery-agent-store";
import { getI18n } from "@/lib/i18n/server";
import { languageLabel } from "@/lib/presentation";
import { getOptionalCurrentUser } from "@/lib/store";

export const dynamic = "force-dynamic";
export default async function DeliveryAgentDraftReview({ params }: { params: Promise<{ draftId: string }> }) {
  if (!deliveryAgentEnabled()) notFound();
  const { draftId } = await params;
  if (!agentUuid(draftId)) notFound();
  const user = await getOptionalCurrentUser();
  if (!user || user.status !== "active") notFound();
  const draft = await getAgentDraftForReview(user.id, draftId);
  if (!draft) notFound();
  const { t } = await getI18n();
  const change = draft.sourceCode ? agentCodeChange(draft.current?.sourceCode ?? "", draft.sourceCode) : null;
  return <div className="page stack">
    <section className="page-head">
      <h1 className="page-title">{t("Review agent registration draft")}</h1>
      <Link href="/games/delivery" className="button button-secondary">{t("Delivery Duel")}</Link>
    </section>
    <section className="panel stack">
      <h2 className="panel-title">{draft.name}</h2>
      <p>{languageLabel(draft.language)}</p>
      <Link href={`/games/delivery/matches/${draft.trialId}`}>{t("Open tested replay")}</Link>
      {draft.appliedAt ? <p role="status">{t("This draft has been registered")}</p> :
        !draft.sourceCode ? <p role="status">{t("Agent draft is no longer available")}</p> :
        draft.stale ? <p role="status">{t("The registered bot changed after this draft was prepared")}</p> : null}
      {change && (change.removed.length || change.added.length) ? <section className="stack">
        <h3>{t("Changes starting at line {line}", { line: change.startLine })}</h3>
        <pre className="table-wrap"><code>{[
          ...change.removed.map(line => "- " + line), ...change.added.map(line => "+ " + line),
        ].join("\n")}</code></pre>
      </section> : draft.sourceCode ? <p>{t("Source code is unchanged")}</p> : null}
      {draft.sourceCode ? <details open>
        <summary>{t("Full proposed code")}</summary>
        <pre className="table-wrap"><code>{draft.sourceCode}</code></pre>
      </details> : null}
      {!draft.appliedAt && draft.sourceCode && !draft.stale ? <>
        <p>{t("Approving replaces your registered bot and starts ranked placement.")}</p>
        <ApproveDeliveryAgentDraft id={draft.id} sourceDigest={draft.sourceDigest} />
      </> : null}
    </section>
  </div>;
}
