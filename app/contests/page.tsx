import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForContestStatus,
  badgeClassForVisibility,
  contestStatusLabel,
  formatDate,
  visibilityLabel,
} from "@/lib/presentation";
import {
  canCreateContestByRole,
  getContestStatus,
  getOptionalCurrentUser,
  listContestsForListView,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ContestsPage() {
  const me = await getOptionalCurrentUser();
  const canCreateContest = me ? canCreateContestByRole(me.role) : false;
  const contests = listContestsForListView(me?.id ?? "guest");

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Contests</h1>
          <p className="page-subtitle">
            コンテスト一覧です。状態遷移（scheduled/running/ended）と順位表公開設定を確認できます。
          </p>
        </div>
        <div className="button-row">
          {canCreateContest ? (
            <Link href="/contests/new" className="button">
              新規コンテスト
            </Link>
          ) : null}
        </div>
      </section>

      <section className="panel">
        {contests.length === 0 ? (
          <p className="empty">コンテストが作成されていません。</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Visibility</th>
                  <th>Window</th>
                  <th>Problems</th>
                  <th>Scoreboard</th>
                </tr>
              </thead>
              <tbody>
                {contests.map((contest) => {
                  const status = getContestStatus(contest);
                  return (
                    <tr key={contest.id}>
                      <td>
                        <Link className="link" href={`/contests/${contest.id}`}>
                          {contest.title}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge className={badgeClassForContestStatus(status)}>
                          {contestStatusLabel(status)}
                        </StatusBadge>
                      </td>
                      <td>
                        <StatusBadge className={badgeClassForVisibility(contest.visibility)}>
                          {visibilityLabel(contest.visibility)}
                        </StatusBadge>
                      </td>
                      <td>
                        {formatDate(contest.startAt)} - {formatDate(contest.endAt)}
                      </td>
                      <td>{contest.problems.length}</td>
                      <td>{contest.scoreboardVisibility}</td>
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
