import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";

export async function ProblemResultLinks({ problemId, contestId, virtualParticipationId, heuristic }: {
  problemId: string; contestId?: string; virtualParticipationId?: string; heuristic: boolean;
}) {
  const { t } = await getI18n();
  const contest = contestId ? { contestId } : {};
  return <>
    <Link className="button button-secondary" href={{ pathname: "/submissions", query: { problemId, ...contest } }}>
      {t("Problem Submissions")}
    </Link>
    {heuristic ? <Link className="button button-secondary" href={{
      pathname: `/problems/${encodeURIComponent(problemId)}/standings`,
      query: { ...contest, ...(contestId && virtualParticipationId ? { virtualParticipationId } : {}) },
    }}>{t("Problem Standings")}</Link> : null}
  </>;
}
