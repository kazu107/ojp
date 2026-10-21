import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { getRatingStatistics } from "@/lib/store";
import { formatDate } from "@/lib/presentation";

export async function RatingSummary({ userId }: { userId: string }) {
  const { t, locale } = await getI18n();
  const { ratings, history } = await getRatingStatistics();
  const items = history.filter((item) => item.userId === userId).reverse();
  return (
    <section className="panel stack">
      <h2 className="panel-title">{t("OJP Elo Rating")}</h2>
      <p className="metric-value">{ratings.get(userId) ?? t("Unrated")}</p>
      <p className="text-soft">
        {t(
          "Independent of AtCoder ratings. Initial rating: 1500; K: 32. Only public Rated contests count.",
        )}
      </p>
      <Link className="link" href="/ratings">
        {t("Rating Rules and Leaderboard")}
      </Link>
      {items.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Contests")}</th>
                <th>{t("Date")}</th>
                <th>{t("Rank")}</th>
                <th>{t("Rating Change")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.contestId}>
                  <td>
                    <Link className="link" href={`/contests/${item.contestId}`}>
                      {item.contestTitle}
                    </Link>
                  </td>
                  <td>{formatDate(item.endAt, locale)}</td>
                  <td>{item.rank}</td>
                  <td>
                    {item.previousRating}
                    {" → "}
                    {item.rating}
                    {" ("}
                    {item.delta >= 0 ? "+" : ""}
                    {item.delta}
                    {")"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{t("No Rated contest history yet.")}</p>
      )}
    </section>
  );
}
