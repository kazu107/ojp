
import { getI18n } from "@/lib/i18n/server";
import { AdminConsole } from "@/components/admin-console";
import {
  getJudgeQueueDiagnosticsForAdmin,
  getCurrentUser,
  listAnnouncementsForAdmin,
  listAuditLogsForAdmin,
  listContestsForListView,
  listProblemsForListView,
  listRejudgeRequestsForAdmin,
  listReportsForAdmin,
  listUsers,
} from "@/lib/store";
import { formatDate } from "@/lib/presentation";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { t, locale } = await getI18n();
  const me = await getCurrentUser();
  const reports = await listReportsForAdmin();
  const announcements = await listAnnouncementsForAdmin();
  const users = listUsers();
  const problems = listProblemsForListView(me.id);
  const contests = listContestsForListView(me.id);
  const audits = await listAuditLogsForAdmin(15);
  const rejudgeRequests = await listRejudgeRequestsForAdmin(20);
  const judgeQueueDiagnostics = await getJudgeQueueDiagnosticsForAdmin();

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">{t("Admin")}</h1>
        </div>
      </section>

      <section className="panel stack">
        <h2 className="panel-title">{t("Audit Logs")}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Date and Time")}</th>
                <th>{t("Action")}</th>
                <th>{t("Target")}</th>
                <th>{t("Reason")}</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.createdAt, locale)}</td>
                  <td>{log.action}</td>
                  <td>
                    {log.targetType}:{log.targetId}
                  </td>
                  <td>{log.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AdminConsole
        users={users}
        problems={problems}
        contests={contests}
        announcements={announcements}
        reports={reports}
        rejudgeRequests={rejudgeRequests}
        judgeQueueDiagnostics={judgeQueueDiagnostics}
      />
    </div>
  );
}
