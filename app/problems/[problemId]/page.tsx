import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownBlock } from "@/components/markdown-block";
import { StatusBadge } from "@/components/status-badge";
import {
  badgeClassForVisibility,
  languageLabel,
  visibilityLabel,
} from "@/lib/presentation";
import { getCurrentUser, getProblemForViewer } from "@/lib/store";

interface ProblemDetailPageProps {
  params: Promise<{
    problemId: string;
  }>;
}

export default async function ProblemDetailPage({ params }: ProblemDetailPageProps) {
  const { problemId } = await params;
  const me = getCurrentUser();
  const problem = getProblemForViewer(problemId, me.id);
  if (!problem) {
    notFound();
  }

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{problem.title}</h1>
          <p className="page-subtitle">問題詳細・制約・解説を確認し、そのまま提出できます。</p>
        </div>
        <div className="button-row">
          <StatusBadge className={badgeClassForVisibility(problem.visibility)}>
            {visibilityLabel(problem.visibility)}
          </StatusBadge>
          <Link href={`/problems/${problem.id}/submit`} className="button">
            提出する
          </Link>
          <Link href={`/problems/${problem.id}/edit`} className="button button-secondary">
            編集
          </Link>
          <Link
            href={`/reports/new?targetType=problem&targetId=${problem.id}`}
            className="button button-danger"
          >
            通報
          </Link>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Statement</h2>
        <MarkdownBlock text={problem.statementMarkdown} />
      </section>

      <section className="grid-2">
        <article className="panel stack">
          <h2 className="panel-title">Input</h2>
          <MarkdownBlock text={problem.inputDescription} />
        </article>
        <article className="panel stack">
          <h2 className="panel-title">Output</h2>
          <MarkdownBlock text={problem.outputDescription} />
        </article>
      </section>

      <section className="grid-2">
        <article className="panel stack">
          <h2 className="panel-title">Constraints</h2>
          <MarkdownBlock text={problem.constraintsMarkdown} />
        </article>
        <article className="panel stack">
          <h2 className="panel-title">Judge Settings</h2>
          <p className="text-soft">Time Limit: {problem.timeLimitMs} ms</p>
          <p className="text-soft">Memory Limit: {problem.memoryLimitMb} MB</p>
          <p className="text-soft">
            Languages: {problem.supportedLanguages.map((language) => languageLabel(language)).join(", ")}
          </p>
        </article>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">Explanation</h2>
        <MarkdownBlock text={problem.explanationMarkdown || "解説はまだありません。"} />
      </section>
    </div>
  );
}
