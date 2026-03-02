import Link from "next/link";
import { SubmissionLiveRefresh } from "@/components/submission-live-refresh";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForSubmission,
  formatDate,
  languageLabel,
  submissionStatusLabel,
} from "@/lib/presentation";
import {
  findUser,
  getOptionalCurrentUser,
  getProblemById,
  listSubmissionsForViewer,
} from "@/lib/store";
import { Language, SubmissionStatus } from "@/lib/types";
import {
  isWaitingSubmissionStatus,
  normalizeSubmissionStatus,
  SUBMISSION_STATUS_VALUES,
} from "@/lib/submission-status";

interface SubmissionsPageProps {
  searchParams: Promise<{
    mine?: string;
    userId?: string;
    problemId?: string;
    contestId?: string;
    status?: string;
    language?: string;
    limit?: string;
  }>;
}

const STATUS_FILTER_VALUES: SubmissionStatus[] = SUBMISSION_STATUS_VALUES;

const LANGUAGE_FILTER_VALUES: Language[] = ["cpp", "python", "java", "javascript"];

function parseStatusFilter(raw?: string): SubmissionStatus | undefined {
  return normalizeSubmissionStatus(raw);
}

function parseLanguageFilter(raw?: string): Language | undefined {
  if (!raw) {
    return undefined;
  }
  return LANGUAGE_FILTER_VALUES.find((value) => value === raw);
}

function parseLimitFilter(raw?: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.min(200, Math.floor(parsed));
}

export const dynamic = "force-dynamic";

export default async function SubmissionsPage({ searchParams }: SubmissionsPageProps) {
  const me = await getOptionalCurrentUser();
  const raw = await searchParams;

  const mineRequested = raw.mine === "1";
  const effectiveMine = mineRequested && !!me;

  const submissions = listSubmissionsForViewer(me?.id ?? "guest", {
    userId: effectiveMine ? me?.id : raw.userId?.trim() || undefined,
    problemId: raw.problemId?.trim() || undefined,
    contestId: raw.contestId?.trim() || undefined,
    status: parseStatusFilter(raw.status),
    language: parseLanguageFilter(raw.language),
    limit: parseLimitFilter(raw.limit),
  });

  const hasWaitingSubmission = submissions.some((submission) =>
    isWaitingSubmissionStatus(submission.status),
  );

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Submissions</h1>
          <p className="page-subtitle">
            Filter by user/problem/contest/status/language. Source code is visible only to submitter and admin.
          </p>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Filters</h2>
        {mineRequested && !me ? (
          <p className="badge badge-red">Sign in is required to use &quot;Only me&quot; filter.</p>
        ) : null}

        <form method="GET" className="form">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Mine</span>
              <select className="select" name="mine" defaultValue={raw.mine === "1" ? "1" : "0"}>
                <option value="0">All</option>
                <option value="1">Only me</option>
              </select>
            </label>

            <label className="field">
              <span className="field-label">User ID</span>
              <input className="input" name="userId" defaultValue={raw.userId ?? ""} placeholder="u2" />
            </label>

            <label className="field">
              <span className="field-label">Problem ID</span>
              <input
                className="input"
                name="problemId"
                defaultValue={raw.problemId ?? ""}
                placeholder="p1000"
              />
            </label>

            <label className="field">
              <span className="field-label">Contest ID</span>
              <input
                className="input"
                name="contestId"
                defaultValue={raw.contestId ?? ""}
                placeholder="c1000 or none"
              />
            </label>

            <label className="field">
              <span className="field-label">Status</span>
              <select
                className="select"
                name="status"
                defaultValue={normalizeSubmissionStatus(raw.status) ?? ""}
              >
                <option value="">All</option>
                {STATUS_FILTER_VALUES.map((status) => (
                  <option key={status} value={status}>
                    {submissionStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Language</span>
              <select className="select" name="language" defaultValue={raw.language ?? ""}>
                <option value="">All</option>
                {LANGUAGE_FILTER_VALUES.map((language) => (
                  <option key={language} value={language}>
                    {languageLabel(language)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Limit</span>
              <input className="input" name="limit" defaultValue={raw.limit ?? ""} placeholder="50" />
            </label>
          </div>

          <div className="button-row">
            <button className="button" type="submit">
              Apply
            </button>
            <Link href="/submissions" className="button button-secondary">
              Reset
            </Link>
          </div>
        </form>
      </section>

      <section className="panel">
        <SubmissionLiveRefresh
          status={hasWaitingSubmission ? "queued" : "accepted"}
          message="Some submissions are waiting for judge. The list refreshes automatically."
        />
        {submissions.length === 0 ? (
          <p className="empty">No submissions found for the current filter.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User</th>
                  <th>Problem</th>
                  <th>Language</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Time</th>
                  <th>Memory</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => {
                  const problem = getProblemById(submission.problemId);
                  const user = findUser(submission.userId);
                  return (
                    <tr key={submission.id}>
                      <td>
                        <Link className="link" href={`/submissions/${submission.id}`}>
                          {submission.id}
                        </Link>
                      </td>
                      <td>{user?.displayName ?? submission.userId}</td>
                      <td>
                        {problem ? (
                          <Link className="link" href={`/problems/${problem.id}`}>
                            {problem.title}
                          </Link>
                        ) : (
                          submission.problemId
                        )}
                      </td>
                      <td>{languageLabel(submission.language)}</td>
                      <td>
                        <StatusBadge className={badgeClassForSubmission(submission.status)}>
                          {submissionStatusLabel(submission.status)}
                        </StatusBadge>
                      </td>
                      <td>{submission.score}</td>
                      <td>{submission.totalTimeMs} ms</td>
                      <td>{submission.peakMemoryKb} KB</td>
                      <td>{formatDate(submission.submittedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
