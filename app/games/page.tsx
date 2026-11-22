import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import {
  getOptionalCurrentUser,
  listProblemsForListView,
  canCreateProblemByRole,
} from "@/lib/store";
import { SiteIcon } from "@/components/site-icon";

export const dynamic = "force-dynamic";
export default async function GamesPage() {
  const { t } = await getI18n(),
    user = await getOptionalCurrentUser();
  const games = listProblemsForListView(user?.id ?? "guest").filter(
    (p) => p.heuristic?.game,
  );
  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Games")}</h1>
          <p className="page-subtitle">
            {t(
              "Control a robot with code, inspect its replay, and improve your score.",
            )}
          </p>
        </div>
        {user && canCreateProblemByRole(user.role) ? (
          <Link className="button button-primary" href="/problems/new">
            {t("Create a game problem")}
          </Link>
        ) : null}
      </section>
      <div className="learning-course-grid">
        {games.map((problem) => (
          <article className="panel stack game-card" key={problem.id}>
            <div className="game-card-icon">
              <SiteIcon name="games" />
              <span>
                {t(
                  problem.heuristic!.game!.objective === "maze"
                    ? "Maze robot"
                    : "Treasure collector",
                )}
              </span>
            </div>
            <h2 className="panel-title">{problem.title}</h2>
            <p className="text-soft">
              {t(
                problem.heuristic!.game!.protocol === "turns"
                  ? "One action per observation"
                  : "Output all actions",
              )}
            </p>
            <div className="button-row">
              <Link
                className="button button-primary"
                href={`/games/${problem.id}`}
              >
                {t("Open game")}
              </Link>
              <Link
                className="button button-secondary"
                href={`/problems/${problem.id}`}
              >
                {t("Problem statement")}
              </Link>
            </div>
          </article>
        ))}
      </div>
      {!games.length ? (
        <section className="panel">
          <p className="empty">
            {t("No game problems have been published yet.")}
          </p>
        </section>
      ) : null}
    </div>
  );
}
