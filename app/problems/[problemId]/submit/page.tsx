
import { getI18n } from "@/lib/i18n/server";
﻿import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmissionForm } from "@/components/submission-form";
import {
  getContestForViewer,
  getCurrentUser,
  getProblemForViewer,
  getProblemForContestViewer,
  getVirtualParticipationForViewer,
} from "@/lib/store";

interface SubmitPageProps {
  params: Promise<{
    problemId: string;
  }>;
  searchParams: Promise<{
    contestId?: string;
    virtualParticipationId?: string;
  }>;
}

export default async function SubmitPage({ params, searchParams }: SubmitPageProps) {
  const { t } = await getI18n();
  const { problemId } = await params;
  const { contestId, virtualParticipationId } = await searchParams;
  const me = await getCurrentUser();
  const problem = contestId ? getProblemForContestViewer(problemId,contestId,me.id) : getProblemForViewer(problemId, me.id);

  if (!problem) {
    notFound();
  }

  const contest = contestId ? getContestForViewer(contestId, me.id) : undefined;
  if (contestId && !contest) {
    notFound();
  }
  if (virtualParticipationId) {
    const session = contestId ? await getVirtualParticipationForViewer(contestId) : null;
    if (!session || session.id !== virtualParticipationId) notFound();
  }

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Submit: ")}{problem.title}</h1>
          <p className="page-subtitle">
            {virtualParticipationId ? t("Virtual submissions do not affect official standings or ratings.") : contest ? t("Contest submissions count only during the official window. After it ends, submissions are treated as practice.") : t("提出後に非同期ジャッジを実行し、提出詳細画面でテストケース別結果を確認できます。")}
          </p>
        </div>
        <div className="button-row">
          <Link className="button button-secondary" href={`/problems/${problem.id}${contestId?`?contestId=${contestId}${virtualParticipationId?`&virtualParticipationId=${virtualParticipationId}`:""}`:""}`}>
            {t("問題に戻る")}</Link>
        </div>
      </section>

      <section className="panel">
        <SubmissionForm
          interactive={problem.judgeType === "interactive"}
          problemId={problem.id}
          contestId={contest?.id ?? null}
          virtualParticipationId={virtualParticipationId ?? null}
        />
      </section>
    </div>
  );
}
