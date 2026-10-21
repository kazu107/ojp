import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import {
  findUser,
  getOptionalCurrentUser,
  getRatingStatistics,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export default async function RatingsPage() {
  const { t } = await getI18n();
  await getOptionalCurrentUser();
  const { ratings, history } = await getRatingStatistics();
  const rows = [...ratings].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Ratings")}</h1>
          <p className="page-subtitle">{t("OJP Elo Rating")}</p>
        </div>
        <Link className="button button-secondary" href="/contests">
          {t("Contests")}
        </Link>
      </section>
      <section className="panel stack">
        <h2 className="panel-title">{t("Rating Rules")}</h2>
        <p>
          {t(
            "Independent of AtCoder ratings. Initial rating: 1500; K: 32. Only public Rated contests count.",
          )}
        </p>
        <p>
          {t(
            "Each result is compared with every eligible opponent using Elo expected scores. Ties count as half a win, and the average difference determines the change.",
          )}
        </p>
        <p>
          {t(
            "Rated requires a public contest and at least two eligible participants. Organizers, problem authors and virtual participants are excluded.",
          )}
        </p>
        <p>
          {t(
            "Ratings are recalculated chronologically from judged official submissions. Pending judgments or internal errors defer this and later Rated results; rejudging never applies a change twice.",
          )}
        </p>
        <p className="text-soft">
          <code>
            {"expected = 1 / (1 + 10 ** ((opponent - current) / 400))"}
          </code>
          <br />
          <code>
            {"new = max(0, round(current + 32 * mean(actual - expected)))"}
          </code>
        </p>
      </section>
      <section className="panel stack">
        <h2 className="panel-title">{t("Rating Leaderboard")}</h2>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Rank")}</th>
                  <th>{t("User")}</th>
                  <th>{t("Rating")}</th>
                  <th>{t("Rated Contests")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([id, rating]) => (
                  <tr key={id}>
                    <td>
                      {rows.findIndex(([, value]) => value === rating) + 1}
                    </td>
                    <td>{findUser(id)?.displayName ?? id}</td>
                    <td>{rating}</td>
                    <td>
                      {history.filter((item) => item.userId === id).length}
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
    </div>
  );
}
