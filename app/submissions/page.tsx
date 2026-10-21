
import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { SubmissionLiveRefresh } from "@/components/submission-live-refresh";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForDifficulty,
  badgeClassForSubmission,
  difficultyLabel,
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
  const { t, locale } = await getI18n();
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
          <h1 className="page-title">{t("Submissions")}</h1>
          <p className="page-subtitle">
            {t("Filter by user/problem/contest/status/language. Source code is visible only to submitter and admin.")}</p>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">{t("Filters")}</h2>
        {mineRequested && !me ? (
          <p className="badge badge-red">{t("Sign in is required to use \"Only me\" filter.")}</p>
        ) : null}

        <form method="GET" className="form">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">{t("Mine")}</span>
              <select className="select" name="mine" defaultValue={raw.mine === "1" ? "1" : "0"}>
                <option value="0">{t("All")}</option>
                <option value="1">{t("Only me")}</option>
              </select>
            </label>

            <label className="field">
              <span className="field-label">{t("User ID")}</span>
              <input className="input" name="userId" defaultValue={raw.userId ?? ""} placeholder={t("u2")} />
            </label>

            <label className="field">
              <span className="field-label">{t("Problem ID")}</span>
              <input
                className="input"
                name="problemId"
                defaultValue={raw.problemId ?? ""}
                placeholder={t("p1000")}
              />
            </label>

            <label className="field">
              <span className="field-label">{t("Contest ID")}</span>
              <input
                className="input"
                name="contestId"
                defaultValue={raw.contestId ?? ""}
                placeholder={t("c1000 or none")}
              />
            </label>

            <label className="field">
              <span className="field-label">{t("Status")}</span>
              <select
                className="select"
                name="status"
                defaultValue={normalizeSubmissionStatus(raw.status) ?? ""}
              >
                <option value="">{t("All")}</option>
                {STATUS_FILTER_VALUES.map((status) => (
                  <option key={status} value={status}>
                    {t(submissionStatusLabel(status))}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">{t("Language")}</span>
              <select className="select" name="language" defaultValue={raw.language ?? ""}>
                <option value="">{t("All")}</option>
                {LANGUAGE_FILTER_VALUES.map((language) => (
                  <option key={language} value={language}>
                    {languageLabel(language)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">{t("Limit")}</span>
              <input className="input" name="limit" defaultValue={raw.limit ?? ""} placeholder="50" />
            </label>
          </div>

          <div className="button-row">
            <button className="button" type="submit">
              {t("Apply")}</button>
            <Link href="/submissions" className="button button-secondary">
              {t("Reset")}</Link>
          </div>
        </form>
      </section>

      <section className="panel">
        <SubmissionLiveRefresh
          status={hasWaitingSubmission ? "queued" : "accepted"}
          message="Some submissions are waiting for judge. The list refreshes automatically."
        />
        {submissions.length === 0 ? (
          <p className="empty">{t("No submissions found for the current filter.")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("ID")}</th>
                  <th>{t("User")}</th>
                  <th>{t("Problem")}</th>
                  <th>{t("Difficulty")}</th>
                  <th>{t("Language")}</th>
                  <th>{t("Status")}</th>
                  <th>{t("Score")}</th>
                  <th>{t("Time")}</th>
                  <th>{t("Memory")}</th>
                  <th>{t("Submitted")}</th>
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
                      <td>
                        {problem ? (
                          <StatusBadge className={badgeClassForDifficulty(problem.difficulty)}>
                            {t(difficultyLabel(problem.difficulty))}
                          </StatusBadge>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{languageLabel(submission.language)}</td>
                      <td>
                        <StatusBadge className={badgeClassForSubmission(submission.status)}>
                          {t(submissionStatusLabel(submission.status))}
                        </StatusBadge>
                      </td>
                      <td>{submission.score}</td>
                      <td>{submission.totalTimeMs} {t(" ms")}</td>
                      <td>{submission.peakMemoryKb} {t(" KB")}</td>
                      <td>{formatDate(submission.submittedAt, locale)}</td>
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
