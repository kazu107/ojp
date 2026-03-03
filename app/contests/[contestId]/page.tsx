import Link from "next/link";
import { notFound } from "next/navigation";
import { ContestJoinButton } from "@/components/contest-join-button";
import { MarkdownBlock } from "@/components/markdown-block";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForContestStatus,
  badgeClassForDifficulty,
  contestStatusLabel,
  difficultyLabel,
  formatDate,
} from "@/lib/presentation";
import {
  buildVisibleScoreboard,
  canEditContestByViewer,
  canViewScoreboardDetails,
  findUser,
  getContestForViewer,
  getContestStatus,
  getOptionalCurrentUser,
  listContestProblems,
} from "@/lib/store";

interface ContestDetailPageProps {
  params: Promise<{
    contestId: string;
  }>;
}

export default async function ContestDetailPage({ params }: ContestDetailPageProps) {
  const { contestId } = await params;
  const me = await getOptionalCurrentUser();
  const contest = getContestForViewer(contestId, me?.id ?? "guest");
  if (!contest) {
    notFound();
  }

  const status = getContestStatus(contest);
  const contestProblems = listContestProblems(contest);
  const scoreboard = buildVisibleScoreboard(contest.id);
  const showPerProblem = canViewScoreboardDetails(contest);
  const joined = me ? contest.participantUserIds.includes(me.id) : false;
  const canEditContest = me ? canEditContestByViewer(contest, me.id) : false;
  const signInUrl = `/signin?callbackUrl=${encodeURIComponent(`/contests/${contest.id}`)}`;

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{contest.title}</h1>
          <p className="page-subtitle">
            コンテスト詳細と順位表です。順位表の公開粒度は `scoreboardVisibility` と開催状態で制御されます。
          </p>
        </div>
        <div className="button-row">
          <StatusBadge className={badgeClassForContestStatus(status)}>
            {contestStatusLabel(status)}
          </StatusBadge>
          {canEditContest ? (
            <Link href={`/contests/${contest.id}/edit`} className="button button-secondary">
              編集
            </Link>
          ) : null}
          <Link
            href={`/reports/new?targetType=contest&targetId=${contest.id}`}
            className="button button-danger"
          >
            通報
          </Link>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Overview</h2>
        <MarkdownBlock text={contest.descriptionMarkdown} />
        <p className="text-soft">
          開始: {formatDate(contest.startAt)} / 終了: {formatDate(contest.endAt)} / Penalty:{" "}
          {contest.penaltyMinutes} minutes
        </p>
        <p className="text-soft">
          Scoreboard mode: {contest.scoreboardVisibility} / Joined: {joined ? "yes" : "no"}
        </p>
        {me ? (
          <ContestJoinButton contestId={contest.id} />
        ) : (
          <Link href={signInUrl} className="button">
            Sign in to join
          </Link>
        )}
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Problems</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Title</th>
                <th>Difficulty</th>
                <th>Score</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {contestProblems.map((item) => (
                <tr key={`${contest.id}-${item.label}`}>
                  <td>{item.label}</td>
                  <td>{item.problem?.title ?? item.problemId}</td>
                  <td>
                    {item.problem ? (
                      <StatusBadge className={badgeClassForDifficulty(item.problem.difficulty)}>
                        {difficultyLabel(item.problem.difficulty)}
                      </StatusBadge>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{item.score}</td>
                  <td>
                    {item.problem ? (
                      <div className="button-row">
                        <Link className="link" href={`/problems/${item.problem.id}`}>
                          View
                        </Link>
                        <Link
                          className="link"
                          href={`/problems/${item.problem.id}/submit?contestId=${contest.id}`}
                        >
                          Submit
                        </Link>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Scoreboard</h2>
        {scoreboard.detailLevel === "hidden" ? (
          <p className="empty">このコンテストの順位表は終了後に公開されます。</p>
        ) : scoreboard.rows.length === 0 ? (
          <p className="empty">順位表データがありません。</p>
        ) : (
          <>
            {scoreboard.detailLevel === "summary" ? (
              <p className="text-soft">
                現在は summary モードです。問題別の詳細はコンテスト終了後に公開されます。
              </p>
            ) : null}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>User</th>
                    <th>Total</th>
                    <th>Penalty</th>
                    {showPerProblem
                      ? contestProblems.map((problem) => <th key={problem.label}>{problem.label}</th>)
                      : null}
                  </tr>
                </thead>
                <tbody>
                  {scoreboard.rows.map((row) => (
                    <tr key={row.userId}>
                      <td>{row.rank}</td>
                      <td>{findUser(row.userId)?.displayName ?? row.userId}</td>
                      <td>{row.totalScore}</td>
                      <td>{row.penalty}</td>
                      {showPerProblem
                        ? row.cells.map((cell) => (
                            <td key={`${row.userId}-${cell.label}`}>
                              <div className="stack">
                                <strong>{cell.score}</strong>
                                <span className="text-soft">Fail:{cell.wrongSubmissions}</span>
                              </div>
                            </td>
                          ))
                        : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
