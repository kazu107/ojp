import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForContestStatus,
  badgeClassForSubmission,
  contestStatusLabel,
  formatDate,
} from "@/lib/presentation";
import {
  buildScoreboard,
  getContestStatus,
  getCurrentUser,
  listContestsForListView,
  listPublicProblems,
  listRecentSubmissions,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const me = getCurrentUser();
  const problems = listPublicProblems();
  const contests = listContestsForListView(me.id);
  const submissions = listRecentSubmissions(8);
  const latestContest = contests[0];
  const latestScoreboard = latestContest ? buildScoreboard(latestContest.id) : [];

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">OJP Dashboard</h1>
          <p className="page-subtitle">
            仕様書 `atcoder_like_platform_spec_draft.md` をもとに、問題管理・提出・コンテスト・順位表の
            最小MVP導線を実装したプロトタイプです。
          </p>
        </div>
        <div className="button-row">
          <Link href="/problems/new" className="button">
            問題を作成
          </Link>
          <Link href="/submissions" className="button button-secondary">
            提出履歴
          </Link>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Platform Snapshot</h2>
        <p className="panel-subtitle">
          GitHubログイン想定ユーザー: <span className="kpi">{me.displayName}</span>
        </p>
        <div className="metric-grid">
          <article className="metric-card">
            <p className="metric-label">公開問題数</p>
            <p className="metric-value">{problems.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">コンテスト数</p>
            <p className="metric-value">{contests.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">最近の提出</p>
            <p className="metric-value">{submissions.length}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">順位表エントリ</p>
            <p className="metric-value">{latestScoreboard.length}</p>
          </article>
        </div>
      </section>

      <section className="grid-2">
        <article className="panel stack">
          <div className="page-head">
            <div>
              <h2 className="panel-title">Latest Submissions</h2>
              <p className="panel-subtitle">提出ステータス遷移（AC / WA / TLE / ...）を表示します。</p>
            </div>
            <Link className="link" href="/submissions">
              一覧へ
            </Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Problem</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <tr key={submission.id}>
                    <td>
                      <Link className="link" href={`/submissions/${submission.id}`}>
                        {submission.id}
                      </Link>
                    </td>
                    <td>{submission.problemId}</td>
                    <td>
                      <StatusBadge className={badgeClassForSubmission(submission.status)}>
                        {submission.status}
                      </StatusBadge>
                    </td>
                    <td>{formatDate(submission.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel stack">
          <div className="page-head">
            <div>
              <h2 className="panel-title">Contest State</h2>
              <p className="panel-subtitle">自動状態判定: scheduled / running / ended</p>
            </div>
            <Link className="link" href="/contests">
              一覧へ
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
                開始: {formatDate(latestContest.startAt)} / 終了: {formatDate(latestContest.endAt)}
              </p>
              <Link className="button button-secondary" href={`/contests/${latestContest.id}`}>
                コンテスト詳細と順位表
              </Link>
            </div>
          ) : (
            <p className="empty">コンテストデータはまだありません。</p>
          )}
        </article>
      </section>
    </div>
  );
}
