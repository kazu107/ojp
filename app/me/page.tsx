import { ProfileForm } from "@/components/profile-form";
import { formatDate, languageLabel, submissionStatusLabel } from "@/lib/presentation";
import {
  getCurrentUser,
  listContestsForListView,
  listProblemsForListView,
  listSubmissionsForViewer,
} from "@/lib/store";
import { Language } from "@/lib/types";
import { SUBMISSION_STATUS_VALUES } from "@/lib/submission-status";

const PROFILE_LANGUAGES: Language[] = ["cpp", "python", "java", "javascript"];

function formatRate(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatAverage(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1);
}

export const dynamic = "force-dynamic";

export default async function MePage() {
  const user = await getCurrentUser();
  const submissions = listSubmissionsForViewer(user.id, { userId: user.id });
  const problems = listProblemsForListView(user.id);
  const contests = listContestsForListView(user.id);

  const authoredProblems = problems.filter((problem) => problem.authorId === user.id);
  const publicAuthoredProblems = authoredProblems.filter((problem) => problem.visibility === "public");
  const packagedAuthoredProblems = authoredProblems.filter((problem) => problem.latestPackageSummary);
  const organizedContests = contests.filter((contest) => contest.organizerId === user.id);
  const joinedContests = contests.filter((contest) => contest.participantUserIds.includes(user.id));
  const contestSubmissions = submissions.filter((submission) => submission.contestId !== null);
  const practiceSubmissions = submissions.filter((submission) => submission.contestId === null);
  const acceptedSubmissions = submissions.filter((submission) => submission.status === "accepted");
  const judgedSubmissions = submissions.filter((submission) => submission.judgedAt);
  const solvedProblemIds = new Set(acceptedSubmissions.map((submission) => submission.problemId));
  const totalScore = submissions.reduce((acc, submission) => acc + submission.score, 0);
  const averageScore = submissions.length > 0 ? totalScore / submissions.length : 0;
  const totalTimeMs = judgedSubmissions.reduce((acc, submission) => acc + submission.totalTimeMs, 0);
  const averageTimeMs = judgedSubmissions.length > 0 ? totalTimeMs / judgedSubmissions.length : 0;
  const peakMemoryKb = submissions.reduce(
    (max, submission) => Math.max(max, submission.peakMemoryKb),
    0,
  );
  const firstSubmissionAt =
    submissions.length > 0 ? submissions[submissions.length - 1].submittedAt : null;
  const lastSubmissionAt = submissions.length > 0 ? submissions[0].submittedAt : null;

  const bestScoreByProblem = new Map<string, number>();
  for (const submission of submissions) {
    bestScoreByProblem.set(
      submission.problemId,
      Math.max(bestScoreByProblem.get(submission.problemId) ?? 0, submission.score),
    );
  }
  const bestScoreSum = [...bestScoreByProblem.values()].reduce((acc, score) => acc + score, 0);

  const languageStats = PROFILE_LANGUAGES.map((language) => {
    const scoped = submissions.filter((submission) => submission.language === language);
    const accepted = scoped.filter((submission) => submission.status === "accepted");
    return {
      language,
      submissions: scoped.length,
      accepted: accepted.length,
      rate: scoped.length > 0 ? (accepted.length / scoped.length) * 100 : 0,
    };
  });

  const verdictStats = SUBMISSION_STATUS_VALUES.map((status) => ({
    status,
    count: submissions.filter((submission) => submission.status === status).length,
  })).filter((entry) => entry.count > 0);

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-subtitle">
            プロフィール編集と、自分の提出・作成・参加状況の統計をまとめて確認できます。
          </p>
        </div>
      </section>

      <section className="panel stack">
        <p className="text-soft">Username: {user.username}</p>
        <p className="text-soft">Display Name: {user.displayName}</p>
        <p className="text-soft">Role: {user.role}</p>
        <p className="text-soft">Status: {user.status}</p>
        <p className="text-soft">Created: {formatDate(user.createdAt)}</p>
        <p className="text-soft">Updated: {formatDate(user.updatedAt)}</p>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Overview</h2>
        <div className="metric-grid">
          <article className="metric-card">
            <p className="metric-label">Solved Problems</p>
            <p className="metric-value">{solvedProblemIds.size}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Submissions</p>
            <p className="metric-value">{submissions.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Accepted</p>
            <p className="metric-value">{acceptedSubmissions.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Acceptance Rate</p>
            <p className="metric-value">
              {submissions.length > 0 ? formatRate((acceptedSubmissions.length / submissions.length) * 100) : "-"}
            </p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Best Score Sum</p>
            <p className="metric-value">{bestScoreSum}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Average Score</p>
            <p className="metric-value">{submissions.length > 0 ? formatAverage(averageScore) : "-"}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Average Time</p>
            <p className="metric-value">{judgedSubmissions.length > 0 ? `${formatAverage(averageTimeMs)} ms` : "-"}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Peak Memory</p>
            <p className="metric-value">{peakMemoryKb > 0 ? `${peakMemoryKb} KB` : "-"}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Practice Submissions</p>
            <p className="metric-value">{practiceSubmissions.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Contest Submissions</p>
            <p className="metric-value">{contestSubmissions.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Joined Contests</p>
            <p className="metric-value">{joinedContests.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Organized Contests</p>
            <p className="metric-value">{organizedContests.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Authored Problems</p>
            <p className="metric-value">{authoredProblems.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Public Problems</p>
            <p className="metric-value">{publicAuthoredProblems.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Packaged Problems</p>
            <p className="metric-value">{packagedAuthoredProblems.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">First Submission</p>
            <p className="metric-value">{firstSubmissionAt ? formatDate(firstSubmissionAt) : "-"}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Last Submission</p>
            <p className="metric-value">{lastSubmissionAt ? formatDate(lastSubmissionAt) : "-"}</p>
          </article>
        </div>
      </section>

      <section className="grid-2">
        <article className="panel stack">
          <h2 className="panel-title">Language Breakdown</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Language</th>
                  <th>Submissions</th>
                  <th>Accepted</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {languageStats.map((entry) => (
                  <tr key={entry.language}>
                    <td>{languageLabel(entry.language)}</td>
                    <td>{entry.submissions}</td>
                    <td>{entry.accepted}</td>
                    <td>{entry.submissions > 0 ? formatRate(entry.rate) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel stack">
          <h2 className="panel-title">Verdict Breakdown</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {verdictStats.length === 0 ? (
                  <tr>
                    <td colSpan={2}>No submissions yet.</td>
                  </tr>
                ) : (
                  verdictStats.map((entry) => (
                    <tr key={entry.status}>
                      <td>{submissionStatusLabel(entry.status)}</td>
                      <td>{entry.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="panel">
        <ProfileForm user={user} />
      </section>
    </div>
  );
}
