import { getI18n } from "@/lib/i18n/server";
import { ContestEditorForm } from "@/components/contest-editor-form";
import {
  canCreateContestByRole,
  getCurrentUser,
  listProblemsForListView,
} from "@/lib/store";

async function initialSchedule() {
  const now = Date.now();
  return {
    startAt: new Date(now + 3600_000).toISOString(),
    endAt: new Date(now + 3 * 3600_000).toISOString(),
  };
}

export default async function NewContestPage() {
  const { t } = await getI18n();
  const me = await getCurrentUser();
  const canCreateContest = canCreateContestByRole(me.role);
  const availableProblems = listProblemsForListView(me.id);
  const initialDates = await initialSchedule();

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Create Contest")}</h1>
          <p className="page-subtitle">
            {t(
              "開催期間、問題セット、順位表公開設定を入力してコンテストを作成します。",
            )}
          </p>
        </div>
      </section>
      <section className="panel">
        {canCreateContest ? (
          <ContestEditorForm
            mode="create"
            availableProblems={availableProblems}
            initialDates={initialDates}
          />
        ) : (
          <p className="badge badge-red">
            {t(
              "You need `contest_organizer` (or admin) role to create contests.",
            )}
          </p>
        )}
      </section>
    </div>
  );
}
