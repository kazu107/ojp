import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForContestStatus,
  badgeClassForDifficulty,
  badgeClassForSubmission,
  contestStatusLabel,
  difficultyLabel,
  formatDate,
  submissionStatusLabel,
} from "@/lib/presentation";
import {
  buildScoreboard,
  canCreateProblemByRole,
  getProblemById,
  getContestStatus,
  listAnnouncementsForViewer,
  getOptionalCurrentUser,
  listContestsForListView,
  listPublicProblems,
  listRecentSubmissions,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const me = await getOptionalCurrentUser();
  const canCreateProblem = me ? canCreateProblemByRole(me.role) : false;
  const problems = listPublicProblems();
  const contests = listContestsForListView(me?.id ?? "guest");
  const submissions = listRecentSubmissions(8);
  const announcements = listAnnouncementsForViewer(me?.id ?? "guest").slice(0, 5);
  const latestContest = contests[0];
  const latestScoreboard = latestContest ? buildScoreboard(latestContest.id) : [];

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">OJP Dashboard</h1>
          <p className="page-subtitle">
            MVP prototype based on `atcoder_like_platform_spec_draft.md`.
            You can view recent submissions, contest status, and scoreboard activity here.
          </p>
        </div>
        <div className="button-row">
          {canCreateProblem ? (
            <Link href="/problems/new" className="button">
              Create Problem
            </Link>
          ) : null}
          <Link href="/submissions" className="button button-secondary">
            View Submissions
          </Link>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Platform Snapshot</h2>
        <p className="panel-subtitle">
          Signed in as: <span className="kpi">{me?.displayName ?? "Guest"}</span>
        </p>
        <div className="metric-grid">
          <article className="metric-card">
            <p className="metric-label">Public Problems</p>
            <p className="metric-value">{problems.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Contests</p>
            <p className="metric-value">{contests.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Recent Submissions</p>
            <p className="metric-value">{submissions.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Scoreboard Entries</p>
            <p className="metric-value">{latestScoreboard.length}</p>
          </article>
        </div>
      </section>

      <section className="panel stack">
        <div className="page-head">
          <div>
            <h2 className="panel-title">Announcements</h2>
            <p className="panel-subtitle">Latest platform updates and moderation notices.</p>
          </div>
        </div>
        {announcements.length === 0 ? (
          <p className="empty">No announcements.</p>
        ) : (
          <div className="stack">
            {announcements.map((announcement) => (
              <article key={announcement.id} className="stack">
                <div className="meta-inline">
                  <strong>{announcement.title}</strong>
                  <span className="text-soft">{formatDate(announcement.createdAt)}</span>
                </div>
                <p className="text-soft">{announcement.body}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="grid-2">
        <article className="panel stack">
          <div className="page-head">
            <div>
              <h2 className="panel-title">Latest Submissions</h2>
              <p className="panel-subtitle">
                Recent status transitions (AC / WA / TLE / ...) for the latest submissions.
              </p>
            </div>
            <Link className="link" href="/submissions">
              View all
            </Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Problem</th>
                  <th>Difficulty</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => {
                  const problem = getProblemById(submission.problemId);
                  return (
                    <tr key={submission.id}>
                      <td>
                        <Link className="link" href={`/submissions/${submission.id}`}>
                          {submission.id}
                        </Link>
                      </td>
                      <td>
                        {problem ? (
                          <Link className="link" href={`/problems/${problem.id}`}>
                            {problem.title}
                          </Link>
                        ) : (
                          submission.problemId
                        )}
                      </td>
                      <td>
                        {problem ? (
                          <StatusBadge className={badgeClassForDifficulty(problem.difficulty)}>
                            {difficultyLabel(problem.difficulty)}
                          </StatusBadge>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <StatusBadge className={badgeClassForSubmission(submission.status)}>
                          {submissionStatusLabel(submission.status)}
                        </StatusBadge>
                      </td>
                      <td>{formatDate(submission.submittedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel stack">
          <div className="page-head">
            <div>
              <h2 className="panel-title">Contest State</h2>
              <p className="panel-subtitle">Automatic state: scheduled / running / ended</p>
            </div>
            <Link className="link" href="/contests">
              View all
            </Link>
          </div>
          {latestContest ? (
            <div className="stack">
              <div className="meta-inline">
                <strong>{latestContest.title}</strong>
                <StatusBadge className={badgeClassForContestStatus(getContestStatus(latestContest))}>
                  {contestStatusLabel(getContestStatus(latestContest))}
                </StatusBadge>
              </div>
              <p className="text-soft">{latestContest.descriptionMarkdown}</p>
              <p className="text-soft">
                Start: {formatDate(latestContest.startAt)} / End: {formatDate(latestContest.endAt)}
              </p>
              <Link className="button button-secondary" href={`/contests/${latestContest.id}`}>
                Open contest and scoreboard
              </Link>
            </div>
          ) : (
            <p className="empty">No contests available yet.</p>
          )}
        </article>
      </section>
    </div>
  );
}
