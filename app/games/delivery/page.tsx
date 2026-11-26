import Link from "next/link";
import { notFound } from "next/navigation";
import { DeliveryAdmin, DeliveryBotEditor, DeliveryRefresh } from "@/components/delivery-controls";
import { getI18n } from "@/lib/i18n/server";
import { getOptionalCurrentUser } from "@/lib/store";
import { DELIVERY_REPLAY_PAGE_SIZE, deliveryEnabled, deliveryOverview } from "@/lib/delivery-store";
import { deliveryMapForRules, deliveryMapLabels } from "@/lib/delivery-game";

export const dynamic = "force-dynamic";
export default async function DeliveryPage({ searchParams }: {
  searchParams: Promise<{ evaluation?: string; view?: string; replays?: string }>;
}) {
  if (!deliveryEnabled()) notFound();
  const { locale, t } = await getI18n();
  const user = await getOptionalCurrentUser();
  const eligible = user?.status === "active" ? user : null;
  const { evaluation: selected, view, replays } = await searchParams;
  const rawPage = Number(replays);
  const page = Number.isSafeInteger(rawPage) ? Math.max(1, Math.min(rawPage, 250)) : 1;
  const arena = await deliveryOverview(eligible?.id, selected, view === "official" || selected ? "official" : "live", page);
  const replayCount = arena.evaluation?._count.matches ?? 0;
  const replayPages = Math.ceil(replayCount / DELIVERY_REPLAY_PAGE_SIZE);
  const replayLink = (target: number) => {
    const params = new URLSearchParams({ replays: String(target) });
    if (!arena.live) {
      params.set("view", "official");
      if (arena.latest) params.set("evaluation", arena.latest.id);
    }
    return "/games/delivery?" + params;
  };
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });
  const showDate = (time: Date) => format.format(time) + " JST";
  const waiting = arena.trials.some(m => m.status === "queued" || m.status === "running");
  const total = arena.progress.reduce((sum, row) => sum + row._count, 0);
  const finished = arena.progress.find(row => row.status === "completed")?._count ?? 0;
  const names = new Map(arena.entries?.map(entry => [entry.versionId, entry.name]));
  const kind = (value: string) => value === "weekly" ? t("Weekly evaluation") : t("Manual evaluation");

  return <div className="page stack">
    <section className="page-head">
      <h1 className="page-title">{t("Delivery Duel")}</h1>
      <Link className="button button-secondary" href="/games">{t("Games")}</Link>
    </section>
    <DeliveryRefresh pending={waiting || arena.liveWaiting || arena.active?.status === "active"} watch={arena.live} />
    <details className="panel stack">
      <summary>{t("Delivery rules and bot protocol")}</summary>
      <p>{t("Two bots share a 15×15 city for 100 turns. Pick up orders, carry up to two units, and deliver by the deadline. Bots may share a tile.")}</p>
      <p>{t("Each delivery earns its base score plus up to 20 bonus points. An expired order you are carrying costs its base score.")}</p>
      <p>{t("Both bots see the same board state before acting. When both claim one order, first pick alternates each turn.")}</p>
      <p>{t("Read the header, H grid rows, and N order rows every turn. Coordinates start at (0, 0) in the top left. Flush exactly one action per turn; exit on END.")}</p>
      <pre className="table-wrap">{`turn seat H W x y opponentX opponentY load scoreA scoreB N
<H rows of . and #>
<N rows of id pickupX pickupY dropoffX dropoffY deadline base size owner>

UP | DOWN | LEFT | RIGHT | WAIT | PICKUP id | DELIVER id`}</pre>
      <p>{t("Seat and owner are 0 (A) or 1 (B); an unclaimed order has owner -1. Legal actions that cannot be applied become WAIT.")}</p>
    </details>
    <section className="panel stack">
      <h2 className="panel-title">{t("Delivery standings")}</h2>
      {arena.liveAvailable ? <nav className="button-row" aria-label={t("Delivery standings")}>
        <Link href="/games/delivery" aria-current={arena.live ? "page" : undefined}
          className={arena.live ? "button button-primary" : "button button-secondary"}>{t("Live standings")}</Link>
        <Link href="/games/delivery?view=official" aria-current={!arena.live ? "page" : undefined}
          className={arena.live ? "button button-secondary" : "button button-primary"}>{t("Official evaluations")}</Link>
      </nav> : null}
      <p className="text-soft">{t("{count}/{max} registered bots", { count: arena.cap, max: arena.limit })}{" \u00b7 "}
        {arena.live ? (arena.sampled ? t("Live standings use eight assigned opponents per bot with swapped starts.") :
          t("Live rankings use one map with swapped starts and update after bot changes.")) :
          t("Weekly cutoff: Monday 03:00 JST. A win earns 3 points, a draw 1, a loss 0.")}</p>
      {arena.active?.status === "active" ? <p role="status">
        {t("Evaluating matches: {done}/{total}", { done: finished, total })}
      </p> : arena.active?.status === "failed" ? <p role="status">{t("Delivery evaluation needs an administrator to retry")}</p> :
        arena.liveWaiting ? <p role="status">{t("Waiting for live evaluation")}</p> : null}
      {eligible?.role === "admin" && (!arena.live || arena.active?.status === "failed") ? <DeliveryAdmin evaluationId={arena.active?.id}
        failed={arena.active?.status === "failed"} busy={Boolean(arena.active) || arena.cap < 2} /> : null}
      {arena.latest ? <p>{arena.live ? t("Last evaluated") : kind(arena.latest.kind)}{" \u00b7 "}{showDate(arena.latest.cutoff)}</p> : null}
      {arena.standings?.length ? <div className="table-wrap"><table className="table">
        <thead><tr><th>{t("Rank")}</th><th>{t("Bot")}</th><th>{t("Points")}</th><th>{t("Wins")}</th>
          <th>{t("Draws")}</th><th>{t("Losses")}</th><th>{t("Total delivery score")}</th></tr></thead>
        <tbody>{arena.standings.map(row => <tr key={row.versionId}>
          <td>{row.rank}</td><td>{row.name}</td><td>{row.points}</td>
          <td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.score}</td>
        </tr>)}</tbody>
      </table></div> : <p className="empty">{t("No delivery evaluation has been published yet.")}</p>}
      {arena.history.length > 1 ? <details>
        <summary>{t("Evaluation history")}</summary>
        <ul>{arena.history.map(item => <li key={item.id}><Link href={`/games/delivery?view=official&evaluation=${item.id}`}
          aria-current={item.id === arena.latest?.id ? "page" : undefined}>{kind(item.kind)}{" \u00b7 "}{showDate(item.cutoff)}</Link></li>)}</ul>
      </details> : null}
      {arena.evaluation && replayCount ? <details open={replays ? true : undefined}>
        <summary>{t("Match replays")} ({replayCount})</summary>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("Bot A")}</th><th>{t("Bot B")}</th><th>{t("Map")}</th><th>{t("Seed")}</th><th>{t("Starting positions")}</th></tr></thead>
          <tbody>{arena.evaluation.matches.map(match => <tr key={match.id}>
            <td><Link href={`/games/delivery/matches/${match.id}`}>{names.get(match.versionA ?? "")}</Link></td>
            <td>{names.get(match.versionB ?? "")}</td><td>{t(deliveryMapLabels[deliveryMapForRules(match.rules) ?? "classic"])}</td><td>{match.seed}</td>
            <td>{match.flipped ? t("Swapped") : t("Original")}</td>
          </tr>)}</tbody>
        </table></div>
        {replayPages > 1 && <nav className="button-row" aria-label={t("Match replays")}>
          {page > 1 ? <Link className="button button-secondary" href={replayLink(Math.min(page - 1, replayPages))}>{t("Previous replays")}</Link> : null}
          {t("Replay page {page} of {total}", { page: Math.min(page, replayPages), total: replayPages })}
          {page < replayPages ? <Link className="button button-secondary" href={replayLink(page + 1)}>{t("Next replays")}</Link> : null}
        </nav>}
      </details> : null}
    </section>
    <section className="panel stack">
      <h2 className="panel-title">{t("Your delivery bot")}</h2>
      {eligible ? <>
        {arena.bot ? <p>{t("Registered bot: {name}", { name: arena.bot.name })}</p> : null}
        <DeliveryBotEditor bot={arena.bot} trialPending={waiting} />
        {arena.trials.length ? <>
          <h3>{t("Private trial history")}</h3>
          <ul>{arena.trials.map(trial => <li key={trial.id}>
            <Link href={`/games/delivery/matches/${trial.id}`}>{showDate(trial.createdAt)}</Link>{" · "}
            {trial.status === "completed" ? t("Completed") : trial.status === "failed" ? t("Failed") :
              trial.status === "running" ? t("Running") : t("Queued")}
          </li>)}</ul>
        </> : null}
      </> : user ? <p>{t("User account is not active")}</p> :
        <Link className="button button-primary" href="/signin?callbackUrl=%2Fgames%2Fdelivery">{t("Sign in")}</Link>}
    </section>
  </div>;
}
