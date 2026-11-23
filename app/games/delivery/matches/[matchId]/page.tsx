import Link from "next/link";
import { notFound } from "next/navigation";
import { BoardPlayer } from "@/components/board-visualizer";
import { DeliveryRefresh } from "@/components/delivery-controls";
import { deliveryBoard, deliveryBoardReplay } from "@/lib/delivery-game";
import { deliveryEnabled, readDeliveryMatch } from "@/lib/delivery-store";
import { getI18n } from "@/lib/i18n/server";
import { getOptionalCurrentUser } from "@/lib/store";

export const dynamic = "force-dynamic";
export default async function DeliveryMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  if (!deliveryEnabled()) notFound();
  const { matchId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(matchId)) notFound();
  const user = await getOptionalCurrentUser();
  const match = await readDeliveryMatch(matchId, user?.id);
  if (!match) notFound();
  const { t } = await getI18n();
  const r = match.result;
  const names = match.names ?? [t("Your delivery bot"), t("Standard delivery bot")];
  const done = r?.frames.at(-1);
  return <div className="page stack">
    <section className="page-head">
      <h1 className="page-title">{t("Delivery match")}</h1>
      <Link className="button button-secondary" href="/games/delivery">{t("Delivery Duel")}</Link>
    </section>
    {r && done ? <>
      <section className="panel stack">
        <h2 className="panel-title">{r.outcome === "double_forfeit" ? t("Both bots forfeited") :
          r.winner === null ? t("Delivery draw") :
            t("{name} wins", { name: names[r.winner] ?? (r.winner === 0 ? "A" : "B") })}</h2>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("Bot")}</th><th>{t("Total delivery score")}</th><th>{t("Delivered orders")}</th><th>{t("Penalty")}</th><th>{t("Result")}</th></tr></thead>
          <tbody>{([0, 1] as const).map(seat => <tr key={seat}>
            <td>{seat === 0 ? "A" : "B"} · {names[seat]}</td><td>{r.totals[seat]}</td>
            <td>{done.couriers[seat].delivered}</td><td>{done.couriers[seat].penalty}</td>
            <td>{r.faults[seat] ? t(r.faults[seat]) : "—"}</td>
          </tr>)}</tbody>
        </table></div>
        <BoardPlayer replay={deliveryBoardReplay(r)} config={deliveryBoard} />
      </section>
      <details className="panel stack">
        <summary>{t("Turn history")}</summary>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("Turn")}</th><th>{t("Bot A")}</th><th>{t("Bot B")}</th></tr></thead>
          <tbody>{r.frames.slice(1).map(f => <tr key={f.turn}>
            <td>{f.turn}</td><td><code>{f.actions[0]}</code></td><td><code>{f.actions[1]}</code></td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </> : <section className="panel">
      <p role="status">{match.status === "failed" ? t("Delivery trial failed to run") :
        match.status === "running" ? t("Running") : t("Queued")}</p>
      <DeliveryRefresh pending={match.status === "queued" || match.status === "running"} />
    </section>}
  </div>;
}
