import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmissionForm } from "@/components/submission-form";
import {
  getContestForViewer,
  getCurrentUser,
  getProblemForViewer,
} from "@/lib/store";

interface SubmitPageProps {
  params: Promise<{
    problemId: string;
  }>;
  searchParams: Promise<{
    contestId?: string;
  }>;
}

export default async function SubmitPage({ params, searchParams }: SubmitPageProps) {
  const { problemId } = await params;
  const { contestId } = await searchParams;
  const me = await getCurrentUser();
  const problem = getProblemForViewer(problemId, me.id);

  if (!problem) {
    notFound();
  }

  const contest = contestId ? getContestForViewer(contestId, me.id) : undefined;
  if (contestId && !contest) {
    notFound();
  }

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Submit: {problem.title}</h1>
          <p className="page-subtitle">
            {contest
              ? `コンテスト ${contest.title} への提出です。参加済みかつ開催中の場合のみ受理されます。`
              : "提出後に非同期ジャッジを実行し、提出詳細画面でテストケース別結果を確認できます。"}
          </p>
        </div>
        <div className="button-row">
          <Link className="button button-secondary" href={`/problems/${problem.id}`}>
            問題に戻る
          </Link>
        </div>
      </section>

      <section className="panel">
        <SubmissionForm
          problemId={problem.id}
          allowedLanguages={problem.supportedLanguages}
          contestId={contest?.id ?? null}
        />
      </section>
    </div>
  );
}
