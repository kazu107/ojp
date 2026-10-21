import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownBlock } from "@/components/markdown-block";
import { ContestLivePanel } from "@/components/contest-live-panel";
import { formatDate } from "@/lib/presentation";
import {
  canEditContestByViewer,
  getContestForViewer,
  getContestLiveData,
  getOptionalCurrentUser,
} from "@/lib/store";

export const dynamic = "force-dynamic";
export default async function ContestDetailPage({
  params,
}: {
  params: Promise<{ contestId: string }>;
}) {
  const { t, locale } = await getI18n();
  const { contestId } = await params;
  const user = await getOptionalCurrentUser();
  const contest = getContestForViewer(contestId, user?.id ?? "guest");
  if (!contest) notFound();
  const initial = await getContestLiveData(contestId, user);
  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{contest.title}</h1>
          <p className="page-subtitle">{t("Contest Details")}</p>
        </div>
        <div className="button-row">
          {user && canEditContestByViewer(contest, user.id) ? (
            <Link
              className="button button-secondary"
              href={`/contests/${contestId}/edit`}
            >
              {t("編集")}
            </Link>
          ) : null}
          <Link
            className="button button-danger"
            href={`/reports/new?targetType=contest&targetId=${contestId}`}
          >
            {t("通報")}
          </Link>
        </div>
      </section>
      <section className="panel stack">
        <h2 className="panel-title">{t("Overview")}</h2>
        <MarkdownBlock text={contest.descriptionMarkdown} />
        <p className="text-soft">
          {t("開始: ")}
          {formatDate(contest.startAt, locale)}
          {t(" / 終了: ")}
          {formatDate(contest.endAt, locale)}
          {t(" / Penalty:")}
          {contest.penaltyMinutes}
          {t(" minutes")}
        </p>
      </section>
      <ContestLivePanel initial={initial} signedIn={!!user} />
    </div>
  );
}
