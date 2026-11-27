import Link from "next/link";
import type { ArenaEntry } from "@/lib/delivery-evaluation";
import { deliveryMapForRules, deliveryMapLabels } from "@/lib/delivery-game";
import type { deliveryLadderOverview } from "@/lib/delivery-ladder-store";
import type { Translator } from "@/lib/i18n/shared";

type LadderOverview = Awaited<ReturnType<typeof deliveryLadderOverview>>;

export function DeliveryLadderPanel({ arena, t }: { arena: LadderOverview; t: Translator }) {
  const page = (target: number) => "/games/delivery?rankPage=" + target;
  return <section className="panel stack">
    <h2 className="panel-title">{t("Continuous standings")}</h2>
    <nav className="button-row" aria-label={t("Delivery standings")}>
      <Link href="/games/delivery" aria-current="page" className="button button-primary">{t("Live standings")}</Link>
      <Link href="/games/delivery?view=official" className="button button-secondary">{t("Past evaluations")}</Link>
    </nav>
    <p className="text-soft">{t("{count} registered bots", { count: arena.count })}{" \u00b7 "}
      {t("Matches are scheduled in turn, with older opportunities first.")}</p>
    <p className="text-soft">{t("Rank score is the rating minus its uncertainty.")}</p>
    {arena.eligible < 2 ? <p role="status">{t("Waiting for at least two playable bots")}</p> : null}
    {arena.standings.length ? <div className="table-wrap"><table className="table">
      <thead><tr><th>{t("Rank")}</th><th>{t("Bot")}</th><th>{t("Rank score")}</th><th>{t("Estimated rating")}</th><th>{t("Evaluated sets")}</th></tr></thead>
      <tbody>{arena.standings.map(row => <tr key={row.userId}>
        <td>{row.rank}</td><td>{row.rankedName}
          {row.state === "pending" ? <small className="text-soft">{" \u00b7 "}{t("Previous version")}</small> : null}</td>
        <td>{row.rankedScore}</td><td>{row.rankedRating}{" \u00b1 "}{row.rankedDeviation}</td><td>{row.rankedSets}</td>
      </tr>)}</tbody>
    </table></div> : <p className="empty">{t("No bots have finished placement yet.")}</p>}
    {arena.pages > 1 ? <nav className="button-row" aria-label={t("Delivery standings")}>
      {arena.page > 1 ? <Link className="button button-secondary" href={page(arena.page - 1)}>{t("Previous ranking page")}</Link> : null}
      {t("Ranking page {page} of {total}", { page: arena.page, total: arena.pages })}
      {arena.page < arena.pages ? <Link className="button button-secondary" href={page(arena.page + 1)}>{t("Next ranking page")}</Link> : null}
    </nav> : null}
    {arena.pairs.length ? <details>
      <summary>{t("Recent sets and replays")}</summary>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t("Bot A")}</th><th>{t("Bot B")}</th><th>{t("Map")}</th><th>{t("Evaluation mode")}</th><th>{t("Match replays")}</th></tr></thead>
        <tbody>{arena.pairs.map(pair => {
          const [a, b] = pair.entries as ArenaEntry[];
          return <tr key={pair.id}>
            <td>{a?.name}</td><td>{b?.name}</td>
            <td>{t(deliveryMapLabels[deliveryMapForRules(pair.matches[0]?.rules ?? "") ?? "classic"])}</td>
            <td>{pair.kind === "ladder-placement" ? t("Placement set") : t("Rated set")}</td>
            <td>{pair.matches.map((match, index) => <span key={match.id}>
              {index ? " / " : null}<Link href={`/games/delivery/matches/${match.id}`}>{index + 1}</Link>
            </span>)}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </details> : null}
  </section>;
}
