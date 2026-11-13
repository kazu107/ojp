import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { SiteIcon } from "@/components/site-icon";
import { StatusBadge } from "@/components/status-badge";
import { badgeClassForContestStatus, badgeClassForDifficulty, badgeClassForSubmission, contestStatusLabel, difficultyLabel, formatDate, submissionStatusLabel } from "@/lib/presentation";
import { canCreateProblemByRole, getProblemById, getContestStatus, listAnnouncementsForViewer, getOptionalCurrentUser, listContestsForListView, listPublicProblems, listRecentSubmissions } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { t, locale } = await getI18n();
  const me = await getOptionalCurrentUser();
  const problems = listPublicProblems();
  const contests = listContestsForListView(me?.id ?? "guest");
  const submissions = listRecentSubmissions(8);
  const announcements = listAnnouncementsForViewer(me?.id ?? "guest").slice(0, 5);
  const latestContest = contests[0];

  return (
    <div className="page dashboard-page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Dashboard")}</h1>
          <p className="page-subtitle">{t("Your problems, learning, and contests in one place.")}</p>
        </div>
        <div className="button-row">
          {me && canCreateProblemByRole(me.role) ? <Link href="/problems/new" className="button button-secondary"><SiteIcon name="plus" />{t("Create Problem")}</Link> : null}
          <Link href="/problems" className="button button-primary">{t("Browse Problems")}<SiteIcon name="arrow" /></Link>
        </div>
      </section>
      <nav className="dashboard-shortcuts" aria-label={t("Quick access")}>
        {[
          { href: "/problems", label: "Problems", description: "Find your next challenge.", icon: "problems" as const },
          { href: "/learn", label: "Learn", description: "Learn step by step with runnable code.", icon: "learn" as const },
          { href: "/contests", label: "Contests", description: "Compete, practice, and track your progress.", icon: "contests" as const },
        ].map(item => <Link key={item.href} className="dashboard-shortcut" href={item.href}>
          <SiteIcon name={item.icon} className="dashboard-shortcut-icon" />
          <div><strong>{t(item.label)}</strong><p>{t(item.description)}</p></div><SiteIcon name="arrow" />
        </Link>)}
      </nav>
      <section className="metric-grid dashboard-metrics" aria-label={t("Platform Snapshot")}>
        {[
          { label: "Public Problems", value: problems.length },
          { label: "Contests", value: contests.length },
          { label: "Recent Submissions", value: submissions.length },
        ].map(metric => <article key={metric.label} className="metric-card"><p className="metric-label">{t(metric.label)}</p><p className="metric-value">{metric.value}</p></article>)}
      </section>
      <section className="dashboard-grid">
        <article className="panel stack">
          <div className="page-head"><h2 className="panel-title">{t("Latest Submissions")}</h2><Link className="link" href="/submissions">{t("View all")}</Link></div>
          {submissions.length ? <div className="table-wrap">
            <table className="table table-compact">
              <thead><tr><th>{t("ID")}</th><th>{t("Problem")}</th><th>{t("Difficulty")}</th><th>{t("Status")}</th><th>{t("Submitted")}</th></tr></thead>
              <tbody>{submissions.map(submission => {
                const problem = getProblemById(submission.problemId);
                return <tr key={submission.id}>
                  <td><Link className="link" href={`/submissions/${submission.id}`}>{submission.id}</Link></td>
                  <td>{problem ? <Link className="link" href={`/problems/${problem.id}`}>{problem.title}</Link> : submission.problemId}</td>
                  <td>{problem ? <StatusBadge className={badgeClassForDifficulty(problem.difficulty)}>{t(difficultyLabel(problem.difficulty))}</StatusBadge> : "-"}</td>
                  <td><StatusBadge className={badgeClassForSubmission(submission.status)}>{t(submissionStatusLabel(submission.status))}</StatusBadge></td>
                  <td>{formatDate(submission.submittedAt, locale)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div> : <p className="empty">{t("No submissions found for the current filter.")}</p>}
        </article>
        <div className="dashboard-sidebar">
          <article className="panel stack">
            <div className="page-head"><h2 className="panel-title">{t("Contests")}</h2><Link className="link" href="/contests">{t("View all")}</Link></div>
            {latestContest ? <div className="stack">
              <div className="meta-inline"><StatusBadge className={badgeClassForContestStatus(getContestStatus(latestContest))}>{t(contestStatusLabel(getContestStatus(latestContest)))}</StatusBadge></div>
              <strong>{latestContest.title}</strong>
              <p className="text-soft">{t("Start: ")}{formatDate(latestContest.startAt, locale)}<br />{t("End: ")}{formatDate(latestContest.endAt, locale)}</p>
              <Link className="button button-secondary" href={`/contests/${latestContest.id}`}>{t("Open contest and scoreboard")}<SiteIcon name="arrow" /></Link>
            </div> : <p className="empty">{t("No contests available yet.")}</p>}
          </article>
          <article className="panel stack">
            <h2 className="panel-title">{t("Announcements")}</h2>
            {announcements.length ? <div className="stack">{announcements.map(announcement => <article key={announcement.id} className="announcement-item">
              <strong>{announcement.title}</strong><time dateTime={announcement.createdAt}>{formatDate(announcement.createdAt, locale)}</time><p>{announcement.body}</p>
            </article>)}</div> : <p className="empty">{t("No announcements.")}</p>}
          </article>
        </div>
      </section>
    </div>
  );
}
