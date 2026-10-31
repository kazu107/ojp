import { problemTags, studyEntry } from "@/lib/problem-workspace-store";
import { ProblemStudy } from "@/components/problem-study";

import { getI18n } from "@/lib/i18n/server";
﻿import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownBlock } from "@/components/markdown-block";
import { ProblemSamplesSection } from "@/components/problem-samples-section";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForDifficulty,
  badgeClassForVisibility,
  difficultyLabel,
  testCaseVisibilityLabel,
  visibilityLabel,
} from "@/lib/presentation";
import {
  canEditProblemByViewer,
  getOptionalCurrentUser,
  getProblemForViewer,
  getProblemForContestViewer,
} from "@/lib/store";
import { getJudgeEnvironmentVersion } from "@/lib/judge-config";
import { SubmissionForm } from "@/components/submission-form";

interface ProblemDetailPageProps {
  params: Promise<{
    problemId: string;
  }>;
  searchParams: Promise<{contestId?:string;virtualParticipationId?:string}>;
}

export default async function ProblemDetailPage({ params, searchParams }: ProblemDetailPageProps) {
  const { t } = await getI18n();
  const { problemId } = await params;
  const {contestId,virtualParticipationId} = await searchParams;
  const contextQuery = contestId ? `?contestId=${encodeURIComponent(contestId)}${virtualParticipationId?`&virtualParticipationId=${encodeURIComponent(virtualParticipationId)}`:""}` : "";
  const me = await getOptionalCurrentUser();
  const viewerId = me?.id ?? "guest";
  const judgeEnvironmentVersion = getJudgeEnvironmentVersion();
  const problem = contestId ? getProblemForContestViewer(problemId,contestId,viewerId) : getProblemForViewer(problemId, viewerId);
  if (!problem) {
    notFound();
  }

  const tags=(await problemTags([problem.id])).get(problem.id) ?? [];
  const study=me ? await studyEntry(me.id, problem.id) : null;
  const canEditProblem = me ? canEditProblemByViewer(problem, me.id) : false;
  const signInUrl = `/signin?callbackUrl=${encodeURIComponent(`/problems/${problem.id}${contextQuery}`)}`;

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{problem.title}</h1>
          <p className="page-subtitle">{t("問題詳細と制約を確認し、そのまま提出できます。")}</p>
        </div>
        <div className="button-row">
          <StatusBadge className={badgeClassForVisibility(problem.visibility)}>
            {t(visibilityLabel(problem.visibility))}
          </StatusBadge>
          <Link href={`/problems/${problem.id}/submit${contextQuery}`} className="button">
            {t("提出する")}</Link>
          <Link href={`/problems/${problem.id}/explanation${contextQuery}`} className="button button-secondary">
            {t("解説")}</Link>
          {canEditProblem ? (
            <Link href={`/problems/${problem.id}/edit`} className="button button-secondary">
              {t("編集")}</Link>
          ) : null}
          <Link
            href={`/reports/new?targetType=problem&targetId=${problem.id}`}
            className="button button-danger"
          >
            {t("通報")}</Link>
        </div>
      </section>

      {tags.length ? <div className="button-row">{tags.map(tag=><Link className="badge badge-blue" key={tag} href={`/problems?tag=${encodeURIComponent(tag)}`}>{tag}</Link>)}</div> : null}
      <section className="panel stack">
        <h2 className="panel-title">{t("Statement")}</h2>
        <MarkdownBlock text={problem.statementMarkdown} />
      </section>

      <section className="grid-2">
        <article className="panel stack">
          <h2 className="panel-title">{t("Input")}</h2>
          <MarkdownBlock text={problem.inputDescription} />
        </article>
        <article className="panel stack">
          <h2 className="panel-title">{t("Output")}</h2>
          <MarkdownBlock text={problem.outputDescription} />
        </article>
      </section>

      <section className="grid-2">
        <article className="panel stack">
          <h2 className="panel-title">{t("Constraints")}</h2>
          <MarkdownBlock text={problem.constraintsMarkdown} />
        </article>
        <article className="panel stack">
          <h2 className="panel-title">{t("Judge Settings")}</h2>
          <p className="text-soft">
            {t("Difficulty:")}{" "}
            <StatusBadge className={badgeClassForDifficulty(problem.difficulty)}>
              {t(difficultyLabel(problem.difficulty))}
            </StatusBadge>
          </p>
          <p className="text-soft">{t("Time Limit: ")}{problem.timeLimitMs} {t(" ms")}</p>
          <p className="text-soft">{t("Memory Limit: ")}{problem.memoryLimitMb} {t(" MB")}</p>
          <p className="text-soft">
            {t("Test Case Visibility: ")}{t(testCaseVisibilityLabel(problem.testCaseVisibility))}
          </p>
          <p className="text-soft">{t("Judge Environment: ")}{judgeEnvironmentVersion}</p>
        </article>
      </section>

      <ProblemSamplesSection
        initialSamples={problem.sampleCases}
        loadUrl={
          problem.sampleCases.length === 0 && (problem.latestPackageSummary?.samplePairs ?? 0) > 0
            ? `/api/problems/${problem.id}/samples${contextQuery}`
            : undefined
        }
        samplePairCount={problem.latestPackageSummary?.samplePairs ?? problem.sampleCases.length}
      />

      <section className="panel stack">
        <h2 className="panel-title">{t("Submit")}</h2>
        {me ? (
          <>
            <p className="text-soft">
              {t("このページの下から直接提出できます。提出後は非同期ジャッジされ、提出詳細で結果を確認できます。")}</p>
            <SubmissionForm interactive={problem.judgeType === "interactive"} problemId={problem.id} contestId={contestId ?? null} virtualParticipationId={virtualParticipationId ?? null}/>
          </>
        ) : (
          <>
            <p className="text-soft">
              {t("提出するにはログインが必要です。ログイン後、この問題ページに戻ります。")}</p>
            <div className="button-row">
              <Link href={signInUrl} className="button">
                {t("Sign In to Submit")}</Link>
            </div>
          </>
        )}
      </section>
      {me ? <ProblemStudy problemId={problem.id} initial={study ? {...study,reviewAt:study.reviewAt?.toISOString() ?? null} : null} /> : null}
    </div>
  );
}
